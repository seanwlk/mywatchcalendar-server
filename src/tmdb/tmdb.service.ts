import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TmdbService {
  private readonly logger = new Logger(TmdbService.name);
  private readonly baseUrl = 'https://api.themoviedb.org/3';
  private readonly apiKey: string;

  constructor(private configService: ConfigService) {
    const key = this.configService.get<string>('TMDB_API_KEY');
    if (!key) {
      throw new Error('TMDB_API_KEY is missing from environment variables');
    }
    this.apiKey = key;
  }

  private async fetchFromTmdb(endpoint: string): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new HttpException(
          `TMDB API Error: ${response.statusText}`,
          response.status,
        );
      }

      return await response.json();
    } catch (error) {
      this.logger.error(`Failed to fetch from TMDB: ${url}`, error);
      throw error;
    }
  }

  async getSeriesDetails(tmdbId: number) {
    const data = await this.fetchFromTmdb(`/tv/${tmdbId}?append_to_response=external_ids&language=en-US`);
    return {
      title: data.name,
      externalIds: {
        imdb: data.external_ids.imdb_id,
        tmdb: tmdbId,
        tvdb: data.external_ids.tvdb_id,
      },
      overview: data.overview,
      posterUrl: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
      firstAirDate: data.first_air_date, // "YYYY-MM-DD"
      numberOfSeasons: data.number_of_seasons,
      in_production: data.in_production,
      status: data.status,
    };
  }

  async getEpisodesForSeries(tmdbId: number) {
    const series = await this.getSeriesDetails(tmdbId);
    const totalSeasons = series.numberOfSeasons;
    
    let allEpisodes : any[] = [];

    for (let i = 1; i <= totalSeasons; i++) {
      this.logger.debug(`Fetching Season ${i} for series ${tmdbId}`);
      
      const seasonData = await this.fetchFromTmdb(`/tv/${tmdbId}/season/${i}`);
      
      const formattedEpisodes = seasonData.episodes.map((ep: any) => ({
        id: ep.id,
        seasonNumber: ep.season_number,
        episodeNumber: ep.episode_number,
        title: ep.name,
        airDate: ep.air_date ? ep.air_date : null,
        overview: ep.overview,
        posterUrl: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : null,
        runtime: ep.runtime,
      }));

      allEpisodes = [...allEpisodes, ...formattedEpisodes];
    }

    return allEpisodes;
  }

  async searchSeries(query: string, page: number = 1) {
    const data = await this.fetchFromTmdb(
      `/search/tv?query=${encodeURIComponent(query)}&page=${page}&language=en-US`
    );
    
    return data.results.map((item: any) => ({
      tmdbId: item.id,
      title: item.name,
      overview: item.overview,
      posterUrl: item.poster_path 
        ? `https://image.tmdb.org/t/p/w500${item.poster_path}` 
        : null,
      releaseDate: item.first_air_date ? new Date(item.first_air_date) : null,
    }));
  }
}