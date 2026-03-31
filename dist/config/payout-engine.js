"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.payoutEngine = void 0;
/**
 * Payout Engine — singleton instance.
 *
 * Wires the @fieldsy/stripe-auto-payout engine to Fieldsy's Prisma database
 * via the FieldsyPayoutAdapter. Import this wherever you need engine services.
 *
 * Event wiring is in ./payout-engine-events.ts (side-effect import in server.ts).
 */
const stripe_auto_payout_1 = require("@fieldsy/stripe-auto-payout");
const payout_engine_adapter_1 = require("../adapters/payout-engine.adapter");
const adapter = new payout_engine_adapter_1.FieldsyPayoutAdapter();
exports.payoutEngine = new stripe_auto_payout_1.StripeAutoPayoutEngine({
    stripe: {
        secretKey: (process.env.STRIPE_PRODUCTION_MODE === 'true'
            ? process.env.STRIPE_LIVE_SECRET_KEY
            : process.env.STRIPE_TEST_SECRET_KEY),
        webhookSecrets: {
            payments: (process.env.STRIPE_PRODUCTION_MODE === 'true'
                ? process.env.STRIPE_LIVE_PAYMENT_WEBHOOK_SECRET
                : process.env.STRIPE_TEST_PAYMENT_WEBHOOK_SECRET),
            connect: (process.env.STRIPE_PRODUCTION_MODE === 'true'
                ? process.env.STRIPE_LIVE_CONNECT_WEBHOOK_SECRET
                : process.env.STRIPE_TEST_CONNECT_WEBHOOK_SECRET),
            payouts: (process.env.STRIPE_PRODUCTION_MODE === 'true'
                ? process.env.STRIPE_LIVE_PAYOUT_WEBHOOK_SECRET || process.env.STRIPE_LIVE_CONNECT_WEBHOOK_SECRET
                : process.env.STRIPE_TEST_PAYOUT_WEBHOOK_SECRET || process.env.STRIPE_TEST_CONNECT_WEBHOOK_SECRET),
            refunds: (process.env.STRIPE_PRODUCTION_MODE === 'true'
                ? process.env.STRIPE_LIVE_REFUND_WEBHOOK_SECRET || process.env.STRIPE_LIVE_PAYMENT_WEBHOOK_SECRET
                : process.env.STRIPE_TEST_REFUND_WEBHOOK_SECRET || process.env.STRIPE_TEST_PAYMENT_WEBHOOK_SECRET),
        },
    },
    currency: 'gbp',
    commission: {
        defaultRate: 20,
        stripeFeePercent: 0.015,
        stripeFeeFixed: 0.2,
    },
    scheduling: {
        payoutReleaseSchedule: 'after_cancellation_window',
        cancellationWindowHours: 24,
    },
}, adapter);
