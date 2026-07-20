import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SeriesController, EpisodeController } from './series.controller';
import { SeriesService } from './series.service';
import { JobsModule } from '../jobs/jobs.module';
import { TmdbService } from '../tmdb/tmdb.service';

@Module({
  imports: [PrismaModule,JobsModule],
  controllers: [SeriesController,EpisodeController],
  providers: [SeriesService,TmdbService],
})
export class SeriesModule {}
