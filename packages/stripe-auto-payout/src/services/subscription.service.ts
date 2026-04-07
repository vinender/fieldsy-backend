/**
 * Subscription Service.
 * Manages recurring billing via Stripe subscriptions.
 * Handles creation, webhook events, payment retries, and cancellation.
 */

import type Stripe from 'stripe';
import type { DatabaseAdapter } from '../types/adapter';
import type { StripeAutoPayoutConfig, Logger } from '../types/config';
import type { PayoutEventBus } from '../core/event-bus';
import type { SubscriptionRecord } from '../types/models';
import { calculatePayoutAmounts } from '../utils/commission';

export class SubscriptionService {
  constructor(
    private adapter: DatabaseAdapter,
    private stripe: Stripe,
    private config: StripeAutoPayoutConfig,
    private events: PayoutEventBus,
    private logger: Logger
  ) {}

  /**
   * Create a Stripe subscription for recurring orders.
   */
  async createSubscription(params: {
    customerId: string;
    listingId: string;
    date: string;
    timeSlot: string;
    startTime: string;
    endTime: string;
    numberOfItems?: number;
    interval: 'weekly' | 'monthly';
    amount: number;
    paymentMethodId: string;
    customerEmail: string;
    /** Product name for Stripe product creation */
    productName: string;
    /** Merchant who owns the listing */
    merchantId: string;
    /** Additional metadata to store */
    metadata?: Record<string, string>;
  }): Promise<{
    subscription: SubscriptionRecord;
    stripeSubscription: Stripe.Subscription;
    clientSecret?: string;
  }> {
    const {
      customerId, listingId, date, timeSlot, startTime, endTime,
      numberOfItems, interval, amount, paymentMethodId, customerEmail,
      productName, merchantId, metadata,
    } = params;

    const customer = await this.adapter.getCustomerInfo(customerId);
    if (!customer) {
      throw new Error('Customer not found');
    }

    // Ensure customer has a Stripe customer ID
    let stripeCustomerId: string | undefined;

    // Try to find existing Stripe customer from the subscription records
    const existingSubscription = await this.adapter.findSubscriptionById(customerId);
    stripeCustomerId = existingSubscription?.stripeCustomerId;

    if (!stripeCustomerId) {
      const stripeCustomer = await this.stripe.customers.create({
        email: customerEmail,
        name: customer.name || undefined,
        metadata: { userId: customerId },
      });
      stripeCustomerId = stripeCustomer.id;
    }

    // Attach payment method
    await this.stripe.paymentMethods.attach(paymentMethodId, {
      customer: stripeCustomerId,
    });

    await this.stripe.customers.update(stripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // Calculate commission
    const commission = await calculatePayoutAmounts(
      this.adapter, this.config, amount, merchantId, this.logger
    );

    // Parse booking date
    const bookingDate = new Date(date);
    const dayOfWeek = this.getDayOfWeek(bookingDate);
    const dayOfMonth = bookingDate.getDate();

    // Create Stripe product
    const product = await this.stripe.products.create({
      name: `${productName} - ${timeSlot}`,
      metadata: {
        listingId,
        productName,
        timeSlot,
        numberOfItems: (numberOfItems || 1).toString(),
        ...metadata,
      },
    });

    // Create price
    const price = await this.stripe.prices.create({
      product: product.id,
      unit_amount: Math.round(amount * 100),
      currency: this.config.currency,
      recurring: {
        interval: interval === 'weekly' ? 'week' : 'month',
        interval_count: 1,
      },
      metadata: {
        listingId,
        customerId,
        platformCommission: commission.platformCommission.toString(),
        merchantAmount: commission.merchantAmount.toString(),
      },
    });

    // Calculate billing anchor
    let nextBillingDate: Date;
    if (interval === 'weekly') {
      nextBillingDate = new Date(bookingDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    } else {
      nextBillingDate = new Date(bookingDate);
      nextBillingDate.setMonth(nextBillingDate.getMonth() + 1);
    }
    const billingCycleAnchor = Math.floor(nextBillingDate.getTime() / 1000);

    // Create subscription
    const stripeSubscription = await this.stripe.subscriptions.create({
      customer: stripeCustomerId,
      items: [{ price: price.id }],
      billing_cycle_anchor: billingCycleAnchor,
      proration_behavior: 'none',
      metadata: {
        customerId,
        listingId,
        merchantId,
        timeSlot,
        startTime,
        endTime,
        numberOfItems: (numberOfItems || 1).toString(),
        dayOfWeek: interval === 'weekly' ? dayOfWeek : '',
        dayOfMonth: interval === 'monthly' ? dayOfMonth.toString() : '',
        interval,
        platformCommission: commission.platformCommission.toString(),
        merchantAmount: commission.merchantAmount.toString(),
        firstBookingDate: bookingDate.toISOString(),
        ...metadata,
      },
      payment_behavior: 'default_incomplete',
      payment_settings: {
        save_default_payment_method: 'on_subscription',
      },
      expand: ['latest_invoice.payment_intent'],
    });

    // Store subscription in database
    const dbSubscription = await this.adapter.createSubscription({
      customerId,
      listingId,
      stripeSubscriptionId: stripeSubscription.id,
      stripeCustomerId,
      status: stripeSubscription.status,
      interval,
      intervalCount: 1,
      currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
      currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
      cancelAtPeriodEnd: false,
      timeSlot,
      dayOfWeek: interval === 'weekly' ? dayOfWeek : undefined,
      dayOfMonth: interval === 'monthly' ? dayOfMonth : undefined,
      startTime,
      endTime,
      numberOfItems,
      totalPrice: amount,
      nextBillingDate: new Date(stripeSubscription.current_period_end * 1000),
      paymentRetryCount: 0,
    });

    // Create the first order via the adapter
    await this.createOrderFromSubscription(dbSubscription.id, bookingDate);

    // Notify merchant
    this.events.notifyUser(merchantId, 'subscription:created', 'New Recurring Order',
      `A ${interval} recurring order has been set up starting ${bookingDate.toISOString().split('T')[0]} at ${timeSlot}.`,
      {
        subscriptionId: dbSubscription.id,
        stripeSubscriptionId: stripeSubscription.id,
        listingId,
        customerId,
        merchantId,
        interval,
        totalPrice: amount,
      }
    );

    const latestInvoice = stripeSubscription.latest_invoice as Stripe.Invoice | undefined;
    const paymentIntent = latestInvoice?.payment_intent as Stripe.PaymentIntent | undefined;

    return {
      subscription: dbSubscription,
      stripeSubscription,
      clientSecret: paymentIntent?.client_secret || undefined,
    };
  }

  /**
   * Create an order from a subscription for a given date.
   * Delegates to the adapter's createOrder and optional checkOrderAvailability.
   */
  async createOrderFromSubscription(
    subscriptionId: string,
    orderDate: Date
  ): Promise<any | null> {
    const subscription = await this.adapter.findSubscriptionById(subscriptionId);
    if (!subscription) {
      throw new Error('Subscription not found');
    }

    // Check availability if adapter supports it
    if (this.adapter.checkOrderAvailability) {
      const availability = await this.adapter.checkOrderAvailability(
        subscription.listingId,
        orderDate,
        subscription.startTime,
        subscription.endTime
      );

      if (!availability.available) {
        this.logger.warn(
          `[Subscription] Slot conflict for subscription ${subscriptionId} on ` +
          `${orderDate.toISOString().split('T')[0]}: ${availability.reason}`
        );
        return null;
      }
    }

    // Calculate commission
    const commission = await calculatePayoutAmounts(
      this.adapter, this.config, subscription.totalPrice,
      '', // merchantId will be resolved by the adapter
      this.logger
    );

    // Generate order ID
    const orderId = await this.adapter.generateOrderId();

    // Create the order
    const order = await this.adapter.createOrder({
      customerId: subscription.customerId,
      listingId: subscription.listingId,
      date: orderDate,
      startTime: subscription.startTime,
      endTime: subscription.endTime,
      totalPrice: subscription.totalPrice,
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      orderId,
      subscriptionId: subscription.id,
      platformCommission: commission.platformCommission,
      merchantAmount: commission.merchantAmount,
      metadata: {
        numberOfItems: subscription.numberOfItems,
        timeSlot: subscription.timeSlot,
        interval: subscription.interval,
      },
    });

    // Update subscription last order date
    await this.adapter.updateSubscription(subscriptionId, {
      lastOrderDate: orderDate,
    });

    return order;
  }

  /**
   * Handle subscription-related webhook events from Stripe.
   */
  async handleSubscriptionWebhook(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'invoice.payment_succeeded':
        await this.handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;
      case 'invoice.payment_failed':
        await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
    }
  }

  /**
   * Handle successful invoice payment — creates the next recurring order.
   */
  private async handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
    if (!invoice.subscription) return;

    const subscription = await this.adapter.findSubscriptionByStripeId(
      invoice.subscription as string
    );
    if (!subscription) return;

    // Reset retry count on success
    if (subscription.paymentRetryCount > 0 || subscription.status === 'past_due') {
      await this.adapter.updateSubscription(subscription.id, {
        status: 'active',
        paymentRetryCount: 0,
        nextRetryDate: undefined,
        failureReason: undefined,
        lastPaymentAttempt: new Date(),
      });
      this.logger.info(`[Subscription] Reset retry count for subscription ${subscription.id}`);
    }

    // Get max advance booking days from settings
    const settings = await this.adapter.getSystemSettings();
    const maxAdvanceBookingDays = settings?.maxAdvanceBookingDays || 30;

    // Calculate next order date
    let nextOrderDate: Date;
    const baseDate = subscription.lastOrderDate || new Date();

    if (subscription.interval === 'weekly') {
      nextOrderDate = new Date(baseDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    } else {
      nextOrderDate = new Date(baseDate);
      nextOrderDate.setMonth(nextOrderDate.getMonth() + 1);
    }

    // Validate date is within advance booking range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxFutureDate = new Date(today);
    maxFutureDate.setDate(maxFutureDate.getDate() + maxAdvanceBookingDays);

    if (nextOrderDate > maxFutureDate) {
      this.logger.info(
        `[Subscription] Next order date (${nextOrderDate.toISOString().split('T')[0]}) ` +
        `beyond max advance days (${maxAdvanceBookingDays}) for subscription ${subscription.id}`
      );

      this.events.notifyUser(subscription.customerId, 'subscription:renewed', 'Recurring Order Scheduled',
        `Your ${subscription.interval} order payment was successful. The order will be automatically created closer to ${nextOrderDate.toISOString().split('T')[0]} at ${subscription.timeSlot}.`,
        {
          subscriptionId: subscription.id,
          stripeSubscriptionId: subscription.stripeSubscriptionId,
          customerId: subscription.customerId,
          listingId: subscription.listingId,
          interval: subscription.interval,
          totalPrice: subscription.totalPrice,
          nextOrderDate: nextOrderDate.toISOString(),
        }
      );
      return;
    }

    // Create the order
    await this.createOrderFromSubscription(subscription.id, nextOrderDate);

    // Notify customer
    this.events.notifyUser(subscription.customerId, 'subscription:renewed', 'Recurring Order Renewed',
      `Your ${subscription.interval} order has been renewed. Next order: ${nextOrderDate.toISOString().split('T')[0]} at ${subscription.timeSlot}.`,
      {
        subscriptionId: subscription.id,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        customerId: subscription.customerId,
        listingId: subscription.listingId,
        interval: subscription.interval,
        totalPrice: subscription.totalPrice,
        nextOrderDate: nextOrderDate.toISOString(),
      }
    );
  }

  /**
   * Handle failed invoice payment with retry logic.
   * Retries up to maxRetryAttempts, then cancels the subscription.
   */
  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    if (!invoice.subscription) return;

    const subscription = await this.adapter.findSubscriptionByStripeId(
      invoice.subscription as string
    );
    if (!subscription) return;

    const maxRetries = this.config.subscription?.maxRetryAttempts ?? 3;
    const retryIntervalHours = this.config.subscription?.retryIntervalHours ?? 24;
    const currentRetryCount = (subscription.paymentRetryCount || 0) + 1;
    const failureReason = this.extractFailureReason(invoice);

    this.logger.info(
      `[Subscription] Payment failed for subscription ${subscription.id}. ` +
      `Attempt ${currentRetryCount}/${maxRetries}`
    );

    // Exceeded max retries — cancel
    if (currentRetryCount >= maxRetries) {
      this.logger.info(
        `[Subscription] Max retries (${maxRetries}) reached. Cancelling subscription ${subscription.id}`
      );
      await this.cancelSubscriptionDueToPaymentFailure(subscription, failureReason, currentRetryCount);
      return;
    }

    // Schedule retry
    const nextRetryDate = new Date(Date.now() + retryIntervalHours * 60 * 60 * 1000);

    await this.adapter.updateSubscription(subscription.id, {
      status: 'past_due',
      paymentRetryCount: currentRetryCount,
      lastPaymentAttempt: new Date(),
      nextRetryDate,
      failureReason,
    });

    // Notify customer
    const remainingAttempts = maxRetries - currentRetryCount;
    this.events.notifyUser(subscription.customerId, 'subscription:payment_failed', 'Payment Failed',
      `Your recurring order payment failed${failureReason ? ` (${failureReason})` : ''}. ` +
      `We will retry in ${retryIntervalHours} hours. ${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} remaining.`,
      {
        subscriptionId: subscription.id,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        customerId: subscription.customerId,
        listingId: subscription.listingId,
        merchantId: '',
        interval: subscription.interval,
        totalPrice: subscription.totalPrice,
        attemptNumber: currentRetryCount,
        maxAttempts: maxRetries,
        failureReason,
        nextRetryDate,
      }
    );
  }

  /**
   * Extract human-readable failure reason from a Stripe invoice.
   */
  private extractFailureReason(invoice: Stripe.Invoice): string {
    const paymentIntent = invoice.payment_intent;
    if (paymentIntent && typeof paymentIntent === 'object') {
      const lastError = paymentIntent.last_payment_error;
      if (lastError) {
        switch (lastError.code) {
          case 'card_declined': return 'Card declined';
          case 'insufficient_funds': return 'Insufficient funds';
          case 'expired_card': return 'Card expired';
          case 'incorrect_cvc': return 'Incorrect CVC';
          case 'processing_error': return 'Processing error';
          case 'incorrect_number': return 'Invalid card number';
          default: return lastError.message || lastError.code || 'Payment failed';
        }
      }
    }

    if (invoice.charge && typeof invoice.charge === 'object') {
      const charge = invoice.charge as Stripe.Charge;
      if (charge.failure_message) return charge.failure_message;
      if (charge.failure_code) return charge.failure_code;
    }

    return 'Payment could not be processed';
  }

  /**
   * Cancel a subscription due to repeated payment failures.
   */
  private async cancelSubscriptionDueToPaymentFailure(
    subscription: SubscriptionRecord,
    failureReason: string,
    totalAttempts: number
  ): Promise<void> {
    const cancellationReason =
      `Auto-cancelled after ${totalAttempts} failed payment attempts. Last failure: ${failureReason}`;

    // Cancel in Stripe
    if (subscription.stripeSubscriptionId?.startsWith('sub_')) {
      try {
        await this.stripe.subscriptions.cancel(subscription.stripeSubscriptionId, {
          cancellation_details: { comment: cancellationReason },
        });
      } catch (err: any) {
        this.logger.error(`[Subscription] Failed to cancel Stripe subscription: ${err.message}`);
      }
    }

    // Update subscription in DB
    await this.adapter.updateSubscription(subscription.id, {
      status: 'canceled',
      canceledAt: new Date(),
      cancellationReason,
      paymentRetryCount: totalAttempts,
      lastPaymentAttempt: new Date(),
      nextRetryDate: undefined,
    });

    // Cancel future orders
    await this.adapter.updateManyOrders(
      { subscriptionId: subscription.id, futureOnly: true },
      {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancellationReason: 'Subscription cancelled due to payment failure',
      }
    );

    // Notify customer
    this.events.notifyUser(subscription.customerId, 'subscription:cancelled', 'Subscription Cancelled',
      `Your recurring order has been cancelled after ${totalAttempts} failed payment attempts. Please update your payment method and create a new subscription.`,
      {
        subscriptionId: subscription.id,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        customerId: subscription.customerId,
        listingId: subscription.listingId,
        merchantId: '',
        interval: subscription.interval,
        totalPrice: subscription.totalPrice,
        cancellationReason,
        totalAttempts,
      }
    );

    this.logger.info(`[Subscription] Subscription ${subscription.id} cancelled due to payment failure`);
  }

  /**
   * Handle subscription update from Stripe webhook.
   */
  private async handleSubscriptionUpdated(stripeSubscription: Stripe.Subscription): Promise<void> {
    try {
      await this.adapter.updateSubscription(
        '', // ID doesn't matter when we look up by Stripe ID
        {
          status: stripeSubscription.status,
          currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
          currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
          cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
          canceledAt: stripeSubscription.canceled_at
            ? new Date(stripeSubscription.canceled_at * 1000)
            : undefined,
        }
      );
    } catch {
      // Look up by Stripe ID and update
      const sub = await this.adapter.findSubscriptionByStripeId(stripeSubscription.id);
      if (sub) {
        await this.adapter.updateSubscription(sub.id, {
          status: stripeSubscription.status,
          currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
          currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
          cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
          canceledAt: stripeSubscription.canceled_at
            ? new Date(stripeSubscription.canceled_at * 1000)
            : undefined,
        });
      }
    }
  }

  /**
   * Handle subscription deletion from Stripe webhook.
   */
  private async handleSubscriptionDeleted(stripeSubscription: Stripe.Subscription): Promise<void> {
    const subscription = await this.adapter.findSubscriptionByStripeId(stripeSubscription.id);
    if (!subscription) return;

    await this.adapter.updateSubscription(subscription.id, {
      status: 'canceled',
      canceledAt: new Date(),
    });

    this.events.notifyUser(subscription.customerId, 'subscription:cancelled', 'Recurring Order Cancelled',
      'Your recurring order has been cancelled.',
      {
        subscriptionId: subscription.id,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        customerId: subscription.customerId,
        listingId: subscription.listingId,
        merchantId: '',
        interval: subscription.interval,
        totalPrice: subscription.totalPrice,
        cancellationReason: 'Cancelled via Stripe',
      }
    );
  }

  /**
   * Retry failed payments for subscriptions that are past_due.
   * Called by the cron scheduler.
   */
  async retryFailedPayments(): Promise<{ retried: number; succeeded: number; failed: number }> {
    const now = new Date();
    const maxRetries = this.config.subscription?.maxRetryAttempts ?? 3;
    const subscriptions = await this.adapter.findSubscriptionsForRetry(now, maxRetries);

    this.logger.info(`[Subscription] Found ${subscriptions.length} subscriptions to retry`);

    let retried = 0;
    let succeeded = 0;
    let failed = 0;

    for (const subscription of subscriptions) {
      try {
        const result = await this.retrySubscriptionPayment(subscription);
        retried++;
        if (result) succeeded++;
        else failed++;
      } catch (err: any) {
        this.logger.error(`[Subscription] Retry error for ${subscription.id}: ${err.message}`);
        failed++;
        retried++;
      }
    }

    return { retried, succeeded, failed };
  }

  /**
   * Retry payment for a specific subscription.
   */
  private async retrySubscriptionPayment(subscription: SubscriptionRecord): Promise<boolean> {
    if (!subscription.stripeSubscriptionId?.startsWith('sub_')) {
      this.logger.info(`[Subscription] ${subscription.id} is not a Stripe subscription, skipping retry`);
      return false;
    }

    this.logger.info(`[Subscription] Retrying payment for subscription ${subscription.id}`);

    try {
      const invoices = await this.stripe.invoices.list({
        subscription: subscription.stripeSubscriptionId,
        status: 'open',
        limit: 1,
      });

      if (invoices.data.length === 0) {
        this.logger.info(`[Subscription] No open invoices for subscription ${subscription.id}`);
        return false;
      }

      const paidInvoice = await this.stripe.invoices.pay(invoices.data[0].id);

      if (paidInvoice.status === 'paid') {
        await this.adapter.updateSubscription(subscription.id, {
          status: 'active',
          paymentRetryCount: 0,
          lastPaymentAttempt: new Date(),
          nextRetryDate: undefined,
          failureReason: undefined,
        });

        this.events.notifyUser(subscription.customerId, 'payout:retry_success', 'Payment Successful',
          'Your recurring order payment has been processed successfully. Your subscription is now active.',
          {
            subscriptionId: subscription.id,
            stripeSubscriptionId: subscription.stripeSubscriptionId,
            customerId: subscription.customerId,
            listingId: subscription.listingId,
            merchantId: '',
            interval: subscription.interval,
            totalPrice: subscription.totalPrice,
          }
        );

        this.logger.info(`[Subscription] Retry successful for subscription ${subscription.id}`);
        return true;
      }

      return false;
    } catch (err: any) {
      this.logger.error(`[Subscription] Payment retry failed for ${subscription.id}: ${err.message}`);
      return false;
    }
  }

  /**
   * Cancel a subscription.
   */
  async cancelSubscription(
    subscriptionId: string,
    cancelImmediately: boolean = false
  ): Promise<SubscriptionRecord> {
    const subscription = await this.adapter.findSubscriptionById(subscriptionId);
    if (!subscription) {
      throw new Error('Subscription not found');
    }

    // Cancel in Stripe if real subscription
    if (subscription.stripeSubscriptionId?.startsWith('sub_')) {
      try {
        if (!cancelImmediately) {
          await this.stripe.subscriptions.update(subscription.stripeSubscriptionId, {
            cancel_at_period_end: true,
          });
        } else {
          await this.stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
        }
      } catch (err: any) {
        this.logger.error(`[Subscription] Stripe cancellation error: ${err.message}`);
      }
    }

    // Update in database
    await this.adapter.updateSubscription(subscriptionId, {
      cancelAtPeriodEnd: !cancelImmediately,
      status: cancelImmediately ? 'canceled' : subscription.status,
      canceledAt: cancelImmediately ? new Date() : undefined,
    });

    // Cancel future orders
    await this.adapter.updateManyOrders(
      { subscriptionId, futureOnly: true },
      {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancellationReason: 'Subscription cancelled by user',
      }
    );

    // Notify
    this.events.notifyUser(subscription.customerId, 'subscription:cancelled_user', 'Subscription Cancelled',
      cancelImmediately
        ? 'Your recurring order has been cancelled immediately.'
        : 'Your recurring order will be cancelled at the end of the current billing period.',
      {
        subscriptionId: subscription.id,
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        customerId: subscription.customerId,
        listingId: subscription.listingId,
        merchantId: '',
        interval: subscription.interval,
        totalPrice: subscription.totalPrice,
        cancellationReason: 'Cancelled by user',
      }
    );

    return subscription;
  }

  /**
   * Refund a single recurring order occurrence without cancelling the subscription.
   */
  async refundSubscriptionOrder(
    orderId: string,
    reason: string = 'requested_by_customer'
  ): Promise<{
    success: boolean;
    refundAmount: number;
    stripeRefundId?: string;
  }> {
    const order = await this.adapter.findOrderById(orderId);
    if (!order || !order.subscriptionId) {
      throw new Error('Recurring order not found');
    }

    const subscription = await this.adapter.findSubscriptionById(order.subscriptionId);
    if (!subscription?.stripeSubscriptionId) {
      throw new Error('Subscription payment information not found');
    }

    // Find payment intent
    let paymentIntentId = order.paymentIntentId;
    if (!paymentIntentId) {
      const payment = await this.adapter.findPaymentByOrderId(orderId);
      paymentIntentId = payment?.stripePaymentId || undefined;
    }

    if (!paymentIntentId) {
      paymentIntentId = await this.findPaymentIntentForOrder(subscription, order) || undefined;
    }

    let stripeRefund: Stripe.Refund | undefined;
    const refundAmount = Math.round((order.totalPrice || subscription.totalPrice) * 100);

    if (paymentIntentId && refundAmount > 0) {
      stripeRefund = await this.stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount: refundAmount,
        reason: 'requested_by_customer',
        metadata: {
          orderId: order.id,
          subscriptionId: order.subscriptionId,
          customerId: order.customerId,
          cancellationReason: (reason || 'No reason provided').substring(0, 500),
        },
      });
    }

    // Update payment record
    if (paymentIntentId) {
      const existingPayment = await this.adapter.findPaymentByOrderId(orderId);
      if (existingPayment) {
        await this.adapter.updatePayment(existingPayment.id, {
          status: stripeRefund ? 'refunded' : 'completed',
          stripePaymentId: paymentIntentId,
          stripeRefundId: stripeRefund?.id,
          refundAmount: stripeRefund ? refundAmount / 100 : undefined,
          refundReason: stripeRefund ? reason : undefined,
        });
      } else {
        await this.adapter.createPayment({
          orderId: order.id,
          customerId: order.customerId,
          amount: order.totalPrice || subscription.totalPrice,
          currency: this.config.currency,
          status: stripeRefund ? 'refunded' : 'completed',
          stripePaymentId: paymentIntentId,
          stripeRefundId: stripeRefund?.id,
          refundAmount: stripeRefund ? refundAmount / 100 : undefined,
          refundReason: stripeRefund ? reason : undefined,
        });
      }
    }

    // Update order
    await this.adapter.updateOrder(order.id, {
      paymentStatus: stripeRefund ? 'REFUNDED' : 'CANCELLED',
      paymentIntentId: paymentIntentId || order.paymentIntentId,
      payoutStatus: stripeRefund ? 'REFUNDED' : 'CANCELLED',
      cancellationReason: reason,
      cancelledAt: new Date(),
    });

    // Record refund transaction
    if (stripeRefund) {
      await this.adapter.createTransaction({
        orderId: order.id,
        customerId: order.customerId,
        merchantId: order.merchantId,
        amount: -(refundAmount / 100),
        type: 'REFUND',
        status: 'COMPLETED',
        lifecycleStage: 'REFUNDED',
        stripeRefundId: stripeRefund.id,
        stripePaymentIntentId: paymentIntentId,
        description: 'Recurring order refund',
        refundedAt: new Date(),
      });
    }

    return {
      success: true,
      refundAmount: stripeRefund ? refundAmount / 100 : 0,
      stripeRefundId: stripeRefund?.id,
    };
  }

  /**
   * Find the payment intent for a recurring order by searching Stripe invoices.
   */
  private async findPaymentIntentForOrder(
    subscription: SubscriptionRecord,
    order: { date: Date }
  ): Promise<string | null> {
    const stripeId = subscription.stripeSubscriptionId;

    // If it's a payment intent ID, return directly
    if (stripeId.startsWith('pi_')) return stripeId;
    if (!stripeId.startsWith('sub_')) return null;

    try {
      const invoices = await this.stripe.invoices.list({
        subscription: stripeId,
        limit: 50,
      });

      if (!invoices?.data?.length) return null;

      const orderDate = new Date(order.date);
      orderDate.setHours(0, 0, 0, 0);

      // Match by period date
      for (const invoice of invoices.data) {
        const lines = invoice.lines?.data || [];
        const matchingLine = lines.find((line) => {
          if (!line.period?.start) return false;
          const periodDate = new Date(line.period.start * 1000);
          periodDate.setHours(0, 0, 0, 0);
          return Math.abs(periodDate.getTime() - orderDate.getTime()) <= 24 * 60 * 60 * 1000;
        });

        if (matchingLine && invoice.payment_intent) {
          return typeof invoice.payment_intent === 'string'
            ? invoice.payment_intent
            : invoice.payment_intent?.id || null;
        }
      }

      // Fallback to any invoice with a payment intent
      const fallback = invoices.data.find((inv) => inv.payment_intent);
      if (fallback) {
        return typeof fallback.payment_intent === 'string'
          ? fallback.payment_intent
          : fallback.payment_intent?.id || null;
      }
    } catch (err: any) {
      this.logger.error(`[Subscription] Error finding payment intent: ${err.message}`);
    }

    return null;
  }

  /** Get day-of-week name from a date */
  private getDayOfWeek(date: Date): string {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[date.getDay()];
  }
}
