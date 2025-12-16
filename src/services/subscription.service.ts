//@ts-nocheck
import { stripe } from '../config/stripe.config';
import prisma from '../config/database';
import Stripe from 'stripe';
import { createNotification } from '../controllers/notification.controller';
import { addDays, addMonths, format, parse } from 'date-fns';

export class SubscriptionService {
  /**
   * Create a Stripe subscription for recurring bookings
   */
  async createSubscription({
    userId,
    fieldId,
    date,
    timeSlot,
    startTime,
    endTime,
    numberOfDogs,
    repeatBooking,
    amount,
    paymentMethodId,
    customerEmail
  }: {
    userId: string;
    fieldId: string;
    date: string;
    timeSlot: string;
    startTime: string;
    endTime: string;
    numberOfDogs: number;
    repeatBooking: 'weekly' | 'monthly';
    amount: number;
    paymentMethodId: string;
    customerEmail: string;
  }) {
    // Get user and field
    const [user, field] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.field.findUnique({ where: { id: fieldId } })
    ]);

    if (!user || !field) {
      throw new Error('User or field not found');
    }

    // Ensure user has a Stripe customer ID
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: customerEmail,
        name: user.name || undefined,
        metadata: { userId: user.id }
      });
      customerId = customer.id;
      
      await prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customerId }
      });
    }

    // Attach payment method to customer
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId
    });

    // Set as default payment method
    await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId
      }
    });

    // Calculate commission
    const PLATFORM_COMMISSION_RATE = 0.20;
    const platformCommission = Math.round(amount * PLATFORM_COMMISSION_RATE * 100) / 100;
    const fieldOwnerAmount = amount - platformCommission;

    // Parse the date to get day of week/month
    const bookingDate = new Date(date);
    const dayOfWeek = format(bookingDate, 'EEEE'); // Monday, Tuesday, etc.
    const dayOfMonth = bookingDate.getDate();

    // Create Stripe product for this field
    const product = await stripe.products.create({
      name: `${field.name} - ${timeSlot}`,
      metadata: {
        fieldId: field.id,
        fieldName: field.name || '',
        timeSlot,
        numberOfDogs: numberOfDogs.toString()
      }
    });

    // Create price based on interval
    const priceData: Stripe.PriceCreateParams = {
      product: product.id,
      unit_amount: Math.round(amount * 100), // Convert to cents
      currency: 'gbp',
      recurring: {
        interval: repeatBooking === 'weekly' ? 'week' : 'month',
        interval_count: 1
      },
      metadata: {
        fieldId: field.id,
        userId: user.id,
        platformCommission: platformCommission.toString(),
        fieldOwnerAmount: fieldOwnerAmount.toString()
      }
    };

    const price = await stripe.prices.create(priceData);

    // Calculate next billing date (next occurrence after first booking)
    let nextBillingDate = new Date();
    if (repeatBooking === 'weekly') {
      // Next billing is one week after the first booking
      nextBillingDate = this.getNextWeeklyDate(bookingDate);
    } else {
      // Next billing is one month after the first booking
      nextBillingDate = this.getNextMonthlyDate(bookingDate);
    }

    // Convert to Unix timestamp for Stripe (seconds since epoch)
    const billingCycleAnchor = Math.floor(nextBillingDate.getTime() / 1000);

    // Create the subscription
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: price.id }],
      // Set billing cycle to start from the next occurrence after first booking
      billing_cycle_anchor: billingCycleAnchor,
      // Don't prorate - charge full amount at each cycle
      proration_behavior: 'none',
      metadata: {
        userId: user.id,
        fieldId: field.id,
        fieldOwnerId: field.ownerId || '',
        timeSlot,
        startTime,
        endTime,
        numberOfDogs: numberOfDogs.toString(),
        dayOfWeek: repeatBooking === 'weekly' ? dayOfWeek : '',
        dayOfMonth: repeatBooking === 'monthly' ? dayOfMonth.toString() : '',
        interval: repeatBooking,
        platformCommission: platformCommission.toString(),
        fieldOwnerAmount: fieldOwnerAmount.toString(),
        firstBookingDate: bookingDate.toISOString()
      },
      payment_behavior: 'default_incomplete',
      payment_settings: {
        save_default_payment_method: 'on_subscription'
      },
      expand: ['latest_invoice.payment_intent']
    });

    // Store subscription in database
    const dbSubscription = await prisma.subscription.create({
      data: {
        userId,
        fieldId,
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: customerId,
        status: subscription.status,
        interval: repeatBooking,
        intervalCount: 1,
        currentPeriodStart: new Date(subscription.current_period_start * 1000),
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        timeSlot,
        dayOfWeek: repeatBooking === 'weekly' ? dayOfWeek : null,
        dayOfMonth: repeatBooking === 'monthly' ? dayOfMonth : null,
        startTime,
        endTime,
        numberOfDogs,
        totalPrice: amount,
        nextBillingDate: new Date(subscription.current_period_end * 1000)
      }
    });

    // Create the first booking
    await this.createBookingFromSubscription(dbSubscription.id, bookingDate);

    // Send notification to field owner
    if (field.ownerId && field.ownerId !== userId) {
      await createNotification({
        userId: field.ownerId,
        type: 'recurring_booking_created',
        title: 'New Recurring Booking!',
        message: `A ${repeatBooking} recurring booking has been set up for ${field.name} starting ${format(bookingDate, 'PPP')} at ${timeSlot}`,
        data: {
          subscriptionId: dbSubscription.id,
          fieldId: field.id,
          fieldName: field.name,
          interval: repeatBooking
        }
      });
    }

    return {
      subscription: dbSubscription,
      stripeSubscription: subscription,
      clientSecret: (subscription.latest_invoice as any)?.payment_intent?.client_secret
    };
  }

  /**
   * Create bookings from a subscription (handles multi-slot subscriptions)
   */
  async createBookingFromSubscription(subscriptionId: string, bookingDate: Date) {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        field: true,
        user: true  // Include user to verify it exists
      }
    });

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    if (!subscription.user) {
      throw new Error(`User not found for subscription ${subscriptionId}`);
    }

    // Import BookingModel for availability check
    const BookingModel = (await import('../models/booking.model')).default;

    const { field } = subscription;
    const pricePerUnit = field.price || 0;

    // Determine if this is a multi-slot subscription
    const timeSlots = subscription.timeSlots && subscription.timeSlots.length > 0
      ? subscription.timeSlots
      : [subscription.timeSlot]; // Fallback to single slot format

    const bookings = [];

    // Helper to parse time to minutes
    const parseTimeToMinutes = (timeStr: string): number => {
      const match = timeStr.match(/(\d+):(\d+)(AM|PM)/i);
      if (!match) return 0;
      let hours = parseInt(match[1]);
      const minutes = parseInt(match[2]);
      const period = match[3].toUpperCase();
      if (period === 'PM' && hours !== 12) hours += 12;
      if (period === 'AM' && hours === 12) hours = 0;
      return hours * 60 + minutes;
    };

    // Helper to convert minutes to time string
    const minutesToTimeStr = (totalMinutes: number): string => {
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      const period = hours >= 12 ? 'PM' : 'AM';
      const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
      return `${displayHour}:${minutes.toString().padStart(2, '0')}${period}`;
    };

    // Determine actual duration in minutes (30 or 60)
    const actualDurationMinutes = field.bookingDuration === '30min' ? 30 : 60;

    for (const slot of timeSlots) {
      // Parse start and end time from slot format "X:XXAM - Y:YYAM" or use stored times
      let slotStart = subscription.startTime;
      let slotEnd = subscription.endTime; // This is already the actual end time (full duration)

      if (slot.includes(' - ')) {
        const [start, displayEnd] = slot.split(' - ').map(t => t.trim());
        slotStart = start;
        // Calculate actual end time based on start time + full duration
        // The display end time has 5-min buffer removed, we need full duration for overlap checks
        const startMinutes = parseTimeToMinutes(start);
        const actualEndMinutes = startMinutes + actualDurationMinutes;
        slotEnd = minutesToTimeStr(actualEndMinutes);
      }

      // Check if this specific slot is available
      const availabilityCheck = await BookingModel.checkFullAvailability(
        subscription.fieldId,
        bookingDate,
        slotStart,
        slotEnd,
        undefined, // No booking to exclude
        subscription.id // Exclude this subscription from recurring check
      );

      if (!availabilityCheck.available) {
        console.log(`⚠️ Slot conflict for subscription ${subscriptionId} slot ${slot} on ${bookingDate.toISOString().split('T')[0]}: ${availabilityCheck.reason}`);
        // Skip this slot but continue with others
        continue;
      }

      // Parse time for price calculation
      let startHour = 0, startMin = 0, endHour = 0, endMin = 0;

      try {
        if (slotStart.includes('AM') || slotStart.includes('PM')) {
          const startMatch = slotStart.match(/(\d+):(\d+)(AM|PM)/i);
          if (startMatch) {
            startHour = parseInt(startMatch[1]);
            startMin = parseInt(startMatch[2]);
            const period = startMatch[3].toUpperCase();
            if (period === 'PM' && startHour !== 12) startHour += 12;
            if (period === 'AM' && startHour === 12) startHour = 0;
          }

          const endMatch = slotEnd.match(/(\d+):(\d+)(AM|PM)/i);
          if (endMatch) {
            endHour = parseInt(endMatch[1]);
            endMin = parseInt(endMatch[2]);
            const period = endMatch[3].toUpperCase();
            if (period === 'PM' && endHour !== 12) endHour += 12;
            if (period === 'AM' && endHour === 12) endHour = 0;
          }
        } else {
          const startParts = slotStart.split(':');
          const endParts = slotEnd.split(':');

          startHour = parseInt(startParts[0]) || 0;
          startMin = parseInt(startParts[1]) || 0;
          endHour = parseInt(endParts[0]) || 0;
          endMin = parseInt(endParts[1]) || 0;
        }
      } catch (error) {
        console.error(`Failed to parse time for subscription ${subscriptionId} slot ${slot}:`, error);
        continue; // Skip this slot
      }

      if (isNaN(startHour) || isNaN(startMin) || isNaN(endHour) || isNaN(endMin)) {
        console.error(`Invalid time values for slot ${slot}`);
        continue;
      }

      const durationHours = (endHour * 60 + endMin - startHour * 60 - startMin) / 60;

      let slotPrice = 0;
      if (field.bookingDuration === '30min') {
        const duration30MinBlocks = durationHours * 2;
        slotPrice = pricePerUnit * duration30MinBlocks * subscription.numberOfDogs;
      } else {
        slotPrice = pricePerUnit * durationHours * subscription.numberOfDogs;
      }

      if (isNaN(slotPrice) || slotPrice <= 0) {
        console.error(`Invalid price calculation for slot ${slot}`);
        continue;
      }

      const formattedStartTime = this.formatTimeFromComponents(startHour, startMin);
      const formattedEndTime = this.formatTimeFromComponents(endHour, endMin);

      // Create booking for this slot
      const booking = await prisma.booking.create({
        data: {
          user: {
            connect: { id: subscription.userId }
          },
          field: {
            connect: { id: subscription.fieldId }
          },
          date: bookingDate,
          startTime: formattedStartTime,
          endTime: formattedEndTime,
          timeSlot: slot,
          numberOfDogs: subscription.numberOfDogs,
          totalPrice: slotPrice,
          status: 'CONFIRMED',
          paymentStatus: 'PAID',
          repeatBooking: subscription.interval,
          subscription: {
            connect: { id: subscription.id }
          },
          platformCommission: slotPrice * 0.20,
          fieldOwnerAmount: slotPrice * 0.80
        }
      });

      bookings.push(booking);
    }

    if (bookings.length === 0) {
      // All slots had conflicts - don't throw error, return null to indicate skipped
      console.log(`⚠️ All slots had conflicts for subscription ${subscriptionId} on ${bookingDate.toISOString().split('T')[0]} - skipping this occurrence`);
      return null;
    }

    // Update subscription last booking date
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { lastBookingDate: bookingDate }
    });

    // Return first booking for backward compatibility, but all were created
    return bookings[0];
  }

  /**
   * Refund a single recurring booking occurrence without cancelling the subscription
   */
  async refundSubscriptionBookingOccurrence(bookingId: string, reason: string = 'requested_by_customer') {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        subscription: true,
        field: {
          include: {
            owner: true
          }
        },
        user: true,
        payment: true
      }
    });

    if (!booking || !booking.subscription || !booking.subscription.stripeSubscriptionId) {
      throw new Error('Recurring booking payment information not found');
    }

    let paymentIntentId = booking.paymentIntentId || booking.payment?.stripePaymentId || null;

    if (!paymentIntentId) {
      paymentIntentId = await this.findPaymentIntentForBooking(booking);
    }

    let stripeRefund = null;
    const bookingPrice = booking.totalPrice || booking.subscription.totalPrice || 0;
    const refundAmount = Math.round(bookingPrice * 100);

    if (paymentIntentId && refundAmount > 0) {
      // Note: Stripe only accepts 'duplicate', 'fraudulent', or 'requested_by_customer' as reason
      stripeRefund = await stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount: refundAmount,
        reason: 'requested_by_customer',
        metadata: {
          bookingId: booking.id,
          subscriptionId: booking.subscriptionId || '',
          userId: booking.userId,
          cancellationReason: reason?.substring(0, 500) || 'No reason provided'
        }
      });
    }

    // Upsert payment record if we have a payment intent reference
    if (paymentIntentId) {
      if (booking.payment) {
        await prisma.payment.update({
          where: { id: booking.payment.id },
          data: {
            status: stripeRefund ? 'refunded' : 'completed',
            stripePaymentId: paymentIntentId,
            stripeRefundId: stripeRefund?.id || booking.payment.stripeRefundId,
            refundAmount: stripeRefund ? refundAmount / 100 : booking.payment.refundAmount,
            refundReason: stripeRefund ? reason : booking.payment.refundReason,
            processedAt: new Date()
          }
        });
      } else {
        await prisma.payment.create({
          data: {
            bookingId: booking.id,
            userId: booking.userId,
            amount: booking.totalPrice || booking.subscription.totalPrice,
            currency: 'gbp',
            status: stripeRefund ? 'refunded' : 'completed',
            paymentMethod: 'card',
            stripePaymentId: paymentIntentId,
            stripeRefundId: stripeRefund?.id,
            refundAmount: stripeRefund ? refundAmount / 100 : undefined,
            refundReason: stripeRefund ? reason : undefined,
            processedAt: new Date()
          }
        });
      }
    }

    // Update booking payout/payment state
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        paymentStatus: stripeRefund ? 'REFUNDED' : 'CANCELLED',
        paymentIntentId: paymentIntentId || booking.paymentIntentId,
        payoutStatus: stripeRefund ? 'REFUNDED' : 'CANCELLED',
        cancellationReason: reason,
        cancelledAt: new Date()
      }
    });

    // Ensure related payouts are marked canceled
    await prisma.payout.updateMany({
      where: {
        bookingIds: {
          has: booking.id
        }
      },
      data: {
        status: 'canceled',
        description: `Payout canceled due to refund for recurring booking ${booking.id}`
      }
    });

    // Record refund transaction with lifecycle tracking
    if (stripeRefund) {
      await prisma.transaction.create({
        data: {
          bookingId: booking.id,
          userId: booking.userId,
          amount: -(refundAmount / 100),
          netAmount: booking.fieldOwnerAmount ? -booking.fieldOwnerAmount : undefined,
          platformFee: booking.platformCommission,
          commissionRate:
            booking.platformCommission && booking.totalPrice
              ? (booking.platformCommission / booking.totalPrice) * 100
              : undefined,
          type: 'REFUND',
          status: 'COMPLETED',
          stripeRefundId: stripeRefund.id,
          stripePaymentIntentId: paymentIntentId,
          description: 'Recurring booking refund',
          // Lifecycle tracking
          lifecycleStage: 'REFUNDED',
          refundedAt: new Date()
        }
      });
    }

    return {
      success: true,
      refundAmount: stripeRefund ? refundAmount / 100 : 0,
      stripeRefundId: stripeRefund?.id || null,
      paymentIntentId
    };
  }

  private async findPaymentIntentForBooking(booking: any): Promise<string | null> {
    if (!booking.subscription?.stripeSubscriptionId) {
      return null;
    }

    const invoices = await stripe.invoices.list({
      subscription: booking.subscription.stripeSubscriptionId,
      limit: 50
    });

    if (!invoices?.data?.length) {
      return null;
    }

    const bookingDate = new Date(booking.date);
    bookingDate.setHours(0, 0, 0, 0);

    for (const invoice of invoices.data) {
      const lines = invoice.lines?.data || [];

      const matchingLine = lines.find((line) => {
        if (!line.period?.start) return false;
        const periodDate = new Date(line.period.start * 1000);
        periodDate.setHours(0, 0, 0, 0);
        return Math.abs(periodDate.getTime() - bookingDate.getTime()) <= 24 * 60 * 60 * 1000;
      });

      if (matchingLine && invoice.payment_intent) {
        return typeof invoice.payment_intent === 'string'
          ? invoice.payment_intent
          : invoice.payment_intent?.id || null;
      }
    }

    const fallbackInvoice = invoices.data.find((invoice) => invoice.payment_intent);
    if (!fallbackInvoice) {
      return null;
    }

    return typeof fallbackInvoice.payment_intent === 'string'
      ? fallbackInvoice.payment_intent
      : fallbackInvoice.payment_intent?.id || null;
  }

  /**
   * Handle subscription webhook events from Stripe
   */
  async handleSubscriptionWebhook(event: Stripe.Event) {
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
   * Handle successful invoice payment (create next booking)
   */
  private async handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
    if (!invoice.subscription) return;

    const subscription = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: invoice.subscription as string },
      include: { field: true }
    });

    if (!subscription) return;

    // Reset retry count on successful payment
    if (subscription.paymentRetryCount > 0 || subscription.status === 'past_due') {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: 'active',
          paymentRetryCount: 0,
          nextRetryDate: null,
          failureReason: null,
          lastPaymentAttempt: new Date()
        }
      });
      console.log(`[SubscriptionService] Reset retry count for subscription ${subscription.id} after successful payment`);
    }

    // Get system settings for max advance booking days
    const settings = await prisma.systemSettings.findFirst({
      select: { maxAdvanceBookingDays: true }
    });
    const maxAdvanceBookingDays = settings?.maxAdvanceBookingDays || 30;

    // Calculate next booking date
    let nextBookingDate = new Date();
    if (subscription.interval === 'everyday') {
      // Next day
      nextBookingDate = addDays(subscription.lastBookingDate || new Date(), 1);
    } else if (subscription.interval === 'weekly') {
      // Next week on the same day
      nextBookingDate = addDays(subscription.lastBookingDate || new Date(), 7);
    } else {
      // Next month on the same date
      nextBookingDate = addMonths(subscription.lastBookingDate || new Date(), 1);
    }

    // Validate that next booking date is within advance booking days range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxFutureDate = new Date(today);
    maxFutureDate.setDate(maxFutureDate.getDate() + maxAdvanceBookingDays);

    // Only create booking if it falls within the advance booking range
    if (nextBookingDate > maxFutureDate) {
      console.log(`⏭️  Next booking date (${format(nextBookingDate, 'PPP')}) is beyond max advance booking days (${maxAdvanceBookingDays}) for subscription ${subscription.id}`);

      // Notify user that booking will be created closer to the date
      await createNotification({
        userId: subscription.userId,
        type: 'recurring_booking_pending',
        title: 'Recurring Booking Scheduled',
        message: `Your ${subscription.interval} booking payment was successful. The booking will be automatically created closer to ${format(nextBookingDate, 'PPP')} at ${subscription.timeSlot}`,
        data: {
          subscriptionId: subscription.id,
          nextBookingDate: nextBookingDate.toISOString(),
          fieldName: subscription.field?.name
        }
      });
      return;
    }

    // Create the booking for the next period
    await this.createBookingFromSubscription(subscription.id, nextBookingDate);

    // Send notification to user
    await createNotification({
      userId: subscription.userId,
      type: 'recurring_booking_charged',
      title: 'Recurring Booking Renewed',
      message: `Your ${subscription.interval} booking has been renewed. Next booking: ${format(nextBookingDate, 'PPP')} at ${subscription.timeSlot}`,
      data: {
        subscriptionId: subscription.id,
        nextBookingDate: nextBookingDate.toISOString()
      }
    });
  }

  /**
   * Handle failed invoice payment with retry logic
   * - Retries up to 3 times, once per day
   * - Cancels subscription after 3 failed attempts
   */
  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
    if (!invoice.subscription) return;

    const subscription = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: invoice.subscription as string },
      include: { field: true, user: true }
    });

    if (!subscription) return;

    const MAX_RETRY_ATTEMPTS = 3;
    const currentRetryCount = (subscription.paymentRetryCount || 0) + 1;
    const failureReason = this.extractFailureReason(invoice);

    console.log(`[SubscriptionService] Payment failed for subscription ${subscription.id}. Attempt ${currentRetryCount}/${MAX_RETRY_ATTEMPTS}`);

    // Check if we've exceeded max retries
    if (currentRetryCount >= MAX_RETRY_ATTEMPTS) {
      // Cancel the subscription immediately
      console.log(`[SubscriptionService] Max retries (${MAX_RETRY_ATTEMPTS}) reached. Cancelling subscription ${subscription.id}`);

      await this.cancelSubscriptionDueToPaymentFailure(subscription, failureReason, currentRetryCount);
      return;
    }

    // Schedule next retry for tomorrow (24 hours from now)
    const nextRetryDate = addDays(new Date(), 1);

    // Update subscription with retry info
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'past_due',
        paymentRetryCount: currentRetryCount,
        lastPaymentAttempt: new Date(),
        nextRetryDate: nextRetryDate,
        failureReason: failureReason
      }
    });

    // Send notification to user about failed payment and upcoming retry
    const remainingAttempts = MAX_RETRY_ATTEMPTS - currentRetryCount;
    await createNotification({
      userId: subscription.userId,
      type: 'payment_failed',
      title: 'Payment Failed',
      message: `Your recurring booking payment failed${failureReason ? ` (${failureReason})` : ''}. We will retry in 24 hours. ${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} remaining before your subscription is cancelled.`,
      data: {
        subscriptionId: subscription.id,
        retryCount: currentRetryCount,
        remainingAttempts,
        nextRetryDate: nextRetryDate.toISOString(),
        failureReason
      }
    });

    console.log(`[SubscriptionService] Scheduled retry ${currentRetryCount + 1} for subscription ${subscription.id} at ${nextRetryDate.toISOString()}`);
  }

  /**
   * Extract failure reason from Stripe invoice
   */
  private extractFailureReason(invoice: Stripe.Invoice): string {
    // Check payment intent for error
    const paymentIntent = invoice.payment_intent;
    if (paymentIntent && typeof paymentIntent === 'object') {
      const lastError = paymentIntent.last_payment_error;
      if (lastError) {
        // Common Stripe error codes
        switch (lastError.code) {
          case 'card_declined':
            return 'Card declined';
          case 'insufficient_funds':
            return 'Insufficient funds';
          case 'expired_card':
            return 'Card expired';
          case 'incorrect_cvc':
            return 'Incorrect CVC';
          case 'processing_error':
            return 'Processing error';
          case 'incorrect_number':
            return 'Invalid card number';
          default:
            return lastError.message || lastError.code || 'Payment failed';
        }
      }
    }

    // Check charge for failure
    if (invoice.charge && typeof invoice.charge === 'object') {
      const charge = invoice.charge as Stripe.Charge;
      if (charge.failure_message) {
        return charge.failure_message;
      }
      if (charge.failure_code) {
        return charge.failure_code;
      }
    }

    return 'Payment could not be processed';
  }

  /**
   * Cancel subscription due to payment failure after max retries
   */
  private async cancelSubscriptionDueToPaymentFailure(
    subscription: any,
    failureReason: string,
    totalAttempts: number
  ) {
    const cancellationReason = `Auto-cancelled after ${totalAttempts} failed payment attempts. Last failure: ${failureReason}`;

    // Cancel in Stripe if it's a real Stripe subscription
    if (subscription.stripeSubscriptionId && subscription.stripeSubscriptionId.startsWith('sub_')) {
      try {
        await stripe.subscriptions.cancel(subscription.stripeSubscriptionId, {
          cancellation_details: {
            comment: cancellationReason
          }
        });
      } catch (stripeError: any) {
        console.error('[SubscriptionService] Failed to cancel Stripe subscription:', stripeError);
      }
    }

    // Update subscription in database
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'canceled',
        canceledAt: new Date(),
        cancellationReason: cancellationReason,
        paymentRetryCount: totalAttempts,
        lastPaymentAttempt: new Date(),
        nextRetryDate: null // Clear retry date since cancelled
      }
    });

    // Cancel all future bookings
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await prisma.booking.updateMany({
      where: {
        subscriptionId: subscription.id,
        date: { gte: today },
        status: { notIn: ['CANCELLED', 'COMPLETED'] }
      },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancellationReason: 'Subscription cancelled due to payment failure'
      }
    });

    // Send notification to user
    await createNotification({
      userId: subscription.userId,
      type: 'subscription_cancelled_payment_failure',
      title: 'Subscription Cancelled',
      message: `Your recurring booking for ${subscription.field?.name || 'the field'} has been cancelled after ${totalAttempts} failed payment attempts. Please update your payment method and create a new recurring booking.`,
      data: {
        subscriptionId: subscription.id,
        fieldId: subscription.fieldId,
        fieldName: subscription.field?.name,
        totalAttempts,
        failureReason,
        cancellationReason
      }
    });

    // Notify field owner
    if (subscription.field?.ownerId) {
      await createNotification({
        userId: subscription.field.ownerId,
        type: 'recurring_booking_cancelled',
        title: 'Recurring Booking Cancelled',
        message: `A recurring booking for ${subscription.field?.name || 'your field'} has been cancelled due to payment failure.`,
        data: {
          subscriptionId: subscription.id,
          userId: subscription.userId,
          userName: subscription.user?.name
        }
      });
    }

    console.log(`[SubscriptionService] Subscription ${subscription.id} cancelled due to payment failure. Reason: ${cancellationReason}`);
  }

  /**
   * Retry failed payments for subscriptions that are past_due and due for retry
   * Called by cron job daily
   */
  async retryFailedPayments() {
    const now = new Date();

    // Find subscriptions that need retry
    const subscriptionsToRetry = await prisma.subscription.findMany({
      where: {
        status: 'past_due',
        nextRetryDate: { lte: now },
        paymentRetryCount: { lt: 3 } // Less than max retries
      },
      include: {
        user: true,
        field: true
      }
    });

    console.log(`[SubscriptionService] Found ${subscriptionsToRetry.length} subscriptions to retry payment`);

    for (const subscription of subscriptionsToRetry) {
      try {
        await this.retrySubscriptionPayment(subscription);
      } catch (error) {
        console.error(`[SubscriptionService] Error retrying payment for subscription ${subscription.id}:`, error);
      }
    }
  }

  /**
   * Retry payment for a specific subscription
   */
  private async retrySubscriptionPayment(subscription: any) {
    if (!subscription.stripeSubscriptionId || !subscription.stripeSubscriptionId.startsWith('sub_')) {
      console.log(`[SubscriptionService] Subscription ${subscription.id} is not a Stripe subscription, skipping retry`);
      return;
    }

    console.log(`[SubscriptionService] Attempting to retry payment for subscription ${subscription.id}`);

    try {
      // Get the latest unpaid invoice for this subscription
      const invoices = await stripe.invoices.list({
        subscription: subscription.stripeSubscriptionId,
        status: 'open',
        limit: 1
      });

      if (invoices.data.length === 0) {
        console.log(`[SubscriptionService] No open invoices found for subscription ${subscription.id}`);
        return;
      }

      const invoice = invoices.data[0];

      // Attempt to pay the invoice
      const paidInvoice = await stripe.invoices.pay(invoice.id);

      if (paidInvoice.status === 'paid') {
        // Payment succeeded - reset retry count and update status
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status: 'active',
            paymentRetryCount: 0,
            lastPaymentAttempt: new Date(),
            nextRetryDate: null,
            failureReason: null
          }
        });

        // Send success notification
        await createNotification({
          userId: subscription.userId,
          type: 'payment_retry_success',
          title: 'Payment Successful',
          message: `Your recurring booking payment has been processed successfully. Your subscription is now active.`,
          data: {
            subscriptionId: subscription.id,
            invoiceId: paidInvoice.id
          }
        });

        console.log(`[SubscriptionService] Payment retry successful for subscription ${subscription.id}`);
      }
    } catch (error: any) {
      console.error(`[SubscriptionService] Payment retry failed for subscription ${subscription.id}:`, error.message);
      // The webhook will handle the failure and increment retry count
    }
  }

  /**
   * Handle subscription updates from Stripe
   */
  private async handleSubscriptionUpdated(stripeSubscription: Stripe.Subscription) {
    await prisma.subscription.update({
      where: { stripeSubscriptionId: stripeSubscription.id },
      data: {
        status: stripeSubscription.status,
        currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
        currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
        canceledAt: stripeSubscription.canceled_at ? new Date(stripeSubscription.canceled_at * 1000) : null
      }
    });
  }

  /**
   * Handle subscription deletion
   */
  private async handleSubscriptionDeleted(stripeSubscription: Stripe.Subscription) {
    const subscription = await prisma.subscription.update({
      where: { stripeSubscriptionId: stripeSubscription.id },
      data: {
        status: 'canceled',
        canceledAt: new Date()
      }
    });

    // Send notification to user
    await createNotification({
      userId: subscription.userId,
      type: 'subscription_canceled',
      title: 'Recurring Booking Cancelled',
      message: 'Your recurring booking has been cancelled.',
      data: {
        subscriptionId: subscription.id
      }
    });
  }

  /**
   * Cancel a subscription
   */
  async cancelSubscription(subscriptionId: string, cancelImmediately = false) {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId }
    });

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    // Only call Stripe API if it's an actual Stripe subscription (starts with 'sub_')
    // Fieldsy uses a custom recurring booking system with individual payment intents,
    // not Stripe's subscription product. The stripeSubscriptionId field may contain a payment intent ID.
    if (subscription.stripeSubscriptionId && subscription.stripeSubscriptionId.startsWith('sub_')) {
      try {
        await stripe.subscriptions.update(
          subscription.stripeSubscriptionId,
          {
            cancel_at_period_end: !cancelImmediately
          }
        );

        if (cancelImmediately) {
          await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
        }
      } catch (stripeError: any) {
        console.error('Stripe subscription cancellation error:', stripeError);
        // Continue with local cancellation even if Stripe fails
      }
    } else {
      // This is a payment intent ID or custom recurring booking, handle locally only
      console.log('Custom recurring booking (not Stripe subscription), handling cancellation locally');
    }

    // Update in database
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        cancelAtPeriodEnd: !cancelImmediately,
        status: cancelImmediately ? 'canceled' : subscription.status,
        canceledAt: cancelImmediately ? new Date() : null
      }
    });

    // Cancel all future bookings for this subscription
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const futureBookings = await prisma.booking.findMany({
      where: {
        subscriptionId: subscriptionId,
        date: {
          gte: today
        },
        status: {
          notIn: ['CANCELLED', 'COMPLETED']
        }
      }
    });

    console.log(`📅 Found ${futureBookings.length} future bookings to cancel for subscription ${subscriptionId}`);

    // Cancel each future booking
    for (const booking of futureBookings) {
      try {
        await prisma.booking.update({
          where: { id: booking.id },
          data: {
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancelReason: 'Subscription cancelled by user'
          }
        });
        console.log(`✅ Cancelled future booking ${booking.id} for ${booking.date.toISOString().split('T')[0]}`);
      } catch (error) {
        console.error(`❌ Failed to cancel booking ${booking.id}:`, error);
      }
    }

    // Note: Notification removed to prevent duplicate toast notifications
    // Frontend already shows a toast when subscription is cancelled
    // If you need to add notification back, make sure to suppress toast in NotificationContext

    return subscription;
  }

  /**
   * Get next weekly occurrence of a date
   */
  private getNextWeeklyDate(date: Date): Date {
    return addDays(date, 7);
  }

  /**
   * Get next monthly occurrence of a date
   */
  private getNextMonthlyDate(date: Date): Date {
    return addMonths(date, 1);
  }

  /**
   * Format time for booking (e.g., "08:00" to "8:00AM")
   */
  private formatTimeForBooking(time: string): string {
    const [hours, minutes] = time.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    return `${displayHour}:${minutes.toString().padStart(2, '0')}${period}`;
  }

  /**
   * Format time from hour and minute components (e.g., 16, 30 to "4:30PM")
   */
  private formatTimeFromComponents(hours: number, minutes: number): string {
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    return `${displayHour}:${minutes.toString().padStart(2, '0')}${period}`;
  }
}

export const subscriptionService = new SubscriptionService();
