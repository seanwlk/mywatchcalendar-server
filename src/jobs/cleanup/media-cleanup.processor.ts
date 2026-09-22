import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Processor('cleanup-media')
export class MediaCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaCleanupProcessor.name);

  constructor(private prisma: PrismaService) {
    super();
  }

  async process(job: Job): Promise<{ count: number; deletedSeries: string[] }> {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - 7);

    const orphanedSeries = await this.prisma.series.findMany({
      where: {
        updatedAt: { lt: thresholdDate },
        followers: { none: {} }, 
        episodes: {
          none: {
            watchProgress: { some: {} }, 
          },
        },
      },
      select: { 
        id: true,
        title: true 
      },
    });

    if (orphanedSeries.length === 0) {
      this.logger.log('No orphaned media found. Cleanup complete.');
      return { count: 0, deletedSeries: [] };
    }

    const seriesIds = orphanedSeries.map((s) => s.id);
    const seriesTitles = orphanedSeries.map((s) => s.title);

    const result = await this.prisma.series.deleteMany({
      where: { id: { in: seriesIds } },
    });

    this.logger.log(`Cleanup complete. Deleted ${result.count} orphaned series.`);
    
    return {
      count: result.count,
      deletedSeries: seriesTitles,
    };
  }
}