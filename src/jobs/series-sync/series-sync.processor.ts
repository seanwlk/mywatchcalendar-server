import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { TmdbService } from '../../tmdb/tmdb.service'; 

@Processor('series-sync')
export class SeriesSyncProcessor extends WorkerHost {
  constructor(private prisma: PrismaService, private tmdb: TmdbService) {
    super();
  }

  async process(job: Job<{ tmdbId: number, requestUser?: string }>): Promise<{ series: any; episodes: number }> {
    const { tmdbId, requestUser } = job.data;

    const [seriesData, episodesData] = await Promise.all([
      this.tmdb.getSeriesDetails(tmdbId),
      this.tmdb.getEpisodesForSeries(tmdbId)
    ]);

    let series = await this.prisma.series.findFirst({
      where: {
        externalIds: {
          path: ['tmdb'],
          equals: tmdbId,
        },
      },
    });
    if (series) {
      series = await this.prisma.series.update({
        where: { id: series.id },
        data: {
          externalIds: seriesData.externalIds,
          title: seriesData.title,
          overview: seriesData.overview,
          posterUrl: seriesData.posterUrl,
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
          releaseDate: new Date(seriesData.firstAirDate),
          in_prod: seriesData.in_production,
          status: seriesData.status,
        },
      });
    }
    
    const episodeOperations = episodesData.map(ep => 
      this.prisma.episode.upsert({
        where: { 
          seriesId_seasonNumber_episodeNumber: {
            seriesId: series.id,
            seasonNumber: ep.seasonNumber,
            episodeNumber: ep.episodeNumber,
          }
        },
        update: { 
          title: ep.title, 
          airDate: ep.airDate ? new Date(ep.airDate) : null,
          overview: ep.overview,
          posterUrl: ep.posterUrl,
          runtime: ep.runtime
        },
        create: { 
          seriesId: series.id,
          externalIds: { tmdb: ep.id },
          seasonNumber: ep.seasonNumber,
          episodeNumber: ep.episodeNumber,
          title: ep.title,
          airDate: ep.airDate ? new Date(ep.airDate) : null,
          overview: ep.overview,
          posterUrl: ep.posterUrl,
          runtime: ep.runtime
        }
      })
    );

    await this.prisma.$transaction(episodeOperations);

    if (requestUser) {
      // If a user followed a series that wasnt in the cache, it will add the follow at the end of the sync
      await this.prisma.followedSeries.upsert({
        where: { userId_seriesId: { userId: requestUser, seriesId: series.id } },
        create: { userId: requestUser, seriesId: series.id, status: 'WATCHING' },
        update: { status: 'WATCHING' },
      });
    }

    return {series: seriesData, episodes: episodesData.length};
  }
}