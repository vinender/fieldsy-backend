//@ts-nocheck
import { Router } from 'express';
import { protect } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import { getRefundService, getPayoutEngine } from '../config/payout-services';
const refundService = getRefundService();

const router = Router();

// Require admin role for all routes
router.use(protect);
router.use(requireRole('ADMIN'));

// Manually trigger payout processing for testing
router.post('/process-payouts', async (req, res) => {
  try {
    console.log('Manually triggering payout processing...');
    
    // Process completed bookings past cancellation period
    await refundService.processCompletedBookingPayouts();
    
    // Process automatic transfers via engine (if enabled)
    const engine = getPayoutEngine();
    if (engine) await engine.processPayoutsNow();
    
    res.json({
      success: true,
      message: 'Payout processing triggered successfully'
    });
  } catch (error: any) {
    console.error('Manual payout trigger error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to process payouts'
    });
  }
});

// Get payout statistics
router.get('/payout-stats', async (req, res) => {
  try {
    const prisma = (await import('../config/database')).default;
    
    // Get overall statistics
    const [totalPayouts, pendingPayouts, completedPayouts, failedPayouts] = await Promise.all([
      prisma.payout.count(),
      prisma.payout.count({ where: { status: 'pending' } }),
      prisma.payout.count({ where: { status: 'paid' } }),
      prisma.payout.count({ where: { status: 'failed' } })
    ]);

    // Get total amounts
    const [totalAmount, pendingAmount, paidAmount] = await Promise.all([
      prisma.payout.aggregate({
        _sum: { amount: true }
      }),
      prisma.payout.aggregate({
        where: { status: 'pending' },
        _sum: { amount: true }
      }),
      prisma.payout.aggregate({
        where: { status: 'paid' },
        _sum: { amount: true }
      })
    ]);

    // Get bookings awaiting payout
    const bookingsAwaitingPayout = await prisma.booking.count({
      where: {
        status: 'COMPLETED',
        payoutStatus: null,
        date: {
          lte: new Date(Date.now() - 24 * 60 * 60 * 1000) // 24 hours old
        }
      }
    });

    res.json({
      success: true,
      stats: {
        payouts: {
          total: totalPayouts,
          pending: pendingPayouts,
          completed: completedPayouts,
          failed: failedPayouts
        },
        amounts: {
          total: totalAmount._sum.amount || 0,
          pending: pendingAmount._sum.amount || 0,
          paid: paidAmount._sum.amount || 0
        },
        bookingsAwaitingPayout
      }
    });
  } catch (error: any) {
    console.error('Payout stats error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get payout statistics'
    });
  }
});

// Top up Stripe test balance (test mode only)
// POST /api/admin/payouts/topup-balance
// Body: { amount: number } — amount in GBP (e.g., 500 for £500)
router.post('/topup-balance', async (req, res) => {
  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2025-07-30.basil' as any,
    });

    const { amount = 50000 } = req.body; // Default £500
    const amountInPence = Math.round(Number(amount) * 100);

    if (amountInPence < 100) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be at least £1.00',
      });
    }

    // Check current balance before
    const balanceBefore = await stripe.balance.retrieve();
    const availableBefore = balanceBefore.available.find(b => b.currency === 'gbp')?.amount || 0;

    // Create test charge with tok_bypassPending for immediate availability
    const paymentMethod = await stripe.paymentMethods.create({
      type: 'card',
      card: { token: 'tok_bypassPending' },
    });

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInPence,
      currency: 'gbp',
      payment_method: paymentMethod.id,
      confirm: true,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never',
      },
      metadata: {
        purpose: 'admin_balance_topup',
        triggeredBy: (req as any).user?.id || 'admin',
        createdAt: new Date().toISOString(),
      },
      description: `Admin balance top-up: £${(amountInPence / 100).toFixed(2)}`,
    });

    // Wait briefly for balance to update
    await new Promise(resolve => setTimeout(resolve, 1500));

    const balanceAfter = await stripe.balance.retrieve();
    const availableAfter = balanceAfter.available.find(b => b.currency === 'gbp')?.amount || 0;
    const pendingAfter = balanceAfter.pending.find(b => b.currency === 'gbp')?.amount || 0;

    res.json({
      success: true,
      message: `Top-up of £${(amountInPence / 100).toFixed(2)} completed`,
      data: {
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
        amount: amountInPence / 100,
        currency: 'GBP',
        balance: {
          available: availableAfter / 100,
          pending: pendingAfter / 100,
          previousAvailable: availableBefore / 100,
        },
      },
    });
  } catch (error: any) {
    console.error('Balance top-up error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to top up balance',
    });
  }
});

// Check current Stripe platform balance
// GET /api/admin/payouts/balance
router.get('/balance', async (req, res) => {
  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2025-07-30.basil' as any,
    });

    const balance = await stripe.balance.retrieve();

    const gbpAvailable = balance.available.find(b => b.currency === 'gbp');
    const gbpPending = balance.pending.find(b => b.currency === 'gbp');

    res.json({
      success: true,
      data: {
        available: (gbpAvailable?.amount || 0) / 100,
        pending: (gbpPending?.amount || 0) / 100,
        currency: 'GBP',
        raw: {
          available: balance.available,
          pending: balance.pending,
        },
      },
    });
  } catch (error: any) {
    console.error('Balance check error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to check balance',
    });
  }
});

export default router;
