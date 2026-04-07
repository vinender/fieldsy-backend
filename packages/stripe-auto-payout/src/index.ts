/**
 * Stripe Auto-Payout Engine.
 * Main entry point — creates all services, wires them together,
 * and exposes a simple API for the consuming application.
 *
 * Usage:
 *   import { StripeAutoPayoutEngine } from '@fieldsy/stripe-auto-payout';
 *
 *   const engine = new StripeAutoPayoutEngine(config, adapter);
 *   engine.events.on('payout:completed', (e) => sendEmail(e.data));
 *   app.use('/api/webhooks', engine.createWebhookRouter(express));
 *   const scheduler = engine.startScheduler(cron);
 */

import type Stripe from 'stripe';
import type { Router } from 'express';
import type { DatabaseAdapter } from './types/adapter';
import type { StripeAutoPayoutConfig, Logger } from './types/config';
import { createStripeClient } from './core/stripe-client';
import { PayoutEventBus } from './core/event-bus';
import { defaultLogger } from './core/logger';

// Services
import { TransactionLifecycleService } from './services/transaction-lifecycle.service';
import { PayoutService } from './services/payout.service';
import { HeldPayoutService } from './services/held-payout.service';
import { RefundService } from './services/refund.service';
import { AutoPayoutService } from './services/auto-payout.service';
import { SubscriptionService } from './services/subscription.service';

// Webhooks
import { PaymentWebhookHandler } from './webhooks/payment.handler';
import { ConnectWebhookHandler } from './webhooks/connect.handler';
import { PayoutWebhookHandler } from './webhooks/payout.handler';
import { RefundWebhookHandler } from './webhooks/refund.handler';
import { createWebhookRouter } from './webhooks/handler';

// Jobs
import { PayoutProcessorJob } from './jobs/payout-processor.job';
import { HeldPayoutReleaseJob } from './jobs/held-payout-release.job';
import { SubscriptionRetryJob } from './jobs/subscription-retry.job';
import { startScheduler } from './jobs/scheduler';

export class StripeAutoPayoutEngine {
  /** Stripe client instance */
  readonly stripe: Stripe;
  /** Typed event bus — subscribe to payout/refund/subscription events */
  readonly events: PayoutEventBus;
  /** Logger instance */
  readonly logger: Logger;

  // ---- Services (use these in your controllers) ----
  readonly lifecycleService: TransactionLifecycleService;
  readonly payoutService: PayoutService;
  readonly heldPayoutService: HeldPayoutService;
  readonly refundService: RefundService;
  readonly autoPayoutService: AutoPayoutService;
  readonly subscriptionService: SubscriptionService;

  // ---- Webhook handlers ----
  private paymentHandler: PaymentWebhookHandler;
  private connectHandler: ConnectWebhookHandler;
  private payoutHandler: PayoutWebhookHandler;
  private refundHandler: RefundWebhookHandler;

  constructor(
    private config: StripeAutoPayoutConfig,
    private adapter: DatabaseAdapter
  ) {
    this.logger = config.logger || defaultLogger;
    this.stripe = createStripeClient(config);
    this.events = new PayoutEventBus();

    // Wire up services
    this.lifecycleService = new TransactionLifecycleService(
      this.adapter, this.stripe, this.config, this.logger
    );
    this.payoutService = new PayoutService(
      this.adapter, this.stripe, this.config, this.events, this.lifecycleService, this.logger
    );
    this.heldPayoutService = new HeldPayoutService(
      this.adapter, this.config, this.events, this.logger
    );
    this.refundService = new RefundService(
      this.adapter, this.stripe, this.config, this.events, this.logger
    );
    this.autoPayoutService = new AutoPayoutService(
      this.adapter, this.stripe, this.config, this.events, this.logger
    );
    this.subscriptionService = new SubscriptionService(
      this.adapter, this.stripe, this.config, this.events, this.logger
    );

    // Wire up webhook handlers
    this.paymentHandler = new PaymentWebhookHandler(
      this.adapter, this.stripe, this.config, this.events, this.lifecycleService, this.logger
    );
    this.connectHandler = new ConnectWebhookHandler(
      this.adapter, this.stripe, this.events, this.logger
    );
    this.payoutHandler = new PayoutWebhookHandler(
      this.adapter, this.stripe, this.config, this.events, this.autoPayoutService, this.logger
    );
    this.refundHandler = new RefundWebhookHandler(
      this.adapter, this.stripe, this.events, this.logger
    );

    this.logger.info('[StripeAutoPayout] Engine initialized');
  }

  /**
   * Create an Express Router that handles all 4 webhook endpoints.
   * Mount BEFORE any JSON body parsers:
   *
   *   app.use('/api/webhooks', engine.createWebhookRouter(express));
   *   app.use(express.json()); // after webhooks
   *
   * @param express The express module (passed in to avoid bundling)
   */
  createWebhookRouter(
    express: { Router: () => Router; raw: (opts: { type: string }) => any }
  ): Router {
    return createWebhookRouter(
      this.stripe,
      this.config,
      {
        payment: this.paymentHandler,
        connect: this.connectHandler,
        payout: this.payoutHandler,
        refund: this.refundHandler,
        subscription: this.subscriptionService,
      },
      this.logger,
      express
    );
  }

  /**
   * Start the cron scheduler. Returns an object with `stop()`.
   *
   *   import cron from 'node-cron';
   *   const scheduler = engine.startScheduler(cron);
   *   // later: scheduler.stop();
   *
   * @param cron The node-cron module (passed in to avoid bundling)
   */
  startScheduler(
    cron: { schedule: (expression: string, task: () => void) => { stop: () => void } }
  ): { stop: () => void } {
    const payoutProcessor = new PayoutProcessorJob(
      this.autoPayoutService, this.events, this.logger
    );
    const heldPayoutRelease = new HeldPayoutReleaseJob(
      this.heldPayoutService, this.events, this.logger
    );
    const subscriptionRetry = new SubscriptionRetryJob(
      this.subscriptionService, this.events, this.logger
    );

    return startScheduler(cron, this.config, {
      payoutProcessor,
      heldPayoutRelease,
      subscriptionRetry,
    }, this.logger);
  }

  /**
   * Manually trigger a full payout processing cycle.
   * Useful for admin endpoints or testing.
   */
  async processPayoutsNow() {
    return this.autoPayoutService.processEligiblePayouts();
  }

  /**
   * Manually trigger held payout release.
   */
  async releaseHeldPayoutsNow() {
    return this.heldPayoutService.processScheduledReleases();
  }

  /**
   * Manually trigger subscription payment retries.
   */
  async retrySubscriptionPaymentsNow() {
    return this.subscriptionService.retryFailedPayments();
  }
}

// ---- Re-export everything for consumers ----

// Types
export type { DatabaseAdapter } from './types/adapter';
export type { StripeAutoPayoutConfig, Logger } from './types/config';
export type {
  PayoutEventType,
  PayoutEvent,
  PayoutCompletedData,
  PayoutFailedData,
  RefundProcessedData,
  PaymentSucceededData,
  SubscriptionEventData,
  SubscriptionPaymentFailedData,
  SubscriptionCancelledData,
  ConnectAccountReadyData,
  AdminJobSummaryData,
} from './types/events';
export type {
  Order,
  ConnectedAccount,
  PayoutRecord,
  TransactionRecord,
  PaymentRecord,
  SubscriptionRecord,
  SystemSettings,
  CommissionResult,
  BalanceCheckResult,
  TransferResult,
  FundsAvailabilityResult,
  PayoutProcessingResult,
} from './types/models';

// Enums
export {
  PayoutStatus,
  LifecycleStage,
  OrderStatus,
  PaymentStatus,
  TransactionType,
  PayoutReleaseSchedule,
  SubscriptionInterval,
  SubscriptionStatus,
} from './types/enums';

// Core
export { PayoutEventBus } from './core/event-bus';
export { createStripeClient } from './core/stripe-client';
export { defaultLogger } from './core/logger';

// Services (for advanced usage)
export { TransactionLifecycleService } from './services/transaction-lifecycle.service';
export { PayoutService } from './services/payout.service';
export { HeldPayoutService } from './services/held-payout.service';
export { RefundService } from './services/refund.service';
export { AutoPayoutService } from './services/auto-payout.service';
export { SubscriptionService } from './services/subscription.service';

// Middleware
export { createRawBodyMiddleware } from './middleware/raw-body';
