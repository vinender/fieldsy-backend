//@ts-nocheck
"use strict";
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
    get STRIPE_CONNECT_WEBHOOK_SECRET () {
        return STRIPE_CONNECT_WEBHOOK_SECRET;
    },
    get STRIPE_PAYMENT_WEBHOOK_SECRET () {
        return STRIPE_PAYMENT_WEBHOOK_SECRET;
    },
    get STRIPE_PAYOUT_WEBHOOK_SECRET () {
        return STRIPE_PAYOUT_WEBHOOK_SECRET;
    },
    get STRIPE_REFUND_WEBHOOK_SECRET () {
        return STRIPE_REFUND_WEBHOOK_SECRET;
    },
    get isStripeProduction () {
        return isProduction;
    },
    get stripe () {
        return stripe;
    }
});
const _stripe = /*#__PURE__*/ _interop_require_default(require("stripe"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const isProduction = process.env.STRIPE_PRODUCTION_MODE === 'true';
const STRIPE_SECRET_KEY = isProduction ? process.env.STRIPE_LIVE_SECRET_KEY : process.env.STRIPE_TEST_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
    throw new Error(`STRIPE_${isProduction ? 'LIVE' : 'TEST'}_SECRET_KEY is not defined in environment variables`);
}
const stripe = new _stripe.default(STRIPE_SECRET_KEY, {
    apiVersion: '2025-07-30.basil',
    typescript: true
});
const STRIPE_PAYMENT_WEBHOOK_SECRET = isProduction ? process.env.STRIPE_LIVE_PAYMENT_WEBHOOK_SECRET || '' : process.env.STRIPE_TEST_PAYMENT_WEBHOOK_SECRET || '';
const STRIPE_CONNECT_WEBHOOK_SECRET = isProduction ? process.env.STRIPE_LIVE_CONNECT_WEBHOOK_SECRET || '' : process.env.STRIPE_TEST_CONNECT_WEBHOOK_SECRET || '';
const STRIPE_PAYOUT_WEBHOOK_SECRET = isProduction ? process.env.STRIPE_LIVE_PAYOUT_WEBHOOK_SECRET || '' : process.env.STRIPE_TEST_PAYOUT_WEBHOOK_SECRET || '';
const STRIPE_REFUND_WEBHOOK_SECRET = isProduction ? process.env.STRIPE_LIVE_REFUND_WEBHOOK_SECRET || '' : process.env.STRIPE_TEST_REFUND_WEBHOOK_SECRET || '';

//# sourceMappingURL=stripe.config.js.map