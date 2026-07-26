import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SeriesSyncProducer {
  private readonly logger = new Logger(SeriesSyncProducer.name);

  constructor(
    @InjectQueue('series-sync') private syncQueue: Queue,
    private prisma: PrismaService,
  ) {}

  async syncSingleSeries(tmdbId: number, requestUser?: string) {
    await this.syncQueue.add('series-sync', { tmdbId, requestUser });
    this.logger.log(`Added series ${tmdbId} to sync queue`);
  }

  // Once a month run a full sync
  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async fullMetadataSync() {
    this.logger.log('Starting monthly series update cron...');

    const allSeries: [{ tmdbId: number }] = await this.prisma.$queryRaw`
      SELECT ("externalIds"->>'tmdb')::int as "tmdbId" 
      FROM "Series"
    `;

    for (const series of allSeries) {
      await this.syncQueue.add('metadata-sync', { tmdbId: series.tmdbId });
    }
  }

  // Daily update only running series followed by users
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async upcomingMetadataSync() {
    this.logger.log('Starting upcoming update cron...');

    const activeSeries: [{ tmdbId: number }] = await this.prisma.$queryRaw`
      SELECT DISTINCT (s."externalIds"->>'tmdb')::int as "tmdbId"
      FROM "Series" s
      JOIN "FollowedSeries" fs ON fs."seriesId" = s.id 
      LEFT JOIN "Episode" e ON e."seriesId" = s.id 
      WHERE fs.status != 'DROPPED'
        AND (
          s.in_prod = true 
          OR s.status IN ('Returning Series', 'In Production', 'Planned')
          OR e."airDate" IS NULL  
          OR e."airDate" >= (CURRENT_DATE - INTERVAL '7 days')
        )
    `;

    for (const series of activeSeries) {
      if (series.tmdbId) {
        await this.syncQueue.add('upcoming-sync', { tmdbId: series.tmdbId });
      }
    }
  }
}
