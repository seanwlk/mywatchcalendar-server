import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class MediaCleanupProducer {
  private readonly logger = new Logger(MediaCleanupProducer.name);

  constructor(@InjectQueue('cleanup-media') private cleanupQueue: Queue) {}

  @Cron(CronExpression.EVERY_WEEK)
  async scheduleCleanup() {
    await this.cleanupQueue.add('clean-orphaned-media', {});
    this.logger.log('Scheduled orphaned media cleanup job');
  }
}