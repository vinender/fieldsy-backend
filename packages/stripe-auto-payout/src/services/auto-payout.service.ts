/**
 * Automatic Payout Service.
 * Processes payouts for eligible orders where the cancellation window has passed.
 * Implements balance gates, commission calculations, and lifecycle tracking.
 */

import type Stripe from 'stripe';
import type { DatabaseAdapter } from '../types/adapter';
import type { StripeAutoPayoutConfig, Logger } from '../types/config';
import type { PayoutEventBus } from '../core/event-bus';
import type { PayoutProcessingResult } from '../types/models';
import { PayoutStatus, LifecycleStage } from '../types/enums';
import { calculatePayoutAmounts } from '../utils/commission';
import { createConnectedAccountPayout } from '../utils/payout-helper';
import {
  checkChargeFundsAvailable,
  checkPlatformBalance,
  safeTransferWithBalanceGate,
} from '../utils/balance-gate';

export class AutoPayoutService {
  constructor(
    private adapter: DatabaseAdapter,
    private stripe: Stripe,
    private config: StripeAutoPayoutConfig,
    private events: PayoutEventBus,
    private logger: Logger
  ) {}

  /**
   * Check if an order's cancellation window has passed.
   * Returns true when current time is beyond the cancellation deadline.
   */
  private hasCancellationWindowPassed(
    order: { date: Date; startTime: string },
    cancellationWindowHours: number
  ): boolean {
    const now = new Date();
    const orderDateTime = new Date(order.date);

    // Parse the start time (supports both "HH:mm" and "H:mmAM/PM" formats)
    const amPmMatch = order.startTime.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (amPmMatch) {
      let hour = parseInt(amPmMatch[1], 10);
      const min = parseInt(amPmMatch[2], 10);
      const period = amPmMatch[3].toUpperCase();
      if (period === 'PM' && hour !== 12) hour += 12;
      if (period === 'AM' && hour === 12) hour = 0;
      orderDateTime.setHours(hour, min, 0, 0);
    } else {
      const [hours, minutes] = order.startTime.split(':').map(Number);
      if (!isNaN(hours)) orderDateTime.setHours(hours, minutes || 0, 0, 0);
    }

    const cancellationDeadline = new Date(
      orderDateTime.getTime() - cancellationWindowHours * 60 * 60 * 1000
    );

    return now > cancellationDeadline;
  }

  /**
   * Determine whether a payout should be released based on system settings.
   */
  private async shouldReleasePayout(
    order: { date: Date; startTime: string },
    settings: { payoutReleaseSchedule?: string; cancellationWindowHours?: number } | null
  ): Promise<boolean> {
    const schedule = settings?.payoutReleaseSchedule || 'after_cancellation_window';
    const cancellationWindowHours =
      settings?.cancellationWindowHours || this.config.scheduling.cancellationWindowHours;

    if (schedule === 'immediate') {
      return true;
    }

    if (schedule === 'on_weekend') {
      const today = new Date().getDay();
      return today === 5 || today === 6 || today === 0;
    }

    // Default: after_cancellation_window
    return this.hasCancellationWindowPassed(order, cancellationWindowHours);
  }

  /**
   * Process all eligible payouts. Called by the cron scheduler.
   * Finds confirmed+paid orders with pending payouts and processes those
   * whose cancellation window has passed per system settings.
   */
  async processEligiblePayouts(): Promise<PayoutProcessingResult> {
    this.logger.info('[AutoPayout] Starting automatic payout processing...');

    const settings = await this.adapter.getSystemSettings();
    const eligibleOrders = await this.adapter.findOrdersEligibleForPayout();

    this.logger.info(
      `[AutoPayout] Found ${eligibleOrders.length} potentially eligible orders. ` +
      `Schedule: ${settings?.payoutReleaseSchedule || 'after_cancellation_window'}`
    );

    const result: PayoutProcessingResult = {
      processed: 0,
      skipped: 0,
      failed: 0,
      deferred: 0,
      details: [],
    };

    for (const order of eligibleOrders) {
      try {
        if (!(await this.shouldReleasePayout(order, settings))) {
          result.skipped++;
          result.details.push({
            orderId: order.id,
            status: 'skipped',
            message: 'Not meeting payout release criteria',
          });
          continue;
        }

        const payoutResult = await this.processOrderPayout(order.id);

        if (payoutResult.success) {
          result.processed++;
          result.details.push({
            orderId: order.id,
            status: 'processed',
            message: payoutResult.message,
          });
        } else if (payoutResult.deferred) {
          result.deferred++;
          result.details.push({
            orderId: order.id,
            status: 'deferred',
            message: payoutResult.message,
          });
        } else {
          result.skipped++;
          result.details.push({
            orderId: order.id,
            status: 'skipped',
            message: payoutResult.message,
          });
        }
      } catch (err: any) {
        this.logger.error(`[AutoPayout] Error processing order ${order.id}: ${err.message}`);
        result.failed++;
        result.details.push({
          orderId: order.id,
          status: 'failed',
          message: err.message,
        });
      }
    }

    this.logger.info(
      `[AutoPayout] Complete. Processed: ${result.processed}, Skipped: ${result.skipped}, ` +
      `Deferred: ${result.deferred}, Failed: ${result.failed}`
    );

    return result;
  }

  /**
   * Process a single order payout after all eligibility checks.
   * Validates order, checks Stripe account, verifies balances, creates transfer + payout.
   */
  async processOrderPayout(orderId: string): Promise<{
    success: boolean;
    message: string;
    deferred?: boolean;
    payoutId?: string;
  }> {
    const settings = await this.adapter.getSystemSettings();
    const order = await this.adapter.findOrderById(orderId);

    if (!order) {
      return { success: false, message: 'Order not found' };
    }

    // Verify payout should be released based on settings
    if (!(await this.shouldReleasePayout(order, settings))) {
      return { success: false, message: 'Not eligible for payout based on settings' };
    }

    // Check if already processed
    if (
      order.payoutStatus === PayoutStatus.COMPLETED ||
      order.payoutStatus === PayoutStatus.PROCESSING
    ) {
      return { success: false, message: `Payout already ${order.payoutStatus}` };
    }

    // Check order status
    if (order.status !== 'CONFIRMED' && order.status !== 'COMPLETED') {
      return { success: false, message: `Order status is ${order.status}, must be CONFIRMED or COMPLETED` };
    }
    if (order.paymentStatus !== 'PAID') {
      return { success: false, message: `Payment status is ${order.paymentStatus}, must be PAID` };
    }

    // Check connected account
    const connectedAccount = await this.adapter.findConnectedAccountByUserId(order.merchantId);

    if (!connectedAccount) {
      // Calculate commission for notification context
      const commission = await calculatePayoutAmounts(
        this.adapter, this.config, order.totalPrice, order.merchantId, this.logger
      );

      this.events.notifyUser(order.merchantId, 'payout:pending_account', 'Set Up Payment Account',
        `You have a pending payout of £${commission.merchantAmount.toFixed(2)}. Please set up your payment account to receive funds.`,
        { orderId, amount: commission.merchantAmount }
      );

      await this.adapter.updateOrder(orderId, { payoutStatus: PayoutStatus.PENDING_ACCOUNT });
      return { success: false, message: 'Merchant has no Stripe account' };
    }

    if (!connectedAccount.chargesEnabled || !connectedAccount.payoutsEnabled) {
      const commission = await calculatePayoutAmounts(
        this.adapter, this.config, order.totalPrice, order.merchantId, this.logger
      );

      this.events.notifyUser(order.merchantId, 'payout:pending_account', 'Complete Payment Account Setup',
        `Complete your payment account setup to receive £${commission.merchantAmount.toFixed(2)} from a recent order.`,
        { orderId, amount: commission.merchantAmount }
      );

      await this.adapter.updateOrder(orderId, { payoutStatus: PayoutStatus.PENDING_ACCOUNT });
      return { success: false, message: 'Stripe account not fully onboarded' };
    }

    // Calculate commission
    const commission = await calculatePayoutAmounts(
      this.adapter, this.config, order.totalPrice, order.merchantId, this.logger
    );
    const merchantAmount = commission.merchantAmount;
    const amountInCents = Math.round(merchantAmount * 100);

    // ----------------------------------------------------------------
    // Balance gate: check if charge funds are available
    // ----------------------------------------------------------------
    const transaction = await this.adapter.findTransactionByOrderId(orderId, 'PAYMENT');

    if (transaction?.stripeChargeId) {
      const fundsCheck = await checkChargeFundsAvailable(
        this.stripe, transaction.stripeChargeId, this.logger
      );

      if (!fundsCheck.isAvailable) {
        this.logger.info(`[AutoPayout] Funds not yet available for order ${orderId}: ${fundsCheck.message}`);

        await this.adapter.updateOrder(orderId, {
          payoutStatus: PayoutStatus.PENDING,
          payoutHeldReason: `Funds pending availability: ${fundsCheck.availableOn?.toISOString() || 'unknown'}`,
        });

        await this.adapter.updateTransactionsByOrderId(orderId, {
          lifecycleStage: LifecycleStage.FUNDS_PENDING,
        });

        return { success: false, deferred: true, message: fundsCheck.message };
      }

      // Update lifecycle to FUNDS_AVAILABLE
      await this.adapter.updateTransactionsByOrderId(orderId, {
        lifecycleStage: LifecycleStage.FUNDS_AVAILABLE,
        fundsAvailableAt: new Date(),
      });
    }

    // Check platform balance
    const balanceCheck = await checkPlatformBalance(this.stripe, amountInCents, this.config.currency, this.logger);
    if (!balanceCheck.canTransfer) {
      this.logger.info(`[AutoPayout] Insufficient platform balance for order ${orderId}: ${balanceCheck.message}`);

      await this.adapter.updateOrder(orderId, {
        payoutStatus: PayoutStatus.PENDING,
        payoutHeldReason: `Insufficient platform balance: ${balanceCheck.message}`,
      });

      return { success: false, deferred: true, message: balanceCheck.message };
    }

    // ----------------------------------------------------------------
    // Execute transfer + payout
    // ----------------------------------------------------------------
    await this.adapter.updateOrder(orderId, { payoutStatus: PayoutStatus.PROCESSING });

    try {
      const transferResult = await safeTransferWithBalanceGate(
        this.stripe,
        {
          amount: amountInCents,
          currency: this.config.currency,
          destination: connectedAccount.stripeAccountId,
          transferGroup: `order_${orderId}`,
          metadata: {
            orderId,
            merchantId: order.merchantId,
            type: 'automatic_order_payout',
            processingReason: 'cancellation_window_passed',
          },
          description: `Automatic payout for order ${order.orderId || orderId}`,
        },
        this.logger
      );

      if (!transferResult.success && transferResult.shouldDefer) {
        await this.adapter.updateOrder(orderId, {
          payoutStatus: PayoutStatus.PENDING,
          payoutHeldReason: transferResult.reason,
        });
        return { success: false, deferred: true, message: transferResult.reason };
      }

      if (!transferResult.success) {
        throw new Error(transferResult.reason);
      }

      const transfer = transferResult.transfer;

      // Create payout on connected account
      let stripePayout: Stripe.Payout | null = null;
      try {
        stripePayout = await createConnectedAccountPayout(this.stripe, {
          stripeAccountId: connectedAccount.stripeAccountId,
          amountInMinorUnits: amountInCents,
          currency: this.config.currency,
          metadata: {
            orderId,
            merchantId: order.merchantId,
            transferId: transfer.id,
            source: 'auto_payout',
          },
          description: `Automatic payout for order ${order.orderId || orderId}`,
        });
      } catch {
        // Payout may be handled automatically by Stripe's schedule
      }

      // Create payout record
      const payoutRecord = await this.adapter.createPayout({
        connectedAccountId: connectedAccount.id,
        stripePayoutId: stripePayout?.id || transfer.id,
        amount: merchantAmount,
        currency: this.config.currency,
        status: stripePayout?.status || 'processing',
        method: 'standard',
        description: `Automatic payout for order ${order.orderId || orderId}`,
        orderIds: [orderId],
        arrivalDate: stripePayout?.arrival_date
          ? new Date(stripePayout.arrival_date * 1000)
          : undefined,
      });

      // Update order
      const payoutStatus =
        stripePayout?.status === 'paid' ? PayoutStatus.COMPLETED : PayoutStatus.PROCESSING;

      await this.adapter.updateOrder(orderId, {
        payoutStatus,
        payoutId: payoutRecord.id,
        merchantAmount,
        platformCommission: commission.platformCommission,
        payoutHeldReason: undefined,
      });

      // Update transaction lifecycle
      const tx = await this.adapter.findTransactionByOrderId(orderId);
      if (tx) {
        await this.adapter.updateTransaction(tx.id, {
          lifecycleStage:
            payoutStatus === PayoutStatus.COMPLETED
              ? LifecycleStage.PAYOUT_COMPLETED
              : LifecycleStage.PAYOUT_INITIATED,
          stripeTransferId: transfer.id,
          stripePayoutId: stripePayout?.id,
          connectedAccountId: connectedAccount.stripeAccountId,
          netAmount: commission.netAmount,
          platformFee: commission.platformFeeAmount,
          commissionRate: commission.commissionRate,
          isCustomCommission: commission.isCustomCommission,
          defaultCommissionRate: commission.defaultCommissionRate,
          transferredAt: new Date(),
          payoutInitiatedAt: new Date(),
          ...(payoutStatus === PayoutStatus.COMPLETED ? { payoutCompletedAt: new Date() } : {}),
        });
      }

      // Notify merchant
      this.events.notifyUser(order.merchantId, 'payout:processing', 'Payment Received',
        `£${merchantAmount.toFixed(2)} has been automatically transferred to your account for order ${order.orderId || orderId}.`,
        {
          orderId,
          payoutId: payoutRecord.id,
          amount: merchantAmount,
          currency: this.config.currency,
          merchantId: order.merchantId,
        }
      );

      this.logger.info(`[AutoPayout] Processed payout for order ${orderId}: £${merchantAmount.toFixed(2)}`);

      return {
        success: true,
        message: `Payout of £${merchantAmount.toFixed(2)} initiated`,
        payoutId: payoutRecord.id,
      };
    } catch (err: any) {
      this.logger.error(`[AutoPayout] Transfer/payout failed for order ${orderId}: ${err.message}`);

      await this.adapter.updateOrder(orderId, { payoutStatus: PayoutStatus.FAILED });

      // Notify admins
      this.events.notifyAdmins('admin:payout_failed', 'Automatic Payout Failed',
        `Failed to process automatic payout for order ${orderId}. Error: ${err.message}`,
        {
          orderId,
          merchantId: order.merchantId,
          amount: merchantAmount,
          error: err.message,
        }
      );

      throw err;
    }
  }

  /**
   * Get payout summary for a merchant dashboard.
   * Returns totals for completed, pending, and upcoming payouts.
   */
  async getMerchantPayoutSummary(merchantId: string): Promise<{
    totalEarnings: number;
    pendingPayouts: number;
    completedPayouts: number;
    upcomingPayouts: number;
  }> {
    const listingIds = await this.adapter.getListingIdsForMerchant(merchantId);
    const orders = await this.adapter.findPendingPayoutOrdersForMerchant(merchantId);

    // Also fetch completed orders for total earnings
    const settings = await this.adapter.getSystemSettings();

    const summary = {
      totalEarnings: 0,
      pendingPayouts: 0,
      completedPayouts: 0,
      upcomingPayouts: 0,
    };

    for (const order of orders) {
      let amount = order.merchantAmount;
      if (!amount) {
        const commission = await calculatePayoutAmounts(
          this.adapter, this.config, order.totalPrice, merchantId, this.logger
        );
        amount = commission.merchantAmount;
      }

      if (order.payoutStatus === PayoutStatus.COMPLETED) {
        summary.completedPayouts += amount;
        summary.totalEarnings += amount;
      } else if (order.payoutStatus === PayoutStatus.PROCESSING) {
        summary.pendingPayouts += amount;
      } else if (order.status === 'CONFIRMED') {
        if (await this.shouldReleasePayout(order, settings)) {
          summary.pendingPayouts += amount;
        } else {
          summary.upcomingPayouts += amount;
        }
      }
    }

    return summary;
  }
}
