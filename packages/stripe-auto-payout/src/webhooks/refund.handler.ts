/**
 * Refund Webhook Handler.
 * Handles charge.refunded, refund.created, refund.updated, refund.failed events.
 */

import type Stripe from 'stripe';
import type { DatabaseAdapter } from '../types/adapter';
import type { Logger } from '../types/config';
import type { PayoutEventBus } from '../core/event-bus';
import { PayoutStatus, LifecycleStage } from '../types/enums';

export class RefundWebhookHandler {
  constructor(
    private adapter: DatabaseAdapter,
    private stripe: Stripe,
    private events: PayoutEventBus,
    private logger: Logger
  ) {}

  /**
   * Route a verified Stripe event to the appropriate handler.
   */
  async handleEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'charge.refunded':
        await this.handleChargeRefunded(event);
        break;
      case 'refund.updated':
        await this.handleRefundUpdated(event);
        break;
      case 'refund.failed':
        await this.handleRefundFailed(event);
        break;
      default:
        this.logger.debug(`[RefundWebhook] Unhandled event: ${event.type}`);
    }
  }

  private async handleChargeRefunded(event: Stripe.Event): Promise<void> {
    const charge = event.data.object as Stripe.Charge;
    this.logger.info(`[RefundWebhook] Charge refunded: ${charge.id}`);

    if (!charge.payment_intent) {
      this.logger.warn('[RefundWebhook] Charge has no payment_intent');
      return;
    }

    const paymentIntentId = typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent.id;

    const order = await this.adapter.findOrderByPaymentIntentId(paymentIntentId);
    if (!order) {
      this.logger.warn(`[RefundWebhook] No order found for payment intent: ${paymentIntentId}`);
      return;
    }

    const refundAmount = charge.amount_refunded / 100;
    const isFullRefund = charge.refunded;

    // Update order
    await this.adapter.updateOrder(order.id, {
      status: 'CANCELLED',
      paymentStatus: 'REFUNDED',
      payoutStatus: PayoutStatus.REFUNDED,
    });

    // Update payment record
    const payment = await this.adapter.findPaymentByOrderId(order.id);
    if (payment) {
      await this.adapter.updatePayment(payment.id, {
        status: 'refunded',
        refundAmount,
      });
    }

    // Update transaction lifecycle
    const tx = await this.adapter.findTransactionByPaymentIntentId(paymentIntentId);
    if (tx) {
      await this.adapter.updateTransaction(tx.id, {
        lifecycleStage: LifecycleStage.REFUNDED,
        stripeRefundId: charge.id,
        refundedAt: new Date(),
      });
    }

    // Notify customer
    this.events.notifyUser(order.customerId, 'refund:processed', 'Refund Processed',
      `Your refund of £${refundAmount.toFixed(2)} has been processed.`,
      {
        orderId: order.id,
        refundAmount,
        refundPercentage: isFullRefund ? 100 : Math.round((refundAmount / order.totalPrice) * 100),
        customerId: order.customerId,
        merchantId: order.merchantId,
      }
    );

    // Notify merchant
    if (order.merchantId) {
      this.events.notifyUser(order.merchantId, 'refund:processed', 'Order Refunded',
        `An order was refunded (£${refundAmount.toFixed(2)}).`,
        {
          orderId: order.id,
          refundAmount,
          refundPercentage: isFullRefund ? 100 : Math.round((refundAmount / order.totalPrice) * 100),
          customerId: order.customerId,
          merchantId: order.merchantId,
        }
      );
    }
  }

  private async handleRefundUpdated(event: Stripe.Event): Promise<void> {
    const refund = event.data.object as Stripe.Refund;
    this.logger.info(`[RefundWebhook] Refund updated: ${refund.id} (${refund.status})`);

    const orderId = refund.metadata?.orderId;
    if (orderId) {
      const payment = await this.adapter.findPaymentByOrderId(orderId);
      if (payment) {
        await this.adapter.updatePayment(payment.id, {
          stripeRefundId: refund.id,
          refundAmount: refund.amount / 100,
        });
      }
    }
  }

  private async handleRefundFailed(event: Stripe.Event): Promise<void> {
    const refund = event.data.object as Stripe.Refund;
    this.logger.error(`[RefundWebhook] Refund FAILED: ${refund.id} — ${refund.failure_reason}`);

    const orderId = refund.metadata?.orderId;
    if (orderId) {
      const order = await this.adapter.findOrderById(orderId);
      if (order) {
        this.events.notifyUser(order.customerId, 'refund:failed', 'Refund Failed',
          'Your refund could not be processed. Please contact support.',
          {
            orderId,
            refundAmount: refund.amount / 100,
            refundPercentage: 0,
            customerId: order.customerId,
            merchantId: order.merchantId,
          }
        );

        this.events.notifyAdmins('admin:payout_failed', 'Refund Failed',
          `Refund failed for order ${orderId}: ${refund.failure_reason}`,
          {
            orderId,
            amount: refund.amount / 100,
            failureCode: refund.failure_reason || undefined,
            failureMessage: refund.failure_reason || undefined,
          }
        );
      }
    }
  }
}
