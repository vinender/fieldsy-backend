//@ts-nocheck
import Stripe from 'stripe';

const isProduction = process.env.STRIPE_PRODUCTION_MODE === 'true';

const STRIPE_SECRET_KEY = isProduction
  ? process.env.STRIPE_LIVE_SECRET_KEY
  : process.env.STRIPE_TEST_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  throw new Error(
    `STRIPE_${isProduction ? 'LIVE' : 'TEST'}_SECRET_KEY is not defined in environment variables`
  );
}

export const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2025-07-30.basil',
  typescript: true,
});

export const STRIPE_PAYMENT_WEBHOOK_SECRET = isProduction
  ? process.env.STRIPE_LIVE_PAYMENT_WEBHOOK_SECRET || ''
  : process.env.STRIPE_TEST_PAYMENT_WEBHOOK_SECRET || '';

export const STRIPE_CONNECT_WEBHOOK_SECRET = isProduction
  ? process.env.STRIPE_LIVE_CONNECT_WEBHOOK_SECRET || ''
  : process.env.STRIPE_TEST_CONNECT_WEBHOOK_SECRET || '';

export const STRIPE_PAYOUT_WEBHOOK_SECRET = isProduction
  ? process.env.STRIPE_LIVE_PAYOUT_WEBHOOK_SECRET || ''
  : process.env.STRIPE_TEST_PAYOUT_WEBHOOK_SECRET || '';

export const STRIPE_REFUND_WEBHOOK_SECRET = isProduction
  ? process.env.STRIPE_LIVE_REFUND_WEBHOOK_SECRET || ''
  : process.env.STRIPE_TEST_REFUND_WEBHOOK_SECRET || '';

export { isProduction as isStripeProduction };
