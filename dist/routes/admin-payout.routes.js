//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "default", {
    enumerable: true,
    get: function() {
        return _default;
    }
});
const _express = require("express");
const _authmiddleware = require("../middleware/auth.middleware");
const _rolemiddleware = require("../middleware/role.middleware");
const _payoutservices = require("../config/payout-services");
function _getRequireWildcardCache(nodeInterop) {
    if (typeof WeakMap !== "function") return null;
    var cacheBabelInterop = new WeakMap();
    var cacheNodeInterop = new WeakMap();
    return (_getRequireWildcardCache = function(nodeInterop) {
        return nodeInterop ? cacheNodeInterop : cacheBabelInterop;
    })(nodeInterop);
}
function _interop_require_wildcard(obj, nodeInterop) {
    if (!nodeInterop && obj && obj.__esModule) {
        return obj;
    }
    if (obj === null || typeof obj !== "object" && typeof obj !== "function") {
        return {
            default: obj
        };
    }
    var cache = _getRequireWildcardCache(nodeInterop);
    if (cache && cache.has(obj)) {
        return cache.get(obj);
    }
    var newObj = {
        __proto__: null
    };
    var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for(var key in obj){
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
            var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
            if (desc && (desc.get || desc.set)) {
                Object.defineProperty(newObj, key, desc);
            } else {
                newObj[key] = obj[key];
            }
        }
    }
    newObj.default = obj;
    if (cache) {
        cache.set(obj, newObj);
    }
    return newObj;
}
const refundService = (0, _payoutservices.getRefundService)();
const router = (0, _express.Router)();
// Require admin role for all routes
router.use(_authmiddleware.protect);
router.use((0, _rolemiddleware.requireRole)('ADMIN'));
// Manually trigger payout processing for testing
router.post('/process-payouts', async (req, res)=>{
    try {
        console.log('Manually triggering payout processing...');
        // Process completed bookings past cancellation period
        await refundService.processCompletedBookingPayouts();
        // Process automatic transfers via engine (if enabled)
        const engine = (0, _payoutservices.getPayoutEngine)();
        if (engine) await engine.processPayoutsNow();
        res.json({
            success: true,
            message: 'Payout processing triggered successfully'
        });
    } catch (error) {
        console.error('Manual payout trigger error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to process payouts'
        });
    }
});
// Get payout statistics
router.get('/payout-stats', async (req, res)=>{
    try {
        const prisma = (await Promise.resolve().then(()=>/*#__PURE__*/ _interop_require_wildcard(require("../config/database")))).default;
        // Get overall statistics
        const [totalPayouts, pendingPayouts, completedPayouts, failedPayouts] = await Promise.all([
            prisma.payout.count(),
            prisma.payout.count({
                where: {
                    status: 'pending'
                }
            }),
            prisma.payout.count({
                where: {
                    status: 'paid'
                }
            }),
            prisma.payout.count({
                where: {
                    status: 'failed'
                }
            })
        ]);
        // Get total amounts
        const [totalAmount, pendingAmount, paidAmount] = await Promise.all([
            prisma.payout.aggregate({
                _sum: {
                    amount: true
                }
            }),
            prisma.payout.aggregate({
                where: {
                    status: 'pending'
                },
                _sum: {
                    amount: true
                }
            }),
            prisma.payout.aggregate({
                where: {
                    status: 'paid'
                },
                _sum: {
                    amount: true
                }
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
    } catch (error) {
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
router.post('/topup-balance', async (req, res)=>{
    try {
        const Stripe = (await Promise.resolve().then(()=>/*#__PURE__*/ _interop_require_wildcard(require("stripe")))).default;
        const stripeKey = process.env.STRIPE_PRODUCTION_MODE === 'true' ? process.env.STRIPE_LIVE_SECRET_KEY : process.env.STRIPE_TEST_SECRET_KEY;
        const stripe = new Stripe(stripeKey, {
            apiVersion: '2025-07-30.basil'
        });
        const { amount = 50000 } = req.body; // Default £500
        const amountInPence = Math.round(Number(amount) * 100);
        if (amountInPence < 100) {
            return res.status(400).json({
                success: false,
                error: 'Amount must be at least £1.00'
            });
        }
        // Check current balance before
        const balanceBefore = await stripe.balance.retrieve();
        const availableBefore = balanceBefore.available.find((b)=>b.currency === 'gbp')?.amount || 0;
        // Create test charge with tok_bypassPending for immediate availability
        const paymentMethod = await stripe.paymentMethods.create({
            type: 'card',
            card: {
                token: 'tok_bypassPending'
            }
        });
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amountInPence,
            currency: 'gbp',
            payment_method: paymentMethod.id,
            confirm: true,
            automatic_payment_methods: {
                enabled: true,
                allow_redirects: 'never'
            },
            metadata: {
                purpose: 'admin_balance_topup',
                triggeredBy: req.user?.id || 'admin',
                createdAt: new Date().toISOString()
            },
            description: `Admin balance top-up: £${(amountInPence / 100).toFixed(2)}`
        });
        // Wait briefly for balance to update
        await new Promise((resolve)=>setTimeout(resolve, 1500));
        const balanceAfter = await stripe.balance.retrieve();
        const availableAfter = balanceAfter.available.find((b)=>b.currency === 'gbp')?.amount || 0;
        const pendingAfter = balanceAfter.pending.find((b)=>b.currency === 'gbp')?.amount || 0;
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
                    previousAvailable: availableBefore / 100
                }
            }
        });
    } catch (error) {
        console.error('Balance top-up error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to top up balance'
        });
    }
});
// Check current Stripe platform balance
// GET /api/admin/payouts/balance
router.get('/balance', async (req, res)=>{
    try {
        const Stripe = (await Promise.resolve().then(()=>/*#__PURE__*/ _interop_require_wildcard(require("stripe")))).default;
        const stripeKey = process.env.STRIPE_PRODUCTION_MODE === 'true' ? process.env.STRIPE_LIVE_SECRET_KEY : process.env.STRIPE_TEST_SECRET_KEY;
        const stripe = new Stripe(stripeKey, {
            apiVersion: '2025-07-30.basil'
        });
        const balance = await stripe.balance.retrieve();
        const gbpAvailable = balance.available.find((b)=>b.currency === 'gbp');
        const gbpPending = balance.pending.find((b)=>b.currency === 'gbp');
        res.json({
            success: true,
            data: {
                available: (gbpAvailable?.amount || 0) / 100,
                pending: (gbpPending?.amount || 0) / 100,
                currency: 'GBP',
                raw: {
                    available: balance.available,
                    pending: balance.pending
                }
            }
        });
    } catch (error) {
        console.error('Balance check error:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to check balance'
        });
    }
});
const _default = router;

//# sourceMappingURL=admin-payout.routes.js.map