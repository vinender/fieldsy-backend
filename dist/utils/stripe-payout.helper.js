"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createConnectedAccountPayout = createConnectedAccountPayout;
//@ts-nocheck
const stripe_config_1 = require("../config/stripe.config");
/**
 * Helper to create a payout on a connected Stripe account.
 * Returns the Stripe payout object so callers can persist status/arrival details.
 */
async function createConnectedAccountPayout({ stripeAccountId, amountInMinorUnits, currency = 'gbp', metadata = {}, description, method = 'standard', }) {
    const payout = await stripe_config_1.stripe.payouts.create({
        amount: amountInMinorUnits,
        currency,
        metadata,
        description,
        method,
    }, {
        stripeAccount: stripeAccountId,
    });
    return payout;
}
