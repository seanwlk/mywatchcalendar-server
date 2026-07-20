import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class TokenCleanupProducer {
  private readonly logger = new Logger(TokenCleanupProducer.name);

  constructor(@InjectQueue('cleanup-sessions') private cleanupQueue: Queue) {}

  @Cron(CronExpression.EVERY_HOUR)
  async scheduleCleanup() {
    await this.cleanupQueue.add('clean-expired-tokens', {});
    this.logger.log('Scheduled token cleanup job');
  }
}