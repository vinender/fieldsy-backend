/**
 * Cron Scheduler.
 * Starts all background jobs with configurable cron expressions.
 */

import type { StripeAutoPayoutConfig, Logger } from '../types/config';
import type { PayoutProcessorJob } from './payout-processor.job';
import type { HeldPayoutReleaseJob } from './held-payout-release.job';
import type { SubscriptionRetryJob } from './subscription-retry.job';

export interface SchedulerDeps {
  payoutProcessor: PayoutProcessorJob;
  heldPayoutRelease: HeldPayoutReleaseJob;
  subscriptionRetry: SubscriptionRetryJob;
}

export interface ScheduledTask {
  stop(): void;
}

/**
 * Start all cron jobs. Returns an object with a `stop()` method.
 *
 * @param cron The `node-cron` module (peer dependency — passed in to avoid bundling).
 */
export function startScheduler(
  cron: { schedule: (expression: string, task: () => void) => ScheduledTask },
  config: StripeAutoPayoutConfig,
  deps: SchedulerDeps,
  logger: Logger
): { stop: () => void } {
  const tasks: ScheduledTask[] = [];
  const cronConfig = config.cron || {};

  // 1. Process eligible payouts (default: every hour)
  tasks.push(
    cron.schedule(cronConfig.processPayouts || '0 * * * *', () => {
      deps.payoutProcessor.run().catch((err) =>
        logger.error(`[Scheduler] Payout processor error: ${err.message}`)
      );
    })
  );
  logger.info(`[Scheduler] Payout processor: ${cronConfig.processPayouts || '0 * * * *'}`);

  // 2. Release held payouts (default: every hour)
  tasks.push(
    cron.schedule(cronConfig.releaseHeldPayouts || '0 * * * *', () => {
      deps.heldPayoutRelease.run().catch((err) =>
        logger.error(`[Scheduler] Held payout release error: ${err.message}`)
      );
    })
  );
  logger.info(`[Scheduler] Held payout release: ${cronConfig.releaseHeldPayouts || '0 * * * *'}`);

  // 3. Weekend payout release (default: Friday 6 PM)
  tasks.push(
    cron.schedule(cronConfig.weekendRelease || '0 18 * * 5', () => {
      deps.heldPayoutRelease.run().catch((err) =>
        logger.error(`[Scheduler] Weekend release error: ${err.message}`)
      );
    })
  );
  logger.info(`[Scheduler] Weekend release: ${cronConfig.weekendRelease || '0 18 * * 5'}`);

  // 4. Subscription payment retry (default: daily at 6 AM)
  tasks.push(
    cron.schedule(cronConfig.subscriptionRetry || '0 6 * * *', () => {
      deps.subscriptionRetry.run().catch((err) =>
        logger.error(`[Scheduler] Subscription retry error: ${err.message}`)
      );
    })
  );
  logger.info(`[Scheduler] Subscription retry: ${cronConfig.subscriptionRetry || '0 6 * * *'}`);

  // 5. Daily admin summary (default: 9 AM)
  tasks.push(
    cron.schedule(cronConfig.dailySummary || '0 9 * * *', () => {
      deps.payoutProcessor.runDailySummary().catch((err) =>
        logger.error(`[Scheduler] Daily summary error: ${err.message}`)
      );
    })
  );
  logger.info(`[Scheduler] Daily summary: ${cronConfig.dailySummary || '0 9 * * *'}`);

  logger.info(`[Scheduler] All ${tasks.length} jobs started`);

  return {
    stop() {
      tasks.forEach((t) => t.stop());
      logger.info('[Scheduler] All jobs stopped');
    },
  };
}
