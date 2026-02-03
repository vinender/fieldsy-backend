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

export const isPayoutEngineEnabled =
  process.env.USE_PAYOUT_ENGINE === 'true';

// Lazy-loaded references (populated on first access)
let _autoPayoutService: any;
let _payoutService: any;
let _heldPayoutService: any;
let _refundService: any;
let _subscriptionService: any;
let _lifecycleService: any;
let _payoutEngine: any;

function getEngine() {
  if (!_payoutEngine) {
    _payoutEngine = require('./payout-engine').payoutEngine;
  }
  return _payoutEngine;
}

/** AutoPayoutService — processEligiblePayouts(), getMerchantPayoutSummary(), etc. */
export function getAutoPayoutService() {
  if (!_autoPayoutService) {
    if (isPayoutEngineEnabled) {
      const engineService = getEngine().autoPayoutService;
      const builtInService = require('../services/auto-payout.service').automaticPayoutService;
      // Engine doesn't expose getPayoutSummary — bridge from built-in service
      if (!engineService.getPayoutSummary) {
        engineService.getPayoutSummary = builtInService.getPayoutSummary.bind(builtInService);
      }
      _autoPayoutService = engineService;
    } else {
      _autoPayoutService = require('../services/auto-payout.service').automaticPayoutService;
    }
  }
  return _autoPayoutService;
}

/** PayoutService — processBookingPayout(), processPendingPayouts(), getPayoutHistory() */
export function getPayoutService() {
  if (!_payoutService) {
    if (isPayoutEngineEnabled) {
      _payoutService = getEngine().payoutService;
    } else {
      _payoutService = require('../services/payout.service').payoutService;
    }
  }
  return _payoutService;
}

/** HeldPayoutService — releaseHeldPayouts(), processScheduledReleases() */
export function getHeldPayoutService() {
  if (!_heldPayoutService) {
    if (isPayoutEngineEnabled) {
      _heldPayoutService = getEngine().heldPayoutService;
    } else {
      _heldPayoutService = require('../services/held-payout.service').heldPayoutService;
    }
  }
  return _heldPayoutService;
}

/** RefundService — processRefund(), processCompletedBookingPayouts() */
export function getRefundService() {
  if (!_refundService) {
    if (isPayoutEngineEnabled) {
      _refundService = getEngine().refundService;
    } else {
      const mod = require('../services/refund.service');
      _refundService = mod.default || mod.refundService;
    }
  }
  return _refundService;
}

/** SubscriptionService — createSubscription(), retryFailedPayments(), cancelSubscription() */
export function getSubscriptionService() {
  if (!_subscriptionService) {
    if (isPayoutEngineEnabled) {
      _subscriptionService = getEngine().subscriptionService;
    } else {
      _subscriptionService = require('../services/subscription.service').subscriptionService;
    }
  }
  return _subscriptionService;
}

/** TransactionLifecycleService */
export function getLifecycleService() {
  if (!_lifecycleService) {
    if (isPayoutEngineEnabled) {
      _lifecycleService = getEngine().lifecycleService;
    } else {
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
export function getPayoutEngine() {
  if (!isPayoutEngineEnabled) return null;
  return getEngine();
}

if (isPayoutEngineEnabled) {
  console.log('[PayoutServices] Using @fieldsy/stripe-auto-payout engine');
} else {
  console.log('[PayoutServices] Using built-in payout services');
}
