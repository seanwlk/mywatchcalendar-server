import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TmdbService } from '../tmdb/tmdb.service';
import { SeriesSyncProducer } from '../jobs/series-sync/series-sync.producer';

@Injectable()
export class SeriesService {
  constructor(
    private readonly prisma: PrismaService,
    private tmdbService: TmdbService,
    private seriesSyncProducer: SeriesSyncProducer,
  ) {}

  async getUnwatched(userId: string, page: number, pageSize: number) {
    const skip = (page - 1) * pageSize;

    const follows = await this.prisma.followedSeries.findMany({
      where: { userId, status: { not: 'DROPPED' } },
      select: { seriesId: true },
    });

    const seriesIds = follows.map((follow) => follow.seriesId);
    if (seriesIds.length === 0) {
      return {
        items: [],
        page,
        pageSize,
        total: 0,
        hasMore: false,
      };
    }

    const episodes = await this.prisma.episode.findMany({
      where: {
        seriesId: { in: seriesIds },
        seasonNumber: { not: 0 },
        airDate: {
          lte: new Date(),
        },
        watchProgress: { none: { userId } },
      },
      include: { series: true },
      orderBy: [{ seriesId: 'asc' }, { seasonNumber: 'asc' }, { episodeNumber: 'asc' }],
    });

    const unwatchedStats = new Map<string, { nextEpisode: (typeof episodes)[0], count: number }>();
    for (const episode of episodes) {
      if (!unwatchedStats.has(episode.seriesId)) {
        unwatchedStats.set(episode.seriesId, { nextEpisode: episode, count: 1 });
      } else {
        unwatchedStats.get(episode.seriesId)!.count++;
      }
    }

    const activeSeriesIds = Array.from(unwatchedStats.keys());
    const lastWatchedMap = new Map<string, number>();

    await Promise.all(
      activeSeriesIds.map(async (seriesId) => {
        const latest = await this.prisma.watchProgress.findFirst({
          where: { userId, episode: { seriesId } },
          orderBy: { watchedAt: 'desc' },
          select: { watchedAt: true },
        });
        lastWatchedMap.set(seriesId, latest?.watchedAt.getTime() || 0);
      })
    );

    const unsortedItems = Array.from(unwatchedStats.values()).map(({ nextEpisode, count }) => {
      return {
        seriesId: nextEpisode.series.id,
        seriesTitle: nextEpisode.series.title,
        overview: nextEpisode.series.overview,
        posterUrl: nextEpisode.series.posterUrl,
        releaseDate: nextEpisode.series.releaseDate,
        status: nextEpisode.series.status,
        latestEpisode: {
          id: nextEpisode.id,
          seasonNumber: nextEpisode.seasonNumber,
          episodeNumber: nextEpisode.episodeNumber,
          title: nextEpisode.title,
          posterUrl: nextEpisode.posterUrl,
          airDate: nextEpisode.airDate,
          overview: nextEpisode.overview,
          episodesLeft: count - 1,
        },
        watched: false,
        rewatchCount: 0,
        _lastWatchedAt: lastWatchedMap.get(nextEpisode.seriesId) || 0,
      };
    });

    unsortedItems.sort((a, b) => {
      if (a.latestEpisode.episodesLeft !== b.latestEpisode.episodesLeft) {
        return a.latestEpisode.episodesLeft - b.latestEpisode.episodesLeft;
      }
      return b._lastWatchedAt - a._lastWatchedAt;
    });

    const total = unsortedItems.length;

    const items = unsortedItems.slice(skip, skip + pageSize).map((item) => {
      const { _lastWatchedAt, ...cleanItem } = item;
      return cleanItem;
    });

    return {
      items,
      page,
      pageSize,
      total,
      hasMore: page * pageSize < total,
    };
  }

  async getCalendar(userId: string, page: number, pageSize: number, direction: 'past' | 'future' = 'future') {
    const skip = (page - 1) * pageSize;

    const pivotDate = new Date();
    pivotDate.setHours(0, 0, 0, 0);
    const dateFilter = direction === 'future'
      ? { gte: pivotDate }
      : { lt: pivotDate };

    const orderBy = direction === 'future'
      ? [
          { airDate: 'asc' as const },
          { seriesId: 'asc' as const },
          { seasonNumber: 'asc' as const },
          { episodeNumber: 'asc' as const },
        ]
      : [
          { airDate: 'desc' as const },
          { seriesId: 'desc' as const },
          { seasonNumber: 'desc' as const },
          { episodeNumber: 'desc' as const },
        ];

    const follows = await this.prisma.followedSeries.findMany({ 
      where: { userId, status: { not: 'DROPPED' } },
      select: { seriesId: true },
    });
    const seriesIds = follows.map((f) => f.seriesId);

    if (seriesIds.length === 0) {
      return { items: [], page, pageSize, total: 0, hasMore: false };
    }

    const [items, total] = await Promise.all([
      this.prisma.episode.findMany({
        where: { airDate: dateFilter, seriesId: { in: seriesIds } },
        include: { series: true },
        orderBy: orderBy,
        skip,
        take: pageSize,
      }),
      this.prisma.episode.count({ where: { airDate: dateFilter, seriesId: { in: seriesIds } } }),
    ]);

    const episodeIds = items.map((e) => e.id);
    const watchRecords = await this.prisma.watchProgress.groupBy({
      by: ['episodeId'],
      where: { userId, episodeId: { in: episodeIds } },
      _count: { _all: true },
    });

    const watchCounts = new Map(watchRecords.map((wr) => [wr.episodeId, wr._count._all]));

    const enriched = items.map((episode) => {
      const count = watchCounts.get(episode.id) || 0;
      
      return {
        seriesId: episode.series.id,
        seriesTitle: episode.series.title,
        overview: episode.series.overview,
        posterUrl: episode.series.posterUrl,
        releaseDate: episode.series.releaseDate,
        status: episode.series.status,
        latestEpisode: {
          id: episode.id,
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber,
          title: episode.title,
          posterUrl: episode.posterUrl,
          airDate: episode.airDate,
          overview: episode.overview,
        },
        watched: count > 0,
        rewatchCount: count,
        isFollowed: true,
      };
    });

    return {
      items: enriched,
      page,
      pageSize,
      total,
      hasMore: page * pageSize < total,
    };
  }

  async getFollowed(userId: string, page: number, pageSize: number) {
    const skip = (page - 1) * pageSize;

    const [follows, total] = await Promise.all([
      this.prisma.followedSeries.findMany({
        where: { userId },
        include: { series: true },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.followedSeries.count({ where: { userId } }),
    ]);

    const items = await Promise.all(
      follows.map(async (follow) => {
        
        const totalEpisodes = await this.prisma.episode.count({
          where: {
            seriesId: follow.seriesId,
            seasonNumber: { not: 0 },
          },
        });

        const watchedGroup = await this.prisma.watchProgress.groupBy({
          by: ['episodeId'],
          where: {
            userId,
            episode: {
              seriesId: follow.seriesId,
              seasonNumber: { not: 0 },
            },
          },
        });

        return {
          id: follow.series.id,
          title: follow.series.title,
          overview: follow.series.overview,
          posterUrl: follow.series.posterUrl,
          releaseDate: follow.series.releaseDate,
          status: follow.series.status,
          isDropped: follow.status === 'DROPPED',
          progress: {
            total: totalEpisodes,
            watched: watchedGroup.length,
          },
        };
      })
    );

    return {
      items,
      page,
      pageSize,
      total,
      hasMore: page * pageSize < total,
    };
  }

  async search(userId: string, query: string, page: number, pageSize: number) {
    const tmdbResponse = await this.tmdbService.searchSeries(query, page);

    const tmdbResults = tmdbResponse?.results || [];
    const tmdbTotal = tmdbResponse?.total || 0;

    if (!tmdbResults || tmdbResults.length === 0) {
      return { items: [], page, pageSize, total: 0, hasMore: false };
    }

    const tmdbIds = tmdbResults.map((r: any) => r.tmdbId);

    const localSeries = await this.prisma.series.findMany({
      where: {
        OR: tmdbIds.map((id) => ({
          externalIds: {
            path: ['tmdb'],
            equals: id,
          },
        })),
      },
      select: {
        id: true,
        externalIds: true,
        followers: {
          where: { userId: userId },
          select: { id: true },
        },
      },
    });

    const localSeriesMap = new Map();
    for (const series of localSeries) {
      const tmdbId = (series.externalIds as any)?.tmdb;
      if (tmdbId) {
        localSeriesMap.set(tmdbId, series);
      }
    }

    const enrichedItems = tmdbResults.map((tmdbItem: any) => {
      const localMatch = localSeriesMap.get(tmdbItem.tmdbId);

      return {
        id: localMatch ? localMatch.id : `tmdb_${tmdbItem.tmdbId}`,
        title: tmdbItem.title,
        overview: tmdbItem.overview,
        releaseDate: tmdbItem.releaseDate,
        posterUrl: tmdbItem.posterUrl,
        status: tmdbItem.status,
        isFollowed: localMatch ? localMatch.followers.length > 0 : false,
      };
    });

    return {
      items: enrichedItems,
      page,
      pageSize: 20, // TMDB returns only a fixed page of 20 results
      total: Math.max(tmdbTotal, enrichedItems.length),
      hasMore: page * 20 < tmdbTotal, 
    };
  }

  async followSeries(userId: string, seriesId: string) {
    const isTmdb = seriesId.startsWith("tmdb_");

    const series = await this.prisma.series.findFirst({
      where: isTmdb ? {
        externalIds: {
          path: ['tmdb'],
          equals: parseInt(seriesId.replace('tmdb_',''),10),
        }} : { id: seriesId },
    });

    if (!series){
      const tmdbId = parseInt(seriesId.replace('tmdb_', ''), 10);
      await this.seriesSyncProducer.syncSingleSeries(tmdbId, userId);
      return { 
        status: 'syncing', 
        message: 'Series is syncing in the background. It will appear in your list shortly.' 
      };
    }

    seriesId = isTmdb ? series.id : seriesId;

    return this.prisma.followedSeries.upsert({
      where: { userId_seriesId: { userId, seriesId } },
      create: { userId, seriesId, status: 'WATCHING' },
      update: { status: 'WATCHING' },
    });
  }

  async unfollowSeries(userId: string, seriesId: string) {
    await this.prisma.followedSeries.deleteMany({ where: { userId, seriesId } });
    return { success: true };
  }

  async updateSeriesStatus(userId: string, seriesId: string, status: 'WATCHING' | 'DROPPED' | 'COMPLETED') {
    return this.prisma.followedSeries.upsert({
      where: { userId_seriesId: { userId, seriesId } },
      create: { userId, seriesId, status },
      update: { status },
    });
  }

  async getSeriesDetails(userId: string, seriesId: string) {
    const isTmdb = seriesId.startsWith("tmdb_");

    const series = await this.prisma.series.findFirst({
      where: isTmdb ? {
        externalIds: {
          path: ['tmdb'],
          equals: parseInt(seriesId.replace('tmdb_',''),10),
        }} : { id: seriesId },
      include: { episodes: { orderBy: [{ seasonNumber: 'asc' }, { episodeNumber: 'asc' }] } },
    });

    if (!series) return null;

    const [watchRecords, followRecord] = await Promise.all([
      this.prisma.watchProgress.groupBy({
        by: ['episodeId'],
        where: {
          userId,
          episode: { seriesId },
        },
        _count: { _all: true },
      }),
      this.prisma.followedSeries.findFirst({
        where: isTmdb
          ? {
              userId,
              series: {
                externalIds: { path: ['tmdb'], equals: parseInt(seriesId.replace('tmdb_',''),10), },
              },
            }
          : {
              userId,
              seriesId,
            },
        select: { status: true },
      })
    ]);

    const watchCounts = new Map(watchRecords.map((wr) => [wr.episodeId, wr._count._all]));

    const seasonsMap = new Map();
    for (const episode of series.episodes) {
      if (!seasonsMap.has(episode.seasonNumber)) {
        seasonsMap.set(episode.seasonNumber, {
          number: episode.seasonNumber,
          episodes: [],
        });
      }
      
      const count = watchCounts.get(episode.id) || 0;

      seasonsMap.get(episode.seasonNumber).episodes.push({
        id: episode.id,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        title: episode.title,
        posterUrl: episode.posterUrl,
        airDate: episode.airDate,
        overview: episode.overview,
        watched: count > 0,
        rewatchCount: count,
      });
    }

    return {
      id: series.id,
      title: series.title,
      externalIds: series.externalIds,
      overview: series.overview,
      posterUrl: series.posterUrl,
      releaseDate: series.releaseDate,
      status: series.status,
      isFollowed: followRecord !== null,
      isDropped: followRecord?.status === 'DROPPED',
      seasons: Array.from(seasonsMap.values()),
    };
  }

  async getEpisodeDetails(userId: string, episodeId: string) {
    const episode = await this.prisma.episode.findUnique({
      where: { id: episodeId },
      include: { series: true },
    });

    if (!episode) return null;

    const watchRecords = await this.prisma.watchProgress.findMany({
      where: { userId, episodeId },
      orderBy: { watchedAt: 'desc' },
    });

    return {
      seriesId: episode.series.id,
      seriesTitle: episode.series.title,
      overview: episode.series.overview,
      posterUrl: episode.series.posterUrl,
      status: episode.series.status,
      releaseDate: episode.series.releaseDate,
      episode: {
        id: episode.id,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        title: episode.title,
        posterUrl: episode.posterUrl,
        airDate: episode.airDate,
        overview: episode.overview,
      },
      watched: watchRecords.length > 0,
      rewatchCount: watchRecords.length,
      history: watchRecords.map((wr) => ({
        id: wr.id,
        watchedAt: wr.watchedAt,
      })),
    };
  }

  async getNextUnwatchedEpisode(userId: string, seriesId: string) {
    const followRecord = await this.prisma.followedSeries.findUnique({
      where: { userId_seriesId: { userId, seriesId } },
      select: { status: true },
    });

    if (followRecord?.status === 'DROPPED') {
      return null;
    }

    const nextEpisode = await this.prisma.episode.findFirst({
      where: {
        seriesId,
        seasonNumber: { not: 0 },
        watchProgress: { none: { userId } },
        airDate: {
          lte: new Date(), 
        },
      },
      orderBy: [{ seasonNumber: 'asc' }, { episodeNumber: 'asc' }],
      include: { series: true }, 
    });

    if (!nextEpisode) return null;

    const remainingCount = await this.prisma.episode.count({
      where: {
        seriesId,
        id: { not: nextEpisode.id },
        seasonNumber: { not: 0 },
        watchProgress: { none: { userId } },
        airDate: {
          lte: new Date(),
        },
      },
    });
    
    return {
      seriesId: nextEpisode.series.id,
      seriesTitle: nextEpisode.series.title,
      overview: nextEpisode.series.overview,
      posterUrl: nextEpisode.series.posterUrl,
      status: nextEpisode.series.status,
      releaseDate: nextEpisode.series.releaseDate,
      latestEpisode: {
        id: nextEpisode.id,
        seasonNumber: nextEpisode.seasonNumber,
        episodeNumber: nextEpisode.episodeNumber,
        title: nextEpisode.title,
        posterUrl: nextEpisode.posterUrl,
        airDate: nextEpisode.airDate,
        overview: nextEpisode.overview,
        episodesLeft: remainingCount,
      },
      watched: false,
      rewatchCount: 0,
    };
  }

  async markWatched(userId: string, episodeId: string, watchedAt?: string) {
    const isTmdb = episodeId.startsWith("tmdb_");

    const episode = await this.prisma.episode.findFirst({
      where: isTmdb ? {
        externalIds: {
          path: ['tmdb'],
          equals: parseInt(episodeId.replace('tmdb_',''),10),
        }} : { id: episodeId },
    });

    if (!episode) {
      return null;
    }

    episodeId = isTmdb ? episode.id : episodeId;
    const watchDate = watchedAt ? new Date(watchedAt) : new Date();

    await this.prisma.watchProgress.create({
      data: { userId, episodeId, watchedAt: watchDate },
    });

    return { success: true };
  }

  async unmarkWatched(userId: string, episodeId: string, progressId?: string) {
    if (progressId) {
      await this.prisma.watchProgress.delete({ 
        where: { id: progressId } 
      });
    } else {
      // This is to allow the user to delete the most recent rewatch
      // instead of just blindly deleting all, possible rollback in the 
      // future if found problematic...
      const mostRecent = await this.prisma.watchProgress.findFirst({
        where: { userId, episodeId },
        orderBy: { watchedAt: 'desc' }
      });
      
      if (mostRecent) {
        await this.prisma.watchProgress.delete({ 
          where: { id: mostRecent.id } 
        });
      }
    }
    return { success: true };
  }
}
