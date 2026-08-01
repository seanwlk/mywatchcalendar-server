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
}