/**
 * Held Payout Service.
 * Manages payouts that are held due to missing Stripe accounts or scheduling rules.
 * Releases them when conditions are met.
 */

import type { DatabaseAdapter } from '../types/adapter';
import type { StripeAutoPayoutConfig, Logger } from '../types/config';
import type { PayoutEventBus } from '../core/event-bus';
import { PayoutStatus, PayoutReleaseSchedule } from '../types/enums';

export class HeldPayoutService {
  constructor(
    private adapter: DatabaseAdapter,
    private config: StripeAutoPayoutConfig,
    private events: PayoutEventBus,
    private logger: Logger
  ) {}

  /**
   * Release held payouts when a merchant connects their Stripe account.
   */
  async releaseHeldPayouts(merchantId: string): Promise<{ released: number }> {
    this.logger.info(`[HeldPayout] Releasing held payouts for merchant: ${merchantId}`);

    // Verify merchant has a connected Stripe account
    const account = await this.adapter.findConnectedAccountByUserId(merchantId);
    if (!account || !account.chargesEnabled || !account.payoutsEnabled) {
      this.logger.warn(`[HeldPayout] Merchant ${merchantId} does not have a fully connected Stripe account`);
      return { released: 0 };
    }

    // Find held orders
    const heldOrders = await this.adapter.findHeldPayoutOrders({
      merchantId,
      holdReason: 'NO_STRIPE_ACCOUNT',
    });

    if (heldOrders.length === 0) {
      this.logger.info(`[HeldPayout] No held payouts found for merchant ${merchantId}`);
      return { released: 0 };
    }

    // Get release schedule
    const settings = await this.adapter.getSystemSettings();
    const schedule =
      settings?.payoutReleaseSchedule || this.config.scheduling.payoutReleaseSchedule;

    let released = 0;

    for (const order of heldOrders) {
      const shouldRelease = this.shouldReleaseNow(order, schedule);
      if (!shouldRelease) continue;

      await this.adapter.updateOrder(order.id, {
        payoutStatus: PayoutStatus.PENDING,
        payoutHeldReason: undefined,
        payoutReleasedAt: new Date(),
      });

      released++;
    }

    if (released > 0) {
      this.events.notifyUser(
        merchantId,
        'payout:released',
        'Payouts Released',
        `${released} held payout(s) have been released and will be processed shortly.`,
        { merchantId, released }
      );
    }

    this.logger.info(`[HeldPayout] Released ${released}/${heldOrders.length} held payouts for merchant ${merchantId}`);
    return { released };
  }

  /**
   * Periodic job: check all held payouts and release those that are now eligible.
   */
  async processScheduledReleases(): Promise<{ released: number; checked: number }> {
    this.logger.info('[HeldPayout] Processing scheduled releases');

    const heldOrders = await this.adapter.findHeldPayoutOrders();
    const settings = await this.adapter.getSystemSettings();
    const schedule =
      settings?.payoutReleaseSchedule || this.config.scheduling.payoutReleaseSchedule;

    let released = 0;

    for (const order of heldOrders) {
      // Check if merchant now has Stripe account
      const account = await this.adapter.findConnectedAccountByUserId(order.merchantId);
      if (!account || !account.chargesEnabled || !account.payoutsEnabled) {
        continue;
      }

      const shouldRelease = this.shouldReleaseNow(order, schedule);
      if (!shouldRelease) continue;

      await this.adapter.updateOrder(order.id, {
        payoutStatus: PayoutStatus.PENDING,
        payoutHeldReason: undefined,
        payoutReleasedAt: new Date(),
      });

      this.events.notifyUser(
        order.merchantId,
        'payout:released',
        'Payout Released',
        `Your payout for order ${order.orderId || order.id} has been released.`,
        { orderId: order.id, merchantId: order.merchantId }
      );

      released++;
    }

    this.logger.info(`[HeldPayout] Released ${released}/${heldOrders.length} held payouts`);
    return { released, checked: heldOrders.length };
  }

  /** Determine if an order's payout should be released based on schedule */
  private shouldReleaseNow(
    order: { date: Date; startTime: string },
    schedule: string
  ): boolean {
    const now = new Date();

    switch (schedule) {
      case PayoutReleaseSchedule.IMMEDIATE:
        return true;

      case PayoutReleaseSchedule.ON_WEEKEND: {
        const day = now.getDay();
        return day === 0 || day === 5 || day === 6; // Sun, Fri, Sat
      }

      case PayoutReleaseSchedule.AFTER_CANCELLATION_WINDOW: {
        const windowHours = this.config.scheduling.cancellationWindowHours;
        const orderTime = new Date(order.date);
        // Parse startTime like "14:00" and add to order date
        const [hours, minutes] = order.startTime.split(':').map(Number);
        if (!isNaN(hours)) orderTime.setHours(hours, minutes || 0, 0, 0);

        const windowEnd = new Date(orderTime.getTime() - windowHours * 60 * 60 * 1000);
        return now >= windowEnd;
      }

      default:
        return true;
    }
  }
}
