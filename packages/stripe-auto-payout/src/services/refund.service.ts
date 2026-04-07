/**
 * Refund Service.
 * Processes refunds with time-based refund percentages and
 * handles partial payouts to merchants for partial refunds.
 */

import type Stripe from 'stripe';
import type { DatabaseAdapter } from '../types/adapter';
import type { StripeAutoPayoutConfig, Logger } from '../types/config';
import type { PayoutEventBus } from '../core/event-bus';
import { PayoutStatus } from '../types/enums';
import { createConnectedAccountPayout } from '../utils/payout-helper';

export class RefundService {
  constructor(
    private adapter: DatabaseAdapter,
    private stripe: Stripe,
    private config: StripeAutoPayoutConfig,
    private events: PayoutEventBus,
    private logger: Logger
  ) {}

  /**
   * Process a refund for an order.
   * Refund percentage is based on cancellation timing:
   *   >= cancellation window: 100%
   *   >= half window: 50%
   *   < half window: 0%
   */
  async processRefund(
    orderId: string,
    reason?: string
  ): Promise<{
    success: boolean;
    message: string;
    refundAmount?: number;
    refundPercentage?: number;
  }> {
    this.logger.info(`[Refund] Processing refund for order: ${orderId}`);

    const order = await this.adapter.findOrderById(orderId);
    if (!order) {
      return { success: false, message: 'Order not found' };
    }

    if (order.paymentStatus === 'REFUNDED') {
      return { success: false, message: 'Order already refunded' };
    }

    // Get payment record
    const payment = await this.adapter.findPaymentByOrderId(orderId);
    if (!payment || !payment.stripePaymentId) {
      return { success: false, message: 'No payment found for this order' };
    }

    // Calculate refund percentage based on timing
    const settings = await this.adapter.getSystemSettings();
    const cancellationWindowHours =
      settings?.cancellationWindowHours || this.config.scheduling.cancellationWindowHours;

    const orderTime = new Date(order.date);
    const [hours, minutes] = order.startTime.split(':').map(Number);
    if (!isNaN(hours)) orderTime.setHours(hours, minutes || 0, 0, 0);

    const now = new Date();
    const hoursUntilOrder = (orderTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    let refundPercentage: number;
    if (hoursUntilOrder >= cancellationWindowHours) {
      refundPercentage = 100;
    } else if (hoursUntilOrder >= cancellationWindowHours / 2) {
      refundPercentage = 50;
    } else {
      refundPercentage = 0;
    }

    const refundAmount = Math.round(((order.totalPrice * refundPercentage) / 100) * 100) / 100;

    // Process Stripe refund if amount > 0
    let stripeRefund: Stripe.Refund | undefined;
    if (refundAmount > 0) {
      try {
        stripeRefund = await this.stripe.refunds.create({
          payment_intent: payment.stripePaymentId,
          amount: Math.round(refundAmount * 100),
          reason: 'requested_by_customer',
          metadata: { orderId, reason: reason || 'Customer cancellation' },
        });
      } catch (err: any) {
        this.logger.error(`[Refund] Stripe refund failed: ${err.message}`);
        return { success: false, message: `Refund failed: ${err.message}` };
      }
    }

    // Update payment record
    await this.adapter.updatePayment(payment.id, {
      status: refundPercentage === 100 ? 'REFUNDED' : 'PAID',
      stripeRefundId: stripeRefund?.id,
      refundAmount,
      refundReason: reason || 'Customer cancellation',
    });

    // Create refund transaction
    await this.adapter.createTransaction({
      orderId,
      customerId: order.customerId,
      merchantId: order.merchantId,
      amount: -refundAmount,
      type: 'REFUND',
      status: 'COMPLETED',
      lifecycleStage: 'REFUNDED',
      stripeRefundId: stripeRefund?.id,
      stripePaymentIntentId: payment.stripePaymentId,
      refundedAt: new Date(),
    });

    // Update order
    await this.adapter.updateOrder(orderId, {
      status: 'CANCELLED',
      paymentStatus: refundPercentage === 100 ? 'REFUNDED' : order.paymentStatus,
      payoutStatus: PayoutStatus.REFUNDED,
      cancellationReason: reason,
      cancelledAt: new Date(),
    });

    // Cancel any pending payouts for this order
    if (order.payoutId) {
      await this.adapter.updatePayout(order.payoutId, { status: 'canceled' });
    }

    // Notify customer
    this.events.notifyUser(
      order.customerId,
      'refund:processed',
      refundAmount > 0 ? 'Refund Processed' : 'Cancellation Confirmed',
      refundAmount > 0
        ? `Your refund of £${refundAmount.toFixed(2)} (${refundPercentage}%) has been processed.`
        : 'Your order has been cancelled. No refund is applicable based on the cancellation policy.',
      {
        orderId,
        refundAmount,
        refundPercentage,
        stripeRefundId: stripeRefund?.id,
        customerId: order.customerId,
        merchantId: order.merchantId,
      }
    );

    // For partial refunds, process merchant payout for the remaining amount
    if (refundPercentage < 100 && refundPercentage > 0) {
      await this.processMerchantPartialPayout(order, refundAmount);
    }

    this.logger.info(`[Refund] Processed ${refundPercentage}% refund (£${refundAmount.toFixed(2)}) for order ${orderId}`);

    return { success: true, message: 'Refund processed', refundAmount, refundPercentage };
  }

  /**
   * Process a partial payout to the merchant when only a partial refund is issued.
   */
  private async processMerchantPartialPayout(
    order: { id: string; totalPrice: number; merchantId: string; orderId?: string },
    refundedAmount: number
  ): Promise<void> {
    const remainingAmount = order.totalPrice - refundedAmount;
    if (remainingAmount <= 0) return;

    // Calculate merchant share of remaining amount
    const commissionRate = (await this.adapter.getMerchantCommissionRate(order.merchantId)) ||
      this.config.commission.defaultRate;
    const stripeFee = remainingAmount * this.config.commission.stripeFeePercent + this.config.commission.stripeFeeFixed;
    const netAmount = remainingAmount - stripeFee;
    const platformFee = (netAmount * commissionRate) / 100;
    let merchantAmount = netAmount - platformFee;
    if (merchantAmount <= 0) return;
    merchantAmount = Math.round(merchantAmount * 100) / 100;

    const account = await this.adapter.findConnectedAccountByUserId(order.merchantId);
    if (!account || !account.payoutsEnabled) {
      // Create pending payout
      await this.adapter.createPayout({
        connectedAccountId: account?.id || '',
        amount: merchantAmount,
        currency: this.config.currency,
        status: 'pending',
        orderIds: [order.id],
        description: `Partial payout for order ${order.orderId || order.id}`,
      });
      return;
    }

    try {
      const amountInCents = Math.round(merchantAmount * 100);
      const transfer = await this.stripe.transfers.create({
        amount: amountInCents,
        currency: this.config.currency,
        destination: account.stripeAccountId,
        metadata: { orderId: order.id },
      });

      let stripePayout: Stripe.Payout | null = null;
      try {
        stripePayout = await createConnectedAccountPayout(this.stripe, {
          stripeAccountId: account.stripeAccountId,
          amountInMinorUnits: amountInCents,
          currency: this.config.currency,
          metadata: { orderId: order.id },
        });
      } catch {
        // Payout may be handled automatically by Stripe
      }

      await this.adapter.createPayout({
        connectedAccountId: account.id,
        stripePayoutId: stripePayout?.id,
        amount: merchantAmount,
        currency: this.config.currency,
        status: stripePayout?.status || 'pending',
        orderIds: [order.id],
        description: `Partial payout for order ${order.orderId || order.id}`,
      });

      this.events.notifyUser(
        order.merchantId,
        'payout:processing',
        'Partial Payout Processing',
        `A partial payout of £${merchantAmount.toFixed(2)} is being processed for order ${order.orderId || order.id}.`,
        { orderId: order.id, amount: merchantAmount }
      );
    } catch (err: any) {
      this.logger.error(`[Refund] Merchant partial payout failed: ${err.message}`);
    }
  }

  /**
   * Batch: process payouts for completed orders that haven't been paid out yet.
   */
  async processCompletedOrderPayouts(): Promise<{ processed: number; failed: number }> {
    const orders = await this.adapter.findOrdersEligibleForPayout();
    let processed = 0;
    let failed = 0;

    for (const order of orders) {
      try {
        const account = await this.adapter.findConnectedAccountByUserId(order.merchantId);
        if (!account || !account.payoutsEnabled) continue;

        await this.adapter.updateOrder(order.id, { payoutStatus: PayoutStatus.PROCESSING });
        // Delegate to the main payout service (caller should use PayoutService.processOrderPayout)
        processed++;
      } catch (err: any) {
        this.logger.error(`[Refund] Batch payout error for order ${order.id}: ${err.message}`);
        failed++;
      }
    }

    return { processed, failed };
  }
}
