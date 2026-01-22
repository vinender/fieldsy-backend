//@ts-nocheck
import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import prisma from '../config/database';
import { automaticPayoutService } from '../services/auto-payout.service';
import { payoutService } from '../services/payout.service';

class EarningsController {
  /**
   * Get comprehensive earnings dashboard for field owner
   */
  getEarningsDashboard = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;
    
    if (userRole !== 'FIELD_OWNER' && userRole !== 'ADMIN') {
      throw new AppError('Only field owners can view earnings dashboard', 403);
    }

    // Get all fields for this owner
    const userFields = await prisma.field.findMany({
      where: { ownerId: userId },
      select: { id: true, name: true }
    });

    if (userFields.length === 0) {
      return res.json({
        success: true,
        data: {
          totalEarnings: 0,
          pendingPayouts: 0,
          completedPayouts: 0,
          upcomingPayouts: 0,
          todayEarnings: 0,
          weekEarnings: 0,
          monthEarnings: 0,
          yearEarnings: 0,
          recentPayouts: [],
          bookingsInCancellationWindow: [],
          fieldEarnings: []
        }
      });
    } 

    const fieldIds = userFields.map(f => f.id);
    const now = new Date();
    
    // Calculate date ranges
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    // Get Stripe account first to fetch payouts
    const stripeAccount = await prisma.stripeAccount.findUnique({
      where: { userId }
    });

    // Get successful payouts for total earnings calculation
    let totalEarningsFromPayouts = 0;
    let allSuccessfulPayouts: any[] = [];
    let todayPayouts: any[] = [];
    let weekPayouts: any[] = [];
    let monthPayouts: any[] = [];
    let yearPayouts: any[] = [];
    
    if (stripeAccount) {
      // Get all successful payouts
      allSuccessfulPayouts = await prisma.payout.findMany({
        where: {
          stripeAccountId: stripeAccount.id,
          status: { in: ['paid', 'PAID', 'completed', 'COMPLETED'] }
        }
      });
      
      // Calculate total earnings from successful payouts
      totalEarningsFromPayouts = allSuccessfulPayouts.reduce((sum, payout) => sum + payout.amount, 0);
      
      // Filter payouts by date ranges
      todayPayouts = allSuccessfulPayouts.filter(p => new Date(p.createdAt) >= startOfDay);
      weekPayouts = allSuccessfulPayouts.filter(p => new Date(p.createdAt) >= startOfWeek);
      monthPayouts = allSuccessfulPayouts.filter(p => new Date(p.createdAt) >= startOfMonth);
      yearPayouts = allSuccessfulPayouts.filter(p => new Date(p.createdAt) >= startOfYear);
    }

    // Get all bookings for other calculations
    const [
      allBookings,
      completedPayoutBookings,
      pendingPayoutBookings
    ] = await Promise.all([
      // All confirmed bookings (for field earnings breakdown)
      prisma.booking.findMany({
        where: {
          fieldId: { in: fieldIds },
          status: { in: ['CONFIRMED', 'COMPLETED'] },
          paymentStatus: 'PAID'
        },
        include: {
          field: { select: { name: true } },
          user: { select: { name: true, email: true } }
        }
      }),
      
      // Bookings with completed payouts
      prisma.booking.findMany({
        where: {
          fieldId: { in: fieldIds },
          payoutStatus: 'COMPLETED'
        }
      }),
      
      // Pending payouts
      prisma.booking.findMany({
        where: {
          fieldId: { in: fieldIds },
          status: 'CONFIRMED',
          paymentStatus: 'PAID',
          OR: [
            { payoutStatus: null },
            { payoutStatus: { in: ['PENDING', 'PROCESSING'] } }
          ]
        },
        include: {
          field: { select: { name: true } },
          user: { select: { name: true, email: true } }
        }
      })
    ]);

    // Calculate earnings from bookings (for pending amounts)
    const calculateBookingEarnings = async (bookings: any[]) => {
      // Calculate earnings - use stored fieldOwnerAmount or fallback to calculation
      const { calculatePayoutAmounts } = require('../utils/commission.utils');
      let sum = 0;
      for (const b of bookings) {
        if (b.fieldOwnerAmount) {
          sum += b.fieldOwnerAmount;
        } else {
          const calc = await calculatePayoutAmounts(b.totalPrice, userId);
          sum += calc.fieldOwnerAmount;
        }
      }
      return sum;
    };

    // Use payout amounts for period earnings
    const totalEarnings = totalEarningsFromPayouts;
    const todayEarnings = todayPayouts.reduce((sum, p) => sum + p.amount, 0);
    const weekEarnings = weekPayouts.reduce((sum, p) => sum + p.amount, 0);
    const monthEarnings = monthPayouts.reduce((sum, p) => sum + p.amount, 0);
    const yearEarnings = yearPayouts.reduce((sum, p) => sum + p.amount, 0);
    const completedPayoutAmount = await calculateBookingEarnings(completedPayoutBookings);
    
    // Get payout summary
    const payoutSummary = await automaticPayoutService.getPayoutSummary(userId);
    
    // Get recent payouts
    let recentPayouts: any[] = [];
    if (stripeAccount) {
      const payouts = await prisma.payout.findMany({
        where: { stripeAccountId: stripeAccount.id },
        orderBy: { createdAt: 'desc' },
        take: 10
      });
      
      // Enhance with booking details
      recentPayouts = await Promise.all(
        payouts.map(async (payout) => {
          const bookings = await prisma.booking.findMany({
            where: { id: { in: payout.bookingIds } },
            include: {
              field: { select: { name: true } },
              user: { select: { name: true, email: true } }
            }
          });
          
          return {
            id: payout.id,
            amount: payout.amount,
            status: payout.status,
            createdAt: payout.createdAt,
            arrivalDate: payout.arrivalDate,
            bookings: bookings.map(b => ({
              id: b.id,
              fieldName: b.field.name,
              customerName: b.user.name || b.user.email,
              date: b.date,
              amount: b.fieldOwnerAmount || (b.totalPrice * 0.8) // Field owner gets ~80% (platform takes ~20% commission)
            }))
          };
        })
      );
    }
    
    // Calculate earnings by field (based on successful payouts)
    const fieldEarnings = await Promise.all(
      userFields.map(async field => {
        const fieldBookings = allBookings.filter(b => b.fieldId === field.id);
        const bookingCount = fieldBookings.length;
        
        // Get successful payouts for this specific field
        let fieldPayoutTotal = 0;
        if (stripeAccount) {
          // Get booking IDs for this field that have completed payouts
          const completedFieldBookings = await prisma.booking.findMany({
            where: {
              fieldId: field.id,
              payoutStatus: 'COMPLETED'
            },
            select: { id: true }
          });
          
          const completedBookingIds = completedFieldBookings.map(b => b.id);
          
          // Get payouts that include these bookings
          const fieldPayouts = await prisma.payout.findMany({
            where: {
              stripeAccountId: stripeAccount.id,
              status: { in: ['paid', 'PAID', 'completed', 'COMPLETED'] },
              bookingIds: {
                hasSome: completedBookingIds
              }
            }
          });
          
          // Sum up the payout amounts for this field
          // Note: This is approximate as payouts can contain multiple bookings
          fieldPayoutTotal = fieldPayouts.reduce((sum, payout) => {
            // Calculate portion of payout for this field
            const payoutBookingCount = payout.bookingIds.length;
            const fieldBookingCount = payout.bookingIds.filter(id => 
              completedBookingIds.includes(id)
            ).length;
            const portion = payoutBookingCount > 0 ? (fieldBookingCount / payoutBookingCount) : 0;
            return sum + (payout.amount * portion);
          }, 0);
        }
        
        return {
          fieldId: field.id,
          fieldName: field.name,
          totalEarnings: fieldPayoutTotal,
          totalBookings: bookingCount,
          averageEarning: bookingCount > 0 ? fieldPayoutTotal / bookingCount : 0
        };
      })
    );
    
    // Get upcoming earnings (bookings in cancellation window)
    const upcomingEarnings = payoutSummary.bookingsInCancellationWindow.map(b => ({
      ...b,
      hoursUntilPayout: Math.max(0, Math.floor((new Date(b.payoutAvailableAt).getTime() - now.getTime()) / (1000 * 60 * 60)))
    }));

    // Get held payouts summary (payouts awaiting Stripe account or other conditions)
    const heldBookings = await prisma.booking.findMany({
      where: {
        fieldId: { in: fieldIds },
        payoutStatus: 'HELD',
        payoutHeldReason: { in: ['NO_STRIPE_ACCOUNT', 'WITHIN_CANCELLATION_WINDOW', 'WAITING_FOR_WEEKEND'] },
        status: { in: ['CONFIRMED', 'COMPLETED'] },
        paymentStatus: 'PAID'
      }
    });

    const heldAmount = await calculateBookingEarnings(heldBookings);

    res.json({
      success: true,
      data: {
        // Total earnings overview
        totalEarnings,
        pendingPayouts: payoutSummary.pendingPayouts,
        completedPayouts: completedPayoutAmount,
        upcomingPayouts: payoutSummary.upcomingPayouts,
        heldPayouts: heldAmount, // ✅ New field
        heldBookingsCount: heldBookings.length, // ✅ New field

        // Period-based earnings
        todayEarnings,
        weekEarnings,
        monthEarnings,
        yearEarnings,

        // Recent payouts
        recentPayouts,

        // Upcoming earnings (in cancellation window)
        upcomingEarnings,

        // Earnings by field
        fieldEarnings,

        // Stripe account status
        hasStripeAccount: !!stripeAccount,
        stripeAccountComplete: stripeAccount ? (stripeAccount.chargesEnabled && stripeAccount.payoutsEnabled) : false
      }
    });
  });

  /**
   * Get detailed payout history with pagination
   */
  getPayoutHistory = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;
    const { page = 1, limit = 20, status, startDate, endDate } = req.query;
    
    if (userRole !== 'FIELD_OWNER' && userRole !== 'ADMIN') {
      throw new AppError('Only field owners can view payout history', 403);
    }

    const pageNum = Number(page);
    const limitNum = Number(limit);
    
    // Get Stripe account
    const stripeAccount = await prisma.stripeAccount.findUnique({
      where: { userId }
    });
    
    if (!stripeAccount) {
      return res.json({
        success: true,
        data: {
          payouts: [],
          total: 0,
          page: pageNum,
          limit: limitNum,
          totalPages: 0
        }
      });
    }
    
    // Build where clause
    const whereClause: any = { stripeAccountId: stripeAccount.id };
    
    if (status) {
      whereClause.status = status as string;
    }
    
    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) {
        whereClause.createdAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        whereClause.createdAt.lte = new Date(endDate as string);
      }
    }
    
    // Get paginated payouts
    const skip = (pageNum - 1) * limitNum;
    
    const [payouts, total] = await Promise.all([
      prisma.payout.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum
      }),
      prisma.payout.count({ where: whereClause })
    ]);
    
    // Enhance payouts with booking details
    const enhancedPayouts = await Promise.all(
      payouts.map(async (payout) => {
        const bookings = await prisma.booking.findMany({
          where: { id: { in: payout.bookingIds } },
          include: {
            field: { select: { name: true } },
            user: { select: { name: true, email: true } }
          }
        });

        // Get the first booking's details for display (most payouts have 1 booking)
        const firstBooking = bookings[0];
        const fieldName = firstBooking?.field?.name || null;
        const customerName = bookings.length === 1
          ? (firstBooking?.user?.name || firstBooking?.user?.email || null)
          : bookings.length > 1
            ? `${bookings.length} bookings`
            : null;
        // Use human-readable bookingId if available
        const humanReadableBookingId = firstBooking?.bookingId || null;

        return {
          id: payout.id,
          stripePayoutId: payout.stripePayoutId,
          amount: payout.amount,
          currency: payout.currency,
          status: payout.status,
          method: payout.method,
          description: payout.description,
          arrivalDate: payout.arrivalDate,
          createdAt: payout.createdAt,
          bookingCount: bookings.length,
          // Top-level booking info for easy display
          fieldName,
          customerName,
          humanReadableBookingId,
          bookings: bookings.map(b => ({
            id: b.id,
            bookingId: b.bookingId, // Human-readable booking ID
            fieldName: b.field.name,
            customerName: b.user.name || b.user.email,
            date: b.date,
            time: `${b.startTime} - ${b.endTime}`,
            amount: b.fieldOwnerAmount || (b.totalPrice * 0.8), // Field owner gets ~80% (platform takes ~20% commission)
            status: b.status
          }))
        };
      })
    );
    
    res.json({
      success: true,
      data: {
        payouts: enhancedPayouts,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  });

  /**
   * Get held/pending payouts summary for field owners without Stripe Connect
   */
  getHeldPayouts = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;

    if (userRole !== 'FIELD_OWNER' && userRole !== 'ADMIN') {
      throw new AppError('Only field owners can view held payouts', 403);
    }

    // Get all fields owned by this user
    const userFields = await prisma.field.findMany({
      where: { ownerId: userId },
      select: { id: true, name: true }
    });

    if (userFields.length === 0) {
      return res.json({
        success: true,
        data: {
          totalHeldAmount: 0,
          heldBookingsCount: 0,
          heldBookings: [],
          hasStripeAccount: false,
          requiresAction: true,
          message: 'Connect your bank account to receive payments'
        }
      });
    }

    const fieldIds = userFields.map(f => f.id);

    // Check Stripe account status
    const stripeAccount = await prisma.stripeAccount.findUnique({
      where: { userId }
    });

    const hasStripeAccount = !!stripeAccount;
    const stripeAccountFullyEnabled = stripeAccount?.chargesEnabled && stripeAccount?.payoutsEnabled;

    // Get all held bookings (payouts waiting for Stripe account connection)
    const heldBookings = await prisma.booking.findMany({
      where: {
        fieldId: { in: fieldIds },
        payoutStatus: 'HELD',
        payoutHeldReason: { in: ['NO_STRIPE_ACCOUNT', 'WITHIN_CANCELLATION_WINDOW', 'WAITING_FOR_WEEKEND'] },
        status: { in: ['CONFIRMED', 'COMPLETED'] },
        paymentStatus: 'PAID'
      },
      include: {
        field: { select: { name: true, id: true } },
        user: { select: { name: true, email: true } }
      },
      orderBy: { date: 'desc' }
    });

    // Calculate total held amount
    const { calculatePayoutAmounts } = require('../utils/commission.utils');

    const enhancedHeldBookings = await Promise.all(
      heldBookings.map(async (booking) => {
        let fieldOwnerAmount = booking.fieldOwnerAmount;
        if (!fieldOwnerAmount) {
          const calc = await calculatePayoutAmounts(booking.totalPrice, userId);
          fieldOwnerAmount = calc.fieldOwnerAmount;
        }

        return {
          id: booking.id,
          fieldId: booking.fieldId,
          fieldName: booking.field.name,
          customerName: booking.user.name || booking.user.email,
          date: booking.date,
          startTime: booking.startTime,
          endTime: booking.endTime,
          totalPrice: booking.totalPrice,
          fieldOwnerAmount,
          platformCommission: booking.platformCommission,
          payoutHeldReason: booking.payoutHeldReason,
          status: booking.status,
          createdAt: booking.createdAt
        };
      })
    );

    const totalHeldAmount = enhancedHeldBookings.reduce((sum, booking) => sum + booking.fieldOwnerAmount, 0);

    // Group by held reason for better clarity
    const heldByReason = {
      NO_STRIPE_ACCOUNT: enhancedHeldBookings.filter(b => b.payoutHeldReason === 'NO_STRIPE_ACCOUNT'),
      WITHIN_CANCELLATION_WINDOW: enhancedHeldBookings.filter(b => b.payoutHeldReason === 'WITHIN_CANCELLATION_WINDOW'),
      WAITING_FOR_WEEKEND: enhancedHeldBookings.filter(b => b.payoutHeldReason === 'WAITING_FOR_WEEKEND')
    };

    // Determine action required message
    let requiresAction = false;
    let actionMessage = '';

    if (!hasStripeAccount) {
      requiresAction = true;
      actionMessage = 'Connect your bank account to receive your pending payments';
    } else if (!stripeAccountFullyEnabled) {
      requiresAction = true;
      actionMessage = 'Complete your bank account setup to unlock your pending payments';
    } else if (heldByReason.NO_STRIPE_ACCOUNT.length > 0) {
      // This shouldn't happen if account is fully enabled, but just in case
      requiresAction = true;
      actionMessage = 'Some payments require manual review';
    } else {
      actionMessage = heldBookings.length > 0
        ? 'Payments are held per your payout schedule settings'
        : 'No pending payments awaiting release';
    }

    res.json({
      success: true,
      data: {
        totalHeldAmount,
        heldBookingsCount: heldBookings.length,
        heldBookings: enhancedHeldBookings,
        heldByReason: {
          noStripeAccount: {
            count: heldByReason.NO_STRIPE_ACCOUNT.length,
            amount: heldByReason.NO_STRIPE_ACCOUNT.reduce((sum, b) => sum + b.fieldOwnerAmount, 0)
          },
          withinCancellationWindow: {
            count: heldByReason.WITHIN_CANCELLATION_WINDOW.length,
            amount: heldByReason.WITHIN_CANCELLATION_WINDOW.reduce((sum, b) => sum + b.fieldOwnerAmount, 0)
          },
          waitingForWeekend: {
            count: heldByReason.WAITING_FOR_WEEKEND.length,
            amount: heldByReason.WAITING_FOR_WEEKEND.reduce((sum, b) => sum + b.fieldOwnerAmount, 0)
          }
        },
        hasStripeAccount,
        stripeAccountFullyEnabled,
        requiresAction,
        actionMessage
      }
    });
  });

  /**
   * Export payout history as CSV
   */
  exportPayoutHistory = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;
    const { startDate, endDate } = req.query;
    
    if (userRole !== 'FIELD_OWNER' && userRole !== 'ADMIN') {
      throw new AppError('Only field owners can export payout history', 403);
    }
    
    // Get Stripe account
    const stripeAccount = await prisma.stripeAccount.findUnique({
      where: { userId }
    });
    
    if (!stripeAccount) {
      throw new AppError('No Stripe account found', 404);
    }
    
    // Build where clause
    const whereClause: any = { stripeAccountId: stripeAccount.id };
    
    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) {
        whereClause.createdAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        whereClause.createdAt.lte = new Date(endDate as string);
      }
    }
    
    // Get all payouts
    const payouts = await prisma.payout.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' }
    });
    
    // Create CSV content
    const csvHeader = 'Date,Payout ID,Amount,Currency,Status,Method,Description,Arrival Date,Booking Count\n';
    
    const csvRows = await Promise.all(
      payouts.map(async (payout) => {
        const bookingCount = payout.bookingIds.length;
        return `${payout.createdAt.toISOString()},${payout.stripePayoutId || 'N/A'},${payout.amount},${payout.currency},${payout.status},${payout.method},${payout.description || 'N/A'},${payout.arrivalDate?.toISOString() || 'N/A'},${bookingCount}`;
      })
    );
    
    const csvContent = csvHeader + csvRows.join('\n');
    
    // Set headers for file download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="payouts_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvContent);
  });

  /**
   * Sync payouts from Stripe to database
   * Admin or Field Owner can trigger this to fetch missing payouts
   */
  syncPayoutsFromStripe = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;

    // Get Stripe account
    const stripeAccount = await prisma.stripeAccount.findUnique({
      where: { userId }
    });

    if (!stripeAccount) {
      throw new AppError('No Stripe account found. Please connect your Stripe account first.', 404);
    }

    try {
      const stripe = require('../config/stripe.config').stripe;

      // Fetch payouts from Stripe for this connected account
      const stripePayouts = await stripe.payouts.list(
        {
          limit: 100 // Fetch up to 100 recent payouts
        },
        {
          stripeAccount: stripeAccount.stripeAccountId
        }
      );

      let syncedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;

      for (const stripePayout of stripePayouts.data) {
        // Check if payout already exists
        const existingPayout = await prisma.payout.findUnique({
          where: { stripePayoutId: stripePayout.id }
        });

        const payoutData = {
          amount: (stripePayout.amount || 0) / 100, // Convert from cents to dollars
          currency: stripePayout.currency || 'gbp',
          status: stripePayout.status,
          method: stripePayout.method || 'standard',
          description: stripePayout.description || null,
          arrivalDate: stripePayout.arrival_date ? new Date(stripePayout.arrival_date * 1000) : null,
          failureCode: stripePayout.failure_code || null,
          failureMessage: stripePayout.failure_message || null,
          bookingIds: [] // Will be empty for manual sync, webhooks populate this
        };

        if (existingPayout) {
          // Update existing payout
          await prisma.payout.update({
            where: { id: existingPayout.id },
            data: payoutData
          });
          updatedCount++;
        } else {
          // Create new payout record
          await prisma.payout.create({
            data: {
              stripeAccountId: stripeAccount.id,
              stripePayoutId: stripePayout.id,
              ...payoutData
            }
          });
          syncedCount++;
        }
      }

      res.json({
        success: true,
        message: `Successfully synced payouts from Stripe`,
        data: {
          total: stripePayouts.data.length,
          synced: syncedCount,
          updated: updatedCount,
          skipped: skippedCount
        }
      });
    } catch (error) {
      console.error('[SyncPayouts] Error syncing payouts from Stripe:', error);
      throw new AppError('Failed to sync payouts from Stripe. Please try again.', 500);
    }
  });
}

export default new EarningsController();
