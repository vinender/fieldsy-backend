//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "createConnectedAccountPayout", {
    enumerable: true,
    get: function() {
        return createConnectedAccountPayout;
    }
});
const _stripeconfig = require("../config/stripe.config");
async function createConnectedAccountPayout({ stripeAccountId, amountInMinorUnits, currency = 'gbp', metadata = {}, description, method = 'standard' }) {
    const payout = await _stripeconfig.stripe.payouts.create({
        amount: amountInMinorUnits,
        currency,
        metadata,
        description,
        method
    }, {
        stripeAccount: stripeAccountId
    });
    return payout;
}

//# sourceMappingURL=stripe-payout.helper.js.map