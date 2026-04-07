/**
 * Payout Processor Job.
 * Periodically processes eligible payouts and generates daily summaries.
 */

import type { AutoPayoutService } from '../services/auto-payout.service';
import type { PayoutEventBus } from '../core/event-bus';
import type { Logger } from '../types/config';

export class PayoutProcessorJob {
  constructor(
    private autoPayoutService: AutoPayoutService,
    private events: PayoutEventBus,
    private logger: Logger
  ) {}

  /**
   * Run the payout processor once.
   * Called by the scheduler on its cron schedule.
   */
  async run(): Promise<void> {
    this.logger.info('[PayoutJob] Starting automatic payout processing...');

    try {
      const startTime = Date.now();
      const results = await this.autoPayoutService.processEligiblePayouts();
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      this.logger.info(
        `[PayoutJob] Complete in ${duration}s — ` +
        `Processed: ${results.processed}, Skipped: ${results.skipped}, ` +
        `Deferred: ${results.deferred}, Failed: ${results.failed}`
      );

      // Notify admins of failures
      if (results.failed > 0) {
        this.events.notifyAdmins(
          'admin:job_error',
          'Payout Processing Alert',
          `Payout job completed with ${results.failed} failures. Please check the logs.`,
          {
            jobName: 'payout-processor',
            processed: results.processed,
            failed: results.failed,
            skipped: results.skipped,
            details: results.details
              .filter((d) => d.status === 'failed')
              .map((d) => `Order ${d.orderId}: ${d.message}`),
          }
        );
      }
    } catch (err: any) {
      this.logger.error(`[PayoutJob] Fatal error: ${err.message}`);

      this.events.notifyAdmins(
        'admin:job_error',
        'Payout Job Failed',
        `The automatic payout processing job encountered an error: ${err.message}`,
        {
          jobName: 'payout-processor',
          processed: 0,
          failed: 1,
          skipped: 0,
          details: [err.message],
        }
      );
    }
  }

  /**
   * Generate and emit a daily summary.
   * Called by the scheduler on its daily cron schedule.
   */
  async runDailySummary(): Promise<void> {
    this.logger.info('[PayoutJob] Generating daily payout summary...');

    try {
      this.events.notifyAdmins(
        'admin:daily_summary',
        'Daily Payout Summary',
        'Daily payout summary has been generated. Check your admin dashboard for details.',
        {
          jobName: 'daily-summary',
          processed: 0,
          failed: 0,
          skipped: 0,
          details: [],
        }
      );

      this.logger.info('[PayoutJob] Daily summary emitted');
    } catch (err: any) {
      this.logger.error(`[PayoutJob] Daily summary error: ${err.message}`);
    }
  }
}
