/**
 * Webhook Router Factory.
 * Creates an Express Router with 4 webhook endpoints,
 * each with raw-body parsing and Stripe signature verification.
 */

import type { Router, Request, Response } from 'express';
import type Stripe from 'stripe';
import type { StripeAutoPayoutConfig, Logger } from '../types/config';
import type { PaymentWebhookHandler } from './payment.handler';
import type { ConnectWebhookHandler } from './connect.handler';
import type { PayoutWebhookHandler } from './payout.handler';
import type { RefundWebhookHandler } from './refund.handler';
import type { SubscriptionService } from '../services/subscription.service';

export interface WebhookHandlers {
  payment: PaymentWebhookHandler;
  connect: ConnectWebhookHandler;
  payout: PayoutWebhookHandler;
  refund: RefundWebhookHandler;
  subscription: SubscriptionService;
}

/**
 * Create an Express router with 4 webhook endpoints.
 * Must be mounted BEFORE any body-parser middleware.
 *
 * Usage:
 *   app.use('/api/webhooks', createWebhookRouter(stripe, config, handlers, logger));
 */
export function createWebhookRouter(
  stripe: Stripe,
  config: StripeAutoPayoutConfig,
  handlers: WebhookHandlers,
  logger: Logger,
  express: { Router: () => Router; raw: (opts: { type: string }) => any }
): Router {
  const router = express.Router();

  // Raw body middleware for all webhook routes (Stripe needs the raw body for signature verification)
  const rawBody = express.raw({ type: 'application/json' });

  /**
   * 1. PAYMENTS WEBHOOK
   * Events: payment_intent.*, charge.*
   */
  router.post('/payments', rawBody, async (req: Request, res: Response): Promise<void> => {
    const event = verifyEvent(stripe, req, config.stripe.webhookSecrets.payments, logger, 'PaymentWebhook');
    if (!event) { res.status(400).send('Invalid signature'); return; }

    try {
      // Handle subscription-related payment events
      if (event.type.startsWith('invoice.') || event.type.startsWith('customer.subscription.')) {
        await handlers.subscription.handleSubscriptionWebhook(event);
      } else {
        await handlers.payment.handleEvent(event);
      }
      res.json({ received: true });
    } catch (err: any) {
      logger.error(`[PaymentWebhook] Error: ${err.message}`);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  /**
   * 2. CONNECT WEBHOOK
   * Events: account.*, capability.*
   */
  router.post('/connect', rawBody, async (req: Request, res: Response): Promise<void> => {
    const event = verifyEvent(stripe, req, config.stripe.webhookSecrets.connect, logger, 'ConnectWebhook');
    if (!event) { res.status(400).send('Invalid signature'); return; }

    try {
      await handlers.connect.handleEvent(event);
      res.json({ received: true });
    } catch (err: any) {
      logger.error(`[ConnectWebhook] Error: ${err.message}`);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  /**
   * 3. PAYOUTS WEBHOOK
   * Events: payout.*, transfer.*, balance.available
   */
  router.post('/payouts', rawBody, async (req: Request, res: Response): Promise<void> => {
    const event = verifyEvent(stripe, req, config.stripe.webhookSecrets.payouts, logger, 'PayoutWebhook');
    if (!event) { res.status(400).send('Invalid signature'); return; }

    try {
      await handlers.payout.handleEvent(event);
      res.json({ received: true });
    } catch (err: any) {
      logger.error(`[PayoutWebhook] Error: ${err.message}`);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  /**
   * 4. REFUNDS WEBHOOK
   * Events: charge.refunded, refund.*
   */
  router.post('/refunds', rawBody, async (req: Request, res: Response): Promise<void> => {
    const event = verifyEvent(stripe, req, config.stripe.webhookSecrets.refunds, logger, 'RefundWebhook');
    if (!event) { res.status(400).send('Invalid signature'); return; }

    try {
      await handlers.refund.handleEvent(event);
      res.json({ received: true });
    } catch (err: any) {
      logger.error(`[RefundWebhook] Error: ${err.message}`);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  return router;
}

/**
 * Verify Stripe webhook signature and construct event.
 */
function verifyEvent(
  stripe: Stripe,
  req: Request,
  secret: string,
  logger: Logger,
  context: string
): Stripe.Event | null {
  const sig = req.headers['stripe-signature'] as string;

  if (!secret) {
    logger.error(`[${context}] Webhook secret not configured`);
    return null;
  }

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, secret);
    logger.debug(`[${context}] Received event: ${event.type} (${event.id})`);
    return event;
  } catch (err: any) {
    logger.error(`[${context}] Signature verification failed: ${err.message}`);
    return null;
  }
}
