//@ts-nocheck
import { Request, Response } from 'express';
import { stripe } from '../config/stripe.config';
import prisma from '../config/database';
import Stripe from 'stripe';
import { createNotification } from './notification.controller';
import { NotificationService } from '../services/notification.service';
import { calculatePayoutAmounts } from '../utils/commission.utils';
import { subscriptionService } from '../services/subscription.service';
import { emailService } from '../services/email.service';
import BookingModel from '../models/booking.model';

export class PaymentController {
  // Create a payment intent for booking a field
  async createPaymentIntent(req: Request, res: Response) {
    try {
      const {
        fieldId,
        numberOfDogs,
        date,
        timeSlots, // Array of selected time slots (e.g., ["9:00AM - 10:00AM", "10:00AM - 11:00AM"])
        repeatBooking,
        amount,
        paymentMethodId, // Optional: use saved payment method
        duration // Optional: booking duration ('30min' or '60min')
      } = req.body;

      // Normalize timeSlots - ensure it's always an array
      const normalizedTimeSlots: string[] = Array.isArray(timeSlots) ? timeSlots : (timeSlots ? [timeSlots] : []);

      if (normalizedTimeSlots.length === 0) {
        return res.status(400).json({ error: 'At least one time slot is required' });
      }

      // For display purposes, use first and last slot
      const displayTimeSlot = normalizedTimeSlots.length === 1
        ? normalizedTimeSlots[0]
        : `${normalizedTimeSlots[0]} (+${normalizedTimeSlots.length - 1} more)`;

      // Validate user
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      // Get user for Stripe customer
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          stripeCustomerId: true
        }
      });

      // Check if user is blocked (field might not exist in production yet)
      try {
        const userBlockStatus = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            isBlocked: true,
            blockReason: true
          }
        });

        if (userBlockStatus?.isBlocked) {
          return res.status(403).json({
            error: 'Your account has been blocked',
            reason: userBlockStatus.blockReason || 'Please contact support for more information'
          });
        }
      } catch (error) {
        // isBlocked field doesn't exist in production yet, skip check
        console.warn('Warning: isBlocked field not found in User model.');
      }

      // Create idempotency key to prevent duplicate bookings
      // Use a deterministic key based on the booking parameters (NOT random!)
      // This ensures that retry attempts for the same booking use the same key
      const crypto = require('crypto');
      const timeSlotsKey = normalizedTimeSlots.sort().join('_');
      const repeatBookingKey = repeatBooking || 'none';
      // Create a hash of the booking parameters for idempotency
      const idempotencyBase = `${userId}_${fieldId}_${date}_${timeSlotsKey}_${repeatBookingKey}_${numberOfDogs}`;
      const idempotencyKey = `booking_${crypto.createHash('sha256').update(idempotencyBase).digest('hex').substring(0, 32)}`;

      // Check if bookings already exist for any of the selected time slots
      const existingBookings = await prisma.booking.findMany({
        where: {
          userId,
          fieldId,
          date: new Date(date),
          timeSlot: { in: normalizedTimeSlots },
          status: {
            notIn: ['CANCELLED']
          }
        }
      });

      if (existingBookings.length > 0) {
        const existingSlots = existingBookings.map(b => b.timeSlot);
        console.log('Duplicate booking attempt detected:', {
          userId,
          fieldId,
          date,
          existingSlots,
          existingBookingIds: existingBookings.map(b => b.id),
          existingStatuses: existingBookings.map(b => ({ status: b.status, paymentStatus: b.paymentStatus }))
        });

        // Check if all existing bookings are already paid
        const allPaid = existingBookings.every(b => b.paymentStatus === 'PAID' && b.status === 'CONFIRMED');
        const anyPending = existingBookings.some(b => b.paymentStatus === 'PENDING');

        // Check if booking was created very recently (within last 30 seconds) - likely a duplicate request
        const recentlyCreated = existingBookings.some(b => {
          const createdAt = new Date(b.createdAt);
          const now = new Date();
          return (now.getTime() - createdAt.getTime()) < 30000; // 30 seconds
        });

        if (allPaid && existingBookings.length === normalizedTimeSlots.length) {
          // All slots are already booked and confirmed
          return res.status(200).json({
            paymentSucceeded: true,
            bookingId: existingBookings[0].id,
            bookingIds: existingBookings.map(b => b.id),
            message: 'Booking already exists and is confirmed',
            isDuplicate: true
          });
        } else if (anyPending || recentlyCreated) {
          // Either pending payment or just created - prevent duplicate
          return res.status(200).json({
            paymentSucceeded: false,
            bookingId: existingBookings[0].id,
            bookingIds: existingBookings.map(b => b.id),
            message: 'A booking for one or more slots is already being processed',
            isDuplicate: true,
            isPending: true
          });
        } else {
          // Existing bookings that aren't paid and weren't recently created - still prevent duplicates
          // These are likely failed or incomplete bookings
          console.log('Found existing non-paid bookings, preventing duplicate creation');
          return res.status(400).json({
            error: 'A booking already exists for one or more of these time slots. Please refresh and try again.',
            existingSlots,
            isDuplicate: true
          });
        }
      }

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Validate field exists
      const field = await prisma.field.findUnique({
        where: { id: fieldId }
      });

      if (!field) {
        return res.status(404).json({ error: 'Field not found' });
      }

      // Calculate amount in cents (Stripe uses smallest currency unit)
      const amountInCents = Math.round(amount * 100);

      // Calculate platform commission dynamically using commission utils
      const { fieldOwnerAmount, platformCommission, commissionRate, isCustomCommission, defaultCommissionRate } =
        await calculatePayoutAmounts(amount, field.ownerId || '');

      // Prepare payment intent parameters
      // Payment goes to platform account (admin) first
      const paymentIntentParams: Stripe.PaymentIntentCreateParams = {
        amount: amountInCents,
        currency: 'eur',
        metadata: {
          userId,
          fieldId,
          fieldOwnerId: field.ownerId || '',
          numberOfDogs: numberOfDogs.toString(),
          date,
          timeSlots: JSON.stringify(normalizedTimeSlots), // Store as JSON array
          timeSlotCount: normalizedTimeSlots.length.toString(),
          repeatBooking: repeatBooking || 'none',
          duration: duration || '60min', // Booking duration (30min or 60min)
          type: 'field_booking',
          platformCommission: platformCommission.toString(),
          fieldOwnerAmount: fieldOwnerAmount.toString(),
          commissionRate: commissionRate.toString(),
          isCustomCommission: isCustomCommission.toString(),
          defaultCommissionRate: defaultCommissionRate.toString()
        },
        description: `Booking for ${field.name} on ${date} - ${normalizedTimeSlots.length} slot(s)`,
        receipt_email: (req as any).user?.email,
      };

      // If a payment method is provided, use it
      if (paymentMethodId) {
        // Verify the payment method belongs to this user
        const paymentMethod = await prisma.paymentMethod.findFirst({
          where: {
            id: paymentMethodId,
            userId: userId
          }
        });

        if (!paymentMethod) {
          return res.status(400).json({ error: 'Invalid payment method' });
        }

        // Ensure user has a valid Stripe customer ID
        let customerId = user.stripeCustomerId;

        // Verify customer exists in Stripe
        if (customerId) {
          try {
            const customer = await stripe.customers.retrieve(customerId);
            if ((customer as any).deleted) {
              console.log(`Stripe customer ${customerId} was deleted, creating new one`);
              customerId = null; // Force recreation
            }
          } catch (error: any) {
            if (error.statusCode === 404 || error.code === 'resource_missing') {
              console.log(`Stripe customer ${customerId} not found, creating new one`);
              customerId = null; // Force recreation
            } else {
              throw error; // Re-throw other errors
            }
          }
        }

        // Create customer if doesn't exist or was invalid
        if (!customerId) {
          const customer = await stripe.customers.create({
            email: user.email,
            name: user.name || undefined,
            metadata: {
              userId: user.id
            }
          });
          customerId = customer.id;

          // Save customer ID
          await prisma.user.update({
            where: { id: userId },
            data: { stripeCustomerId: customerId }
          });
        }

        try {
          // Verify the payment method still exists in Stripe
          const stripePaymentMethod = await stripe.paymentMethods.retrieve(
            paymentMethod.stripePaymentMethodId
          );

          // Check if payment method is attached to the customer
          if (stripePaymentMethod.customer !== customerId) {
            // Attach payment method to customer if not already attached
            await stripe.paymentMethods.attach(
              paymentMethod.stripePaymentMethodId,
              { customer: customerId }
            );
          }
        } catch (stripeError: any) {
          console.error('Stripe payment method error:', stripeError);

          // Payment method doesn't exist or is invalid
          if (stripeError.code === 'resource_missing' || stripeError.statusCode === 404) {
            // Remove invalid payment method from database
            await prisma.paymentMethod.delete({
              where: { id: paymentMethodId }
            });

            return res.status(400).json({
              error: 'Payment method no longer valid. Please add a new payment method.',
              code: 'PAYMENT_METHOD_EXPIRED'
            });
          }

          // Other Stripe errors
          return res.status(400).json({
            error: 'Unable to process payment method. Please try again or use a different payment method.',
            code: 'PAYMENT_METHOD_ERROR'
          });
        }

        paymentIntentParams.customer = customerId;
        paymentIntentParams.payment_method = paymentMethod.stripePaymentMethodId;
        paymentIntentParams.confirm = true; // Auto-confirm the payment
        paymentIntentParams.return_url = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/user/my-bookings`; // Add return URL for 3D Secure
        // Use specific payment method configuration
        paymentIntentParams.automatic_payment_methods = {
          enabled: true,
          allow_redirects: 'never' // Never allow redirect-based payment methods
        };
      } else {
        // Use automatic payment methods for new card entry
        paymentIntentParams.automatic_payment_methods = {
          enabled: true,
        };
      }

      // Create payment intent with error handling and idempotency
      let paymentIntent;
      try {
        paymentIntent = await stripe.paymentIntents.create(paymentIntentParams, {
          idempotencyKey: idempotencyKey
        });
      } catch (stripeError: any) {
        console.error('Error creating payment intent:', stripeError);

        // Handle specific Stripe errors
        if (stripeError.type === 'StripeInvalidRequestError') {
          if (stripeError.message.includes('No such PaymentMethod')) {
            return res.status(400).json({
              error: 'Payment method not found. Please select a different payment method.',
              code: 'PAYMENT_METHOD_NOT_FOUND'
            });
          }
          if (stripeError.message.includes('Payment method not available')) {
            return res.status(400).json({
              error: 'This payment method is not available. Please try a different payment method.',
              code: 'PAYMENT_METHOD_UNAVAILABLE'
            });
          }
        }

        // Generic payment error
        return res.status(500).json({
          error: 'Unable to process payment. Please try again.',
          code: 'PAYMENT_PROCESSING_ERROR',
          details: process.env.NODE_ENV === 'development' ? stripeError.message : undefined
        });
      }

      // Parse the first time slot to extract start and end times for subscription
      // Expected format: "4:00PM - 4:55PM" (display time with 5-min buffer)
      const firstTimeSlot = normalizedTimeSlots[0];
      const [startTimeStr, displayEndTimeStr] = firstTimeSlot.split(' - ').map((t: string) => t.trim());

      // Helper function to parse time string to minutes (for subscription end time calculation)
      const parseTimeForSubscription = (timeStr: string): number => {
        const match = timeStr.match(/(\d+):(\d+)(AM|PM)/i);
        if (!match) return 0;
        let hours = parseInt(match[1]);
        const minutes = parseInt(match[2]);
        const period = match[3].toUpperCase();
        if (period === 'PM' && hours !== 12) hours += 12;
        if (period === 'AM' && hours === 12) hours = 0;
        return hours * 60 + minutes;
      };

      // Helper function to convert minutes to time string (for subscription end time calculation)
      const minutesToTimeForSubscription = (totalMinutes: number): string => {
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const period = hours >= 12 ? 'PM' : 'AM';
        const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
        return `${displayHour}:${minutes.toString().padStart(2, '0')}${period}`;
      };

      // Calculate actual end time for subscription (full duration, not display time)
      const subscriptionDurationMinutes = duration === '30min' ? 30 : 60;
      const subscriptionStartMinutes = parseTimeForSubscription(startTimeStr);
      const subscriptionActualEndMinutes = subscriptionStartMinutes + subscriptionDurationMinutes;
      const endTimeStr = minutesToTimeForSubscription(subscriptionActualEndMinutes);

      // Create a booking record with appropriate status
      const bookingStatus = paymentIntent.status === 'succeeded' ? 'CONFIRMED' : 'PENDING';
      const paymentStatus = paymentIntent.status === 'succeeded' ? 'PAID' : 'PENDING';

      // Check if field owner has a connected Stripe account
      const fieldOwnerStripeAccount = await prisma.stripeAccount.findUnique({
        where: { userId: field.ownerId }
      });

      // Get system settings for payout release schedule
      const systemSettings = await prisma.systemSettings.findFirst();
      const payoutReleaseSchedule = systemSettings?.payoutReleaseSchedule || 'after_cancellation_window';

      // Determine payout status based on Stripe account connection and release schedule
      let payoutStatus = 'PENDING';
      let payoutHeldReason = undefined;

      if (paymentIntent.status === 'succeeded') {
        if (!fieldOwnerStripeAccount || !fieldOwnerStripeAccount.chargesEnabled || !fieldOwnerStripeAccount.payoutsEnabled) {
          // Hold the payout if field owner doesn't have a connected Stripe account
          payoutStatus = 'HELD';
          payoutHeldReason = 'NO_STRIPE_ACCOUNT';
        } else if (payoutReleaseSchedule === 'on_weekend') {
          // Check if today is weekend
          const today = new Date().getDay();
          if (today === 5 || today === 6 || today === 0) { // Friday, Saturday, Sunday
            payoutStatus = 'PENDING';
          } else {
            payoutStatus = 'HELD';
            payoutHeldReason = 'WAITING_FOR_WEEKEND';
          }
        } else { // after_cancellation_window
          payoutStatus = 'HELD';
          payoutHeldReason = 'WITHIN_CANCELLATION_WINDOW';
        }
      }

      // Get field owner details for snapshot
      const fieldOwner = await prisma.user.findUnique({
        where: { id: field.ownerId },
        select: { name: true, email: true }
      });

      // If this is a recurring booking, create subscription first
      let subscriptionId = undefined;
      const recurringOptions = ['everyday', 'weekly', 'monthly'];
      const normalizedRepeatBooking = repeatBooking?.toLowerCase();

      console.log('🔍 REPEAT BOOKING CHECK:', {
        repeatBooking,
        normalizedRepeatBooking,
        isIncluded: recurringOptions.includes(normalizedRepeatBooking),
        recurringOptions
      });

      if (repeatBooking && recurringOptions.includes(normalizedRepeatBooking)) {
        console.log('✅ Creating subscription for recurring booking...');
        try {
          // Create subscription record in database
          const bookingDate = new Date(date);

          // Check for conflicts with existing bookings on future recurring dates
          const conflictCheck = await BookingModel.checkRecurringSubscriptionConflicts(
            fieldId,
            bookingDate,
            startTimeStr,
            endTimeStr,
            normalizedRepeatBooking as 'everyday' | 'weekly' | 'monthly'
          );

          if (conflictCheck.hasConflict) {
            const conflictDates = conflictCheck.conflictingDates
              .slice(0, 3) // Show first 3 conflicts
              .map(c => {
                const dateStr = c.date.toLocaleDateString('en-GB', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short'
                });
                return dateStr;
              })
              .join(', ');

            const moreCount = conflictCheck.conflictingDates.length > 3
              ? ` and ${conflictCheck.conflictingDates.length - 3} more`
              : '';

            return res.status(400).json({
              error: `Cannot create ${normalizedRepeatBooking} recurring booking. There are existing bookings on: ${conflictDates}${moreCount}. Please choose a different time slot or cancel the conflicting bookings first.`,
              conflictingDates: conflictCheck.conflictingDates.map(c => ({
                date: c.date.toISOString(),
                bookedBy: c.existingBooking.user?.name || 'Another user'
              }))
            });
          }
          const dayOfWeek = bookingDate.toLocaleDateString('en-US', { weekday: 'long' });
          const dayOfMonth = bookingDate.getDate();

          // Calculate next billing date
          let nextBillingDate: Date;
          let currentPeriodEnd: Date;

          if (normalizedRepeatBooking === 'everyday') {
            // Next billing is 1 day after the booking date
            nextBillingDate = new Date(bookingDate);
            nextBillingDate.setDate(bookingDate.getDate() + 1);

            currentPeriodEnd = new Date(bookingDate);
            currentPeriodEnd.setDate(bookingDate.getDate() + 1);
          } else if (normalizedRepeatBooking === 'weekly') {
            // Next billing is 7 days after the booking date
            nextBillingDate = new Date(bookingDate);
            nextBillingDate.setDate(bookingDate.getDate() + 7);

            currentPeriodEnd = new Date(bookingDate);
            currentPeriodEnd.setDate(bookingDate.getDate() + 7);
          } else {
            // Monthly - next billing is same date next month
            nextBillingDate = new Date(bookingDate);
            nextBillingDate.setMonth(bookingDate.getMonth() + 1);

            // Handle edge case: if current day is 31 and next month has fewer days
            // JavaScript automatically adjusts (e.g., Jan 31 + 1 month = Mar 3 if Feb has 28 days)
            // To fix this, we ensure it stays on the last day of the month
            if (nextBillingDate.getDate() !== dayOfMonth) {
              nextBillingDate.setDate(0); // Go to last day of previous month
            }

            currentPeriodEnd = new Date(nextBillingDate);
          }

          console.log('Recurring booking calculation:', {
            bookingDate: bookingDate.toISOString(),
            interval: repeatBooking,
            normalizedInterval: normalizedRepeatBooking,
            nextBillingDate: nextBillingDate.toISOString(),
            currentPeriodEnd: currentPeriodEnd.toISOString(),
            dayOfWeek: normalizedRepeatBooking === 'weekly' ? dayOfWeek : null,
            dayOfMonth: normalizedRepeatBooking === 'monthly' ? dayOfMonth : null
          });

          const subscription = await prisma.subscription.create({
            data: {
              userId,
              fieldId,
              stripeSubscriptionId: paymentIntent.id, // Use payment intent ID as reference
              stripeCustomerId: user.stripeCustomerId || '',
              status: 'active',
              interval: normalizedRepeatBooking,
              intervalCount: 1,
              currentPeriodStart: bookingDate,
              currentPeriodEnd: currentPeriodEnd,
              timeSlot: displayTimeSlot, // For display: first slot or "X:XX (+N more)"
              timeSlots: normalizedTimeSlots, // Store all time slots as array
              dayOfWeek: normalizedRepeatBooking === 'weekly' ? dayOfWeek : null,
              dayOfMonth: normalizedRepeatBooking === 'monthly' ? dayOfMonth : null,
              startTime: startTimeStr,
              endTime: endTimeStr,
              numberOfDogs: parseInt(numberOfDogs),
              totalPrice: amount,
              nextBillingDate: nextBillingDate,
              lastBookingDate: bookingDate
            }
          });

          subscriptionId = subscription.id;
          console.log('✅ Created subscription for recurring booking:', {
            subscriptionId,
            userId,
            fieldId,
            status: subscription.status,
            interval: subscription.interval,
            timeSlot: subscription.timeSlot,
            timeSlots: subscription.timeSlots
          });
        } catch (subscriptionError) {
          console.error('Error creating subscription:', subscriptionError);
          // Continue with booking creation even if subscription fails
        }
      }

      // Create a booking for each selected time slot
      // Calculate per-slot amounts
      const pricePerSlot = amount / normalizedTimeSlots.length;
      const platformCommissionPerSlot = platformCommission / normalizedTimeSlots.length;
      const fieldOwnerAmountPerSlot = fieldOwnerAmount / normalizedTimeSlots.length;

      // Helper function to parse time string to minutes
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

      // Helper function to convert minutes back to time string
      const minutesToTimeStr = (totalMinutes: number): string => {
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const period = hours >= 12 ? 'PM' : 'AM';
        const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
        return `${displayHour}:${minutes.toString().padStart(2, '0')}${period}`;
      };

      // Determine actual slot duration in minutes (30 or 60)
      const actualDurationMinutes = duration === '30min' ? 30 : 60;

      const bookings = await Promise.all(
        normalizedTimeSlots.map(async (slot: string) => {
          const [slotStart, displaySlotEnd] = slot.split(' - ').map((t: string) => t.trim());

          // Calculate the ACTUAL end time based on start time + full duration
          // The display end time has 5-min buffer removed, we need the full duration for availability checks
          const startMinutes = parseTimeToMinutes(slotStart);
          const actualEndMinutes = startMinutes + actualDurationMinutes;
          const actualSlotEnd = minutesToTimeStr(actualEndMinutes);

          return prisma.booking.create({
            data: {
              fieldId,
              userId,
              date: new Date(date),
              startTime: slotStart,
              endTime: actualSlotEnd, // Use actual end time (full duration) for proper overlap detection
              timeSlot: slot, // Keep display slot for UI
              numberOfDogs: parseInt(numberOfDogs),
              totalPrice: pricePerSlot,
              platformCommission: platformCommissionPerSlot,
              fieldOwnerAmount: fieldOwnerAmountPerSlot,
              status: bookingStatus,
              paymentStatus: paymentStatus,
              paymentIntentId: paymentIntent.id,
              payoutStatus,
              payoutHeldReason,
              repeatBooking: normalizedRepeatBooking || repeatBooking || 'none',
              subscriptionId: subscriptionId, // Link to subscription if created
              bookingDuration: duration || '60min' // Booking duration (30min or 60min)
            }
          });
        })
      );

      // Use first booking as primary for backward compatibility
      const booking = bookings[0];
      const allBookingIds = bookings.map(b => b.id);

      // If payment was auto-confirmed with saved card, create notifications
      if (paymentIntent.status === 'succeeded') {
        // Create payment record
        await prisma.payment.create({
          data: {
            bookingId: booking.id,
            userId,
            amount,
            currency: 'EUR',
            status: 'completed',
            paymentMethod: 'card',
            stripePaymentId: paymentIntent.id,
            processedAt: new Date()
          }
        });

        // Create transaction record for admin tracking (immediately when payment succeeds)
        // Check if transaction doesn't already exist for this payment intent
        const existingTransaction = await prisma.transaction.findFirst({
          where: { stripePaymentIntentId: paymentIntent.id }
        });

        if (!existingTransaction) {
          // Get field owner's connected Stripe account ID
          const fieldOwnerStripeAccount = await prisma.stripeAccount.findFirst({
            where: { userId: field.ownerId }
          });

          await prisma.transaction.create({
            data: {
              bookingId: booking.id,
              userId,
              fieldOwnerId: field.ownerId || null,
              amount: amount,
              netAmount: fieldOwnerAmount,
              platformFee: platformCommission,
              commissionRate: commissionRate,
              isCustomCommission: isCustomCommission,
              defaultCommissionRate: defaultCommissionRate,
              type: 'PAYMENT',
              status: 'COMPLETED',
              stripePaymentIntentId: paymentIntent.id,
              connectedAccountId: fieldOwnerStripeAccount?.stripeAccountId || null,
              // Lifecycle tracking
              lifecycleStage: 'PAYMENT_RECEIVED',
              paymentReceivedAt: new Date(),
              description: `Payment for booking at ${field.name}`
            }
          });
          console.log('[PaymentController] Created transaction record for immediate payment:', paymentIntent.id);
        }

        // Send notifications
        const slotsDisplay = normalizedTimeSlots.length === 1
          ? normalizedTimeSlots[0]
          : `${normalizedTimeSlots.length} time slots`;

        await createNotification({
          userId,
          type: 'BOOKING_CONFIRMATION',
          title: 'Booking Confirmed',
          message: `Your booking for ${field.name} on ${date} (${slotsDisplay}) has been confirmed.`,
          data: { bookingId: booking.id, bookingIds: allBookingIds, fieldId }
        });

        if (field.ownerId && field.ownerId !== userId) {
          await createNotification({
            userId: field.ownerId,
            type: 'NEW_BOOKING',
            title: 'New Booking',
            message: `You have a new booking for ${field.name} on ${date} (${slotsDisplay}).`,
            data: { bookingId: booking.id, bookingIds: allBookingIds, fieldId }
          });
        }

        // Send email notifications
        try {
          // Get field owner details for email
          const fieldOwner = await prisma.user.findUnique({
            where: { id: field.ownerId },
            select: { name: true, email: true }
          });

          // Send booking confirmation email to dog owner
          if (user.email) {
            await emailService.sendBookingConfirmationToDogOwner({
              email: user.email,
              userName: user.name || 'Valued Customer',
              bookingId: booking.id,
              fieldName: field.name,
              fieldAddress: field.address || '',
              date: new Date(date),
              startTime: startTimeStr,
              endTime: endTimeStr,
              totalPrice: amount,
              fieldOwnerName: fieldOwner?.name || 'Field Owner'
            });
          }

          // Send new booking notification email to field owner
          if (fieldOwner?.email) {
            await emailService.sendNewBookingNotificationToFieldOwner({
              email: fieldOwner.email,
              ownerName: fieldOwner.name || 'Field Owner',
              bookingId: booking.id,
              fieldName: field.name,
              date: new Date(date),
              startTime: startTimeStr,
              endTime: endTimeStr,
              totalPrice: amount,
              fieldOwnerAmount,
              platformCommission,
              dogOwnerName: user.name || user.email || 'Customer'
            });
          }
        } catch (emailError) {
          console.error('Error sending booking emails:', emailError);
          // Don't fail the booking if email fails
        }
      }

      res.json({
        clientSecret: paymentIntent.client_secret,
        bookingId: booking.id,
        bookingIds: allBookingIds, // All booking IDs for multi-slot bookings
        slotsCount: normalizedTimeSlots.length,
        paymentSucceeded: paymentIntent.status === 'succeeded',
        publishableKey: `pk_test_${process.env.STRIPE_SECRET_KEY?.slice(8, 40)}` // Send publishable key
      });
    } catch (error) {
      console.error('Error creating payment intent:', error);
      res.status(500).json({
        error: 'Failed to create payment intent',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Confirm payment and update booking status
  async confirmPayment(req: Request, res: Response) {
    try {
      const { paymentIntentId, bookingId } = req.body;

      // Retrieve the payment intent from Stripe
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

      if (paymentIntent.status === 'succeeded') {
        // Update booking status
        const booking = await prisma.booking.update({
          where: { id: bookingId },
          data: {
            status: 'CONFIRMED',
            paymentStatus: 'PAID'
          },
          include: {
            field: true,
            user: true
          }
        });

        // Get field owner details first
        const field = await prisma.field.findUnique({
          where: { id: booking.fieldId },
          include: {
            owner: true
          }
        });

        // Calculate commission amounts
        const { fieldOwnerAmount, platformFeeAmount, commissionRate, isCustomCommission, defaultCommissionRate } = await calculatePayoutAmounts(
          booking.totalPrice,
          field?.ownerId || ''
        );

        // Create transaction record with commission details and lifecycle tracking
        await prisma.transaction.create({
          data: {
            bookingId: booking.id,
            userId: booking.userId,
            fieldOwnerId: field?.ownerId || null,
            amount: booking.totalPrice,
            netAmount: fieldOwnerAmount,
            platformFee: platformFeeAmount,
            commissionRate: commissionRate,
            isCustomCommission: isCustomCommission,
            defaultCommissionRate: defaultCommissionRate,
            type: 'PAYMENT',
            status: 'COMPLETED',
            stripePaymentIntentId: paymentIntentId,
            // Lifecycle tracking
            lifecycleStage: 'PAYMENT_RECEIVED',
            paymentReceivedAt: new Date(),
            description: `Payment for booking at ${field?.name || 'field'}`
          }
        });

        // Send notification to field owner about new booking (also notifies admins)
        if (field?.ownerId && field.ownerId !== booking.userId) {
          const bookingDateLabel = new Date(booking.date).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
          });
          const bookingTimeLabel = `${booking.startTime} - ${booking.endTime}`;
          const customerName = booking.user.name || booking.user.email || 'A dog owner';
          const amountDisplay = typeof booking.totalPrice === 'number'
            ? booking.totalPrice.toFixed(2)
            : booking.totalPrice;

          await NotificationService.createNotification({
            userId: field.ownerId,
            type: 'booking_received',
            title: 'New Booking Received!',
            message: `You have a new booking for ${field.name} on ${new Date(booking.date).toLocaleDateString()} at ${booking.startTime}`,
            adminTitle: 'New booking scheduled',
            adminMessage: `${customerName} booked "${field.name}" for ${bookingDateLabel} at ${bookingTimeLabel}. Total £${amountDisplay}.`,
            data: {
              bookingId: booking.id,
              fieldId: booking.fieldId,
              fieldName: field.name,
              date: booking.date,
              time: `${booking.startTime} - ${booking.endTime}`,
              customerName: booking.user.name || booking.user.email,
              numberOfDogs: booking.numberOfDogs,
              amount: booking.totalPrice
            }
          }, true); // true = also notify admins
        }

        // Send confirmation notification to dog owner
        await createNotification({
          userId: booking.userId,
          type: 'booking_confirmed',
          title: 'Booking Confirmed!',
          message: `Your booking for ${field?.name || 'the field'} on ${new Date(booking.date).toLocaleDateString()} at ${booking.startTime} has been confirmed.`,
          data: {
            bookingId: booking.id,
            fieldId: booking.fieldId,
            fieldName: field?.name,
            date: booking.date,
            time: `${booking.startTime} - ${booking.endTime}`,
            amount: booking.totalPrice,
            paymentIntentId
          }
        });

        // Send confirmation email (implement email service)
        // await emailService.sendBookingConfirmation(booking);

        res.json({
          success: true,
          booking,
          message: 'Payment confirmed successfully'
        });
      } else {
        res.status(400).json({
          error: 'Payment not successful',
          status: paymentIntent.status
        });
      }
    } catch (error) {
      console.error('Error confirming payment:', error);
      res.status(500).json({
        error: 'Failed to confirm payment',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Handle Stripe webhooks
  async handleWebhook(req: Request, res: Response) {
    const sig = req.headers['stripe-signature'] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const connectWebhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;

    if (!webhookSecret && !connectWebhookSecret) {
      console.error('Stripe webhook secret not configured');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    let event: Stripe.Event;

    // Try to verify with the main webhook secret first, then try connect webhook secret
    // This handles both direct account events and connected account events
    try {
      // First, try the main webhook secret
      if (webhookSecret) {
        try {
          event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            webhookSecret
          );
        } catch (err) {
          // If main secret fails and we have a connect secret, try that
          if (connectWebhookSecret) {
            event = stripe.webhooks.constructEvent(
              req.body,
              sig,
              connectWebhookSecret
            );
          } else {
            throw err;
          }
        }
      } else if (connectWebhookSecret) {
        event = stripe.webhooks.constructEvent(
          req.body,
          sig,
          connectWebhookSecret
        );
      } else {
        throw new Error('No webhook secret configured');
      }
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return res.status(400).send(`Webhook Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // Log connected account events for debugging
    const connectedAccountId = (event as any).account;
    if (connectedAccountId) {
      console.log(`[Webhook] Received event ${event.type} from connected account: ${connectedAccountId}`);
    }

    // Handle the event
    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          const paymentIntent = event.data.object as Stripe.PaymentIntent;

          // Use transaction to prevent duplicate booking updates
          await prisma.$transaction(async (tx) => {
            // Check if booking exists
            const booking = await tx.booking.findFirst({
              where: { paymentIntentId: paymentIntent.id }
            });

            if (!booking) {
              // If no booking exists with this payment intent ID, check metadata
              // This handles edge cases where webhook arrives before booking creation
              const metadata = paymentIntent.metadata;
              if (metadata.userId && metadata.fieldId && metadata.date && metadata.timeSlot) {
                // Check if a booking already exists for this exact combination
                const existingBooking = await tx.booking.findFirst({
                  where: {
                    userId: metadata.userId,
                    fieldId: metadata.fieldId,
                    date: new Date(metadata.date),
                    timeSlot: metadata.timeSlot,
                    status: {
                      notIn: ['CANCELLED']
                    }
                  }
                });

                if (existingBooking) {
                  console.log('Webhook: Duplicate booking prevented for payment intent:', paymentIntent.id);
                  // Update existing booking's payment intent if needed
                  if (!existingBooking.paymentIntentId) {
                    await tx.booking.update({
                      where: { id: existingBooking.id },
                      data: {
                        paymentIntentId: paymentIntent.id,
                        status: 'CONFIRMED',
                        paymentStatus: 'PAID'
                      }
                    });
                  }
                  return; // Exit early to prevent duplicate
                }

                // Create new booking from webhook if it doesn't exist
                const [startTimeStr, endTimeStr] = metadata.timeSlot.split(' - ').map((t: string) => t.trim());
                const platformCommission = parseFloat(metadata.platformCommission || '0');
                const fieldOwnerAmount = parseFloat(metadata.fieldOwnerAmount || '0');

                const newBooking = await tx.booking.create({
                  data: {
                    fieldId: metadata.fieldId,
                    userId: metadata.userId,
                    date: new Date(metadata.date),
                    startTime: startTimeStr,
                    endTime: endTimeStr,
                    timeSlot: metadata.timeSlot,
                    numberOfDogs: parseInt(metadata.numberOfDogs || '1'),
                    totalPrice: paymentIntent.amount / 100, // Convert from cents
                    platformCommission,
                    fieldOwnerAmount,
                    status: 'CONFIRMED',
                    paymentStatus: 'PAID',
                    paymentIntentId: paymentIntent.id,
                    payoutStatus: 'PENDING',
                    repeatBooking: metadata.repeatBooking || 'none'
                  }
                });

                // Get field owner for commission calculation
                const field = await tx.field.findUnique({
                  where: { id: metadata.fieldId },
                  select: { ownerId: true }
                });

                // Calculate commission amounts
                const payoutAmounts = await calculatePayoutAmounts(
                  paymentIntent.amount / 100,
                  field?.ownerId || ''
                );

                // Create transaction record with commission details and lifecycle tracking
                await tx.transaction.create({
                  data: {
                    bookingId: newBooking.id,
                    userId: metadata.userId,
                    fieldOwnerId: field?.ownerId || null,
                    amount: paymentIntent.amount / 100,
                    netAmount: payoutAmounts.fieldOwnerAmount,
                    platformFee: payoutAmounts.platformFeeAmount,
                    commissionRate: payoutAmounts.commissionRate,
                    type: 'PAYMENT',
                    status: 'COMPLETED',
                    stripePaymentIntentId: paymentIntent.id,
                    // Lifecycle tracking
                    lifecycleStage: 'PAYMENT_RECEIVED',
                    paymentReceivedAt: new Date(),
                    description: `Payment for booking (webhook)`
                  }
                });

                console.log('Webhook: Created new booking from payment intent:', newBooking.id);
              }
            } else if (booking.status !== 'CONFIRMED' || booking.paymentStatus !== 'PAID') {
              // Update existing booking status
              await tx.booking.update({
                where: { id: booking.id },
                data: {
                  status: 'CONFIRMED',
                  paymentStatus: 'PAID'
                }
              });

              // Check if transaction already exists
              const existingTransaction = await tx.transaction.findFirst({
                where: {
                  stripePaymentIntentId: paymentIntent.id
                }
              });

              if (!existingTransaction) {
                // Get field for commission calculation
                const field = await tx.field.findUnique({
                  where: { id: booking.fieldId },
                  select: { ownerId: true }
                });

                // Calculate commission amounts
                const payoutAmounts = await calculatePayoutAmounts(
                  booking.totalPrice,
                  field?.ownerId || ''
                );

                // Create transaction record with commission details and lifecycle tracking
                await tx.transaction.create({
                  data: {
                    bookingId: booking.id,
                    userId: booking.userId,
                    fieldOwnerId: field?.ownerId || null,
                    amount: booking.totalPrice,
                    netAmount: payoutAmounts.fieldOwnerAmount,
                    platformFee: payoutAmounts.platformFeeAmount,
                    commissionRate: payoutAmounts.commissionRate,
                    type: 'PAYMENT',
                    status: 'COMPLETED',
                    stripePaymentIntentId: paymentIntent.id,
                    // Lifecycle tracking
                    lifecycleStage: 'PAYMENT_RECEIVED',
                    paymentReceivedAt: new Date(),
                    description: `Payment for booking (webhook)`
                  }
                });
              }
            }
          });
          break;

        case 'payment_intent.payment_failed':
          const failedPayment = event.data.object as Stripe.PaymentIntent;

          // Update booking status to failed
          const failedBooking = await prisma.booking.findFirst({
            where: { paymentIntentId: failedPayment.id }
          });

          if (failedBooking) {
            await prisma.booking.update({
              where: { id: failedBooking.id },
              data: {
                status: 'CANCELLED',
                paymentStatus: 'FAILED'
              }
            });
          }
          break;

        case 'payout.created':
        case 'payout.updated':
        case 'payout.paid':
        case 'payout.failed':
        case 'payout.canceled':
          await syncStripePayoutEvent(event);
          break;

        case 'balance.available':
          // Log available balance updates
          // This event is triggered when your balance becomes available for payout
          console.log('Balance available event received:', event.id);
          break;

        case 'charge.refunded':
          const refundedCharge = event.data.object as Stripe.Charge;
          console.log('Charge refunded:', refundedCharge.id);

          // Find booking associated with this charge
          if (refundedCharge.payment_intent) {
            const refundedBooking = await prisma.booking.findFirst({
              where: { paymentIntentId: refundedCharge.payment_intent as string }
            });

            if (refundedBooking) {
              await prisma.booking.update({
                where: { id: refundedBooking.id },
                data: {
                  status: 'CANCELLED',
                  paymentStatus: 'REFUNDED'
                }
              });
              console.log(`Booking ${refundedBooking.id} marked as refunded`);
            }
          }
          break;

        case 'charge.succeeded':
          // This is usually redundant if we handle payment_intent.succeeded
          // But can be useful for logging or specific charge-level logic
          const succeededCharge = event.data.object as Stripe.Charge;
          console.log('Charge succeeded:', succeededCharge.id);
          break;

        case 'payment_intent.created':
          const createdIntent = event.data.object as Stripe.PaymentIntent;
          console.log('Payment intent created:', createdIntent.id);
          // We generally don't need to do anything here as the booking is created 
          // via API before the intent is confirmed, or via webhook on success
          break;

        case 'transfer.created':
        case 'transfer.paid':
        case 'transfer.failed':
        case 'transfer.reversed':
          await syncStripeTransferEvent(event);
          break;

        case 'refund.created':
        case 'refund.updated':
        case 'refund.failed':
          await syncStripeRefundEvent(event);
          break;

        default:
          console.log(`Unhandled event type ${event.type}`);
      }

      res.json({ received: true });
    } catch (error) {
      console.error('Error processing webhook:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }

  // Get payment methods for user
  async getPaymentMethods(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;

      // For now, return mock data
      // In production, integrate with Stripe Customer API
      res.json({
        paymentMethods: []
      });
    } catch (error) {
      console.error('Error fetching payment methods:', error);
      res.status(500).json({ error: 'Failed to fetch payment methods' });
    }
  }
}

function extractBookingIdsFromMetadata(metadata?: Stripe.Metadata | null): string[] {
  if (!metadata) return [];

  if (metadata.bookingId) {
    return [metadata.bookingId];
  }

  if (metadata.bookingIds) {
    try {
      const parsed = JSON.parse(metadata.bookingIds);
      if (Array.isArray(parsed)) {
        return parsed.filter(Boolean);
      }
    } catch (error) {
      // bookingIds might be a comma separated list
      return metadata.bookingIds.split(',').map(id => id.trim()).filter(Boolean);
    }
  }

  return [];
}

async function syncStripePayoutEvent(event: Stripe.Event) {
  const payoutObject = event.data.object as Stripe.Payout;
  const connectedAccountId = (event as any).account;

  console.log(`[StripeWebhook] Processing ${event.type} event:`, {
    eventId: event.id,
    payoutId: payoutObject?.id,
    payoutStatus: payoutObject?.status,
    amount: payoutObject?.amount,
    connectedAccountId,
    metadata: payoutObject?.metadata
  });

  if (!payoutObject) {
    console.warn('[StripeWebhook] Payout event missing payout object');
    return;
  }

  // For automatic payouts without connected account ID, try to find the account by payout ID
  if (!connectedAccountId) {
    console.log('[StripeWebhook] No connected account ID in event, attempting to find account from payout metadata or existing record');

    // Check if we have an existing payout record
    const existingPayout = await prisma.payout.findFirst({
      where: { stripePayoutId: payoutObject.id },
      include: { stripeAccount: true }
    });

    if (existingPayout) {
      console.log(`[StripeWebhook] Found existing payout record, updating status to: ${payoutObject.status}`);
      await prisma.payout.update({
        where: { id: existingPayout.id },
        data: {
          status: payoutObject.status,
          arrivalDate: payoutObject.arrival_date ? new Date(payoutObject.arrival_date * 1000) : null,
          failureCode: payoutObject.failure_code || null,
          failureMessage: payoutObject.failure_message || null
        }
      });
      return;
    }

    console.warn('[StripeWebhook] Cannot process payout without connected account ID and no existing record found');
    return;
  }

  console.log(`[StripeWebhook] Processing payout event for account: ${connectedAccountId}`);

  let stripeAccount = await prisma.stripeAccount.findFirst({
    where: { stripeAccountId: connectedAccountId }
  });

  if (!stripeAccount) {
    console.warn(`[StripeWebhook] Account ${connectedAccountId} not found in DB. Attempting self-healing...`);

    try {
      // Fetch account from Stripe to check metadata
      const account = await stripe.accounts.retrieve(connectedAccountId);
      const userId = account.metadata?.userId;

      if (userId) {
        // Verify user exists
        const user = await prisma.user.findUnique({ where: { id: userId } });

        if (user) {
          console.log(`[StripeWebhook] Found user ${userId} for orphaned account ${connectedAccountId}. Re-linking...`);

          // Create missing StripeAccount record
          stripeAccount = await prisma.stripeAccount.create({
            data: {
              userId,
              stripeAccountId: connectedAccountId,
              accountType: account.type || 'express',
              chargesEnabled: account.charges_enabled,
              payoutsEnabled: account.payouts_enabled,
              detailsSubmitted: account.details_submitted,
              defaultCurrency: account.default_currency || 'gbp',
              country: account.country || 'GB',
              email: account.email || user.email
            }
          });

          console.log(`[StripeWebhook] Successfully re-linked account ${connectedAccountId} to user ${userId}`);
        } else {
          console.error(`[StripeWebhook] User ${userId} from Stripe metadata not found in DB.`);
        }
      } else {
        console.warn(`[StripeWebhook] No userId in metadata for account ${connectedAccountId}. Cannot self-heal.`);
      }
    } catch (error) {
      console.error(`[StripeWebhook] Failed to fetch account ${connectedAccountId} from Stripe:`, error);
    }
  }

  if (!stripeAccount) {
    console.warn(`[StripeWebhook] Received payout event for unknown account: ${connectedAccountId}. Available accounts count: ${await prisma.stripeAccount.count()}`);
    return;
  }

  console.log(`[StripeWebhook] Found matching internal account: ${stripeAccount.id} for Stripe account: ${connectedAccountId}`);

  const bookingIds = extractBookingIdsFromMetadata(payoutObject.metadata);
  const payoutData = {
    amount: (payoutObject.amount || 0) / 100,
    currency: payoutObject.currency || 'gbp',
    status: payoutObject.status,
    method: payoutObject.method || 'standard',
    description: payoutObject.description || null,
    arrivalDate: payoutObject.arrival_date ? new Date(payoutObject.arrival_date * 1000) : null,
    failureCode: payoutObject.failure_code || null,
    failureMessage: payoutObject.failure_message || null
  };

  const existingPayout = payoutObject.id
    ? await prisma.payout.findUnique({
      where: { stripePayoutId: payoutObject.id }
    })
    : null;

  if (existingPayout) {
    await prisma.payout.update({
      where: { id: existingPayout.id },
      data: {
        ...payoutData,
        ...(bookingIds.length && !existingPayout.bookingIds.length ? { bookingIds } : {})
      }
    });
  } else {
    await prisma.payout.create({
      data: {
        stripeAccountId: stripeAccount.id,
        stripePayoutId: payoutObject.id,
        bookingIds,
        ...payoutData
      }
    });
  }

  if (bookingIds.length) {
    let payoutStatus: 'COMPLETED' | 'PROCESSING' | 'FAILED' = 'PROCESSING';
    if (payoutObject.status === 'paid') {
      payoutStatus = 'COMPLETED';
    } else if (payoutObject.status === 'failed' || payoutObject.status === 'canceled') {
      payoutStatus = 'FAILED';
    }

    await prisma.booking.updateMany({
      where: { id: { in: bookingIds } },
      data: {
        payoutStatus,
        ...(payoutStatus === 'COMPLETED' ? { payoutReleasedAt: new Date() } : {})
      }
    });

    // Update Transaction lifecycle when payout completes
    if (payoutStatus === 'COMPLETED' && bookingIds.length > 0) {
      await prisma.transaction.updateMany({
        where: { bookingId: { in: bookingIds } },
        data: {
          lifecycleStage: 'PAYOUT_COMPLETED',
          stripePayoutId: payoutObject.id,
          payoutCompletedAt: new Date()
        }
      });
      console.log(`[StripeWebhook] Updated transaction lifecycle to PAYOUT_COMPLETED for bookings: ${bookingIds.join(', ')}`);
    } else if (payoutStatus === 'PROCESSING' && bookingIds.length > 0) {
      await prisma.transaction.updateMany({
        where: { bookingId: { in: bookingIds } },
        data: {
          lifecycleStage: 'PAYOUT_INITIATED',
          stripePayoutId: payoutObject.id,
          payoutInitiatedAt: new Date()
        }
      });
    }
  }
}

/**
 * Sync Stripe transfer events to update booking and transaction records
 */
async function syncStripeTransferEvent(event: Stripe.Event) {
  const transfer = event.data.object as Stripe.Transfer;

  console.log(`[StripeWebhook] Processing ${event.type} event:`, {
    eventId: event.id,
    transferId: transfer.id,
    amount: transfer.amount,
    destination: transfer.destination,
    metadata: transfer.metadata
  });

  const bookingIds = extractBookingIdsFromMetadata(transfer.metadata);

  if (bookingIds.length === 0) {
    console.log('[StripeWebhook] No booking IDs found in transfer metadata');
    return;
  }

  // Update bookings based on transfer status
  if (event.type === 'transfer.created') {
    // Transfer created - funds are being moved to connected account
    console.log(`[StripeWebhook] Transfer created for bookings: ${bookingIds.join(', ')}`);

    // Update transaction lifecycle
    await prisma.transaction.updateMany({
      where: { bookingId: { in: bookingIds } },
      data: {
        lifecycleStage: 'TRANSFERRED',
        stripeTransferId: transfer.id,
        transferredAt: new Date(),
        connectedAccountId: typeof transfer.destination === 'string' ? transfer.destination : transfer.destination?.id
      }
    });
  } else if (event.type === 'transfer.paid') {
    // Transfer completed successfully
    console.log(`[StripeWebhook] Transfer paid for bookings: ${bookingIds.join(', ')}`);

    // Mark transfer as complete in booking (if not already processing payout)
    await prisma.booking.updateMany({
      where: {
        id: { in: bookingIds },
        payoutStatus: { in: ['PENDING', 'HELD', null] }
      },
      data: {
        payoutStatus: 'PROCESSING'
      }
    });
  } else if (event.type === 'transfer.failed' || event.type === 'transfer.reversed') {
    // Transfer failed or was reversed
    console.log(`[StripeWebhook] Transfer ${event.type} for bookings: ${bookingIds.join(', ')}`);

    await prisma.booking.updateMany({
      where: { id: { in: bookingIds } },
      data: {
        payoutStatus: 'FAILED'
      }
    });

    // Update transaction with failure info
    await prisma.transaction.updateMany({
      where: { bookingId: { in: bookingIds } },
      data: {
        lifecycleStage: 'TRANSFER_FAILED',
        failureCode: event.type === 'transfer.reversed' ? 'REVERSED' : 'FAILED',
        failureMessage: event.type === 'transfer.reversed' ? 'Transfer was reversed' : 'Transfer failed'
      }
    });

    // Notify admins about failed transfer
    const adminUsers = await prisma.user.findMany({
      where: { role: 'ADMIN' }
    });

    for (const admin of adminUsers) {
      await prisma.notification.create({
        data: {
          userId: admin.id,
          type: 'PAYOUT_FAILED',
          title: `Transfer ${event.type === 'transfer.reversed' ? 'Reversed' : 'Failed'}`,
          message: `Transfer ${transfer.id} ${event.type === 'transfer.reversed' ? 'was reversed' : 'failed'} for bookings: ${bookingIds.join(', ')}`,
          data: {
            transferId: transfer.id,
            bookingIds,
            eventType: event.type
          }
        }
      });
    }
  }
}

/**
 * Sync Stripe refund events to update booking and transaction records
 */

async function syncStripeRefundEvent(event: Stripe.Event) {
  const refund = event.data.object as Stripe.Refund;
  
  console.log(`[StripeWebhook] Processing ${event.type} event:`, {
    eventId: event.id,
    refundId: refund.id,
    amount: refund.amount,
    status: refund.status,
    paymentIntent: refund.payment_intent,
    metadata: refund.metadata
  });

  // Find booking by payment intent
  const paymentIntentId = typeof refund.payment_intent === 'string'
    ? refund.payment_intent
    : refund.payment_intent?.id;

  if (!paymentIntentId) {
    console.log('[StripeWebhook] No payment intent found in refund');
    return;
  }

  const booking = await prisma.booking.findFirst({
    where: { paymentIntentId },
    include: {
      field: { select: { ownerId: true, name: true } },
      user: { select: { name: true, email: true } }
    }
  });

  if (!booking) {
    console.log(`[StripeWebhook] No booking found for payment intent: ${paymentIntentId}`);
    return;
  }

  const refundAmount = refund.amount / 100;

  if (event.type === 'refund.created' || event.type === 'refund.updated') {
    // Update transaction record
    const existingTransaction = await prisma.transaction.findFirst({
      where: { bookingId: booking.id, type: 'REFUND' }
    });

    if (existingTransaction) {
      // Update existing refund transaction
      await prisma.transaction.update({
        where: { id: existingTransaction.id },
        data: {
          status: refund.status === 'succeeded' ? 'COMPLETED' : refund.status === 'failed' ? 'FAILED' : 'PROCESSING',
          stripeRefundId: refund.id,
          refundedAt: refund.status === 'succeeded' ? new Date() : null,
          failureCode: refund.failure_reason || null,
          failureMessage: refund.failure_reason || null
        }
      });
    } else {
      // Create new refund transaction record
      await prisma.transaction.create({
        data: {
          bookingId: booking.id,
          userId: booking.userId,
          fieldOwnerId: booking.field.ownerId,
          amount: refundAmount,
          netAmount: refundAmount,
          type: 'REFUND',
          status: refund.status === 'succeeded' ? 'COMPLETED' : refund.status === 'failed' ? 'FAILED' : 'PROCESSING',
          lifecycleStage: 'REFUNDED',
          stripePaymentIntentId: paymentIntentId,
          stripeRefundId: refund.id,
          refundedAt: refund.status === 'succeeded' ? new Date() : null,
          description: `Refund for booking ${booking.id}`
        }
      });
    }

    // Also update the original payment transaction
    await prisma.transaction.updateMany({
      where: { bookingId: booking.id, type: 'PAYMENT' },
      data: {
        lifecycleStage: 'REFUNDED',
        stripeRefundId: refund.id,
        refundedAt: refund.status === 'succeeded' ? new Date() : null
      }
    });

    // Update booking status
    if (refund.status === 'succeeded') {
      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          status: 'CANCELLED',
          paymentStatus: 'REFUNDED',
          payoutStatus: 'REFUNDED'
        }
      });
      console.log(`[StripeWebhook] Booking ${booking.id} marked as refunded`);
    }
  } else if (event.type === 'refund.failed') {
    // Update transaction with failure
    await prisma.transaction.updateMany({
      where: { bookingId: booking.id, type: 'REFUND' },
      data: {
        status: 'FAILED',
        failureCode: refund.failure_reason || 'UNKNOWN',
        failureMessage: refund.failure_reason || 'Refund failed'
      }
    });

    // Notify admins about failed refund
    const adminUsers = await prisma.user.findMany({
      where: { role: 'ADMIN' }
    });

    for (const admin of adminUsers) {
      await prisma.notification.create({
        data: {
          userId: admin.id,
          type: 'REFUND_FAILED',
          title: 'Refund Failed',
          message: `Refund of £${refundAmount.toFixed(2)} failed for booking ${booking.id}. Reason: ${refund.failure_reason || 'Unknown'}`,
          data: {
            bookingId: booking.id,
            refundId: refund.id,
            amount: refundAmount,
            failureReason: refund.failure_reason
          }
        }
      });
    }
  }
}
