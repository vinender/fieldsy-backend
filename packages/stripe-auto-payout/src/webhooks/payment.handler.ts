/**
 * Payment Webhook Handler.
 * Handles platform payment events: payment_intent.*, charge.succeeded, charge.failed.
 */

import type Stripe from 'stripe';
import type { DatabaseAdapter } from '../types/adapter';
import type { StripeAutoPayoutConfig, Logger } from '../types/config';
import type { PayoutEventBus } from '../core/event-bus';
import type { TransactionLifecycleService } from '../services/transaction-lifecycle.service';
import { calculatePayoutAmounts } from '../utils/commission';

export class PaymentWebhookHandler {
  constructor(
    private adapter: DatabaseAdapter,
    private stripe: Stripe,
    private config: StripeAutoPayoutConfig,
    private events: PayoutEventBus,
    private lifecycleService: TransactionLifecycleService,
    private logger: Logger
  ) {}

  /**
   * Route a verified Stripe event to the appropriate handler.
   */
  async handleEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.handlePaymentIntentSucceeded(event);
        break;
      case 'payment_intent.payment_failed':
        await this.handlePaymentIntentFailed(event);
        break;
      case 'payment_intent.canceled':
        await this.handlePaymentIntentCanceled(event);
        break;
      case 'charge.succeeded':
        await this.handleChargeSucceeded(event);
        break;
      case 'charge.failed':
        this.handleChargeFailed(event);
        break;
      default:
        this.logger.debug(`[PaymentWebhook] Unhandled event: ${event.type}`);
    }
  }

  private async handlePaymentIntentSucceeded(event: Stripe.Event): Promise<void> {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    this.logger.info(`[PaymentWebhook] Payment intent succeeded: ${paymentIntent.id}`);

    // Check if order exists for this payment intent
    const order = await this.adapter.findOrderByPaymentIntentId(paymentIntent.id);

    if (!order) {
      // Order may need to be created from metadata
      const meta = paymentIntent.metadata;
      if (meta.customerId && meta.listingId && meta.date) {
        const orderId = await this.adapter.generateOrderId();

        const commission = await calculatePayoutAmounts(
          this.adapter, this.config, paymentIntent.amount / 100,
          meta.merchantId || '', this.logger
        );

        const [startTime, endTime] = (meta.timeSlot || '').includes(' - ')
          ? meta.timeSlot.split(' - ').map((t: string) => t.trim())
          : [meta.startTime || '', meta.endTime || ''];

        const newOrder = await this.adapter.createOrder({
          customerId: meta.customerId,
          listingId: meta.listingId,
          merchantId: meta.merchantId || '',
          date: new Date(meta.date),
          startTime,
          endTime,
          totalPrice: paymentIntent.amount / 100,
          status: 'CONFIRMED',
          paymentStatus: 'PAID',
          paymentIntentId: paymentIntent.id,
          payoutStatus: 'PENDING',
          orderId,
          platformCommission: commission.platformCommission,
          merchantAmount: commission.merchantAmount,
          metadata: meta as Record<string, any>,
        });

        await this.createLifecycleTransaction(newOrder, paymentIntent, meta);

        this.logger.info(`[PaymentWebhook] Created order from webhook: ${newOrder.id}`);
      }
      return;
    }

    if (order.status !== 'CONFIRMED' || order.paymentStatus !== 'PAID') {
      await this.adapter.updateOrder(order.id, {
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
      });

      await this.createLifecycleTransaction(order, paymentIntent, paymentIntent.metadata);

      // Notify customer
      this.events.notifyUser(order.customerId, 'order:confirmed', 'Order Confirmed',
        'Your order has been confirmed.',
        { orderId: order.id, paymentIntentId: paymentIntent.id }
      );

      // Notify merchant
      if (order.merchantId) {
        this.events.notifyUser(order.merchantId, 'order:new', 'New Order',
          'You have a new confirmed order.',
          { orderId: order.id }
        );
      }
    }
  }

  private async createLifecycleTransaction(
    order: { id: string; customerId: string; merchantId: string },
    paymentIntent: Stripe.PaymentIntent,
    metadata: Record<string, string>
  ): Promise<void> {
    try {
      let chargeId: string | undefined;
      if (paymentIntent.latest_charge) {
        chargeId = typeof paymentIntent.latest_charge === 'string'
          ? paymentIntent.latest_charge
          : paymentIntent.latest_charge.id;
      }

      const connectedAccount = await this.adapter.findConnectedAccountByUserId(
        metadata.merchantId || order.merchantId
      );

      await this.adapter.createTransaction({
        orderId: order.id,
        customerId: order.customerId,
        merchantId: order.merchantId,
        amount: paymentIntent.amount / 100,
        netAmount: parseFloat(metadata.merchantAmount || '0') || undefined,
        platformFee: parseFloat(metadata.platformCommission || '0') || undefined,
        commissionRate: parseFloat(metadata.commissionRate || '0') || undefined,
        isCustomCommission: metadata.isCustomCommission === 'true',
        defaultCommissionRate: parseFloat(metadata.defaultCommissionRate || '0') || undefined,
        type: 'PAYMENT',
        status: 'COMPLETED',
        lifecycleStage: 'PAYMENT_RECEIVED',
        stripePaymentIntentId: paymentIntent.id,
        stripeChargeId: chargeId,
        connectedAccountId: connectedAccount?.stripeAccountId,
        paymentReceivedAt: new Date(),
        description: `Payment for order ${order.id}`,
      });
    } catch (err: any) {
      this.logger.error(`[PaymentWebhook] Lifecycle transaction error: ${err.message}`);
    }
  }

  private async handlePaymentIntentFailed(event: Stripe.Event): Promise<void> {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    this.logger.error(`[PaymentWebhook] Payment intent failed: ${paymentIntent.id}`);

    const order = await this.adapter.findOrderByPaymentIntentId(paymentIntent.id);
    if (order) {
      await this.adapter.updateOrder(order.id, {
        status: 'CANCELLED',
        paymentStatus: 'FAILED',
      });

      const tx = await this.adapter.findTransactionByPaymentIntentId(paymentIntent.id);
      if (tx) {
        await this.adapter.updateTransaction(tx.id, {
          lifecycleStage: 'FAILED',
          failureCode: paymentIntent.last_payment_error?.code || 'unknown',
          failureMessage: paymentIntent.last_payment_error?.message || 'Payment failed',
        });
      }

      this.events.notifyUser(order.customerId, 'payment:failed', 'Payment Failed',
        'Your payment could not be processed. Please try again.',
        { orderId: order.id, paymentIntentId: paymentIntent.id }
      );
    }
  }

  private async handlePaymentIntentCanceled(event: Stripe.Event): Promise<void> {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    this.logger.info(`[PaymentWebhook] Payment intent canceled: ${paymentIntent.id}`);

    const order = await this.adapter.findOrderByPaymentIntentId(paymentIntent.id);
    if (order && order.status !== 'CANCELLED') {
      await this.adapter.updateOrder(order.id, {
        status: 'CANCELLED',
        paymentStatus: 'CANCELLED',
      });
    }
  }

  private async handleChargeSucceeded(event: Stripe.Event): Promise<void> {
    const charge = event.data.object as Stripe.Charge;
    this.logger.info(`[PaymentWebhook] Charge succeeded: ${charge.id}`);

    if (!charge.payment_intent) return;

    const paymentIntentId = typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent.id;

    const balanceTransactionId = charge.balance_transaction
      ? (typeof charge.balance_transaction === 'string'
        ? charge.balance_transaction
        : charge.balance_transaction.id)
      : undefined;

    // Update lifecycle to FUNDS_PENDING
    const tx = await this.adapter.findTransactionByPaymentIntentId(paymentIntentId);
    if (tx) {
      await this.adapter.updateTransaction(tx.id, {
        lifecycleStage: 'FUNDS_PENDING',
        stripeChargeId: charge.id,
        stripeBalanceTransactionId: balanceTransactionId,
      });
    }

    // Check when funds will be available
    if (balanceTransactionId) {
      try {
        const balanceTx = await this.stripe.balanceTransactions.retrieve(balanceTransactionId);
        if (balanceTx.available_on && tx) {
          const fundsAvailableAt = new Date(balanceTx.available_on * 1000);
          this.logger.debug(
            `[PaymentWebhook] Funds for charge ${charge.id} available at: ${fundsAvailableAt.toISOString()}`
          );
        }
      } catch (err: any) {
        this.logger.warn(`[PaymentWebhook] Could not fetch balance transaction: ${err.message}`);
      }
    }
  }

  private handleChargeFailed(event: Stripe.Event): void {
    const charge = event.data.object as Stripe.Charge;
    this.logger.error(
      `[PaymentWebhook] Charge failed: ${charge.id} — ${charge.failure_message}`
    );
  }
}
