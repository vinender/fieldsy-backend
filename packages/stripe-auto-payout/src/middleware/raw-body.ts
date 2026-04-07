/**
 * Raw body middleware helper.
 * Stripe webhook signature verification requires the raw request body.
 * Mount this BEFORE any JSON body parsers on your webhook routes.
 *
 * Usage with express:
 *   import express from 'express';
 *   import { createRawBodyMiddleware } from '@fieldsy/stripe-auto-payout';
 *
 *   // Mount webhooks first (before app.use(express.json()))
 *   app.use('/api/webhooks', createRawBodyMiddleware(express));
 *   app.use('/api/webhooks', engine.createWebhookRouter());
 *
 *   // Then add JSON parser for other routes
 *   app.use(express.json());
 */

/**
 * Creates express.raw() middleware for webhook routes.
 * The webhook router factory already applies this internally,
 * so you only need this if mounting routes manually.
 */
export function createRawBodyMiddleware(
  express: { raw: (opts: { type: string }) => any }
): any {
  return express.raw({ type: 'application/json' });
}
