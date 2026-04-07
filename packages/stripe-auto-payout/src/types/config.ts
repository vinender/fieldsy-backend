/**
 * Configuration interface for the Stripe Auto-Payout engine.
 * A single object that replaces all environment variables and hardcoded constants.
 */

export interface StripeAutoPayoutConfig {
  /** Stripe API configuration */
  stripe: {
    /** Stripe secret key (sk_test_... or sk_live_...) */
    secretKey: string;
    /** Stripe API version override (optional) */
    apiVersion?: string;
    /** Webhook signing secrets for each endpoint */
    webhookSecrets: {
      /** Platform payment events (payment_intent.*, charge.*) */
      payments: string;
      /** Connect account events (account.*, capability.*) */
      connect: string;
      /** Payout events (payout.*, transfer.*, balance.available) */
      payouts: string;
      /** Refund events (charge.refunded, refund.*) */
      refunds: string;
    };
  };

  /** Default currency code (e.g., 'gbp', 'usd', 'eur') */
  currency: string;

  /** Commission and fee configuration */
  commission: {
    /** Default platform commission rate as percentage (e.g., 20 for 20%) */
    defaultRate: number;
    /** Stripe processing fee: percentage component (e.g., 0.015 for 1.5%) */
    stripeFeePercent: number;
    /** Stripe processing fee: fixed component in major units (e.g., 0.20 for 20p/20c) */
    stripeFeeFixed: number;
  };

  /** Payout scheduling configuration */
  scheduling: {
    /** When to release payouts to merchants */
    payoutReleaseSchedule: 'immediate' | 'on_weekend' | 'after_cancellation_window';
    /** Hours before order start when cancellation with refund is allowed */
    cancellationWindowHours: number;
  };

  /** Cron schedule overrides (node-cron expressions). All optional with sensible defaults. */
  cron?: {
    /** Mark past orders as completed (default: every 30 min) */
    markCompleted?: string;
    /** Process eligible payouts (default: '0 * * * *' — every hour) */
    processPayouts?: string;
    /** Release held payouts (default: '0 * * * *' — every hour) */
    releaseHeldPayouts?: string;
    /** Weekend payout release (default: '0 18 * * 5' — Friday 6 PM) */
    weekendRelease?: string;
    /** Daily admin summary (default: '0 9 * * *' — 9 AM daily) */
    dailySummary?: string;
    /** Subscription payment retry (default: '0 6 * * *' — 6 AM daily) */
    subscriptionRetry?: string;
  };

  /** Subscription-specific settings */
  subscription?: {
    /** Max payment retry attempts before auto-cancel (default: 3) */
    maxRetryAttempts?: number;
    /** Hours between retries (default: 24) */
    retryIntervalHours?: number;
  };

  /** Custom logger. If not provided, uses console. */
  logger?: Logger;
}

/** Pluggable logger interface */
export interface Logger {
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
}
