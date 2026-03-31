"use strict";
/**
 * Payout Service Provider — feature flag switch.
 *
 * Checks `USE_PAYOUT_ENGINE` env variable:
 *   - "true"  → uses @fieldsy/stripe-auto-payout engine
 *   - "false" / unset → uses the original built-in services
 *
 * All controllers, jobs, and routes should import services from this file
 * instead of importing directly from the engine or original service files.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPayoutEngineEnabled = void 0;
exports.getAutoPayoutService = getAutoPayoutService;
exports.getPayoutService = getPayoutService;
exports.getHeldPayoutService = getHeldPayoutService;
exports.getRefundService = getRefundService;
exports.getSubscriptionService = getSubscriptionService;
exports.getLifecycleService = getLifecycleService;
exports.getPayoutEngine = getPayoutEngine;
exports.isPayoutEngineEnabled = process.env.USE_PAYOUT_ENGINE === 'true';
// Lazy-loaded references (populated on first access)
let _autoPayoutService;
let _payoutService;
let _heldPayoutService;
let _refundService;
let _subscriptionService;
let _lifecycleService;
let _payoutEngine;
function getEngine() {
    if (!_payoutEngine) {
        _payoutEngine = require('./payout-engine').payoutEngine;
    }
    return _payoutEngine;
}
/** AutoPayoutService — processEligiblePayouts(), getMerchantPayoutSummary(), etc. */
function getAutoPayoutService() {
    if (!_autoPayoutService) {
        if (exports.isPayoutEngineEnabled) {
            const engineService = getEngine().autoPayoutService;
            const builtInService = require('../services/auto-payout.service').automaticPayoutService;
            // Engine doesn't expose getPayoutSummary — bridge from built-in service
            if (!engineService.getPayoutSummary) {
                engineService.getPayoutSummary = builtInService.getPayoutSummary.bind(builtInService);
            }
            _autoPayoutService = engineService;
        }
        else {
            _autoPayoutService = require('../services/auto-payout.service').automaticPayoutService;
        }
    }
    return _autoPayoutService;
}
/** PayoutService — processBookingPayout(), processPendingPayouts(), getPayoutHistory() */
function getPayoutService() {
    if (!_payoutService) {
        if (exports.isPayoutEngineEnabled) {
            _payoutService = getEngine().payoutService;
        }
        else {
            _payoutService = require('../services/payout.service').payoutService;
        }
    }
    return _payoutService;
}
/** HeldPayoutService — releaseHeldPayouts(), processScheduledReleases() */
function getHeldPayoutService() {
    if (!_heldPayoutService) {
        if (exports.isPayoutEngineEnabled) {
            _heldPayoutService = getEngine().heldPayoutService;
        }
        else {
            _heldPayoutService = require('../services/held-payout.service').heldPayoutService;
        }
    }
    return _heldPayoutService;
}
/** RefundService — processRefund(), processCompletedBookingPayouts() */
function getRefundService() {
    if (!_refundService) {
        if (exports.isPayoutEngineEnabled) {
            _refundService = getEngine().refundService;
        }
        else {
            const mod = require('../services/refund.service');
            _refundService = mod.default || mod.refundService;
        }
    }
    return _refundService;
}
/** SubscriptionService — createSubscription(), retryFailedPayments(), cancelSubscription() */
function getSubscriptionService() {
    if (!_subscriptionService) {
        if (exports.isPayoutEngineEnabled) {
            const engineService = getEngine().subscriptionService;
            const builtInService = require('../services/subscription.service').subscriptionService;
            // Engine doesn't expose createBookingFromSubscription — bridge from built-in service
            if (!engineService.createBookingFromSubscription) {
                engineService.createBookingFromSubscription = builtInService.createBookingFromSubscription.bind(builtInService);
            }
            _subscriptionService = engineService;
        }
        else {
            _subscriptionService = require('../services/subscription.service').subscriptionService;
        }
    }
    return _subscriptionService;
}
/** TransactionLifecycleService */
function getLifecycleService() {
    if (!_lifecycleService) {
        if (exports.isPayoutEngineEnabled) {
            _lifecycleService = getEngine().lifecycleService;
        }
        else {
            _lifecycleService = require('../services/transaction-lifecycle.service').transactionLifecycleService;
        }
    }
    return _lifecycleService;
}
/**
 * Get the engine instance directly (only available when USE_PAYOUT_ENGINE=true).
 * Used for engine-specific methods like createWebhookRouter(), startScheduler(), processPayoutsNow().
 * Returns null when engine is disabled.
 */
function getPayoutEngine() {
    if (!exports.isPayoutEngineEnabled)
        return null;
    return getEngine();
}
if (exports.isPayoutEngineEnabled) {
    console.log('[PayoutServices] Using @fieldsy/stripe-auto-payout engine');
}
else {
    console.log('[PayoutServices] Using built-in payout services');
}
