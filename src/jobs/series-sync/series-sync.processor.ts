import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { TmdbService } from '../../tmdb/tmdb.service';

@Processor('series-sync')
export class SeriesSyncProcessor extends WorkerHost {
  constructor(
    private prisma: PrismaService,
    private tmdb: TmdbService,
  ) {
    super();
  }

  private async fetchTvmazeEpisodes(tvdbId?: number): Promise<any[]> {
    if (!tvdbId) return [];
    try {
      const lookup = await fetch(
        `https://api.tvmaze.com/lookup/shows?thetvdb=${tvdbId}`,
      );
      if (!lookup.ok) return [];
      const tvmazeId = (await lookup.json()).id;

      const epRes = await fetch(
        `https://api.tvmaze.com/shows/${tvmazeId}/episodes`,
      );
      if (epRes.ok) {
        const episodes = await epRes.json();
        return episodes.sort((a: any, b: any) => {
          if (a.season === b.season) return a.number - b.number;
          return a.season - b.season;
        });
      }
    } catch (e) {
      console.warn('TVmaze fetch failed:', e);
    }
    return [];
  }

  async process(
    job: Job<{ tmdbId: number; requestUser?: string }>,
  ): Promise<{ series: any; episodes: number }> {
    const { tmdbId, requestUser } = job.data;
    const isUpcomingSync = job.name === 'upcoming-sync';

    const seriesData = await this.tmdb.getSeriesDetails(tmdbId);

    let targetSeasons: number[] | undefined;

    if (isUpcomingSync) {
      const seasonsSet = new Set<number>();

      if (seriesData.numberOfSeasons)
        seasonsSet.add(seriesData.numberOfSeasons);
      if (seriesData.lastEpisodeToAir?.seasonNumber)
        seasonsSet.add(seriesData.lastEpisodeToAir.seasonNumber);
      if (seriesData.nextEpisodeToAir?.seasonNumber)
        seasonsSet.add(seriesData.nextEpisodeToAir.seasonNumber);

      const existingSeries = await this.prisma.series.findFirst({
        where: { externalIds: { path: ['tmdb'], equals: tmdbId } },
        select: {
          id: true,
          episodes: {
            where: {
              OR: [
                { airDate: null },
                {
                  airDate: {
                    gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                  },
                },
              ],
            },
            select: { seasonNumber: true },
          },
        },
      });

      if (existingSeries) {
        existingSeries.episodes.forEach((ep) =>
          seasonsSet.add(ep.seasonNumber),
        );
      }

      targetSeasons = Array.from(seasonsSet);
    }

    const [episodesData, tvmazeEpisodes] = await Promise.all([
      this.tmdb.getEpisodesForSeries(tmdbId, targetSeasons),
      this.fetchTvmazeEpisodes(seriesData.externalIds.tvdb),
    ]);

    let series = await this.prisma.series.findFirst({
      where: {
        externalIds: {
          path: ['tmdb'],
          equals: tmdbId,
        },
      },
    });
    let releaseDate = seriesData.firstAirDate === '' ? null : new Date(seriesData.firstAirDate);

    if (series) {
      series = await this.prisma.series.update({
        where: { id: series.id },
        data: {
          externalIds: seriesData.externalIds,
          title: seriesData.title,
          overview: seriesData.overview,
          posterUrl: seriesData.posterUrl,
          releaseDate: releaseDate,
          in_prod: seriesData.in_production,
          status: seriesData.status,
        },
      });
    } else {
      series = await this.prisma.series.create({
        data: {
          title: seriesData.title,
          externalIds: seriesData.externalIds,
          overview: seriesData.overview,
          posterUrl: seriesData.posterUrl,
          releaseDate: releaseDate,
          in_prod: seriesData.in_production,
          status: seriesData.status,
        },
      });
    }

    // Fetch from TVMaze the Airing UTC Timestamp (will fallback to TMDB date)
    // The match up is kinda fuzzy because TVMaze does not index TMDB IDs and has different season naming scheme
    const episodeOperations = episodesData.map((ep) => {
      let finalAirDate = ep.airDate ? new Date(ep.airDate) : null;

      if (tvmazeEpisodes.length > 0 && finalAirDate) {
        const tmdbDateStr = ep.airDate; // "YYYY-MM-DD"

        // Try for S+E number
        let match = tvmazeEpisodes.find(
          (t) => t.season === ep.seasonNumber && t.number === ep.episodeNumber,
        );

        // Try for absolute array index if season is still one on tmdb
        if (!match && ep.seasonNumber === 1) {
          const absoluteMatch = tvmazeEpisodes[ep.episodeNumber - 1];
          if (absoluteMatch) {
            match = absoluteMatch;
          }
        }

        // Episode title + date
        if (!match && tmdbDateStr && ep.title) {
          match = tvmazeEpisodes.find(
            (t) =>
              t.airdate === tmdbDateStr &&
              t.name.toLowerCase().includes(ep.title!.toLowerCase()),
          );
        }

        // Last resort ep date
        if (!match && tmdbDateStr) {
          const sameDateEpisodes = tvmazeEpisodes.filter(
            (t) => t.airdate === tmdbDateStr,
          );
          if (sameDateEpisodes.length === 1) {
            match = sameDateEpisodes[0];
          }
        }

        if (match && match.airstamp) {
          finalAirDate = new Date(match.airstamp);
        }
      }

      return this.prisma.episode.upsert({
        where: {
          seriesId_seasonNumber_episodeNumber: {
            seriesId: series.id,
            seasonNumber: ep.seasonNumber,
            episodeNumber: ep.episodeNumber,
          },
        },
        update: {
          title: ep.title,
          airDate: finalAirDate,
          overview: ep.overview,
          posterUrl: ep.posterUrl,
          runtime: ep.runtime,
        },
        create: {
          seriesId: series.id,
          externalIds: { tmdb: ep.id },
          seasonNumber: ep.seasonNumber,
          episodeNumber: ep.episodeNumber,
          title: ep.title,
          airDate: finalAirDate,
          overview: ep.overview,
          posterUrl: ep.posterUrl,
          runtime: ep.runtime,
        },
      });
    });

    await this.prisma.$transaction(episodeOperations);

    if (requestUser) {
      // If a user followed a series that wasnt in the cache, it will add the follow at the end of the sync
      await this.prisma.followedSeries.upsert({
        where: {
          userId_seriesId: { userId: requestUser, seriesId: series.id },
        },
        create: {
          userId: requestUser,
          seriesId: series.id,
          status: 'WATCHING',
        },
        update: { status: 'WATCHING' },
      });
    }

    return { series: seriesData, episodes: episodesData.length };
  }
}
