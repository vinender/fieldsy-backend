//@ts-nocheck
import { Request, Response, NextFunction } from 'express';
import BookingModel from '../models/booking.model';
import FieldModel from '../models/field.model';
import UserModel from '../models/user.model';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import prisma from '../config/database';
import { createNotification } from './notification.controller';
import { payoutService } from '../services/payout.service';
import refundService from '../services/refund.service';
import { emailService } from '../services/email.service';
import { transformAmenities } from '../utils/amenityHelper';
import { resolveField } from '../utils/field.utils';

class BookingController {
  // Create a new booking
  createBooking = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const dogOwnerId = (req as any).user.id;
    const { fieldId, date, startTime, endTime, notes, numberOfDogs = 1 } = req.body;

    // Resolve fieldId if it's external (e.g. F1111)
    const resolvedFieldId = await FieldModel.resolveId(fieldId);

    // Check if user is blocked (field might not exist in production yet)
    try {
      const user = await prisma.user.findUnique({
        where: { id: dogOwnerId },
        select: { isBlocked: true, blockReason: true }
      });

      if (user?.isBlocked) {
        throw new AppError(
          `Your account has been blocked. ${user.blockReason || 'Please contact support for more information'}`,
          403
        );
      }
    } catch (error) {
      // isBlocked field doesn't exist in production yet, skip check
      console.warn('Warning: isBlocked field not found in User model.');
    }

    // Verify field exists and is active
    const field = await FieldModel.findById(fieldId);
    if (!field) {
      throw new AppError('Field not found', 404);
    }

    if (!field.isActive) {
      throw new AppError('Field is not available for booking', 400);
    }

    // Check if field is claimed - unclaimed fields cannot be booked
    if (field.isClaimed === false) {
      throw new AppError('This field has not been claimed by an owner yet and is not available for booking', 400);
    }

    // Check if the time slot is in the past
    const bookingDate = new Date(date);
    const [startHourStr, startPeriod] = startTime.split(/(?=[AP]M)/);
    let startHour = parseInt(startHourStr.split(':')[0]);
    if (startPeriod === 'PM' && startHour !== 12) startHour += 12;
    if (startPeriod === 'AM' && startHour === 12) startHour = 0;

    const slotDateTime = new Date(bookingDate);
    slotDateTime.setHours(startHour, parseInt(startHourStr.split(':')[1] || '0'), 0, 0);

    if (slotDateTime < new Date()) {
      throw new AppError('Cannot book a time slot in the past', 400);
    }

    // Check if slot is already booked (private booking system)
    const startOfDayDate = new Date(bookingDate);
    startOfDayDate.setHours(0, 0, 0, 0);

    const endOfDayDate = new Date(bookingDate);
    endOfDayDate.setHours(23, 59, 59, 999);

    const existingBooking = await prisma.booking.findFirst({
      where: {
        fieldId: resolvedFieldId,
        date: {
          gte: startOfDayDate,
          lte: endOfDayDate
        },
        startTime,
        status: {
          notIn: ['CANCELLED']
        }
      }
    });

    if (existingBooking) {
      throw new AppError(
        'This time slot is already booked. Once booked, a slot becomes private for that dog owner.',
        400
      );
    }

    // Check full availability (including recurring booking reservations)
    const availabilityCheck = await BookingModel.checkFullAvailability(
      resolvedFieldId,
      new Date(date),
      startTime,
      endTime
    );

    if (!availabilityCheck.available) {
      throw new AppError(availabilityCheck.reason || 'This time slot is not available', 400);
    }

    // Calculate total price based on duration and number of dogs
    // Use price30min for 30-minute slots, price1hr for hourly slots
    // Fall back to field.price for backwards compatibility
    const startMinutes = this.timeToMinutes(startTime);
    const endMinutes = this.timeToMinutes(endTime);
    const durationHours = (endMinutes - startMinutes) / 60;

    let totalPrice = 0;
    if (field.bookingDuration === '30min') {
      // For 30-minute slots, use price30min (price per 30 minutes per dog)
      const pricePerSlot = field.price30min || field.price || 0;
      const duration30MinBlocks = durationHours * 2; // Convert hours to 30-min blocks
      totalPrice = pricePerSlot * duration30MinBlocks * numberOfDogs;
    } else {
      // For hourly slots, use price1hr (price per hour per dog)
      const pricePerHour = field.price1hr || field.price || 0;
      totalPrice = pricePerHour * durationHours * numberOfDogs;
    }

    // Log for debugging
    const priceUsed = field.bookingDuration === '30min'
      ? (field.price30min || field.price || 0)
      : (field.price1hr || field.price || 0);
    console.log('Create booking price calculation:', {
      fieldId: field.id,
      priceUsed,
      price30min: field.price30min,
      price1hr: field.price1hr,
      durationHours,
      numberOfDogs,
      bookingDuration: field.bookingDuration,
      totalPrice
    });

    // Calculate commission amounts using dynamic commission rate
    const { calculatePayoutAmounts } = await import('../utils/commission.utils');
    const { fieldOwnerAmount, platformCommission } = await calculatePayoutAmounts(
      totalPrice,
      field.ownerId || ''
    );

    // Create booking
    const booking = await BookingModel.create({
      dogOwnerId,
      fieldId: resolvedFieldId,
      date: new Date(date),
      startTime,
      endTime,
      timeSlot: `${startTime} - ${endTime}`, // Set timeSlot to match startTime and endTime
      totalPrice,
      fieldOwnerAmount,
      platformCommission,
      numberOfDogs, // Store for pricing and info, but slot is now private
      notes,
    });

    // Send notification to field owner (if not booking their own field)
    console.log('=== Booking Notification Debug ===');
    console.log('Field owner ID:', field.ownerId);
    console.log('Dog owner ID:', dogOwnerId);
    console.log('Are they the same?', field.ownerId === dogOwnerId);

    if (field.ownerId && field.ownerId !== dogOwnerId) {
      console.log('Sending notification to field owner...');
      try {
        await createNotification({
          userId: field.ownerId,
          type: 'new_booking_received',
          title: 'New Booking Received!',
          message: `You have a new booking request for ${field.name} on ${new Date(date).toLocaleDateString()} from ${startTime} to ${endTime}. Please review and confirm.`,
          data: {
            bookingId: booking.id,
            fieldId: resolvedFieldId,
            fieldName: field.name,
            date,
            startTime,
            endTime,
            dogOwnerName: (req as any).user.name,
          },
        });
        console.log('Field owner notification sent successfully');
      } catch (error) {
        console.error('Failed to send field owner notification:', error);
      }
    } else {
      console.log('Skipping field owner notification - booking own field');
    }

    // Send confirmation notification to dog owner
    console.log('Sending confirmation notification to dog owner...');
    try {
      await createNotification({
        userId: dogOwnerId,
        type: 'booking_request_sent',
        title: 'Booking Request Sent',
        message: `Your booking request for ${field.name} on ${new Date(date).toLocaleDateString()} has been sent to the field owner. You'll be notified once it's confirmed.`,
        data: {
          bookingId: booking.id,
          fieldId: field.id,
          fieldName: field.name,
          date,
          startTime,
          endTime,
          totalPrice,
        },
      });
      console.log('Dog owner confirmation notification sent successfully');
    } catch (error) {
      console.error('Failed to send dog owner notification:', error);
    }

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      data: BookingModel.sanitize(booking),
    });
  });

  // Get all bookings (admin only)
  getAllBookings = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const {
      dogOwnerId,
      fieldId,
      status,
      date,
      startDate,
      endDate,
      page = 1,
      limit = 10,
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    // Resolve IDs if they are human-readable
    const resolvedDogOwnerId = dogOwnerId ? await UserModel.resolveId(dogOwnerId as string) : undefined;
    const resolvedFieldId = fieldId ? await FieldModel.resolveId(fieldId as string) : undefined;

    const bookings = await BookingModel.findAll({
      dogOwnerId: resolvedDogOwnerId,
      fieldId: resolvedFieldId,
      status: status as any,
      date: date ? new Date(date as string) : undefined,
      startDate: startDate ? new Date(startDate as string) : undefined,
      endDate: endDate ? new Date(endDate as string) : undefined,
      skip,
      take: Number(limit),
    });

    res.json({
      success: true,
      data: bookings,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: bookings.length,
      },
    });
  });

  // Get booking by ID (optimized for modal display)
  getBooking = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;

    // Get system settings for cancellation window
    const systemSettings = await prisma.systemSettings.findFirst();
    const cancellationWindowHours = systemSettings?.cancellationWindowHours || 24;

    const isObjectId = id.length === 24 && /^[0-9a-fA-F]+$/.test(id);

    // Define select fields for the query
    const selectFields = {
      id: true,
      userId: true,
      fieldId: true,
      date: true,
      startTime: true,
      endTime: true,
      timeSlot: true,
      numberOfDogs: true,
      totalPrice: true,
      status: true,
      paymentStatus: true,
      repeatBooking: true,
      rescheduleCount: true,
      subscriptionId: true,
      bookingId: true,
      createdAt: true,
      updatedAt: true,
      fieldReview: {
        select: {
          id: true,
          rating: true,
          createdAt: true,
        },
      },
      field: {
        select: {
          id: true,
          name: true,
          address: true,
          city: true,
          state: true,
          zipCode: true,
          price: true,
          bookingDuration: true,
          size: true,
          customFieldSize: true,
          terrainType: true,
          fenceType: true,
          fenceSize: true,
          surfaceType: true,
          images: true,
          averageRating: true,
          totalReviews: true,
          amenities: true,
          owner: {
            select: {
              id: true,
              name: true,
              email: true,
              emailVerified: true,
              createdAt: true
            }
          }
        }
      },
      user: {
        select: {
          id: true,
          name: true,
          email: true
        }
      },
      subscription: {
        select: {
          id: true,
          status: true,
          interval: true,
          cancelAtPeriodEnd: true,
        }
      }
    };

    // Use findUnique for ObjectId, findFirst for human-readable bookingId
    const booking = isObjectId
      ? await prisma.booking.findUnique({ where: { id }, select: selectFields })
      : await prisma.booking.findFirst({ where: { bookingId: id }, select: selectFields });

    if (!booking) {
      throw new AppError('Booking not found', 404);
    }

    // Check access rights
    const hasAccess =
      userRole === 'ADMIN' ||
      booking.userId === userId ||
      booking.field?.owner?.id === userId;

    if (!hasAccess) {
      throw new AppError('You do not have access to this booking', 403);
    }

    // Transform amenities to include icon URLs from database
    const transformedAmenities = booking.field?.amenities && booking.field.amenities.length > 0
      ? await transformAmenities(booking.field.amenities)
      : [];

    // Calculate booking eligibility for cancellation/reschedule
    const now = new Date();
    const bookingDateTime = new Date(booking.date);

    // Parse the start time properly (handles formats like "9:00AM", "9:00 AM", "09:00")
    const startTime = booking.startTime || '00:00';
    const timeMatch = startTime.match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)?$/i);
    if (timeMatch) {
      let hour = parseInt(timeMatch[1]);
      const minutes = parseInt(timeMatch[2] || '0');
      const period = timeMatch[3]?.toUpperCase();

      if (period === 'PM' && hour !== 12) hour += 12;
      if (period === 'AM' && hour === 12) hour = 0;

      bookingDateTime.setHours(hour, minutes, 0, 0);
    }

    const hoursUntilBooking = Math.max(0, (bookingDateTime.getTime() - now.getTime()) / (1000 * 60 * 60));
    const isUpcoming = booking.status === 'CONFIRMED' && bookingDateTime > now;
    const rescheduleCount = booking.rescheduleCount || 0;

    // Check if any booking in the subscription has been completed (for recurring bookings)
    let hasCompletedBookingInSubscription = false;
    if (booking.subscriptionId) {
      const completedCount = await prisma.booking.count({
        where: {
          subscriptionId: booking.subscriptionId,
          status: 'COMPLETED'
        }
      });
      hasCompletedBookingInSubscription = completedCount > 0;
    }

    // Calculate eligibility flags
    const isReschedulable = isUpcoming &&
      hoursUntilBooking >= cancellationWindowHours &&
      rescheduleCount < 3 &&
      !hasCompletedBookingInSubscription;

    const isCancellable = isUpcoming && hoursUntilBooking >= cancellationWindowHours;

    // For subscription immediate cancellation - use same logic as booking cancellation
    const canCancelSubscriptionImmediately = booking.subscription &&
      booking.subscription.status === 'active' &&
      !booking.subscription.cancelAtPeriodEnd &&
      isUpcoming &&
      isCancellable;

    // Return optimized booking data
    const optimizedBooking = {
      id: booking.id,
      userId: booking.userId,
      fieldId: booking.fieldId,
      date: booking.date,
      startTime: booking.startTime,
      endTime: booking.endTime,
      timeSlot: booking.timeSlot,
      numberOfDogs: booking.numberOfDogs,
      totalPrice: booking.totalPrice,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      repeatBooking: booking.repeatBooking,
      rescheduleCount: booking.rescheduleCount,
      subscriptionId: booking.subscriptionId,
      bookingId: booking.bookingId,
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt,
      // Eligibility flags for cancellation/reschedule
      isCancellable,
      isReschedulable,
      hoursUntilBooking: Math.floor(hoursUntilBooking),
      hasCompletedBookingInSubscription,
      cancellationWindow: cancellationWindowHours,
      canCancelSubscriptionImmediately: !!canCancelSubscriptionImmediately,
      // Review data - to check if booking has been reviewed
      hasReview: !!booking.fieldReview,
      fieldReview: booking.fieldReview ? {
        id: booking.fieldReview.id,
        rating: booking.fieldReview.rating,
        createdAt: booking.fieldReview.createdAt,
      } : null,
      field: {
        id: booking.field?.id,
        name: booking.field?.name,
        address: booking.field?.address,
        city: booking.field?.city,
        state: booking.field?.state,
        zipCode: booking.field?.zipCode,
        postalCode: booking.field?.zipCode,
        price: booking.field?.price,
        bookingDuration: booking.field?.bookingDuration,
        size: booking.field?.size,
        customFieldSize: booking.field?.customFieldSize,
        terrainType: booking.field?.terrainType,
        fenceType: booking.field?.fenceType,
        fenceSize: booking.field?.fenceSize,
        surfaceType: booking.field?.surfaceType,
        images: booking.field?.images || [],
        averageRating: booking.field?.averageRating || 0,
        totalReviews: booking.field?.totalReviews || 0,
        amenities: transformedAmenities,
        owner: booking.field?.owner ? {
          id: booking.field.owner.id,
          name: booking.field.owner.name,
          email: booking.field.owner.email,
          emailVerified: booking.field.owner.emailVerified,
          createdAt: booking.field.owner.createdAt
        } : null
      },
      user: booking.user ? {
        id: booking.user.id,
        name: booking.user.name,
        email: booking.user.email
      } : null
    };

    res.json({
      success: true,
      data: optimizedBooking,
    });
  });

  // Get user's bookings with pagination
  getMyBookings = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;
    const { status, page = 1, limit = 10, includeExpired, includeFuture, dateRange, startDate, endDate } = req.query;

    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;

    // Get system settings for cancellation window
    const systemSettings = await prisma.systemSettings.findFirst();
    const cancellationWindowHours = systemSettings?.cancellationWindowHours || 24;

    let whereClause: any = {};

    if (userRole === 'DOG_OWNER') {
      whereClause.userId = userId;
    } else if (userRole === 'FIELD_OWNER') {
      // For field owner, we need to get their field first
      const fields = await prisma.field.findMany({
        where: { ownerId: userId },
        select: { id: true },
      });

      if (fields.length === 0) {
        return res.json({
          success: true,
          data: [],
          pagination: {
            page: pageNum,
            limit: limitNum,
            total: 0,
            totalPages: 0,
            hasNextPage: false,
            hasPrevPage: false,
          },
        });
      }

      whereClause.fieldId = { in: fields.map(f => f.id) };
    } else {
      throw new AppError('Invalid user role', 400);
    }

    // Handle date range filtering
    if (startDate && endDate) {
      // Custom date range - include bookings on start and end dates
      const rangeStart = new Date(startDate as string);
      rangeStart.setHours(0, 0, 0, 0); // Start of day

      const rangeEnd = new Date(endDate as string);
      rangeEnd.setHours(23, 59, 59, 999); // End of day

      whereClause.date = {
        gte: rangeStart,
        lte: rangeEnd,
      };
    } else if (dateRange) {
      // Predefined date ranges
      const now = new Date();
      let rangeStart: Date;
      let rangeEnd: Date = now;

      switch (dateRange) {
        case 'thisWeek':
          // Start of current week (Sunday) at 00:00:00
          rangeStart = new Date(now);
          rangeStart.setDate(now.getDate() - now.getDay());
          rangeStart.setHours(0, 0, 0, 0);
          // End of current week (Saturday) at 23:59:59
          rangeEnd = new Date(rangeStart);
          rangeEnd.setDate(rangeStart.getDate() + 6);
          rangeEnd.setHours(23, 59, 59, 999);
          break;

        case 'thisMonth':
          // Start of current month at 00:00:00
          rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
          rangeStart.setHours(0, 0, 0, 0);
          // End of current month at 23:59:59
          rangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
          rangeEnd.setHours(23, 59, 59, 999);
          break;

        case 'thisYear':
          // Start of current year at 00:00:00
          rangeStart = new Date(now.getFullYear(), 0, 1);
          rangeStart.setHours(0, 0, 0, 0);
          // End of current year at 23:59:59
          rangeEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
          break;

        default:
          rangeStart = new Date(0); // Beginning of time
      }

      if (rangeStart!) {
        whereClause.date = {
          gte: rangeStart,
          lte: rangeEnd,
        };
      }
    }

    // Handle multiple statuses and date filtering
    if (status) {
      const statuses = (status as string).split(',');
      const now = new Date();
      now.setHours(0, 0, 0, 0); // Set to start of day for consistent date comparisons
      const hasCustomDateFilter = !!(startDate && endDate) || !!dateRange;

      // If multiple statuses, use OR condition
      if (statuses.length > 1) {
        const statusConditions: any[] = [];

        for (const s of statuses) {
          const statusCondition: any = { status: s };

          // Apply date filtering based on includeFuture and includeExpired flags
          // This applies to ALL statuses to ensure proper filtering
          if (!hasCustomDateFilter) {
            if (includeFuture === 'true') {
              // Upcoming tab: show only bookings with future dates
              statusCondition.date = { gte: now };
            } else if (includeExpired === 'true') {
              // Previous tab: show bookings with past dates OR same-day bookings that are COMPLETED
              // Don't filter by date for COMPLETED status - they will be filtered by end time in post-processing
              // Don't filter by date for CANCELLED status - cancelled bookings should show regardless of date
              if (s !== 'COMPLETED' && s !== 'CANCELLED') {
                statusCondition.date = { lt: now };
              }
            }
          }

          statusConditions.push(statusCondition);
        }

        whereClause.OR = statusConditions;
      } else {
        // Single status
        const statusCondition: any = { status: status as string };

        // Apply date filtering for single status too
        if (!hasCustomDateFilter) {
          if (includeFuture === 'true') {
            statusCondition.date = { gte: now };
          } else if (includeExpired === 'true') {
            // Previous tab: show bookings with past dates OR same-day bookings that are COMPLETED
            // Don't filter by date for COMPLETED status - they will be filtered by end time in post-processing
            // Don't filter by date for CANCELLED status - cancelled bookings should show regardless of date
            if (status !== 'COMPLETED' && status !== 'CANCELLED') {
              statusCondition.date = { lt: now };
            }
          }
        }

        whereClause = { ...whereClause, ...statusCondition };
      }
    }

    // Get bookings with pagination
    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where: whereClause,
        skip,
        take: limitNum,
        include: {
          field: {
            include: {
              owner: true,
            },
          },
          user: {
            select: {
              id: true,
              userId: true,
              name: true,
              email: true,
            },
          },
          fieldReview: {
            select: {
              id: true,
              rating: true,
              createdAt: true,
            },
          },
          subscription: {
            select: {
              id: true,
              status: true,
              interval: true,
              dayOfWeek: true,
              dayOfMonth: true,
              lastBookingDate: true,
              nextBillingDate: true,
              currentPeriodEnd: true,
              cancelAtPeriodEnd: true,
              canceledAt: true,
              totalPrice: true,
              stripeSubscriptionId: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),
      prisma.booking.count({
        where: whereClause
      }),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    // Transform bookings to remove redundant data and optimize response
    // Use Promise.all to handle async amenity transformation
    // Helper function to calculate hours until booking and return booking datetime
    const getBookingTimeInfo = (bookingDate: Date, startTime: string): { hoursUntilBooking: number; bookingDateTime: Date } => {
      const now = new Date();
      const bookingDateTime = new Date(bookingDate);

      // Parse the start time and add it to the booking date
      if (startTime) {
        const timeMatch = startTime.match(/^(\d{1,2}):?(\d{2})?\s*(AM|PM)?$/i);
        if (timeMatch) {
          let hour = parseInt(timeMatch[1]);
          const minutes = parseInt(timeMatch[2] || '0');
          const period = timeMatch[3]?.toUpperCase();

          if (period === 'PM' && hour !== 12) hour += 12;
          if (period === 'AM' && hour === 12) hour = 0;

          bookingDateTime.setHours(hour, minutes, 0, 0);
        }
      }

      const hoursUntilBooking = (bookingDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);
      return { hoursUntilBooking, bookingDateTime };
    };

    const optimizedBookings = await Promise.all(
      bookings.map(async (booking) => {
        const field = booking.field;
        const owner = field?.owner;
        const user = booking.user;

        // Fetch and transform amenities from database
        const transformedAmenities = field?.amenities && field.amenities.length > 0
          ? await transformAmenities(field.amenities)
          : [];

        // Calculate cancellation/reschedule eligibility
        const { hoursUntilBooking, bookingDateTime } = getBookingTimeInfo(booking.date, booking.startTime);
        // Match getBooking logic: isUpcoming requires status CONFIRMED AND booking time in the future
        const now = new Date();
        const isUpcoming = booking.status === 'CONFIRMED' && bookingDateTime > now;
        const isCancellable = isUpcoming && hoursUntilBooking >= cancellationWindowHours;
        const rescheduleCount = booking.rescheduleCount || 0;

        // For recurring bookings, check if any booking in the subscription has been completed
        // If so, disable reschedule for all bookings in the subscription
        let hasCompletedBookingInSubscription = false;
        if (booking.subscription && booking.subscriptionId) {
          // Query the database for completed bookings in this subscription
          // (not just the current page of bookings, which may not include all completed ones)
          const completedCount = await prisma.booking.count({
            where: {
              subscriptionId: booking.subscriptionId,
              status: 'COMPLETED'
            }
          });
          hasCompletedBookingInSubscription = completedCount > 0;
        }

        // isReschedulable logic:
        // - Regular bookings: can reschedule if upcoming, outside cancellation window, and under 3 reschedules
        // - Recurring bookings: same as above BUT also must not have any completed bookings in subscription
        const isReschedulable = isUpcoming &&
          hoursUntilBooking >= cancellationWindowHours &&
          rescheduleCount < 3 &&
          !hasCompletedBookingInSubscription;

        // For subscription immediate cancellation - use same logic as booking cancellation
        const canCancelSubscriptionImmediately = booking.subscription &&
          booking.subscription.status === 'active' &&
          !booking.subscription.cancelAtPeriodEnd &&
          isUpcoming &&
          isCancellable;

        return {
          id: booking.bookingId || booking.id,
          userId: user?.userId || booking.userId,
          fieldId: field?.fieldId || booking.fieldId,
          date: booking.date,
          startTime: booking.startTime,
          endTime: booking.endTime,
          timeSlot: booking.timeSlot,
          numberOfDogs: booking.numberOfDogs,
          totalPrice: booking.totalPrice,
          status: booking.status,
          paymentStatus: booking.paymentStatus,
          repeatBooking: booking.repeatBooking,
          rescheduleCount: booking.rescheduleCount,
          bookingId: booking.bookingId,
          createdAt: booking.createdAt,
          updatedAt: booking.updatedAt,
          // Calculated fields for frontend/mobile apps
          isCancellable,
          isReschedulable,
          hasCompletedBookingInSubscription, // True if any booking in subscription is completed (disables reschedule)
          hoursUntilBooking: Math.floor(hoursUntilBooking),
          cancellationWindow: cancellationWindowHours,
          canCancelSubscriptionImmediately: !!canCancelSubscriptionImmediately,
          // Review data - to check if booking has been reviewed
          hasReview: !!booking.fieldReview,
          fieldReview: booking.fieldReview ? {
            id: booking.fieldReview.id,
            rating: booking.fieldReview.rating,
            createdAt: booking.fieldReview.createdAt,
          } : null,
          // Field data - only what's needed for display
          field: {
            id: field?.fieldId || field?.id,
            name: field?.name,
            address: field?.address,
            city: field?.city,
            state: field?.state,
            zipCode: field?.zipCode,
            postalCode: field?.zipCode, // Alias for frontend compatibility
            price: field?.price,
            bookingDuration: field?.bookingDuration,
            size: field?.size,
            customFieldSize: field?.customFieldSize,
            terrainType: field?.terrainType,
            fenceType: field?.fenceType,
            fenceSize: field?.fenceSize,
            surfaceType: field?.surfaceType,
            images: field?.images || [],
            averageRating: field?.averageRating || 0,
            totalReviews: field?.totalReviews || 0,
            // Amenities with labels and icon URLs from database
            amenities: transformedAmenities,
            // Owner information
            owner: owner ? {
              id: owner.userId || owner.id,
              name: owner.name,
              email: owner.email,
              emailVerified: owner.emailVerified,
              createdAt: owner.createdAt
            } : null
          },
          // User information (for field owners viewing bookings)
          user: user ? {
            id: user.id,
            name: user.name,
            email: user.email
          } : null,
          // Subscription data for recurring bookings
          subscription: booking.subscription ? (() => {
            const sub = booking.subscription;
            const now = new Date();

            // Helper function to calculate next date based on interval
            const calculateNextDate = (baseDate: Date, interval: string): Date => {
              const result = new Date(baseDate);
              while (result < now) {
                if (interval === 'everyday') {
                  result.setDate(result.getDate() + 1);
                } else if (interval === 'weekly') {
                  result.setDate(result.getDate() + 7);
                } else if (interval === 'monthly') {
                  result.setMonth(result.getMonth() + 1);
                } else {
                  // Default to adding 1 day if interval is unknown
                  result.setDate(result.getDate() + 1);
                }
              }
              return result;
            };

            // Calculate the correct next billing date based on the CURRENT BOOKING's date
            // This should show the next billing date AFTER the booking being displayed
            let calculatedNextBillingDate: Date | null = null;

            // Use the current booking's date as the base for calculating next billing
            // This ensures the "Next billing" shows the date AFTER this booking
            const currentBookingDate = booking.date ? new Date(booking.date) : null;

            if (currentBookingDate) {
              // Calculate next booking date from the CURRENT booking's date
              if (sub.interval === 'everyday') {
                calculatedNextBillingDate = new Date(currentBookingDate);
                calculatedNextBillingDate.setDate(calculatedNextBillingDate.getDate() + 1);
              } else if (sub.interval === 'weekly') {
                calculatedNextBillingDate = new Date(currentBookingDate);
                calculatedNextBillingDate.setDate(calculatedNextBillingDate.getDate() + 7);
              } else if (sub.interval === 'monthly') {
                calculatedNextBillingDate = new Date(currentBookingDate);
                calculatedNextBillingDate.setMonth(calculatedNextBillingDate.getMonth() + 1);
              }
            } else if (sub.lastBookingDate) {
              // Fallback to lastBookingDate if current booking date not available
              const lastBooking = new Date(sub.lastBookingDate);
              if (sub.interval === 'everyday') {
                calculatedNextBillingDate = new Date(lastBooking);
                calculatedNextBillingDate.setDate(calculatedNextBillingDate.getDate() + 1);
              } else if (sub.interval === 'weekly') {
                calculatedNextBillingDate = new Date(lastBooking);
                calculatedNextBillingDate.setDate(calculatedNextBillingDate.getDate() + 7);
              } else if (sub.interval === 'monthly') {
                calculatedNextBillingDate = new Date(lastBooking);
                calculatedNextBillingDate.setMonth(calculatedNextBillingDate.getMonth() + 1);
              }
            } else {
              // Fallback to stored nextBillingDate if no booking dates available
              calculatedNextBillingDate = sub.nextBillingDate ? new Date(sub.nextBillingDate) : null;

              // If nextBillingDate is in the past, calculate the next future billing date
              if (calculatedNextBillingDate && calculatedNextBillingDate < now) {
                calculatedNextBillingDate = calculateNextDate(calculatedNextBillingDate, sub.interval);
              }
            }

            // Also check currentPeriodEnd as fallback if still no valid date
            if (!calculatedNextBillingDate || calculatedNextBillingDate < now) {
              if (sub.currentPeriodEnd && new Date(sub.currentPeriodEnd) > now) {
                calculatedNextBillingDate = new Date(sub.currentPeriodEnd);
              }
            }

            // Calculate the correct currentPeriodEnd for display
            // For cancelled subscriptions, this is when the subscription actually ends
            let calculatedCurrentPeriodEnd: Date = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : now;

            // If currentPeriodEnd is in the past but subscription is still active or cancelAtPeriodEnd,
            // calculate the correct end date
            if (calculatedCurrentPeriodEnd < now) {
              // For cancelAtPeriodEnd, use the calculated next billing date as the end date
              if (sub.cancelAtPeriodEnd && calculatedNextBillingDate) {
                calculatedCurrentPeriodEnd = new Date(calculatedNextBillingDate);
              } else if (sub.status === 'active') {
                // For active subscriptions, calculate from stored date
                calculatedCurrentPeriodEnd = calculateNextDate(calculatedCurrentPeriodEnd, sub.interval);
              }
            }

            // For cancelled subscriptions showing "ends on" date, use the booking date as reference
            // if the stored currentPeriodEnd is in the past
            if (sub.cancelAtPeriodEnd && calculatedCurrentPeriodEnd < now && booking.date) {
              const bookingDate = new Date(booking.date);
              // The subscription ends after the current booking date
              if (bookingDate > now) {
                calculatedCurrentPeriodEnd = bookingDate;
              }
            }

            return {
              id: sub.id,
              status: sub.status,
              interval: sub.interval,
              dayOfWeek: sub.dayOfWeek,
              dayOfMonth: sub.dayOfMonth,
              nextBillingDate: calculatedNextBillingDate,
              currentPeriodEnd: calculatedCurrentPeriodEnd,
              cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
              canceledAt: sub.canceledAt,
              totalPrice: sub.totalPrice,
              stripeSubscriptionId: sub.stripeSubscriptionId,
            };
          })() : null
        };
      })
    );

    res.json({
      success: true,
      data: optimizedBookings,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
    });
  });

  // Update booking status (field owner or admin)
  updateBookingStatus = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { status } = req.body;
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;

    const booking = await BookingModel.findById(id);
    if (!booking) {
      throw new AppError('Booking not found', 404);
    }

    // Check authorization
    const isFieldOwner = (booking.field as any).ownerId === userId;
    const isAdmin = userRole === 'ADMIN';

    if (!isFieldOwner && !isAdmin) {
      throw new AppError('You are not authorized to update this booking', 403);
    }

    // Validate status transition
    const validTransitions: Record<string, string[]> = {
      PENDING: ['CONFIRMED', 'CANCELLED'],
      CONFIRMED: ['COMPLETED', 'CANCELLED'],
      COMPLETED: [],
      CANCELLED: [],
    };

    if (!validTransitions[booking.status].includes(status)) {
      throw new AppError(`Cannot change status from ${booking.status} to ${status}`, 400);
    }

    const updatedBooking = await BookingModel.updateStatus(id, status);

    // Send notifications based on status change
    const field = (booking.field as any);

    if (status === 'CONFIRMED') {
      // Notify dog owner that booking is confirmed
      await createNotification({
        userId: (booking as any).userId,
        type: 'booking_confirmed',
        title: 'Booking Confirmed!',
        message: `Your booking for ${field.name} on ${new Date(booking.date).toLocaleDateString()} has been confirmed by the field owner.`,
        data: {
          bookingId: booking.id,
          fieldId: field.id,
          fieldName: field.name,
          date: booking.date,
          startTime: booking.startTime,
          endTime: booking.endTime,
        },
      });

      // Send email notification
      try {
        const dogOwner = await prisma.user.findUnique({
          where: { id: (booking as any).userId },
          select: { email: true, name: true }
        });

        if (dogOwner?.email) {
          await emailService.sendBookingStatusChangeEmail({
            email: dogOwner.email,
            userName: dogOwner.name || 'Valued Customer',
            bookingId: booking.id,
            fieldName: field.name,
            date: new Date(booking.date),
            startTime: booking.startTime,
            endTime: booking.endTime,
            newStatus: 'CONFIRMED'
          });
        }
      } catch (emailError) {
        console.error('Error sending confirmation email:', emailError);
      }
    } else if (status === 'COMPLETED') {
      // Notify dog owner that booking is completed
      await createNotification({
        userId: (booking as any).userId,
        type: 'booking_completed',
        title: 'Booking Completed',
        message: `We hope you enjoyed your visit to ${field.name}. Consider leaving a review!`,
        data: {
          bookingId: booking.id,
          fieldId: field.id,
          fieldName: field.name,
        },
      });

      // Send email notification
      try {
        const dogOwner = await prisma.user.findUnique({
          where: { id: (booking as any).userId },
          select: { email: true, name: true }
        });

        if (dogOwner?.email) {
          await emailService.sendBookingStatusChangeEmail({
            email: dogOwner.email,
            userName: dogOwner.name || 'Valued Customer',
            bookingId: booking.id,
            fieldName: field.name,
            date: new Date(booking.date),
            startTime: booking.startTime,
            endTime: booking.endTime,
            newStatus: 'COMPLETED'
          });
        }
      } catch (emailError) {
        console.error('Error sending completion email:', emailError);
      }

      // Auto-create next recurring booking if this booking is part of a subscription
      if ((booking as any).subscriptionId) {
        try {
          console.log(`📅 Booking ${id} is part of subscription ${(booking as any).subscriptionId}, creating next booking...`);
          const { subscriptionService } = await import('../services/subscription.service');

          // Get subscription details
          const subscription = await prisma.subscription.findUnique({
            where: { id: (booking as any).subscriptionId }
          });

          if (subscription && subscription.status === 'active') {
            // Get system settings for maxAdvanceBookingDays
            const settings = await prisma.systemSettings.findFirst({
              select: { maxAdvanceBookingDays: true }
            });
            const maxAdvanceBookingDays = settings?.maxAdvanceBookingDays || 30;

            // Calculate next booking date based on interval
            const { addDays, addMonths, format, isAfter } = await import('date-fns');
            const lastBookingDate = subscription.lastBookingDate || booking.date;

            let nextBookingDate = new Date();
            if (subscription.interval === 'everyday') {
              nextBookingDate = addDays(lastBookingDate, 1);
            } else if (subscription.interval === 'weekly') {
              nextBookingDate = addDays(lastBookingDate, 7);
            } else if (subscription.interval === 'monthly') {
              nextBookingDate = addMonths(lastBookingDate, 1);
            }

            // Check if next booking is within advance booking range
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const maxFutureDate = new Date(today);
            maxFutureDate.setDate(maxFutureDate.getDate() + maxAdvanceBookingDays);

            if (!isAfter(nextBookingDate, maxFutureDate)) {
              // Check if booking already exists for this date
              const existingBooking = await prisma.booking.findFirst({
                where: {
                  subscriptionId: subscription.id,
                  date: nextBookingDate,
                  status: { not: 'CANCELLED' }
                }
              });

              if (!existingBooking) {
                const newBooking = await subscriptionService.createBookingFromSubscription(
                  subscription.id,
                  nextBookingDate
                );
                console.log(`✅ Auto-created next recurring booking ${newBooking.id} for ${format(nextBookingDate, 'PPP')}`);

                // Notify user about the auto-created booking
                await createNotification({
                  userId: subscription.userId,
                  type: 'recurring_booking_created',
                  title: 'Next Booking Scheduled',
                  message: `Your next ${subscription.interval} booking at ${field.name} has been automatically scheduled for ${format(nextBookingDate, 'PPP')} at ${subscription.timeSlot}`,
                  data: {
                    bookingId: newBooking.id,
                    subscriptionId: subscription.id,
                    fieldId: subscription.fieldId,
                    fieldName: field.name,
                    bookingDate: nextBookingDate.toISOString(),
                    timeSlot: subscription.timeSlot
                  }
                });
              }
            }
          }
        } catch (recurringError) {
          console.error(`Failed to auto-create next recurring booking for ${id}:`, recurringError);
          // Don't throw - this shouldn't block the completion
        }
      }

      // Trigger automatic payout to field owner
      try {
        console.log(`Triggering automatic payout for completed booking ${id}`);
        await payoutService.processBookingPayout(id);
        console.log(`Payout processed successfully for booking ${id}`);
      } catch (payoutError) {
        console.error(`Failed to process payout for booking ${id}:`, payoutError);
        // Don't throw error - payout can be retried later
        // Notify admin about the failed payout
        const adminUsers = await prisma.user.findMany({
          where: { role: 'ADMIN' }
        });
        for (const admin of adminUsers) {
          await createNotification({
            userId: admin.id,
            type: 'PAYOUT_FAILED',
            title: 'Automatic Payout Failed',
            message: `Failed to process automatic payout for booking ${id}`,
            data: {
              bookingId: id,
              error: payoutError instanceof Error ? payoutError.message : 'Unknown error'
            }
          });
        }
      }
    }

    res.json({
      success: true,
      message: `Booking ${status.toLowerCase()} successfully`,
      data: updatedBooking,
    });
  });

  // Mark past bookings as completed (can be called by a cron job)
  markPastBookingsAsCompleted = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const now = new Date();

    // Find all bookings that are past their date/time and not already completed or cancelled
    const completedBookings = await prisma.booking.updateMany({
      where: {
        status: {
          notIn: ['COMPLETED', 'CANCELLED'],
        },
        date: {
          lt: now,
        },
      },
      data: {
        status: 'COMPLETED',
      },
    });

    res.json({
      success: true,
      message: `Marked ${completedBookings.count} bookings as completed`,
      data: {
        count: completedBookings.count,
      },
    });
  });

  // Check refund eligibility for a booking
  checkRefundEligibility = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const userId = (req as any).user.id;

    // Get cancellation window from settings
    const settings = await prisma.systemSettings.findFirst();
    const cancellationWindowHours = settings?.cancellationWindowHours || 24;

    const booking = await BookingModel.findById(id);
    if (!booking) {
      throw new AppError('Booking not found', 404);
    }

    // Check authorization
    const isDogOwner = (booking as any).userId === userId;
    if (!isDogOwner) {
      throw new AppError('You are not authorized to check this booking', 403);
    }

    // Calculate time until booking from current time
    const now = new Date();
    const bookingDate = new Date(booking.date);

    // Parse the booking start time to add to the date
    const [startHourStr, startPeriod] = booking.startTime.split(/(?=[AP]M)/);
    let startHour = parseInt(startHourStr.split(':')[0]);
    const startMinute = parseInt(startHourStr.split(':')[1] || '0');
    if (startPeriod === 'PM' && startHour !== 12) startHour += 12;
    if (startPeriod === 'AM' && startHour === 12) startHour = 0;

    bookingDate.setHours(startHour, startMinute, 0, 0);

    // Debug logging
    console.log('=== Refund Eligibility Check ===');
    console.log('Booking ID:', booking.id);
    console.log('Current time:', now.toISOString());
    console.log('Booking date/time:', bookingDate.toISOString());
    console.log('Start time:', booking.startTime);

    // Calculate hours until booking from now
    const hoursUntilBooking = (bookingDate.getTime() - now.getTime()) / (1000 * 60 * 60);
    const isRefundEligible = hoursUntilBooking >= cancellationWindowHours;

    console.log('Hours until booking:', hoursUntilBooking);
    console.log('Is refund eligible:', isRefundEligible);
    console.log('=========================');

    res.json({
      success: true,
      data: {
        isRefundEligible,
        hoursUntilBooking: Math.floor(hoursUntilBooking),
        canCancel: hoursUntilBooking >= cancellationWindowHours,
        message: isRefundEligible
          ? `This booking can be cancelled with a full refund. There are ${Math.floor(hoursUntilBooking)} hours until the booking time.`
          : `This booking cannot be cancelled with a refund. Cancellations must be made at least ${cancellationWindowHours} hours before the booking time. Only ${Math.floor(hoursUntilBooking)} hours remain.`,
      },
    });
  });

  // Cancel booking (dog owner or field owner)
  cancelBooking = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;
    const { reason } = req.body;

    // Get cancellation window from settings
    const settings = await prisma.systemSettings.findFirst();
    const cancellationWindowHours = settings?.cancellationWindowHours || 24;

    const booking = await BookingModel.findById(id);
    if (!booking) {
      throw new AppError('Booking not found', 404);
    }

    // Check authorization
    const isDogOwner = (booking as any).userId === userId;
    const isFieldOwner = (booking.field as any).ownerId === userId;
    const isAdmin = userRole === 'ADMIN';

    if (!isDogOwner && !isFieldOwner && !isAdmin) {
      throw new AppError('You are not authorized to cancel this booking', 403);
    }

    // Check if booking can be cancelled
    if (booking.status === 'COMPLETED' || booking.status === 'CANCELLED') {
      throw new AppError(`Cannot cancel a ${booking.status.toLowerCase()} booking`, 400);
    }

    // Calculate time until booking from current time
    const now = new Date();
    const bookingDate = new Date(booking.date);

    // Parse the booking start time to add to the date
    const [startHourStr, startPeriod] = booking.startTime.split(/(?=[AP]M)/);
    let startHour = parseInt(startHourStr.split(':')[0]);
    const startMinute = parseInt(startHourStr.split(':')[1] || '0');
    if (startPeriod === 'PM' && startHour !== 12) startHour += 12;
    if (startPeriod === 'AM' && startHour === 12) startHour = 0;

    bookingDate.setHours(startHour, startMinute, 0, 0);

    // Debug logging for cancellation
    console.log('=== Cancel Booking Check ===');
    console.log('Booking ID:', booking.id);
    console.log('Current time:', now.toISOString());
    console.log('Booking date/time:', bookingDate.toISOString());
    console.log('Start time:', booking.startTime);

    // Calculate hours until booking from now
    const hoursUntilBooking = (bookingDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    // Check if cancellation is allowed (at least cancellationWindowHours before booking)
    if (hoursUntilBooking < cancellationWindowHours && !isAdmin) {
      throw new AppError(`Cancellation not allowed. Bookings must be cancelled at least ${cancellationWindowHours} hours in advance.`, 400);
    }

    // Refund is eligible if cancelled at least 24 hours before booking
    const isRefundEligible = hoursUntilBooking >= cancellationWindowHours;

    console.log('Hours until booking:', hoursUntilBooking);
    console.log('Is refund eligible:', isRefundEligible);
    console.log('===================================');

    const cancelledBooking = await BookingModel.cancel(id, reason);

    // Process immediate refund if eligible
    let refundResult = null;
    if (isRefundEligible && isDogOwner) {
      try {
        if (booking.subscriptionId) {
          const { subscriptionService } = await import('../services/subscription.service');
          refundResult = await subscriptionService.refundSubscriptionBookingOccurrence(id, reason || 'requested_by_customer');
        } else {
          refundResult = await refundService.processRefund(id, reason);
        }
      } catch (refundError: any) {
        console.error('Refund processing error:', refundError);
        // Continue with cancellation even if refund fails
      }
    } else if (!isRefundEligible && isDogOwner) {
      // If not eligible for refund, transfer full amount to field owner after cancellation period
      // Run in background - don't block response
      refundService.processFieldOwnerPayout(booking, 0).catch((payoutError: any) => {
        console.error('Payout processing error:', payoutError);
      });
    }

    // Send cancellation notifications and emails in background (non-blocking)
    const field = (booking.field as any);

    // Run notifications and emails in background - don't await
    (async () => {
      try {
        if (isDogOwner) {
          // Dog owner cancelled - notify field owner
          if (field.ownerId) {
            // Create notification
            await createNotification({
              userId: field.ownerId,
              type: 'booking_cancelled_by_customer',
              title: 'Booking Cancelled',
              message: `A booking for ${field.name} on ${new Date(booking.date).toLocaleDateString()} has been cancelled by the customer.`,
              data: {
                bookingId: booking.id,
                fieldId: field.id,
                fieldName: field.name,
                date: booking.date,
                startTime: booking.startTime,
                endTime: booking.endTime,
              },
            });

            // Fetch both users in parallel
            const [fieldOwner, dogOwner] = await Promise.all([
              prisma.user.findUnique({
                where: { id: field.ownerId },
                select: { email: true, name: true }
              }),
              prisma.user.findUnique({
                where: { id: (booking as any).userId },
                select: { name: true, email: true }
              })
            ]);

            // Send email to field owner
            if (fieldOwner?.email) {
              emailService.sendBookingStatusChangeEmail({
                email: fieldOwner.email,
                userName: fieldOwner.name || 'Field Owner',
                bookingId: booking.id,
                fieldName: field.name,
                date: new Date(booking.date),
                startTime: booking.startTime,
                endTime: booking.endTime,
                newStatus: 'CANCELLED',
                reason: `Cancelled by customer: ${dogOwner?.name || dogOwner?.email || 'Customer'}. ${reason || ''}`
              }).catch((err) => console.error('Error sending email to field owner:', err));
            }

            // Send email to dog owner
            if (dogOwner?.email) {
              emailService.sendBookingStatusChangeEmail({
                email: dogOwner.email,
                userName: dogOwner.name || 'Valued Customer',
                bookingId: booking.id,
                fieldName: field.name,
                date: new Date(booking.date),
                startTime: booking.startTime,
                endTime: booking.endTime,
                newStatus: 'CANCELLED',
                reason: reason || 'You cancelled this booking'
              }).catch((err) => console.error('Error sending email to dog owner:', err));
            }
          }

          // Send confirmation notification to dog owner
          await createNotification({
            userId: (booking as any).userId,
            type: 'booking_cancelled_success',
            title: 'Booking Cancelled',
            message: `Your booking for ${field.name} on ${new Date(booking.date).toLocaleDateString()} has been cancelled successfully.`,
            data: {
              bookingId: booking.id,
              fieldId: field.id,
              fieldName: field.name,
            },
          });
        } else if (isFieldOwner) {
          // Field owner cancelled - notify dog owner
          await createNotification({
            userId: (booking as any).userId,
            type: 'booking_cancelled_by_owner',
            title: 'Booking Cancelled by Field Owner',
            message: `Unfortunately, your booking for ${field.name} on ${new Date(booking.date).toLocaleDateString()} has been cancelled by the field owner.`,
            data: {
              bookingId: booking.id,
              fieldId: field.id,
              fieldName: field.name,
              date: booking.date,
            },
          });

          // Send email to dog owner
          const dogOwner = await prisma.user.findUnique({
            where: { id: (booking as any).userId },
            select: { email: true, name: true }
          });

          if (dogOwner?.email) {
            emailService.sendBookingStatusChangeEmail({
              email: dogOwner.email,
              userName: dogOwner.name || 'Valued Customer',
              bookingId: booking.id,
              fieldName: field.name,
              date: new Date(booking.date),
              startTime: booking.startTime,
              endTime: booking.endTime,
              newStatus: 'CANCELLED',
              reason: reason || 'The field owner cancelled this booking'
            }).catch((err) => console.error('Error sending email to dog owner:', err));
          }
        }
      } catch (error) {
        console.error('Error in background cancellation tasks:', error);
      }
    })();

    res.json({
      success: true,
      message: 'Booking cancelled successfully',
      data: {
        ...cancelledBooking,
        isRefundEligible,
        refundResult,
        refundMessage: refundResult?.success
          ? `Refund of £${refundResult.refundAmount?.toFixed(2) || '0.00'} has been initiated and will be credited to your account within 5-7 business days.`
          : isRefundEligible
            ? 'You are eligible for a refund. The amount will be credited to your account within 5-7 business days.'
            : `This booking is not eligible for a refund as it was cancelled less than ${cancellationWindowHours} hours before the scheduled time.`,
      },
    });
  });

  // Update booking (reschedule)
  updateBooking = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { date, startTime, endTime, notes, recurring } = req.body;
    const userId = (req as any).user.id;

    const booking = await BookingModel.findById(id);
    if (!booking) {
      throw new AppError('Booking not found', 404);
    }

    // Only dog owner can reschedule their booking
    if ((booking as any).userId !== userId) {
      throw new AppError('You can only update your own bookings', 403);
    }

    // Check if booking can be rescheduled
    if (booking.status !== 'PENDING' && booking.status !== 'CONFIRMED') {
      throw new AppError('Only pending or confirmed bookings can be rescheduled', 400);
    }

    // Check reschedule limit (max 3 times)
    const rescheduleCount = (booking as any).rescheduleCount || 0;
    if (rescheduleCount >= 3) {
      throw new AppError('You have reached the maximum number of reschedules (3) for this booking. Please cancel and create a new booking if needed.', 400);
    }

    // Check if booking is within cancellation window
    const bookingDateTime = new Date(booking.date);
    const [hours, minutes] = booking.startTime.split(':');
    bookingDateTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);

    const now = new Date();
    const hoursUntilBooking = (bookingDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    // Get cancellation window from settings (default 24 hours)
    const settings = await prisma.systemSettings.findFirst();
    const cancellationWindowHours = settings?.cancellationWindowHours || 24;

    if (hoursUntilBooking < cancellationWindowHours) {
      throw new AppError(`Rescheduling is only allowed at least ${cancellationWindowHours} hours before the booking time.`, 400);
    }

    // If changing time/date, check availability and recalculate price
    if (date || startTime || endTime) {
      const newDate = date ? new Date(date) : booking.date;
      const newStartTime = startTime || booking.startTime;
      const newEndTime = endTime || booking.endTime;

      // Check full availability (including recurring booking reservations)
      // Exclude the current booking's subscription (if any) to allow rescheduling within same subscription
      const availabilityCheck = await BookingModel.checkFullAvailability(
        booking.fieldId,
        newDate,
        newStartTime,
        newEndTime,
        id, // Exclude current booking from check
        booking.subscriptionId || undefined // Exclude current subscription if this is a recurring booking
      );

      if (!availabilityCheck.available) {
        throw new AppError(availabilityCheck.reason || 'The new time slot is not available', 400);
      }

      // Always recalculate price when rescheduling with the original numberOfDogs
      const field = await FieldModel.findById(booking.fieldId);
      if (!field) {
        throw new AppError('Field not found', 404);
      }

      const startMinutes = this.timeToMinutes(newStartTime);
      const endMinutes = this.timeToMinutes(newEndTime);
      const durationHours = (endMinutes - startMinutes) / 60;
      const dogsCount = booking.numberOfDogs || 1; // Always use the original numberOfDogs from booking

      // Calculate price based on field's booking duration setting
      // Use price30min for 30-minute slots, price1hr for hourly slots
      // Fall back to field.price for backwards compatibility
      let totalPrice = 0;

      if (field.bookingDuration === '30min') {
        // For 30-minute slots, use price30min (price per 30 minutes per dog)
        const pricePerSlot = field.price30min || field.price || 0;
        const duration30MinBlocks = durationHours * 2; // Convert hours to 30-min blocks
        totalPrice = pricePerSlot * duration30MinBlocks * dogsCount;
      } else {
        // For hourly slots, use price1hr (price per hour per dog)
        const pricePerHour = field.price1hr || field.price || 0;
        totalPrice = pricePerHour * durationHours * dogsCount;
      }

      // Ensure totalPrice is a valid number
      const priceUsed = field.bookingDuration === '30min'
        ? (field.price30min || field.price || 0)
        : (field.price1hr || field.price || 0);

      if (isNaN(totalPrice) || totalPrice < 0) {
        console.error('Invalid totalPrice calculation:', {
          priceUsed,
          price30min: field.price30min,
          price1hr: field.price1hr,
          durationHours,
          numberOfDogs: dogsCount,
          bookingDuration: field.bookingDuration,
          totalPrice
        });
        totalPrice = 0;
      }

      // Calculate commission using the utility function (commission rate = field owner's percentage)
      const { calculatePayoutAmounts } = await import('../utils/commission.utils');
      const { fieldOwnerAmount, platformCommission, commissionRate } = await calculatePayoutAmounts(
        totalPrice,
        field.ownerId || ''
      );

      // Log for debugging
      console.log('Reschedule price calculation:', {
        priceUsed,
        price30min: field.price30min,
        price1hr: field.price1hr,
        durationHours,
        numberOfDogs: dogsCount,
        bookingDuration: field.bookingDuration,
        totalPrice,
        platformCommission,
        fieldOwnerAmount,
        commissionRate
      });

      // Ensure totalPrice and commission fields are set in the update data
      req.body.totalPrice = totalPrice;
      req.body.platformCommission = platformCommission;
      req.body.fieldOwnerAmount = fieldOwnerAmount;

      // Update timeSlot to match the new startTime and endTime
      req.body.timeSlot = `${newStartTime} - ${newEndTime}`;

      // Convert date string to full DateTime if provided
      if (date) {
        req.body.date = new Date(date);
      }
    }

    // Increment reschedule count if date or time is being changed
    if (date || startTime || endTime) {
      req.body.rescheduleCount = rescheduleCount + 1;
    }

    // Update repeatBooking if recurring is provided (map recurring to repeatBooking field)
    if (recurring !== undefined) {
      req.body.repeatBooking = recurring;
      // Remove the recurring field as it doesn't exist in the schema
      delete req.body.recurring;
    }

    // Log the final update data
    console.log('Final update data for booking:', req.body);

    const updatedBooking = await BookingModel.update(id, req.body);

    res.json({
      success: true,
      message: `Booking rescheduled successfully. You have ${2 - rescheduleCount} reschedule${2 - rescheduleCount === 1 ? '' : 's'} remaining for this booking.`,
      data: updatedBooking,
      remainingReschedules: 3 - (rescheduleCount + 1),
    });
  });

  // Delete booking (admin only)
  deleteBooking = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    const booking = await BookingModel.findById(id);
    if (!booking) {
      throw new AppError('Booking not found', 404);
    }

    await BookingModel.delete(id);

    res.status(204).json({
      success: true,
      message: 'Booking deleted successfully',
    });
  });

  // Get booking statistics
  getBookingStats = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;

    let stats;
    if (userRole === 'DOG_OWNER') {
      stats = await BookingModel.getDogOwnerStats(userId);
    } else if (userRole === 'FIELD_OWNER') {
      stats = await BookingModel.getFieldOwnerStats(userId);
    } else {
      throw new AppError('Statistics not available for this user role', 400);
    }

    res.json({
      success: true,
      data: stats,
    });
  });

  // Get slot availability (private booking system - slot is either available or booked)
  getSlotAvailability = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { fieldId } = req.params;
    const { date, duration } = req.query;

    if (!date) {
      throw new AppError('Date is required', 400);
    }

    // Duration can be '30min' or '60min' (or '1hour' for backward compatibility)
    // If not provided, use field's default bookingDuration
    const requestedDuration = duration as string | undefined;

    // Get field details - support both ObjectID and human-readable fieldId
    const isObjectId = fieldId.length === 24 && /^[0-9a-fA-F]+$/.test(fieldId);
    const field = isObjectId
      ? await prisma.field.findUnique({ where: { id: fieldId } })
      : await prisma.field.findFirst({ where: { fieldId: fieldId } });

    if (!field) {
      throw new AppError('Field not found', 404);
    }

    // Parse the date
    const selectedDate = new Date(date as string);
    const now = new Date();

    // Get start and end of day
    const startOfDayDate = new Date(selectedDate);
    startOfDayDate.setHours(0, 0, 0, 0);

    const endOfDayDate = new Date(selectedDate);
    endOfDayDate.setHours(23, 59, 59, 999);

    // Get all bookings for this field on the selected date (excluding cancelled)
    // Always use the MongoDB ObjectID for querying bookings
    const bookings = await prisma.booking.findMany({
      where: {
        fieldId: field.id,
        date: {
          gte: startOfDayDate,
          lte: endOfDayDate
        },
        status: {
          notIn: ['CANCELLED']
        }
      },
      select: {
        startTime: true,
        endTime: true,
        timeSlot: true,
        status: true,
        subscriptionId: true
      }
    });

    // Get all active subscriptions for this field to mark recurring time slots
    const activeSubscriptions = await prisma.subscription.findMany({
      where: {
        fieldId: field.id,
        status: 'active',
        cancelAtPeriodEnd: false
      },
      select: {
        id: true,
        interval: true,
        dayOfWeek: true,
        dayOfMonth: true,
        timeSlot: true,
        startTime: true,
        endTime: true,
        lastBookingDate: true,
        createdAt: true
      }
    });

    // Get system settings for maxAdvanceBookingDays
    const settings = await prisma.systemSettings.findFirst({
      select: { maxAdvanceBookingDays: true }
    });
    const maxAdvanceBookingDays = settings?.maxAdvanceBookingDays || 30;
    const maxFutureDate = new Date(selectedDate);
    maxFutureDate.setDate(maxFutureDate.getDate() + maxAdvanceBookingDays);

    // Filter subscriptions that apply to the selected date
    // Store recurring subscriptions with their time info for proper overlap checking
    const recurringSubscriptions: Array<{
      timeSlot: string;
      startTime: string;
      endTime: string;
      interval: string;
    }> = [];

    for (const subscription of activeSubscriptions) {
      // Check if the selected date falls on a recurring booking day
      let isRecurringDay = false;

      if (subscription.interval === 'everyday') {
        // Every day is a recurring day
        isRecurringDay = true;
      } else if (subscription.interval === 'weekly') {
        // Check if selected date's day of week matches subscription's day
        const selectedDayOfWeek = selectedDate.toLocaleDateString('en-US', { weekday: 'long' });
        if (subscription.dayOfWeek && selectedDayOfWeek.toLowerCase() === subscription.dayOfWeek.toLowerCase()) {
          isRecurringDay = true;
        }
      } else if (subscription.interval === 'monthly') {
        // Check if selected date's day of month matches subscription's day
        if (subscription.dayOfMonth && selectedDate.getDate() === subscription.dayOfMonth) {
          isRecurringDay = true;
        }
      }

      // If this is a recurring day, check if it's within the booking window
      if (isRecurringDay) {
        // Only mark as reserved if it's a future date
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (selectedDate >= today && selectedDate <= maxFutureDate) {
          // Check if a booking doesn't already exist for this date and subscription
          const hasExistingBooking = bookings.some(b =>
            b.subscriptionId === subscription.id &&
            (b.timeSlot === subscription.timeSlot || b.startTime === subscription.startTime)
          );

          // If no booking exists yet, add to recurring list for overlap checking
          if (!hasExistingBooking) {
            recurringSubscriptions.push({
              timeSlot: subscription.timeSlot || `${subscription.startTime} - ${subscription.endTime}`,
              startTime: subscription.startTime,
              endTime: subscription.endTime,
              interval: subscription.interval
            });
          }
        }
      }
    }

    // Helper to convert time string to minutes for overlap checking
    const timeStringToMinutes = (time: string): number => {
      // Handle both "HH:mm" and "H:mmAM/PM" formats
      if (time.includes('AM') || time.includes('PM')) {
        const match = time.match(/(\d+):(\d+)(AM|PM)/i);
        if (match) {
          let hours = parseInt(match[1]);
          const minutes = parseInt(match[2]);
          const period = match[3].toUpperCase();
          if (period === 'PM' && hours !== 12) hours += 12;
          if (period === 'AM' && hours === 12) hours = 0;
          return hours * 60 + minutes;
        }
      }
      const [hours, mins] = time.split(':').map(Number);
      return hours * 60 + (mins || 0);
    };

    // Check if a slot overlaps with recurring bookings
    const checkRecurringOverlap = (slotStart: number, slotEnd: number): { isOverlapping: boolean; interval?: string } => {
      for (const recurring of recurringSubscriptions) {
        const recurStart = timeStringToMinutes(recurring.startTime);
        const recurEnd = timeStringToMinutes(recurring.endTime);

        // Check for overlap
        const hasOverlap =
          (slotStart >= recurStart && slotStart < recurEnd) ||
          (slotEnd > recurStart && slotEnd <= recurEnd) ||
          (slotStart <= recurStart && slotEnd >= recurEnd);

        if (hasOverlap) {
          return { isOverlapping: true, interval: recurring.interval };
        }
      }
      return { isOverlapping: false };
    };

    // Generate time slots based on field's operating hours and booking duration
    // Parse opening and closing times to include minutes
    const parseTime = (timeStr: string): { hour: number; minute: number } => {
      if (!timeStr) return { hour: 0, minute: 0 };

      // First, try to match 12-hour format with AM/PM (e.g., "12:15AM", "2:30 PM")
      const time12Match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (time12Match) {
        let hour = parseInt(time12Match[1]);
        const minute = parseInt(time12Match[2]);
        const period = time12Match[3].toUpperCase();

        // Convert to 24-hour format
        if (period === 'PM' && hour !== 12) {
          hour += 12;
        } else if (period === 'AM' && hour === 12) {
          hour = 0;
        }

        return { hour, minute };
      }

      // Second, try to match 24-hour format (e.g., "14:30", "02:15")
      const time24Match = timeStr.match(/(\d{1,2}):(\d{2})/);
      if (time24Match) {
        const hour = parseInt(time24Match[1]);
        const minute = parseInt(time24Match[2]);
        return { hour, minute };
      }

      // Fallback: try to parse as just hour
      const hour = parseInt(timeStr.split(':')[0]) || 0;
      return { hour, minute: 0 };
    };

    const openingTime = parseTime(field.openingTime || '6:00AM');
    const closingTime = parseTime(field.closingTime || '9:00PM');

    const slots = [];

    // Determine slot duration based on requested duration or field's default
    // Allow user to select 30min or 60min duration
    // '1hour' is treated as '60min' for backward compatibility
    const effectiveDuration = requestedDuration || field.bookingDuration || '1hour';
    const slotDurationMinutes = (effectiveDuration === '30min') ? 30 : 60;

    // Display duration with 5-minute buffer for field owner transition
    // 30min slot shows as 25 minutes, 60min slot shows as 55 minutes
    const displayDurationMinutes = slotDurationMinutes === 30 ? 25 : 55;

    // Helper function to format time
    const formatTime = (hour: number, minutes: number = 0): string => {
      const period = hour >= 12 ? 'PM' : 'AM';
      const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      const displayMinutes = minutes.toString().padStart(2, '0');
      return `${displayHour}:${displayMinutes}${period}`;
    };

    // Convert time to minutes for easier calculation
    const timeToMinutes = (hour: number, minute: number): number => {
      return hour * 60 + minute;
    };

    const openingMinutes = timeToMinutes(openingTime.hour, openingTime.minute);
    const closingMinutes = timeToMinutes(closingTime.hour, closingTime.minute);

    // Generate slots from opening to closing time
    let currentMinutes = openingMinutes;

    // Helper function to check if a new slot overlaps with any existing booking
    const checkBookingOverlap = (slotStartMinutes: number, slotEndMinutes: number): boolean => {
      for (const booking of bookings) {
        // Parse booking start and end times
        const bookingStartMinutes = timeStringToMinutes(booking.startTime);
        const bookingEndMinutes = timeStringToMinutes(booking.endTime);

        // Check for overlap: slots overlap if one starts before the other ends
        const hasOverlap =
          (slotStartMinutes >= bookingStartMinutes && slotStartMinutes < bookingEndMinutes) ||
          (slotEndMinutes > bookingStartMinutes && slotEndMinutes <= bookingEndMinutes) ||
          (slotStartMinutes <= bookingStartMinutes && slotEndMinutes >= bookingEndMinutes);

        if (hasOverlap) {
          return true;
        }
      }
      return false;
    };

    while (currentMinutes + slotDurationMinutes <= closingMinutes) {
      // Calculate start time
      const startHour = Math.floor(currentMinutes / 60);
      const startMinute = currentMinutes % 60;

      // Calculate end time for display (with 5-min buffer: 25 or 55 minutes)
      const displayEndTotalMinutes = currentMinutes + displayDurationMinutes;
      const displayEndHour = Math.floor(displayEndTotalMinutes / 60);
      const displayEndMinute = displayEndTotalMinutes % 60;

      // Full slot end time for availability checking (full 30 or 60 minutes)
      const fullEndTotalMinutes = currentMinutes + slotDurationMinutes;

      // Format times for display (showing shortened duration)
      const startTime = formatTime(startHour, startMinute);
      const displayEndTime = formatTime(displayEndHour, displayEndMinute);
      const slotTime = `${startTime} - ${displayEndTime}`;

      // Also store the full slot time for internal reference
      const fullEndHour = Math.floor(fullEndTotalMinutes / 60);
      const fullEndMinute = fullEndTotalMinutes % 60;
      const fullEndTime = formatTime(fullEndHour, fullEndMinute);

      // Check if slot is booked using overlap detection (checks full slot duration)
      const isBookedByBooking = checkBookingOverlap(currentMinutes, fullEndTotalMinutes);

      // Check if slot is reserved by recurring booking (using proper overlap detection)
      const recurringCheck = checkRecurringOverlap(currentMinutes, fullEndTotalMinutes);
      const isBookedByRecurring = recurringCheck.isOverlapping;

      const isBooked = isBookedByBooking || isBookedByRecurring;

      // Note: isPast check removed from backend because server timezone may differ from client timezone
      // Frontend will calculate isPast using client's local timezone
      slots.push({
        time: slotTime,
        fullEndTime, // Full end time for booking creation
        startHour: startHour,
        startMinute: startMinute,
        displayDuration: displayDurationMinutes, // 25 or 55 minutes
        actualDuration: slotDurationMinutes, // 30 or 60 minutes
        isBooked,
        isBookedByRecurring,
        recurringInterval: recurringCheck.interval,
        isAvailable: !isBooked
      });

      // Move to next slot (using full slot duration to avoid overlaps)
      currentMinutes += slotDurationMinutes;
    }

    // Prevent caching - availability data must always be fresh
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    res.json({
      success: true,
      data: {
        date: date as string,
        fieldId,
        fieldName: field.name,
        slots,
        bookingDuration: effectiveDuration,
        displayDuration: displayDurationMinutes,
        actualDuration: slotDurationMinutes,
        operatingHours: {
          opening: field.openingTime || '06:00',
          closing: field.closingTime || '21:00'
        },
        operatingDays: field.operatingDays
      }
    });
  });

  // Check field availability (including recurring booking reservations)
  checkAvailability = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { fieldId, date, startTime, endTime } = req.query;

    if (!fieldId || !date || !startTime || !endTime) {
      throw new AppError('Field ID, date, start time, and end time are required', 400);
    }

    // Resolve field to get the actual ObjectID
    const field = await resolveField(fieldId as string);
    if (!field) {
      throw new AppError('Field not found', 404);
    }

    // Use checkFullAvailability to include recurring slot checks
    const availabilityCheck = await BookingModel.checkFullAvailability(
      field.id,
      new Date(date as string),
      startTime as string,
      endTime as string
    );

    res.json({
      success: true,
      available: availabilityCheck.available,
      reason: availabilityCheck.reason,
      conflictType: availabilityCheck.conflictType
    });
  });

  // Check recurring subscription conflicts before booking
  // This is called from the book-field page when user selects a recurring option
  checkRecurringConflicts = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { fieldId, date, startTime, endTime, interval } = req.query;

    if (!fieldId || !date || !startTime || !endTime || !interval) {
      throw new AppError('Field ID, date, start time, end time, and interval are required', 400);
    }

    // Resolve field to get the actual ObjectID
    const field = await resolveField(fieldId as string);
    if (!field) {
      throw new AppError('Field not found', 404);
    }

    // Validate interval
    const validIntervals = ['everyday', 'weekly', 'monthly'];
    const normalizedInterval = (interval as string).toLowerCase();
    if (!validIntervals.includes(normalizedInterval)) {
      throw new AppError('Invalid interval. Must be everyday, weekly, or monthly', 400);
    }

    // Check for conflicts
    const conflictCheck = await BookingModel.checkRecurringSubscriptionConflicts(
      field.id,
      new Date(date as string),
      startTime as string,
      endTime as string,
      normalizedInterval as 'everyday' | 'weekly' | 'monthly'
    );

    // Prevent caching - conflict data must always be fresh
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    if (conflictCheck.hasConflict) {
      // Format the conflicting dates for display
      const conflictDates = conflictCheck.conflictingDates.slice(0, 5).map(c => {
        const dateObj = new Date(c.date);
        return dateObj.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
      });
      const moreCount = conflictCheck.conflictingDates.length > 5
        ? ` and ${conflictCheck.conflictingDates.length - 5} more`
        : '';

      // Return warning instead of blocking - these dates will be skipped automatically
      res.json({
        success: true,
        hasConflict: true,
        canProceed: true, // Allow proceeding despite conflicts
        skippedDatesCount: conflictCheck.conflictingDates.length,
        message: `Note: ${conflictCheck.conflictingDates.length} date(s) will be skipped due to existing bookings: ${conflictDates.join(', ')}${moreCount}. Your recurring booking will continue on available dates.`,
        skippedDates: conflictCheck.conflictingDates.map(c => ({
          date: c.date.toISOString(),
          formattedDate: new Date(c.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
          bookedBy: c.existingBooking.user?.name || 'Another user'
        }))
      });
    } else {
      res.json({
        success: true,
        hasConflict: false,
        canProceed: true,
        message: 'No conflicts found'
      });
    }
  });

  // Get my recurring bookings (subscriptions + bookings with repeatBooking)
  getMyRecurringBookings = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;
    const { status = 'active' } = req.query;

    console.log('[getMyRecurringBookings] Starting fetch for userId:', userId, 'status filter:', status);

    // Get system settings for maxAdvanceBookingDays
    const settings = await prisma.systemSettings.findFirst({
      select: { maxAdvanceBookingDays: true }
    });
    const maxAdvanceBookingDays = settings?.maxAdvanceBookingDays || 30;

    // Calculate the max date for future bookings
    const maxFutureDate = new Date();
    maxFutureDate.setDate(maxFutureDate.getDate() + maxAdvanceBookingDays);

    // Build where clause - if status is 'all' or empty, show all subscriptions
    const whereClause: any = { userId };
    if (status && status !== 'all') {
      whereClause.status = status as string;
    }

    console.log('[getMyRecurringBookings] Query whereClause:', JSON.stringify(whereClause));

    // Get user's subscriptions from subscription table
    // Only show subscription cards - individual recurring bookings are created from subscriptions
    const subscriptions = await prisma.subscription.findMany({
      where: whereClause,
      include: {
        field: {
          include: {
            owner: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          }
        },
        bookings: {
          where: {
            status: { not: 'CANCELLED' }
          },
          orderBy: {
            date: 'asc'
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    console.log('[getMyRecurringBookings] Found', subscriptions.length, 'subscriptions');
    if (subscriptions.length > 0) {
      console.log('[getMyRecurringBookings] First subscription:', {
        id: subscriptions[0].id,
        status: subscriptions[0].status,
        interval: subscriptions[0].interval,
        fieldId: subscriptions[0].fieldId,
        bookingsCount: subscriptions[0].bookings?.length || 0
      });
    }

    const now = new Date();

    // Format subscriptions with calculated next billing date
    const formattedSubscriptions = subscriptions.map(sub => {
      // Filter bookings: only future bookings or the most recent past booking
      const futureBookings = sub.bookings.filter(booking =>
        new Date(booking.date) > now && new Date(booking.date) <= maxFutureDate
      );
      const pastBookings = sub.bookings.filter(booking =>
        new Date(booking.date) <= now
      );

      // Calculate next billing date from upcoming bookings
      let calculatedNextBillingDate = sub.nextBillingDate;
      if (futureBookings.length > 0) {
        // Use the earliest future booking date as next billing date
        calculatedNextBillingDate = futureBookings[0].date;
      }

      // For recent bookings, show up to 5 most recent bookings (past + future)
      const recentBookingsToShow = [
        ...pastBookings.slice(-2), // Last 2 past bookings
        ...futureBookings.slice(0, 3) // Next 3 future bookings
      ]
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .slice(0, 5)
        .map(booking => ({
          id: booking.id,
          date: booking.date,
          status: booking.status,
          paymentStatus: booking.paymentStatus
        }));

      return {
        id: sub.id,
        type: 'subscription',
        fieldId: sub.fieldId,
        fieldName: sub.field.name,
        fieldAddress: sub.field.address,
        fieldOwner: sub.field.owner.name,
        interval: sub.interval,
        dayOfWeek: sub.dayOfWeek,
        dayOfMonth: sub.dayOfMonth,
        timeSlot: sub.timeSlot,
        startTime: sub.startTime,
        endTime: sub.endTime,
        numberOfDogs: sub.numberOfDogs,
        totalPrice: sub.totalPrice,
        status: sub.status,
        nextBillingDate: calculatedNextBillingDate, // Use calculated next billing date
        currentPeriodEnd: sub.currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        canceledAt: sub.canceledAt,
        recentBookings: recentBookingsToShow,
        createdAt: sub.createdAt
      };
    });

    res.json({
      success: true,
      data: formattedSubscriptions,
      total: formattedSubscriptions.length
    });
  });

  // Cancel recurring booking (subscription)
  cancelRecurringBooking = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;
    const { id } = req.params;
    const { cancelImmediately = false } = req.body;

    // Helper to check if string is a valid MongoDB ObjectId
    const isValidObjectId = (str: string) => str.length === 24 && /^[0-9a-fA-F]+$/.test(str);

    // Find the subscription - try direct lookup first only if it's a valid ObjectId
    let subscription = null;

    if (isValidObjectId(id)) {
      subscription = await prisma.subscription.findUnique({
        where: {
          id: id
        },
        include: {
          field: true
        }
      });
    }

    // If not found, the ID might be a booking ID (either ObjectId or human-readable bookingId)
    // Try to find subscription through booking
    if (!subscription) {
      const bookingWhere = isValidObjectId(id) ? { id: id } : { bookingId: id };

      const booking = await prisma.booking.findFirst({
        where: bookingWhere,
        select: { subscriptionId: true }
      });

      if (booking?.subscriptionId) {
        subscription = await prisma.subscription.findUnique({
          where: {
            id: booking.subscriptionId
          },
          include: {
            field: true
          }
        });
      }
    }

    if (!subscription) {
      throw new AppError('Recurring booking not found', 404);
    }

    const subscriptionId = subscription.id;

    // Verify ownership
    if (subscription.userId !== userId) {
      throw new AppError('You are not authorized to cancel this recurring booking', 403);
    }

    // Cancel in Stripe if it's an actual Stripe subscription (starts with 'sub_')
    // Note: Fieldsy uses a custom recurring booking system with individual payment intents,
    // not Stripe's subscription product. The stripeSubscriptionId field may contain a payment intent ID.
    if (subscription.stripeSubscriptionId && subscription.stripeSubscriptionId.startsWith('sub_')) {
      try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

        if (cancelImmediately) {
          // Cancel immediately and issue prorated refund
          await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
        } else {
          // Cancel at period end
          await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
            cancel_at_period_end: true
          });
        }
      } catch (stripeError: any) {
        console.error('Stripe cancellation error:', stripeError);
        // Continue with local cancellation even if Stripe fails
      }
    } else if (subscription.stripeSubscriptionId) {
      // This is a payment intent ID, not a Stripe subscription
      // For custom recurring bookings, we just handle the cancellation locally
      console.log('Custom recurring booking (not Stripe subscription), handling cancellation locally');
    }

    // Update subscription in database
    const updatedSubscription = await prisma.subscription.update({
      where: {
        id: subscriptionId
      },
      data: {
        status: cancelImmediately ? 'canceled' : subscription.status,
        cancelAtPeriodEnd: !cancelImmediately,
        canceledAt: cancelImmediately ? new Date() : null
      }
    });

    // Cancel future bookings if canceling immediately
    if (cancelImmediately) {
      await prisma.booking.updateMany({
        where: {
          subscriptionId,
          date: {
            gte: new Date()
          },
          status: {
            in: ['PENDING', 'CONFIRMED']
          }
        },
        data: {
          status: 'CANCELLED',
          cancellationReason: 'Recurring booking canceled',
          cancelledAt: new Date()
        }
      });
    }

    // Create notification for user
    await createNotification({
      userId,
      type: 'booking_cancelled',
      title: 'Recurring Booking Canceled',
      message: cancelImmediately
        ? `Your recurring booking for ${subscription.field.name} has been canceled immediately.`
        : `Your recurring booking for ${subscription.field.name} will be canceled at the end of the current period.`,
      metadata: {
        subscriptionId,
        fieldId: subscription.fieldId,
        cancelType: cancelImmediately ? 'immediate' : 'period_end'
      }
    });

    // Create notification for field owner
    await createNotification({
      userId: subscription.field.ownerId,
      type: 'booking_cancelled',
      title: 'Recurring Booking Canceled',
      message: cancelImmediately
        ? `A recurring booking for ${subscription.field.name} has been canceled.`
        : `A recurring booking for ${subscription.field.name} will end after the current period.`,
      metadata: {
        subscriptionId,
        fieldId: subscription.fieldId,
        cancelType: cancelImmediately ? 'immediate' : 'period_end'
      }
    });

    res.json({
      success: true,
      message: cancelImmediately
        ? 'Recurring booking canceled immediately'
        : 'Recurring booking will be canceled at the end of the current period',
      data: updatedSubscription
    });
  });

  // Get cancelled bookings for field owners
  getCancelledBookings = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;
    const { page = 1, limit = 10 } = req.query;

    // Only field owners can access this endpoint
    if (userRole !== 'FIELD_OWNER') {
      throw new AppError('Only field owners can access cancelled bookings', 403);
    }

    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;

    // Get all fields owned by this user
    const fields = await prisma.field.findMany({
      where: { ownerId: userId },
      select: { id: true },
    });

    if (fields.length === 0) {
      return res.json({
        success: true,
        data: [],
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPrevPage: false,
        },
      });
    }

    // Get cancelled bookings for these fields
    const whereClause = {
      fieldId: { in: fields.map(f => f.id) },
      status: 'CANCELLED'
    };

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where: whereClause,
        skip,
        take: limitNum,
        include: {
          field: {
            include: {
              owner: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              image: true,
              googleImage: true,
            },
          },
        },
        orderBy: {
          updatedAt: 'desc', // Show most recently cancelled first
        },
      }),
      prisma.booking.count({ where: whereClause }),
    ]);

    const totalPages = Math.ceil(total / limitNum);

    // Format bookings to match field owner booking format
    const formattedBookings = bookings.map(booking => ({
      id: booking.id,
      userId: booking.userId,
      userName: booking.user?.name || 'Unknown',
      userAvatar: booking.user?.image || booking.user?.googleImage || null,
      userEmail: booking.user?.email || '',
      userPhone: booking.user?.phone || '',
      time: `${booking.startTime} - ${booking.endTime}`,
      orderId: `#${booking.id.slice(-6).toUpperCase()}`, // Use last 6 chars for uniqueness (matches admin panel format)
      status: booking.status.toLowerCase(),
      frequency: booking.repeatBooking && booking.repeatBooking.toLowerCase() !== 'none' ? booking.repeatBooking : null,
      dogs: booking.numberOfDogs || 1,
      amount: booking.totalPrice || 0,
      date: booking.date,
      fieldName: booking.field?.name || '',
      fieldAddress: booking.field?.address || '',
      notes: booking.notes || '',
      startTime: booking.startTime,
      endTime: booking.endTime,
      field: booking.field,
      user: booking.user,
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt,
    }));

    res.json({
      success: true,
      data: formattedBookings,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
    });
  });

  // Helper function to convert time string to minutes (handles both 12-hour and 24-hour formats)
  private timeToMinutes(time: string): number {
    // Handle 12-hour format (e.g., "2:15AM", "11:30PM")
    const ampmMatch = time.match(/(\d+):(\d+)(AM|PM)/i);
    if (ampmMatch) {
      let hours = parseInt(ampmMatch[1]);
      const minutes = parseInt(ampmMatch[2]);
      const period = ampmMatch[3].toUpperCase();

      // Convert to 24-hour format
      if (period === 'PM' && hours !== 12) {
        hours += 12;
      } else if (period === 'AM' && hours === 12) {
        hours = 0;
      }

      return hours * 60 + minutes;
    }

    // Handle 24-hour format (e.g., "14:00", "09:30")
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  // Check if user has completed bookings for a specific field
  hasCompletedBookingsForField = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;
    const { fieldId } = req.params;

    if (!fieldId) {
      return res.status(400).json({
        success: false,
        message: 'Field ID is required'
      });
    }

    // Check if user has at least one completed booking for this field
    const completedBooking = await Booking.findOne({
      userId: userId,
      fieldId: fieldId,
      status: 'COMPLETED'
    });

    return res.status(200).json({
      success: true,
      hasCompletedBooking: !!completedBooking,
      data: {
        canReview: !!completedBooking
      }
    });
  });

  // Check if specific selected slots are available
  // This is a lightweight check for validating selected slots before payment
  checkSelectedSlotsAvailability = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { fieldId, date, slots, duration } = req.body;

    // Validate required fields
    if (!fieldId) {
      return res.status(400).json({
        available: false,
        message: 'Field ID is required'
      });
    }

    if (!date) {
      return res.status(400).json({
        available: false,
        message: 'Date is required'
      });
    }

    if (!slots || !Array.isArray(slots) || slots.length === 0) {
      return res.status(400).json({
        available: false,
        message: 'At least one time slot is required'
      });
    }

    // Get field details - support both ObjectID and human-readable fieldId
    const field = await resolveField(fieldId);

    if (!field) {
      return res.status(404).json({
        available: false,
        message: 'Field not found'
      });
    }

    // Parse the date
    const selectedDate = new Date(date);
    const startOfDayDate = new Date(selectedDate);
    startOfDayDate.setHours(0, 0, 0, 0);
    const endOfDayDate = new Date(selectedDate);
    endOfDayDate.setHours(23, 59, 59, 999);

    // Get all bookings for this field on the selected date (excluding cancelled)
    const existingBookings = await prisma.booking.findMany({
      where: {
        fieldId: field.id,
        date: {
          gte: startOfDayDate,
          lte: endOfDayDate
        },
        status: {
          notIn: ['CANCELLED']
        }
      },
      select: {
        startTime: true,
        endTime: true,
        timeSlot: true,
        subscriptionId: true
      }
    });

    // Get all active subscriptions for recurring booking checks
    const activeSubscriptions = await prisma.subscription.findMany({
      where: {
        fieldId: field.id,
        status: 'active',
        cancelAtPeriodEnd: false
      },
      select: {
        id: true,
        interval: true,
        dayOfWeek: true,
        dayOfMonth: true,
        timeSlot: true,
        startTime: true,
        endTime: true
      }
    });

    // Helper to convert time string to minutes
    const timeStringToMinutes = (time: string): number => {
      if (time.includes('AM') || time.includes('PM')) {
        const match = time.match(/(\d+):(\d+)(AM|PM)/i);
        if (match) {
          let hours = parseInt(match[1]);
          const minutes = parseInt(match[2]);
          const period = match[3].toUpperCase();
          if (period === 'PM' && hours !== 12) hours += 12;
          if (period === 'AM' && hours === 12) hours = 0;
          return hours * 60 + minutes;
        }
      }
      const [hours, mins] = time.split(':').map(Number);
      return hours * 60 + (mins || 0);
    };

    // Filter subscriptions that apply to the selected date
    const recurringSubscriptions: Array<{ startMinutes: number; endMinutes: number }> = [];

    for (const subscription of activeSubscriptions) {
      let isRecurringDay = false;

      if (subscription.interval === 'everyday') {
        isRecurringDay = true;
      } else if (subscription.interval === 'weekly') {
        const selectedDayOfWeek = selectedDate.toLocaleDateString('en-US', { weekday: 'long' });
        if (subscription.dayOfWeek && selectedDayOfWeek.toLowerCase() === subscription.dayOfWeek.toLowerCase()) {
          isRecurringDay = true;
        }
      } else if (subscription.interval === 'monthly') {
        if (subscription.dayOfMonth && selectedDate.getDate() === subscription.dayOfMonth) {
          isRecurringDay = true;
        }
      }

      if (isRecurringDay && subscription.startTime && subscription.endTime) {
        // Check if booking doesn't already exist for this subscription
        const hasExistingBooking = existingBookings.some(b =>
          b.subscriptionId === subscription.id
        );

        if (!hasExistingBooking) {
          recurringSubscriptions.push({
            startMinutes: timeStringToMinutes(subscription.startTime),
            endMinutes: timeStringToMinutes(subscription.endTime)
          });
        }
      }
    }

    // Determine actual slot duration
    const effectiveDuration = duration || field.bookingDuration || '1hour';
    const actualDurationMinutes = effectiveDuration === '30min' ? 30 : 60;

    // Check each selected slot
    const unavailableSlots: string[] = [];

    for (const slot of slots) {
      // Parse slot time - format is "HH:MMAM/PM - HH:MMAM/PM" (display time with 5-min buffer)
      const [slotStart] = slot.split(' - ').map((t: string) => t.trim());
      const slotStartMinutes = timeStringToMinutes(slotStart);
      // Use actual duration (30 or 60 min) for overlap checking, not display duration
      const slotEndMinutes = slotStartMinutes + actualDurationMinutes;

      // Check for overlap with existing bookings
      let isUnavailable = false;

      for (const booking of existingBookings) {
        const bookingStartMinutes = timeStringToMinutes(booking.startTime);
        const bookingEndMinutes = timeStringToMinutes(booking.endTime);

        // Check for overlap
        const hasOverlap =
          (slotStartMinutes >= bookingStartMinutes && slotStartMinutes < bookingEndMinutes) ||
          (slotEndMinutes > bookingStartMinutes && slotEndMinutes <= bookingEndMinutes) ||
          (slotStartMinutes <= bookingStartMinutes && slotEndMinutes >= bookingEndMinutes);

        if (hasOverlap) {
          isUnavailable = true;
          break;
        }
      }

      // Check for overlap with recurring subscriptions
      if (!isUnavailable) {
        for (const recurring of recurringSubscriptions) {
          const hasOverlap =
            (slotStartMinutes >= recurring.startMinutes && slotStartMinutes < recurring.endMinutes) ||
            (slotEndMinutes > recurring.startMinutes && slotEndMinutes <= recurring.endMinutes) ||
            (slotStartMinutes <= recurring.startMinutes && slotEndMinutes >= recurring.endMinutes);

          if (hasOverlap) {
            isUnavailable = true;
            break;
          }
        }
      }

      if (isUnavailable) {
        unavailableSlots.push(slot);
      }
    }

    // Prevent caching
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    if (unavailableSlots.length > 0) {
      return res.status(200).json({
        available: false,
        message: unavailableSlots.length === 1
          ? `The slot ${unavailableSlots[0]} is no longer available. Another user has already booked it.`
          : `${unavailableSlots.length} slots are no longer available. Another user has already booked them.`,
        unavailableSlots
      });
    }

    return res.status(200).json({
      available: true,
      message: 'All selected slots are available'
    });
  });
}

export default new BookingController();
