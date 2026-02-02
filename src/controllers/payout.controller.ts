//@ts-nocheck
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { getPayoutService } from '../config/payout-services';
const payoutService = getPayoutService();

const prisma = new PrismaClient();

// Get field owner's earnings history with pagination
export const getEarningsHistory = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id || (req as any).user.id;
    const { page = 1, limit = 10, status, startDate, endDate } = req.query;
    
    const skip = (Number(page) - 1) * Number(limit);

    // Build query filters
    const where: any = {};

    // Get all fields owned by this user
    const userFields = await prisma.field.findMany({
      where: { ownerId: userId },
      select: { id: true }
    });

    const fieldIds = userFields.map(field => field.id);

    if (fieldIds.length === 0) {
      return res.json({
        transactions: [],
        totalEarnings: 0,
        stats: {
          completed: 0,
          refunded: 0,
          failed: 0
        },
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: 0,
          totalPages: 0
        }
      });
    }

    // Get bookings for these fields including cancelled ones with transfers
    const bookingWhere: any = {
      fieldId: { in: fieldIds },
      OR: [
        { status: 'COMPLETED' },
        { 
          status: 'CANCELLED',
          payoutStatus: { not: null } // Include cancelled bookings that have payouts
        }
      ]
    };

    // Get transactions for these bookings
    const bookings = await prisma.booking.findMany({
      where: bookingWhere,
      select: { id: true }
    });

    const bookingIds = bookings.map(booking => booking.id);

    // Build transaction query
    const transactionWhere: any = {
      bookingId: { in: bookingIds }
    };

    if (status) {
      transactionWhere.status = status;
    }

    if (startDate || endDate) {
      transactionWhere.createdAt = {};
      if (startDate) {
        transactionWhere.createdAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        transactionWhere.createdAt.lte = new Date(endDate as string);
      }
    }

    // Get transactions with pagination
    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where: transactionWhere,
        include: {
          booking: {
            include: {
              field: {
                select: {
                  name: true,
                  address: true
                }
              },
              user: {
                select: {
                  name: true,
                  email: true
                }
              }
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        skip,
        take: Number(limit)
      }),
      prisma.transaction.count({
        where: transactionWhere
      })
    ]);

    // Calculate total earnings and stats
    const allTransactions = await prisma.transaction.findMany({
      where: {
        bookingId: { in: bookingIds },
        status: 'COMPLETED'
      },
      select: {
        amount: true,
        status: true
      }
    });

    const totalEarnings = allTransactions.reduce((sum, t) => sum + t.amount, 0);

    // Get status counts
    const statusCounts = await prisma.transaction.groupBy({
      by: ['status'],
      where: {
        bookingId: { in: bookingIds }
      },
      _count: true
    });

    const stats = {
      completed: statusCounts.find(s => s.status === 'COMPLETED')?._count || 0,
      refunded: statusCounts.find(s => s.status === 'REFUNDED')?._count || 0,
      failed: statusCounts.find(s => s.status === 'FAILED')?._count || 0
    };

    // Format transactions for frontend
    const formattedTransactions = transactions.map(transaction => ({
      id: transaction.id,
      orderId: `#${transaction.id.slice(-6).toUpperCase()}`,
      paymentId: transaction.stripePaymentIntentId || transaction.id,
      date: transaction.createdAt,
      amount: transaction.amount,
      status: transaction.status.toLowerCase(),
      type: transaction.type,
      fieldName: transaction.booking.field.name,
      fieldAddress: transaction.booking.field.address,
      customerName: transaction.booking.user.name,
      customerEmail: transaction.booking.user.email,
      description: transaction.description
    }));

    res.json({
      transactions: formattedTransactions,
      totalEarnings,
      stats,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching earnings history:', error);
    res.status(500).json({ error: 'Failed to fetch earnings history' });
  }
};

// Get earnings summary
export const getEarningsSummary = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id || (req as any).user.id;
    const { period = 'all' } = req.query;

    // Get all fields owned by this user
    const userFields = await prisma.field.findMany({
      where: { ownerId: userId },
      select: { id: true }
    });

    const fieldIds = userFields.map(field => field.id);

    if (fieldIds.length === 0) {
      return res.json({
        totalEarnings: 0,
        currentBalance: 0,
        pendingPayouts: 0,
        lastPayout: null,
        monthlyEarnings: []
      });
    }

    // Get bookings for these fields
    const bookings = await prisma.booking.findMany({
      where: { fieldId: { in: fieldIds } },
      select: { id: true }
    });

    const bookingIds = bookings.map(booking => booking.id);

    // Calculate date range based on period
    let dateFilter = {};
    const now = new Date();
    
    switch (period) {
      case 'week':
        dateFilter = {
          gte: new Date(now.setDate(now.getDate() - 7))
        };
        break;
      case 'month':
        dateFilter = {
          gte: new Date(now.setMonth(now.getMonth() - 1))
        };
        break;
      case 'year':
        dateFilter = {
          gte: new Date(now.setFullYear(now.getFullYear() - 1))
        };
        break;
    }

    // Get completed transactions
    const completedTransactions = await prisma.transaction.findMany({
      where: {
        bookingId: { in: bookingIds },
        status: 'COMPLETED',
        ...(period !== 'all' && { createdAt: dateFilter })
      },
      select: {
        amount: true,
        createdAt: true
      }
    });

    const totalEarnings = completedTransactions.reduce((sum, t) => sum + t.amount, 0);

    // Get pending transactions
    const pendingTransactions = await prisma.transaction.findMany({
      where: {
        bookingId: { in: bookingIds },
        status: 'PENDING'
      },
      select: {
        amount: true
      }
    });

    const pendingPayouts = pendingTransactions.reduce((sum, t) => sum + t.amount, 0);

    // Calculate monthly earnings for chart
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyTransactions = await prisma.transaction.findMany({
      where: {
        bookingId: { in: bookingIds },
        status: 'COMPLETED',
        createdAt: {
          gte: sixMonthsAgo
        }
      },
      select: {
        amount: true,
        createdAt: true
      }
    });

    // Group by month
    const monthlyEarnings = Array.from({ length: 6 }, (_, i) => {
      const date = new Date();
      date.setMonth(date.getMonth() - (5 - i));
      const month = date.toLocaleString('default', { month: 'short' });
      const year = date.getFullYear();
      
      const monthTransactions = monthlyTransactions.filter(t => {
        const tDate = new Date(t.createdAt);
        return tDate.getMonth() === date.getMonth() && tDate.getFullYear() === year;
      });
      
      const amount = monthTransactions.reduce((sum, t) => sum + t.amount, 0);
      
      return {
        month: `${month} ${year}`,
        amount
      };
    });

    res.json({
      totalEarnings,
      currentBalance: totalEarnings - pendingPayouts, // Simplified calculation
      pendingPayouts,
      lastPayout: null, // To be implemented with payout tracking
      monthlyEarnings
    });
  } catch (error) {
    console.error('Error fetching earnings summary:', error);
    res.status(500).json({ error: 'Failed to fetch earnings summary' });
  }
};

// Get transaction details
export const getTransactionDetails = async (req: Request, res: Response) => {
  try {
    const { transactionId } = req.params;
    const userId = (req as any).user._id || (req as any).user.id;

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        booking: {
          include: {
            field: true,
            user: {
              select: {
                name: true,
                email: true,
                phone: true
              }
            }
          }
        }
      }
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Verify the user owns the field
    if (transaction.booking.field.ownerId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(transaction);
  } catch (error) {
    console.error('Error fetching transaction details:', error);
    res.status(500).json({ error: 'Failed to fetch transaction details' });
  }
};

// Process pending payouts for field owner (after Stripe account setup)
export const processPendingPayouts = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id || (req as any).user.id;
    const userRole = (req as any).user.role;

    // Only field owners can process their payouts
    if (userRole !== 'FIELD_OWNER') {
      return res.status(403).json({ error: 'Only field owners can process payouts' });
    }

    const results = await payoutService.processPendingPayouts(userId);
    
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    res.json({
      success: true,
      message: `Processed ${successCount} payouts successfully, ${failedCount} failed`,
      data: {
        processed: successCount,
        failed: failedCount,
        results
      }
    });
  } catch (error) {
    console.error('Error processing pending payouts:', error);
    res.status(500).json({ 
      error: 'Failed to process pending payouts',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Get payout history for field owner
export const getPayoutHistory = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id || (req as any).user.id;
    const { page = 1, limit = 10 } = req.query;

    const payouts = await payoutService.getPayoutHistory(
      userId, 
      Number(page), 
      Number(limit)
    );

    res.json({
      success: true,
      data: payouts
    });
  } catch (error) {
    console.error('Error fetching payout history:', error);
    res.status(500).json({ 
      error: 'Failed to fetch payout history',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// Manually trigger payout for a specific booking (Admin only)
export const triggerBookingPayout = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;
    const userRole = (req as any).user.role;

    // Only admins can manually trigger payouts
    if (userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Only admins can manually trigger payouts' });
    }

    const payout = await payoutService.processBookingPayout(bookingId);

    res.json({
      success: true,
      message: 'Payout triggered successfully',
      data: payout
    });
  } catch (error) {
    console.error('Error triggering payout:', error);
    res.status(500).json({ 
      error: 'Failed to trigger payout',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
