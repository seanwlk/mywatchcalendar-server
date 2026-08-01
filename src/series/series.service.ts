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

    const latestUnwatchedBySeries = new Map<string, (typeof episodes)[number]>();
    for (const episode of episodes) {
      if (!latestUnwatchedBySeries.has(episode.seriesId)) {
        latestUnwatchedBySeries.set(episode.seriesId, episode);
      }
    }

    const items = Array.from(latestUnwatchedBySeries.values())
      .slice(skip, skip + pageSize)
      .map((episode) => ({
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
          episodesLeft: episodes.filter((e) => e.seriesId === episode.seriesId && e.airDate && e.airDate <= new Date() && e.id !== episode.id).length,
        },
        watched: false,
      }));

    const total = latestUnwatchedBySeries.size;

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

    const enriched = await Promise.all(
      items.map(async (episode) => {
        const watched = await this.prisma.watchProgress.findUnique({
          where: { userId_episodeId: { userId, episodeId: episode.id } },
        });
        
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
          watched: Boolean(watched),
          isFollowed: true,
        };
      }),
    );

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

        const watchedEpisodes = await this.prisma.watchProgress.count({
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
            watched: watchedEpisodes,
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
    const skip = (page - 1) * pageSize;

    const [items, total, tmdbResults] = await Promise.all([
      this.prisma.series.findMany({
        where: {
          title: { contains: query, mode: 'insensitive' },
        },
        select: {
          id: true,
          title: true,
          releaseDate: true,
          posterUrl: true,
          overview: true,
          externalIds: true,
          status: true,
          followers: {
            where: { userId: userId },
            select: { id: true },
          },
        },
        skip,
        take: pageSize,
        orderBy: { title: 'asc' },
      }),
      this.prisma.series.count({
        where: {
          title: { contains: query, mode: 'insensitive' },
        },
      }),
      this.tmdbService.searchSeries(query, page)
    ]);

    const localTmdbIds = new Set(
      items
        .map((series) => (series.externalIds as any)?.tmdb)
        .filter((id) => id != null)
    );

    const formattedItems = items.map((series) => ({
      id: series.id,
      title: series.title,
      overview: series.overview,
      releaseDate: series.releaseDate,
      posterUrl: series.posterUrl,
      status: series.status,
      isFollowed: series.followers.length > 0,
    }));

    const newTmdbItems = tmdbResults
      .filter((tmdbItem) => !localTmdbIds.has(tmdbItem.tmdbId))
      .map((tmdbItem) => ({
        id: `tmdb_${tmdbItem.tmdbId}`,
        title: tmdbItem.title,
        overview: tmdbItem.overview,
        releaseDate: tmdbItem.releaseDate,
        posterUrl: tmdbItem.posterUrl,
        status: tmdbItem.status,
        isFollowed: false,
      }));
    
    const combinedItems = [...formattedItems, ...newTmdbItems]
    return {
      items: combinedItems,
      page,
      pageSize,
      total,
      hasMore: page * pageSize < total,
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

    const [progress, followRecord] = await Promise.all([
      this.prisma.watchProgress.findMany({
        where: {
          userId,
          episode: { seriesId },
        },
        select: { episodeId: true },
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

    const watchedIds = new Set(progress.map((p) => p.episodeId));

    const seasonsMap = new Map();
    for (const episode of series.episodes) {
      if (!seasonsMap.has(episode.seasonNumber)) {
        seasonsMap.set(episode.seasonNumber, {
          number: episode.seasonNumber,
          episodes: [],
        });
      }
      
      seasonsMap.get(episode.seasonNumber).episodes.push({
        id: episode.id,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        title: episode.title,
        posterUrl: episode.posterUrl,
        airDate: episode.airDate,
        overview: episode.overview,
        watched: watchedIds.has(episode.id),
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

  const watched = await this.prisma.watchProgress.findUnique({
    where: { userId_episodeId: { userId, episodeId } },
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
    watched: Boolean(watched),
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

    await this.prisma.watchProgress.upsert({
      where: { userId_episodeId: { userId, episodeId } },
      update: { watchedAt: watchDate },
      create: { userId, episodeId, watchedAt: watchDate },
    });

    return { success: true };
  }

  async unmarkWatched(userId: string, episodeId: string) {
    const existing = await this.prisma.watchProgress.findUnique({ where: { userId_episodeId: { userId, episodeId } } });
    if (!existing) {
      return { success: true };
    }

    await this.prisma.watchProgress.delete({ where: { id: existing.id } });
    return { success: true };
  }
}
