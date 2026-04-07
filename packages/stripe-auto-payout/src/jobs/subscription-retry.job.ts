/**
 * Subscription Retry Job.
 * Retries failed subscription payments daily.
 */

import type { SubscriptionService } from '../services/subscription.service';
import type { PayoutEventBus } from '../core/event-bus';
import type { Logger } from '../types/config';

export class SubscriptionRetryJob {
  constructor(
    private subscriptionService: SubscriptionService,
    private events: PayoutEventBus,
    private logger: Logger
  ) {}

  /**
   * Run the subscription payment retry job.
   * Called daily by the scheduler.
   */
  async run(): Promise<void> {
    this.logger.info('[SubscriptionRetryJob] Starting payment retry...');

    try {
      const result = await this.subscriptionService.retryFailedPayments();

      this.logger.info(
        `[SubscriptionRetryJob] Complete — ` +
        `Retried: ${result.retried}, Succeeded: ${result.succeeded}, Failed: ${result.failed}`
      );

      if (result.failed > 0) {
        this.events.notifyAdmins(
          'admin:job_error',
          'Subscription Retry Alert',
          `Subscription retry job completed with ${result.failed} failures out of ${result.retried} retries.`,
          {
            jobName: 'subscription-retry',
            processed: result.succeeded,
            failed: result.failed,
            skipped: 0,
            details: [],
          }
        );
      }
    } catch (err: any) {
      this.logger.error(`[SubscriptionRetryJob] Error: ${err.message}`);
      this.events.notifyAdmins(
        'admin:job_error',
        'Subscription Retry Job Failed',
        `The subscription retry job encountered an error: ${err.message}`,
        {
          jobName: 'subscription-retry',
          processed: 0,
          failed: 1,
          skipped: 0,
          details: [err.message],
        }
      );
    }
  }
}
