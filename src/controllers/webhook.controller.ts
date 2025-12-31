//@ts-nocheck
import { Request, Response } from 'express';
import { stripe } from '../config/stripe.config';
import prisma from '../config/database';
import Stripe from 'stripe';
import { createNotification } from './notification.controller';
import { emailService } from '../services/email.service';
import { calculatePayoutAmounts } from '../utils/commission.utils';
import { transactionLifecycleService, LIFECYCLE_STAGES } from '../services/transaction-lifecycle.service';

/**
 * ============================================================================
 * STRIPE WEBHOOK CONTROLLER
 * ============================================================================
 *
 * Four dedicated webhook endpoints for handling different Stripe events:
 *
 * 1. PAYMENTS WEBHOOK (/api/webhooks/payments)
 *    - For platform payment events (customer payments to your platform)
 *    - Secret: STRIPE_WEBHOOK_SECRET
 *    - Events: payment_intent.*, charge.succeeded, charge.failed, charge.updated
 *
 * 2. CONNECT ACCOUNTS WEBHOOK (/api/webhooks/connect)
 *    - For connected account onboarding events (field owners creating Stripe accounts)
 *    - Secret: STRIPE_CONNECT_WEBHOOK_SECRET
 *    - Events: account.updated, account.application.authorized, account.application.deauthorized
 *
 * 3. PAYOUTS WEBHOOK (/api/webhooks/payouts)
 *    - For payout events on connected accounts (money going to field owners' banks)
 *    - Secret: STRIPE_PAYOUT_WEBHOOK_SECRET (connected accounts)
 *    - Events: payout.*, transfer.*, balance.available
 *
 * 4. REFUNDS WEBHOOK (/api/webhooks/refunds)
 *    - For refund events (money going back to customers)
 *    - Secret: STRIPE_REFUND_WEBHOOK_SECRET
 *    - Events: charge.refunded, refund.created, refund.updated, refund.failed
 *
 * ============================================================================
 */

export class WebhookController {

  // ============================================================================
  // 1. PAYMENTS WEBHOOK - Platform Payment Events
  // ============================================================================
  /**
   * Endpoint: /api/webhooks/payments
   * Listen to: "Events on your account"
   *
   * EVENTS TO ENABLE IN STRIPE DASHBOARD:
   * - payment_intent.created
   * - payment_intent.succeeded
   * - payment_intent.payment_failed
   * - payment_intent.canceled
   * - payment_intent.processing
   * - charge.succeeded
   * - charge.failed
   * - charge.updated
   * - charge.captured
   * - charge.expired
   */
  async handlePaymentWebhook(req: Request, res: Response) {
    const sig = req.headers['stripe-signature'] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('[PaymentWebhook] Webhook secret not configured');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error('[PaymentWebhook] Signature verification failed:', err);
      return res.status(400).send(`Webhook Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    console.log(`[PaymentWebhook] Received event: ${event.type}`, { eventId: event.id });

    try {
      switch (event.type) {
        case 'payment_intent.created':
          await this.handlePaymentIntentCreated(event);
          break;

        case 'payment_intent.succeeded':
          await this.handlePaymentIntentSucceeded(event);
          break;

        case 'payment_intent.payment_failed':
          await this.handlePaymentIntentFailed(event);
          break;

        case 'payment_intent.canceled':
          await this.handlePaymentIntentCanceled(event);
          break;

        case 'payment_intent.processing':
          console.log('[PaymentWebhook] Payment processing:', (event.data.object as Stripe.PaymentIntent).id);
          break;

        case 'charge.succeeded':
          await this.handleChargeSucceeded(event);
          break;

        case 'charge.failed':
          await this.handleChargeFailed(event);
          break;

        case 'charge.updated':
          console.log('[PaymentWebhook] Charge updated:', (event.data.object as Stripe.Charge).id);
          break;

        case 'charge.captured':
          console.log('[PaymentWebhook] Charge captured:', (event.data.object as Stripe.Charge).id);
          break;

        default:
          console.log(`[PaymentWebhook] Unhandled event type: ${event.type}`);
      }

      res.json({ received: true });
    } catch (error) {
      console.error('[PaymentWebhook] Error processing webhook:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }

  // ============================================================================
  // 2. CONNECT ACCOUNTS WEBHOOK - Merchant/Field Owner Account Events
  // ============================================================================
  /**
   * Endpoint: /api/webhooks/connect
   * Listen to: "Events on Connected accounts"
   *
   * EVENTS TO ENABLE IN STRIPE DASHBOARD:
   * - account.updated
   * - account.application.authorized
   * - account.application.deauthorized
   * - account.external_account.created
   * - account.external_account.deleted
   * - account.external_account.updated
   * - capability.updated
   * - person.created
   * - person.updated
   * - person.deleted
   */
  async handleConnectWebhook(req: Request, res: Response) {
    const sig = req.headers['stripe-signature'] as string;
    const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('[ConnectWebhook] Webhook secret not configured');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error('[ConnectWebhook] Signature verification failed:', err);
      return res.status(400).send(`Webhook Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    const connectedAccountId = (event as any).account;
    console.log(`[ConnectWebhook] Received event: ${event.type}`, {
      eventId: event.id,
      connectedAccountId: connectedAccountId || 'platform'
    });

    try {
      switch (event.type) {
        case 'account.updated':
          await this.handleAccountUpdated(event);
          break;

        case 'account.application.authorized':
          await this.handleAccountAuthorized(event);
          break;

        case 'account.application.deauthorized':
          await this.handleAccountDeauthorized(event);
          break;

        case 'account.external_account.created':
          await this.handleExternalAccountCreated(event);
          break;

        case 'account.external_account.updated':
          await this.handleExternalAccountUpdated(event);
          break;

        case 'account.external_account.deleted':
          await this.handleExternalAccountDeleted(event);
          break;

        case 'capability.updated':
          await this.handleCapabilityUpdated(event);
          break;

        case 'person.created':
        case 'person.updated':
        case 'person.deleted':
          console.log(`[ConnectWebhook] Person event: ${event.type}`);
          break;

        default:
          console.log(`[ConnectWebhook] Unhandled event type: ${event.type}`);
      }

      res.json({ received: true });
    } catch (error) {
      console.error('[ConnectWebhook] Error processing webhook:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }

  // ============================================================================
  // 3. PAYOUTS WEBHOOK - Field Owner Payout Events
  // ============================================================================
  /**
   * Endpoint: /api/webhooks/payouts
   * Listen to: "Events on Connected accounts"
   *
   * EVENTS TO ENABLE IN STRIPE DASHBOARD:
   * - payout.created
   * - payout.updated
   * - payout.paid
   * - payout.failed
   * - payout.canceled
   * - payout.reconciliation_completed
   * - transfer.created
   * - transfer.updated
   * - transfer.reversed
   * - balance.available
   */
  async handlePayoutWebhook(req: Request, res: Response) {
    const sig = req.headers['stripe-signature'] as string;
    // Payout events come from connected accounts, so use connect webhook secret
    const webhookSecret = process.env.STRIPE_PAYOUT_WEBHOOK_SECRET || process.env.STRIPE_CONNECT_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('[PayoutWebhook] Webhook secret not configured');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error('[PayoutWebhook] Signature verification failed:', err);
      return res.status(400).send(`Webhook Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    const connectedAccountId = (event as any).account;
    console.log(`[PayoutWebhook] Received event: ${event.type}`, {
      eventId: event.id,
      connectedAccountId: connectedAccountId || 'platform'
    });

    try {
      switch (event.type) {
        case 'payout.created':
          await this.handlePayoutCreated(event);
          break;

        case 'payout.updated':
          await this.handlePayoutUpdated(event);
          break;

        case 'payout.paid':
          await this.handlePayoutPaid(event);
          break;

        case 'payout.failed':
          await this.handlePayoutFailed(event);
          break;

        case 'payout.canceled':
          await this.handlePayoutCanceled(event);
          break;

        case 'payout.reconciliation_completed':
          console.log('[PayoutWebhook] Payout reconciliation completed:', (event.data.object as Stripe.Payout).id);
          break;

        case 'transfer.created':
          await this.handleTransferCreated(event);
          break;

        case 'transfer.updated':
          await this.handleTransferUpdated(event);
          break;

        case 'transfer.reversed':
          await this.handleTransferReversed(event);
          break;

        case 'balance.available':
          await this.handleBalanceAvailable(event);
          break;

        default:
          console.log(`[PayoutWebhook] Unhandled event type: ${event.type}`);
      }

      res.json({ received: true });
    } catch (error) {
      console.error('[PayoutWebhook] Error processing webhook:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }

  // ============================================================================
  // 4. REFUNDS WEBHOOK - Customer Refund Events
  // ============================================================================
  /**
   * Endpoint: /api/webhooks/refunds
   * Listen to: "Events on your account"
   *
   * EVENTS TO ENABLE IN STRIPE DASHBOARD:
   * - charge.refunded
   * - charge.refund.updated
   * - refund.created
   * - refund.updated
   * - refund.failed
   */
  async handleRefundWebhook(req: Request, res: Response) {
    const sig = req.headers['stripe-signature'] as string;
    const webhookSecret = process.env.STRIPE_REFUND_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('[RefundWebhook] Webhook secret not configured');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      console.error('[RefundWebhook] Signature verification failed:', err);
      return res.status(400).send(`Webhook Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    console.log(`[RefundWebhook] Received event: ${event.type}`, { eventId: event.id });

    try {
      switch (event.type) {
        case 'charge.refunded':
          await this.handleChargeRefunded(event);
          break;

        case 'charge.refund.updated':
          console.log('[RefundWebhook] Charge refund updated');
          break;

        case 'refund.created':
          await this.handleRefundCreated(event);
          break;

        case 'refund.updated':
          await this.handleRefundUpdated(event);
          break;

        case 'refund.failed':
          await this.handleRefundFailed(event);
          break;

        default:
          console.log(`[RefundWebhook] Unhandled event type: ${event.type}`);
      }

      res.json({ received: true });
    } catch (error) {
      console.error('[RefundWebhook] Error processing webhook:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }

  // ============================================================================
  // PAYMENT EVENT HANDLERS
  // ============================================================================

  private async handlePaymentIntentCreated(event: Stripe.Event) {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    console.log('[PaymentWebhook] Payment intent created:', paymentIntent.id);
    // Usually no action needed - booking is created via API
  }

  private async handlePaymentIntentSucceeded(event: Stripe.Event) {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    console.log('[PaymentWebhook] Payment intent succeeded:', paymentIntent.id);

    // Use transaction to prevent duplicate booking updates
    await prisma.$transaction(async (tx) => {
      // Check if booking exists
      const booking = await tx.booking.findFirst({
        where: { paymentIntentId: paymentIntent.id },
        include: { field: true, user: true }
      });

      if (!booking) {
        // Handle case where webhook arrives before booking creation
        const metadata = paymentIntent.metadata;
        if (metadata.userId && metadata.fieldId && metadata.date && metadata.timeSlot) {
          // Check if a booking already exists for this combination
          const existingBooking = await tx.booking.findFirst({
            where: {
              userId: metadata.userId,
              fieldId: metadata.fieldId,
              date: new Date(metadata.date),
              timeSlot: metadata.timeSlot,
              status: { notIn: ['CANCELLED'] }
            }
          });

          if (existingBooking) {
            console.log('[PaymentWebhook] Booking already exists, updating payment intent');
            if (!existingBooking.paymentIntentId) {
              await tx.booking.update({
                where: { id: existingBooking.id },
                data: {
                  paymentIntentId: paymentIntent.id,
                  status: 'CONFIRMED',
                  paymentStatus: 'PAID'
                }
              });

              // Create lifecycle transaction for existing booking
              await this.createLifecycleTransaction(existingBooking, paymentIntent, metadata);
            }
            return;
          }

          // Create new booking from webhook
          const [startTime, endTime] = metadata.timeSlot.split(' - ').map((t: string) => t.trim());
          const newBooking = await tx.booking.create({
            data: {
              fieldId: metadata.fieldId,
              userId: metadata.userId,
              date: new Date(metadata.date),
              startTime,
              endTime,
              timeSlot: metadata.timeSlot,
              numberOfDogs: parseInt(metadata.numberOfDogs || '1'),
              totalPrice: paymentIntent.amount / 100,
              platformCommission: parseFloat(metadata.platformCommission || '0'),
              fieldOwnerAmount: parseFloat(metadata.fieldOwnerAmount || '0'),
              status: 'CONFIRMED',
              paymentStatus: 'PAID',
              paymentIntentId: paymentIntent.id,
              payoutStatus: 'PENDING'
            }
          });

          console.log('[PaymentWebhook] Created new booking:', newBooking.id);

          // Create lifecycle transaction for new booking
          await this.createLifecycleTransaction(newBooking, paymentIntent, metadata);
        }
      } else if (booking.status !== 'CONFIRMED' || booking.paymentStatus !== 'PAID') {
        // Update existing booking
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: 'CONFIRMED',
            paymentStatus: 'PAID'
          }
        });

        // Create lifecycle transaction
        await this.createLifecycleTransaction(booking, paymentIntent, paymentIntent.metadata);

        // Send confirmation notification
        await createNotification({
          userId: booking.userId,
          type: 'booking_confirmed',
          title: 'Booking Confirmed',
          message: `Your booking for ${booking.field.name} has been confirmed.`,
          data: { bookingId: booking.id }
        });

        // Notify field owner
        if (booking.field.ownerId) {
          await createNotification({
            userId: booking.field.ownerId,
            type: 'new_booking',
            title: 'New Booking',
            message: `You have a new booking for ${booking.field.name}.`,
            data: { bookingId: booking.id }
          });
        }

        console.log('[PaymentWebhook] Updated booking:', booking.id);
      }
    });
  }

  /**
   * Create lifecycle transaction for tracking payment flow
   */
  private async createLifecycleTransaction(booking: any, paymentIntent: Stripe.PaymentIntent, metadata: any) {
    try {
      // Get charge ID if available
      let chargeId: string | undefined;
      if (paymentIntent.latest_charge) {
        chargeId = typeof paymentIntent.latest_charge === 'string'
          ? paymentIntent.latest_charge
          : paymentIntent.latest_charge.id;
      }

      // Get connected account ID for field owner
      const fieldOwnerStripeAccount = await prisma.stripeAccount.findFirst({
        where: { userId: metadata.fieldOwnerId || booking.field?.ownerId }
      });

      await transactionLifecycleService.createPaymentTransaction({
        bookingId: booking.id,
        userId: booking.userId,
        fieldOwnerId: metadata.fieldOwnerId || booking.field?.ownerId,
        amount: paymentIntent.amount / 100,
        platformFee: parseFloat(metadata.platformCommission || '0'),
        netAmount: parseFloat(metadata.fieldOwnerAmount || '0'),
        commissionRate: parseFloat(metadata.commissionRate || '0'),
        isCustomCommission: metadata.isCustomCommission === 'true',
        defaultCommissionRate: parseFloat(metadata.defaultCommissionRate || '0'),
        stripePaymentIntentId: paymentIntent.id,
        stripeChargeId: chargeId,
        connectedAccountId: fieldOwnerStripeAccount?.stripeAccountId,
        description: `Payment for booking ${booking.id}`
      });

      console.log('[PaymentWebhook] Created lifecycle transaction for booking:', booking.id);
    } catch (error) {
      console.error('[PaymentWebhook] Error creating lifecycle transaction:', error);
      // Don't fail the webhook if transaction creation fails
    }
  }

  private async handlePaymentIntentFailed(event: Stripe.Event) {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    console.error('[PaymentWebhook] Payment intent failed:', paymentIntent.id);

    const booking = await prisma.booking.findFirst({
      where: { paymentIntentId: paymentIntent.id },
      include: { user: true }
    });

    if (booking) {
      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          status: 'CANCELLED',
          paymentStatus: 'FAILED'
        }
      });

      // Update lifecycle transaction to FAILED
      await transactionLifecycleService.updateFailed({
        stripePaymentIntentId: paymentIntent.id,
        failureCode: paymentIntent.last_payment_error?.code || 'unknown',
        failureMessage: paymentIntent.last_payment_error?.message || 'Payment failed'
      });

      await createNotification({
        userId: booking.userId,
        type: 'payment_failed',
        title: 'Payment Failed',
        message: 'Your payment could not be processed. Please try again.',
        data: { bookingId: booking.id }
      });
    }
  }

  private async handlePaymentIntentCanceled(event: Stripe.Event) {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    console.log('[PaymentWebhook] Payment intent canceled:', paymentIntent.id);

    const booking = await prisma.booking.findFirst({
      where: { paymentIntentId: paymentIntent.id }
    });

    if (booking && booking.status !== 'CANCELLED') {
      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          status: 'CANCELLED',
          paymentStatus: 'CANCELLED'
        }
      });
    }
  }

  private async handleChargeSucceeded(event: Stripe.Event) {
    const charge = event.data.object as Stripe.Charge;
    console.log('[PaymentWebhook] Charge succeeded:', charge.id);

    // Update lifecycle to FUNDS_PENDING with balance transaction ID
    if (charge.payment_intent) {
      const paymentIntentId = typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent.id;

      const balanceTransactionId = charge.balance_transaction
        ? (typeof charge.balance_transaction === 'string'
          ? charge.balance_transaction
          : charge.balance_transaction.id)
        : undefined;

      await transactionLifecycleService.updateFundsPending(paymentIntentId, balanceTransactionId);

      // ============================================================================
      // Track when funds will be available (Rule 3: Delayed payouts)
      // Stripe typically makes funds available in 2 business days
      // ============================================================================
      if (balanceTransactionId) {
        try {
          const balanceTransaction = await stripe.balanceTransactions.retrieve(balanceTransactionId);

          // available_on is a Unix timestamp
          if (balanceTransaction.available_on) {
            const fundsAvailableAt = new Date(balanceTransaction.available_on * 1000);
            console.log(`[PaymentWebhook] Funds for charge ${charge.id} will be available at: ${fundsAvailableAt.toISOString()}`);

            // Store the expected availability date in the transaction
            await prisma.transaction.updateMany({
              where: { stripePaymentIntentId: paymentIntentId },
              data: {
                metadata: {
                  expectedFundsAvailableAt: fundsAvailableAt.toISOString(),
                  balanceTransactionStatus: balanceTransaction.status
                }
              }
            });
          }
        } catch (error) {
          console.error('[PaymentWebhook] Error fetching balance transaction details:', error);
        }
      }
    }
  }

  private async handleChargeFailed(event: Stripe.Event) {
    const charge = event.data.object as Stripe.Charge;
    console.error('[PaymentWebhook] Charge failed:', charge.id, 'Reason:', charge.failure_message);
  }

  // ============================================================================
  // CONNECT ACCOUNT EVENT HANDLERS
  // ============================================================================

  private async handleAccountUpdated(event: Stripe.Event) {
    const account = event.data.object as Stripe.Account;
    console.log('[ConnectWebhook] Account updated:', {
      accountId: account.id,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted
    });

    // Find and update our record
    const stripeAccount = await prisma.stripeAccount.findFirst({
      where: { stripeAccountId: account.id },
      include: { user: true }
    });

    if (stripeAccount) {
      const wasPayoutsEnabled = stripeAccount.payoutsEnabled;

      await prisma.stripeAccount.update({
        where: { id: stripeAccount.id },
        data: {
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled,
          detailsSubmitted: account.details_submitted,
          // Update requirements
          requirementsCurrentlyDue: account.requirements?.currently_due || [],
          requirementsEventuallyDue: account.requirements?.eventually_due || [],
          requirementsPastDue: account.requirements?.past_due || []
        }
      });

      // Notify user if payouts just became enabled
      if (!wasPayoutsEnabled && account.payouts_enabled) {
        await createNotification({
          userId: stripeAccount.userId,
          type: 'stripe_account_ready',
          title: 'Stripe Account Ready',
          message: 'Your Stripe account is now fully set up! You can start receiving payouts for your bookings.',
          data: { stripeAccountId: account.id }
        });

        // Send email
        if (stripeAccount.user?.email) {
          await emailService.sendEmail({
            to: stripeAccount.user.email,
            subject: 'Your Stripe Account is Ready!',
            template: 'stripe-account-ready',
            data: {
              userName: stripeAccount.user.name || 'Field Owner'
            }
          });
        }
      }

      // Notify if there are requirements due
      if (account.requirements?.currently_due && account.requirements.currently_due.length > 0) {
        await createNotification({
          userId: stripeAccount.userId,
          type: 'stripe_requirements',
          title: 'Action Required',
          message: 'Your Stripe account needs additional information. Please complete the setup to receive payouts.',
          data: {
            stripeAccountId: account.id,
            requirements: account.requirements.currently_due
          }
        });
      }
    } else {
      // Account not in our database - might be from metadata
      const userId = account.metadata?.userId;
      if (userId) {
        console.log('[ConnectWebhook] Creating new StripeAccount record for user:', userId);
        await prisma.stripeAccount.create({
          data: {
            userId,
            stripeAccountId: account.id,
            chargesEnabled: account.charges_enabled || false,
            payoutsEnabled: account.payouts_enabled || false,
            detailsSubmitted: account.details_submitted || false,
            requirementsCurrentlyDue: account.requirements?.currently_due || [],
            requirementsEventuallyDue: account.requirements?.eventually_due || [],
            requirementsPastDue: account.requirements?.past_due || []
          }
        });
      }
    }
  }

  private async handleAccountAuthorized(event: Stripe.Event) {
    const application = event.data.object as any;
    console.log('[ConnectWebhook] Account authorized:', application);
  }

  private async handleAccountDeauthorized(event: Stripe.Event) {
    const application = event.data.object as any;
    const connectedAccountId = (event as any).account;
    console.log('[ConnectWebhook] Account deauthorized:', connectedAccountId);

    if (connectedAccountId) {
      const stripeAccount = await prisma.stripeAccount.findFirst({
        where: { stripeAccountId: connectedAccountId }
      });

      if (stripeAccount) {
        await prisma.stripeAccount.update({
          where: { id: stripeAccount.id },
          data: {
            chargesEnabled: false,
            payoutsEnabled: false,
            detailsSubmitted: false
          }
        });

        await createNotification({
          userId: stripeAccount.userId,
          type: 'stripe_account_disconnected',
          title: 'Stripe Account Disconnected',
          message: 'Your Stripe account has been disconnected. You will not receive payouts until you reconnect.',
          data: { stripeAccountId: connectedAccountId }
        });
      }
    }
  }

  private async handleExternalAccountCreated(event: Stripe.Event) {
    const externalAccount = event.data.object as Stripe.BankAccount | Stripe.Card;
    const connectedAccountId = (event as any).account;
    console.log('[ConnectWebhook] External account created:', {
      accountId: connectedAccountId,
      type: externalAccount.object
    });
  }

  private async handleExternalAccountUpdated(event: Stripe.Event) {
    const externalAccount = event.data.object as Stripe.BankAccount | Stripe.Card;
    console.log('[ConnectWebhook] External account updated:', externalAccount.id);
  }

  private async handleExternalAccountDeleted(event: Stripe.Event) {
    const externalAccount = event.data.object as Stripe.BankAccount | Stripe.Card;
    console.log('[ConnectWebhook] External account deleted:', externalAccount.id);
  }

  private async handleCapabilityUpdated(event: Stripe.Event) {
    const capability = event.data.object as Stripe.Capability;
    const connectedAccountId = (event as any).account;
    console.log('[ConnectWebhook] Capability updated:', {
      accountId: connectedAccountId,
      capability: capability.id,
      status: capability.status
    });

    if (connectedAccountId) {
      // Refresh account status
      const account = await stripe.accounts.retrieve(connectedAccountId);
      await prisma.stripeAccount.updateMany({
        where: { stripeAccountId: connectedAccountId },
        data: {
          chargesEnabled: account.charges_enabled,
          payoutsEnabled: account.payouts_enabled
        }
      });
    }
  }

  // ============================================================================
  // PAYOUT EVENT HANDLERS
  // ============================================================================

  private async handlePayoutCreated(event: Stripe.Event) {
    const payout = event.data.object as Stripe.Payout;
    const connectedAccountId = (event as any).account;

    console.log('[PayoutWebhook] Payout created:', {
      payoutId: payout.id,
      amount: payout.amount / 100,
      currency: payout.currency,
      status: payout.status,
      connectedAccountId
    });

    await this.syncPayoutRecord(payout, connectedAccountId);

    // Update lifecycle to PAYOUT_INITIATED
    const bookingId = payout.metadata?.bookingId;
    if (bookingId) {
      await transactionLifecycleService.updatePayoutInitiated({
        bookingId,
        stripePayoutId: payout.id
      });
    }
  }

  private async handlePayoutUpdated(event: Stripe.Event) {
    const payout = event.data.object as Stripe.Payout;
    const connectedAccountId = (event as any).account;

    console.log('[PayoutWebhook] Payout updated:', {
      payoutId: payout.id,
      status: payout.status
    });

    await this.syncPayoutRecord(payout, connectedAccountId);
  }

  private async handlePayoutPaid(event: Stripe.Event) {
    const payout = event.data.object as Stripe.Payout;
    const connectedAccountId = (event as any).account;

    console.log('[PayoutWebhook] Payout PAID:', {
      payoutId: payout.id,
      amount: payout.amount / 100,
      currency: payout.currency,
      arrivalDate: payout.arrival_date ? new Date(payout.arrival_date * 1000) : null
    });

    const payoutRecord = await this.syncPayoutRecord(payout, connectedAccountId);

    // Update lifecycle to PAYOUT_COMPLETED
    await transactionLifecycleService.updatePayoutCompleted(payout.id);

    if (connectedAccountId) {
      const stripeAccount = await prisma.stripeAccount.findFirst({
        where: { stripeAccountId: connectedAccountId },
        include: { user: true }
      });

      if (stripeAccount?.user) {
        // Send notification
        try {
          await createNotification({
            userId: stripeAccount.userId,
            type: 'payout_completed',
            title: 'Payout Completed',
            message: `Your payout of £${(payout.amount / 100).toFixed(2)} has been deposited to your bank account.`,
            data: {
              payoutId: payoutRecord?.id || payout.id,
              stripePayoutId: payout.id,
              amount: payout.amount / 100
            }
          });
        } catch (notifError) {
          console.error('[PayoutWebhook] Failed to send notification:', notifError);
        }

        // Update related bookings from metadata
        const bookingIds = this.extractBookingIds(payout.metadata);
        if (bookingIds.length > 0) {
          try {
            await prisma.booking.updateMany({
              where: { id: { in: bookingIds } },
              data: { payoutStatus: 'COMPLETED' }
            });
            console.log(`[PayoutWebhook] Updated ${bookingIds.length} bookings to COMPLETED`);
          } catch (bookingError) {
            console.error('[PayoutWebhook] Failed to update bookings:', bookingError);
          }
        }

        // Send email
        if (stripeAccount.user.email) {
          try {
            await emailService.sendPayoutCompletedEmail({
              email: stripeAccount.user.email,
              userName: stripeAccount.user.name || 'Field Owner',
              amount: (payout.amount / 100).toFixed(2),
              currency: payout.currency.toUpperCase()
            });
          } catch (emailError) {
            console.error('[PayoutWebhook] Failed to send email:', emailError);
          }
        }
      } else {
        console.log(`[PayoutWebhook] No user found for connected account: ${connectedAccountId}`);
      }
    } else {
      console.log(`[PayoutWebhook] Payout paid event has no connected account ID`);
    }
  }

  private async handlePayoutFailed(event: Stripe.Event) {
    const payout = event.data.object as Stripe.Payout;
    const connectedAccountId = (event as any).account;

    console.error('[PayoutWebhook] Payout FAILED:', {
      payoutId: payout.id,
      amount: payout.amount / 100,
      failureCode: payout.failure_code,
      failureMessage: payout.failure_message
    });

    const payoutRecord = await this.syncPayoutRecord(payout, connectedAccountId);

    if (connectedAccountId) {
      const stripeAccount = await prisma.stripeAccount.findFirst({
        where: { stripeAccountId: connectedAccountId },
        include: { user: true }
      });

      if (stripeAccount?.user) {
        try {
          await createNotification({
            userId: stripeAccount.userId,
            type: 'payout_failed',
            title: 'Payout Failed',
            message: `Your payout of £${(payout.amount / 100).toFixed(2)} could not be processed. ${payout.failure_message || 'Please check your bank details.'}`,
            data: {
              payoutId: payoutRecord?.id || payout.id,
              stripePayoutId: payout.id,
              failureCode: payout.failure_code,
              failureMessage: payout.failure_message
            }
          });
        } catch (notifError) {
          console.error('[PayoutWebhook] Failed to send notification:', notifError);
        }

        // Update related bookings from metadata
        const bookingIds = this.extractBookingIds(payout.metadata);
        if (bookingIds.length > 0) {
          try {
            await prisma.booking.updateMany({
              where: { id: { in: bookingIds } },
              data: { payoutStatus: 'FAILED' }
            });
            console.log(`[PayoutWebhook] Updated ${bookingIds.length} bookings to FAILED`);
          } catch (bookingError) {
            console.error('[PayoutWebhook] Failed to update bookings:', bookingError);
          }
        }

        // Send email notification for failed payout
        if (stripeAccount.user.email) {
          try {
            await emailService.sendPayoutFailedEmail({
              email: stripeAccount.user.email,
              userName: stripeAccount.user.name || 'Field Owner',
              amount: (payout.amount / 100).toFixed(2),
              currency: payout.currency.toUpperCase(),
              failureReason: payout.failure_message || undefined
            });
          } catch (emailError) {
            console.error('[PayoutWebhook] Failed to send payout failed email:', emailError);
          }
        }
      } else {
        console.log(`[PayoutWebhook] No user found for connected account: ${connectedAccountId}`);
      }
    }
  }

  private async handlePayoutCanceled(event: Stripe.Event) {
    const payout = event.data.object as Stripe.Payout;
    const connectedAccountId = (event as any).account;

    console.log('[PayoutWebhook] Payout canceled:', payout.id);
    await this.syncPayoutRecord(payout, connectedAccountId);
  }

  private async handleTransferCreated(event: Stripe.Event) {
    const transfer = event.data.object as Stripe.Transfer;
    console.log('[PayoutWebhook] Transfer created:', {
      transferId: transfer.id,
      amount: transfer.amount / 100,
      destination: transfer.destination
    });

    // Update lifecycle to TRANSFERRED
    const destinationAccountId = typeof transfer.destination === 'string'
      ? transfer.destination
      : transfer.destination?.id;

    if (destinationAccountId) {
      // Try to find the transaction by payment intent from transfer metadata
      const bookingId = transfer.metadata?.bookingId;
      const paymentIntentId = transfer.source_transaction
        ? (typeof transfer.source_transaction === 'string'
          ? transfer.source_transaction
          : transfer.source_transaction.id)
        : undefined;

      await transactionLifecycleService.updateTransferred({
        bookingId,
        stripePaymentIntentId: paymentIntentId,
        stripeTransferId: transfer.id,
        connectedAccountId: destinationAccountId
      });
    }
  }

  private async handleTransferUpdated(event: Stripe.Event) {
    const transfer = event.data.object as Stripe.Transfer;
    console.log('[PayoutWebhook] Transfer updated:', transfer.id);
  }

  private async handleTransferReversed(event: Stripe.Event) {
    const transfer = event.data.object as Stripe.Transfer;
    console.log('[PayoutWebhook] Transfer reversed:', {
      transferId: transfer.id,
      amount: transfer.amount / 100
    });

    // Update any associated payouts
    const payoutRecord = await prisma.payout.findFirst({
      where: {
        OR: [
          { stripePayoutId: transfer.id },
          { description: { contains: transfer.id } }
        ]
      }
    });

    if (payoutRecord) {
      await prisma.payout.update({
        where: { id: payoutRecord.id },
        data: {
          status: 'reversed',
          description: `Transfer ${transfer.id} was reversed`
        }
      });
    }
  }

  /**
   * Handle balance.available webhook event
   *
   * This is the CORRECT signal to trigger payouts (Rule 1 & 2)
   * When Stripe notifies us that balance has changed, we check for pending payouts
   * that can now be processed.
   */
  private async handleBalanceAvailable(event: Stripe.Event) {
    const balance = event.data.object as Stripe.Balance;
    const connectedAccountId = (event as any).account;

    // Find available balance for GBP
    const gbpAvailable = balance.available.find(b => b.currency === 'gbp');
    const gbpPending = balance.pending?.find(b => b.currency === 'gbp');

    console.log('[PayoutWebhook] Balance available event:', {
      eventId: event.id,
      connectedAccountId: connectedAccountId || 'platform',
      availableGBP: gbpAvailable?.amount ? gbpAvailable.amount / 100 : 0,
      pendingGBP: gbpPending?.amount ? gbpPending.amount / 100 : 0
    });

    // If this is a platform balance event (not connected account), process pending payouts
    if (!connectedAccountId && gbpAvailable && gbpAvailable.amount > 0) {
      console.log('[PayoutWebhook] Platform balance available - checking for pending payouts...');

      try {
        // Import the auto-payout service dynamically to avoid circular dependencies
        const { automaticPayoutService } = await import('../services/auto-payout.service');

        // Find bookings that are PENDING due to insufficient balance
        const pendingBookings = await prisma.booking.findMany({
          where: {
            payoutStatus: 'PENDING',
            payoutHeldReason: {
              contains: 'Insufficient platform balance'
            },
            status: 'CONFIRMED',
            paymentStatus: 'PAID'
          },
          take: 10, // Process in batches to avoid overwhelming the system
          orderBy: { createdAt: 'asc' } // Process oldest first
        });

        if (pendingBookings.length > 0) {
          console.log(`[PayoutWebhook] Found ${pendingBookings.length} bookings pending due to balance issues`);

          // Process each booking (balance will be re-checked in the service)
          for (const booking of pendingBookings) {
            try {
              await automaticPayoutService.processBookingPayoutAfterCancellationWindow(booking.id);
              console.log(`[PayoutWebhook] Processed pending payout for booking: ${booking.id}`);
            } catch (error) {
              console.error(`[PayoutWebhook] Failed to process booking ${booking.id}:`, error);
            }
          }
        }

        // Also process bookings waiting for funds availability
        const fundsWaitingBookings = await prisma.booking.findMany({
          where: {
            payoutStatus: 'PENDING',
            payoutHeldReason: {
              contains: 'Funds pending availability'
            },
            status: 'CONFIRMED',
            paymentStatus: 'PAID'
          },
          take: 10,
          orderBy: { createdAt: 'asc' }
        });

        if (fundsWaitingBookings.length > 0) {
          console.log(`[PayoutWebhook] Found ${fundsWaitingBookings.length} bookings waiting for funds availability`);

          for (const booking of fundsWaitingBookings) {
            try {
              await automaticPayoutService.processBookingPayoutAfterCancellationWindow(booking.id);
              console.log(`[PayoutWebhook] Processed funds-waiting payout for booking: ${booking.id}`);
            } catch (error) {
              console.error(`[PayoutWebhook] Failed to process booking ${booking.id}:`, error);
            }
          }
        }

        // Update transactions that were in FUNDS_PENDING to FUNDS_AVAILABLE
        // This is done by checking which transactions now have available funds
        const pendingTransactions = await prisma.transaction.findMany({
          where: {
            lifecycleStage: 'FUNDS_PENDING',
            stripeChargeId: { not: null }
          },
          take: 20
        });

        for (const transaction of pendingTransactions) {
          try {
            const charge = await stripe.charges.retrieve(transaction.stripeChargeId!);
            if (charge.balance_transaction) {
              const balanceTransactionId = typeof charge.balance_transaction === 'string'
                ? charge.balance_transaction
                : charge.balance_transaction.id;

              const balanceTransaction = await stripe.balanceTransactions.retrieve(balanceTransactionId);

              if (balanceTransaction.status === 'available') {
                await prisma.transaction.update({
                  where: { id: transaction.id },
                  data: {
                    lifecycleStage: 'FUNDS_AVAILABLE',
                    fundsAvailableAt: new Date()
                  }
                });
                console.log(`[PayoutWebhook] Updated transaction ${transaction.id} to FUNDS_AVAILABLE`);
              }
            }
          } catch (error) {
            console.error(`[PayoutWebhook] Error checking transaction ${transaction.id}:`, error);
          }
        }

      } catch (error) {
        console.error('[PayoutWebhook] Error processing pending payouts on balance available:', error);
      }
    }
  }

  // ============================================================================
  // REFUND EVENT HANDLERS
  // ============================================================================

  private async handleChargeRefunded(event: Stripe.Event) {
    const charge = event.data.object as Stripe.Charge;
    console.log('[RefundWebhook] Charge refunded:', charge.id);

    if (!charge.payment_intent) {
      console.warn('[RefundWebhook] Charge has no payment_intent');
      return;
    }

    const paymentIntentId = typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent.id;

    const booking = await prisma.booking.findFirst({
      where: { paymentIntentId },
      include: {
        user: true,
        field: { include: { owner: true } },
        payment: true
      }
    });

    if (!booking) {
      console.warn('[RefundWebhook] No booking found for payment intent:', paymentIntentId);
      return;
    }

    const refundAmount = charge.amount_refunded / 100;
    const isFullRefund = charge.refunded;

    // Update booking status
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: 'CANCELLED',
        paymentStatus: 'REFUNDED',
        payoutStatus: 'REFUNDED'
      }
    });

    // Update payment record
    if (booking.payment) {
      await prisma.payment.update({
        where: { id: booking.payment.id },
        data: {
          status: 'refunded',
          refundAmount,
          processedAt: new Date()
        }
      });
    }

    // Cancel pending payouts
    await prisma.payout.updateMany({
      where: {
        bookingIds: { has: booking.id },
        status: { in: ['pending', 'processing'] }
      },
      data: {
        status: 'canceled',
        description: `Canceled due to refund for booking ${booking.id}`
      }
    });

    // Update lifecycle transaction to REFUNDED
    await transactionLifecycleService.updateRefunded({
      stripePaymentIntentId: paymentIntentId,
      stripeRefundId: charge.id,
      refundAmount
    });

    // Notify user
    await createNotification({
      userId: booking.userId,
      type: 'refund_processed',
      title: 'Refund Processed',
      message: `Your refund of £${refundAmount.toFixed(2)} for ${booking.field.name} has been processed.`,
      data: { bookingId: booking.id, refundAmount, isFullRefund }
    });

    // Notify field owner
    if (booking.field.ownerId) {
      await createNotification({
        userId: booking.field.ownerId,
        type: 'booking_refunded',
        title: 'Booking Refunded',
        message: `A booking for ${booking.field.name} was refunded (£${refundAmount.toFixed(2)}).`,
        data: { bookingId: booking.id, refundAmount }
      });
    }

    console.log(`[RefundWebhook] Processed refund for booking ${booking.id}`);
  }

  private async handleRefundCreated(event: Stripe.Event) {
    const refund = event.data.object as Stripe.Refund;
    console.log('[RefundWebhook] Refund created:', refund.id, 'Status:', refund.status);

    if (refund.metadata?.bookingId) {
      console.log(`[RefundWebhook] Refund for booking: ${refund.metadata.bookingId}`);
    }
  }

  private async handleRefundUpdated(event: Stripe.Event) {
    const refund = event.data.object as Stripe.Refund;
    console.log('[RefundWebhook] Refund updated:', refund.id, 'Status:', refund.status);

    const bookingId = refund.metadata?.bookingId;
    if (bookingId) {
      const payment = await prisma.payment.findFirst({
        where: { booking: { id: bookingId } }
      });

      if (payment) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            stripeRefundId: refund.id,
            refundAmount: refund.amount / 100
          }
        });
      }
    }
  }

  private async handleRefundFailed(event: Stripe.Event) {
    const refund = event.data.object as Stripe.Refund;
    console.error('[RefundWebhook] Refund FAILED:', refund.id, 'Reason:', refund.failure_reason);

    const bookingId = refund.metadata?.bookingId;
    if (bookingId) {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { user: true }
      });

      if (booking) {
        await createNotification({
          userId: booking.userId,
          type: 'refund_failed',
          title: 'Refund Failed',
          message: 'Your refund could not be processed. Please contact support.',
          data: {
            bookingId,
            refundId: refund.id,
            failureReason: refund.failure_reason
          }
        });

        console.error(`[RefundWebhook] ALERT: Refund failed for booking ${bookingId}`);
      }
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private async syncPayoutRecord(payout: Stripe.Payout, connectedAccountId?: string): Promise<any> {
    try {
      const bookingIds = this.extractBookingIds(payout.metadata);

      // First try to find existing record
      let payoutRecord = await prisma.payout.findFirst({
        where: { stripePayoutId: payout.id }
      });

      if (payoutRecord) {
        // Update existing record
        payoutRecord = await prisma.payout.update({
          where: { id: payoutRecord.id },
          data: {
            status: payout.status,
            arrivalDate: payout.arrival_date ? new Date(payout.arrival_date * 1000) : null,
            failureCode: payout.failure_code || null,
            failureMessage: payout.failure_message || null
          }
        });
        console.log(`[PayoutWebhook] Updated payout ${payoutRecord.id} to: ${payout.status}`);
      } else if (connectedAccountId) {
        // Need to create new record
        const stripeAccount = await prisma.stripeAccount.findFirst({
          where: { stripeAccountId: connectedAccountId }
        });

        if (stripeAccount) {
          try {
            // Use upsert to handle race conditions where another webhook may have created the record
            payoutRecord = await prisma.payout.upsert({
              where: { stripePayoutId: payout.id },
              update: {
                status: payout.status,
                arrivalDate: payout.arrival_date ? new Date(payout.arrival_date * 1000) : null,
                failureCode: payout.failure_code || null,
                failureMessage: payout.failure_message || null
              },
              create: {
                stripeAccountId: stripeAccount.id,
                stripePayoutId: payout.id,
                amount: payout.amount / 100,
                currency: payout.currency,
                status: payout.status,
                description: payout.description || `Payout ${payout.id}`,
                arrivalDate: payout.arrival_date ? new Date(payout.arrival_date * 1000) : null,
                failureCode: payout.failure_code || null,
                failureMessage: payout.failure_message || null,
                bookingIds
              }
            });
            console.log(`[PayoutWebhook] Upserted payout record ${payoutRecord.id} with status: ${payout.status}`);
          } catch (upsertError: any) {
            // If upsert fails (e.g., race condition), try to fetch the existing record
            if (upsertError.code === 'P2002') {
              console.log(`[PayoutWebhook] Race condition detected, fetching existing record for: ${payout.id}`);
              payoutRecord = await prisma.payout.findFirst({
                where: { stripePayoutId: payout.id }
              });
              if (payoutRecord) {
                // Update the existing record
                payoutRecord = await prisma.payout.update({
                  where: { id: payoutRecord.id },
                  data: {
                    status: payout.status,
                    arrivalDate: payout.arrival_date ? new Date(payout.arrival_date * 1000) : null,
                    failureCode: payout.failure_code || null,
                    failureMessage: payout.failure_message || null
                  }
                });
                console.log(`[PayoutWebhook] Updated existing record after race condition: ${payoutRecord.id}`);
              }
            } else {
              throw upsertError;
            }
          }
        } else {
          console.log(`[PayoutWebhook] No StripeAccount found for connected account: ${connectedAccountId}`);
        }
      } else {
        console.log(`[PayoutWebhook] No payout record found and no connected account ID provided for payout: ${payout.id}`);
      }

      return payoutRecord;
    } catch (error) {
      console.error(`[PayoutWebhook] Error syncing payout record:`, error);
      // Return null instead of throwing - we don't want to fail the webhook
      return null;
    }
  }

  private extractBookingIds(metadata?: Stripe.Metadata | null): string[] {
    if (!metadata) return [];

    if (metadata.bookingId) {
      return [metadata.bookingId];
    }

    if (metadata.bookingIds) {
      try {
        const parsed = JSON.parse(metadata.bookingIds);
        if (Array.isArray(parsed)) return parsed.filter(Boolean);
      } catch {
        return metadata.bookingIds.split(',').map(id => id.trim()).filter(Boolean);
      }
    }

    return [];
  }
}

export const webhookController = new WebhookController();
