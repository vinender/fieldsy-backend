/**
 * Payout Service Provider — feature flag switch.
 *
 * Checks `USE_PAYOUT_ENGINE` env variable:
 *   - "true"  → uses @fieldsy/stripe-auto-payout engine
 *   - "false" / unset → uses the original built-in services
 *
 * All controllers, jobs, and routes should import services from this file
 * instead of importing directly from the engine or original service files.
 */ "use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get getAutoPayoutService () {
        return getAutoPayoutService;
    },
    get getHeldPayoutService () {
        return getHeldPayoutService;
    },
    get getLifecycleService () {
        return getLifecycleService;
    },
    get getPayoutEngine () {
        return getPayoutEngine;
    },
    get getPayoutService () {
        return getPayoutService;
    },
    get getRefundService () {
        return getRefundService;
    },
    get getSubscriptionService () {
        return getSubscriptionService;
    },
    get isPayoutEngineEnabled () {
        return isPayoutEngineEnabled;
    }
});
const isPayoutEngineEnabled = process.env.USE_PAYOUT_ENGINE === 'true';
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
function getAutoPayoutService() {
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
function getPayoutService() {
    if (!_payoutService) {
        if (isPayoutEngineEnabled) {
            _payoutService = getEngine().payoutService;
        } else {
            _payoutService = require('../services/payout.service').payoutService;
        }
    }
    return _payoutService;
}
function getHeldPayoutService() {
    if (!_heldPayoutService) {
        if (isPayoutEngineEnabled) {
            _heldPayoutService = getEngine().heldPayoutService;
        } else {
            _heldPayoutService = require('../services/held-payout.service').heldPayoutService;
        }
    }
    return _heldPayoutService;
}
function getRefundService() {
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
function getSubscriptionService() {
    if (!_subscriptionService) {
        if (isPayoutEngineEnabled) {
            const engineService = getEngine().subscriptionService;
            const builtInService = require('../services/subscription.service').subscriptionService;
            // Engine doesn't expose createBookingFromSubscription — bridge from built-in service
            if (!engineService.createBookingFromSubscription) {
                engineService.createBookingFromSubscription = builtInService.createBookingFromSubscription.bind(builtInService);
            }
            _subscriptionService = engineService;
        } else {
            _subscriptionService = require('../services/subscription.service').subscriptionService;
        }
    }
    return _subscriptionService;
}
function getLifecycleService() {
    if (!_lifecycleService) {
        if (isPayoutEngineEnabled) {
            _lifecycleService = getEngine().lifecycleService;
        } else {
            _lifecycleService = require('../services/transaction-lifecycle.service').transactionLifecycleService;
        }
    }
    return _lifecycleService;
}
function getPayoutEngine() {
    if (!isPayoutEngineEnabled) return null;
    return getEngine();
}
if (isPayoutEngineEnabled) {
    console.log('[PayoutServices] Using @fieldsy/stripe-auto-payout engine');
} else {
    console.log('[PayoutServices] Using built-in payout services');
}

//# sourceMappingURL=payout-services.js.map