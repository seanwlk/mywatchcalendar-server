import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserStats(userId: string) {
    const totalSeries = await this.prisma.followedSeries.count({
      where: { 
        userId
      },
    });

    const totalEpisodesWatched = await this.prisma.watchProgress.count({
      where: { userId },
    });
    const progressRecords = await this.prisma.watchProgress.findMany({
      where: { userId },
      select: {
        episode: {
          select: { runtime: true },
        },
      },
    });

    const totalTimeMinutes = progressRecords.reduce((sum, record) => {
      return sum + (record.episode?.runtime || 0);
    }, 0);

    return {
      totalSeries,
      totalEpisodesWatched,
      totalTimeMinutes,
    };
  }

  async getUserHistory(userId: string, start: Date, end: Date) {
    const records = await this.prisma.watchProgress.findMany({
      where: {
        userId,
        watchedAt: { gte: start, lte: end },
      },
      select: {
        watchedAt: true,
        episode: {
          select: { runtime: true },
        },
      },
      orderBy: { watchedAt: 'desc' },
    });

    const olderRecordsCount = await this.prisma.watchProgress.count({
      where: {
        userId,
        watchedAt: { lt: start },
      },
    });

    return {
      hasMore: olderRecordsCount > 0,
      records: records.map((r) => ({
        date: r.watchedAt.toISOString(),
        runtime: r.episode?.runtime || 0,
      })),
    };
  }
}