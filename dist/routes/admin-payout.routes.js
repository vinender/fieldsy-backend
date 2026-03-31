"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = require("express");
const auth_middleware_1 = require("../middleware/auth.middleware");
const role_middleware_1 = require("../middleware/role.middleware");
const payout_services_1 = require("../config/payout-services");
const refundService = (0, payout_services_1.getRefundService)();
const router = (0, express_1.Router)();
// Require admin role for all routes
router.use(auth_middleware_1.protect);
router.use((0, role_middleware_1.requireRole)('ADMIN'));
// Manually trigger payout processing for testing
router.post('/process-payouts', async (req, res) => {
    try {
        console.log('Manually triggering payout processing...');
        // Process completed bookings past cancellation period
        await refundService.processCompletedBookingPayouts();
        // Process automatic transfers via engine (if enabled)
        const engine = (0, payout_services_1.getPayoutEngine)();
        if (engine)
            await engine.processPayoutsNow();
        res.json({
            success: true,
            message: 'Payout processing triggered successfully'
        });
    }
    catch (error) {
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
        const prisma = (await Promise.resolve().then(() => __importStar(require('../config/database')))).default;
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
    }
    catch (error) {
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
        const Stripe = (await Promise.resolve().then(() => __importStar(require('stripe')))).default;
        const stripeKey = (process.env.STRIPE_PRODUCTION_MODE === 'true' ? process.env.STRIPE_LIVE_SECRET_KEY : process.env.STRIPE_TEST_SECRET_KEY);
        const stripe = new Stripe(stripeKey, {
            apiVersion: '2025-07-30.basil',
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
                triggeredBy: req.user?.id || 'admin',
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
    }
    catch (error) {
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
        const Stripe = (await Promise.resolve().then(() => __importStar(require('stripe')))).default;
        const stripeKey = (process.env.STRIPE_PRODUCTION_MODE === 'true' ? process.env.STRIPE_LIVE_SECRET_KEY : process.env.STRIPE_TEST_SECRET_KEY);
        const stripe = new Stripe(stripeKey, {
            apiVersion: '2025-07-30.basil',
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
    }
    catch (error) {
        console.error('Balance check error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to check balance',
        });
    }
});
exports.default = router;
