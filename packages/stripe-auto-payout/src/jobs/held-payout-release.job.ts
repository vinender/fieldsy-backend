/**
 * Held Payout Release Job.
 * Periodically checks for held payouts that should be released.
 */

import type { HeldPayoutService } from '../services/held-payout.service';
import type { PayoutEventBus } from '../core/event-bus';
import type { Logger } from '../types/config';

export class HeldPayoutReleaseJob {
  constructor(
    private heldPayoutService: HeldPayoutService,
    private events: PayoutEventBus,
    private logger: Logger
  ) {}

  /**
   * Run the standard held payout release check.
   * Called hourly by the scheduler.
   */
  async run(): Promise<void> {
    this.logger.info('[HeldPayoutJob] Starting scheduled release check...');

    try {
      const result = await this.heldPayoutService.processScheduledReleases();
      this.logger.info(
        `[HeldPayoutJob] Release check complete — ` +
        `Released: ${result.released}, Checked: ${result.checked}`
      );
    } catch (err: any) {
      this.logger.error(`[HeldPayoutJob] Error: ${err.message}`);
      this.events.notifyAdmins(
        'admin:job_error',
        'Held Payout Release Job Error',
        `Error processing held payout releases: ${err.message}`,
        {
          jobName: 'held-payout-release',
          processed: 0,
          failed: 1,
          skipped: 0,
          details: [err.message],
        }
      );
    }
  }
}
