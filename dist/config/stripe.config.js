"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isStripeProduction = exports.STRIPE_REFUND_WEBHOOK_SECRET = exports.STRIPE_PAYOUT_WEBHOOK_SECRET = exports.STRIPE_CONNECT_WEBHOOK_SECRET = exports.STRIPE_PAYMENT_WEBHOOK_SECRET = exports.stripe = void 0;
//@ts-nocheck
const stripe_1 = __importDefault(require("stripe"));
const isProduction = process.env.STRIPE_PRODUCTION_MODE === 'true';
exports.isStripeProduction = isProduction;
const STRIPE_SECRET_KEY = isProduction
    ? process.env.STRIPE_LIVE_SECRET_KEY
    : process.env.STRIPE_TEST_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
    throw new Error(`STRIPE_${isProduction ? 'LIVE' : 'TEST'}_SECRET_KEY is not defined in environment variables`);
}
exports.stripe = new stripe_1.default(STRIPE_SECRET_KEY, {
    apiVersion: '2025-07-30.basil',
    typescript: true,
});
exports.STRIPE_PAYMENT_WEBHOOK_SECRET = isProduction
    ? process.env.STRIPE_LIVE_PAYMENT_WEBHOOK_SECRET || ''
    : process.env.STRIPE_TEST_PAYMENT_WEBHOOK_SECRET || '';
exports.STRIPE_CONNECT_WEBHOOK_SECRET = isProduction
    ? process.env.STRIPE_LIVE_CONNECT_WEBHOOK_SECRET || ''
    : process.env.STRIPE_TEST_CONNECT_WEBHOOK_SECRET || '';
exports.STRIPE_PAYOUT_WEBHOOK_SECRET = isProduction
    ? process.env.STRIPE_LIVE_PAYOUT_WEBHOOK_SECRET || ''
    : process.env.STRIPE_TEST_PAYOUT_WEBHOOK_SECRET || '';
exports.STRIPE_REFUND_WEBHOOK_SECRET = isProduction
    ? process.env.STRIPE_LIVE_REFUND_WEBHOOK_SECRET || ''
    : process.env.STRIPE_TEST_REFUND_WEBHOOK_SECRET || '';
