import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Processor('cleanup-sessions')
export class TokenCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(TokenCleanupProcessor.name);

  constructor(private prisma: PrismaService) {
    super();
  }

  async process(job: Job): Promise<number> {
    this.logger.log('Starting expired token cleanup...');

    const result = await this.prisma.refreshTokenSession.deleteMany({
      where: { 
        OR :[
          { expiresAt: { lt: new Date() } },
          { revokedAt: { lt: new Date() } }
        ]
      },
    });

    this.logger.log(`Cleanup complete. Deleted ${result.count} expired sessions.`);
    return result.count;
  }
}