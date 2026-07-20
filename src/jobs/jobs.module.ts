import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import basicAuth from 'express-basic-auth';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { TmdbModule } from '../tmdb/tmdb.module';
import { SeriesSyncProducer } from './series-sync/series-sync.producer';
import { SeriesSyncProcessor } from './series-sync/series-sync.processor';
import { TokenCleanupProducer } from './cleanup/token-cleanup.producer';
import { TokenCleanupProcessor } from './cleanup/token-cleanup.processor';

const REGISTERED_QUEUES = [
  'series-sync',
  'cleanup-sessions',
];

@Module({
  imports: [
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST'),
          port: configService.get<number>('REDIS_PORT'),
        },
      }),
    }),
    BullBoardModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const user = configService.get<string>('BULLBOARD_USER') ?? 'admin';
        const pass = configService.get<string>('BULLBOARD_PASSWORD') ?? 'admin';

        return {
          route: '/queues',
          adapter: ExpressAdapter,
          middleware: basicAuth({
            users: {
              [user]: pass,
            },
            challenge: true,
          }),
        };
      },
    }),
    ...REGISTERED_QUEUES.map((queueName) => 
      BullModule.registerQueue({ name: queueName })
    ),
    ...REGISTERED_QUEUES.map((queueName) =>
      BullBoardModule.forFeature({
        name: queueName,
        adapter: BullMQAdapter,
      })
    ),
    PrismaModule,
    TmdbModule,
  ],
  providers: [
    SeriesSyncProducer,
    SeriesSyncProcessor,
    TokenCleanupProducer,
    TokenCleanupProcessor,
  ],
  exports: [SeriesSyncProducer],
})
export class JobsModule {}