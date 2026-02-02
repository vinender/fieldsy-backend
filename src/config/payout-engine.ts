/**
 * Payout Engine — singleton instance.
 *
 * Wires the @fieldsy/stripe-auto-payout engine to Fieldsy's Prisma database
 * via the FieldsyPayoutAdapter. Import this wherever you need engine services.
 *
 * Event wiring is in ./payout-engine-events.ts (side-effect import in server.ts).
 */
import { StripeAutoPayoutEngine } from '@fieldsy/stripe-auto-payout';
import { FieldsyPayoutAdapter } from '../adapters/payout-engine.adapter';

const adapter = new FieldsyPayoutAdapter();

export const payoutEngine = new StripeAutoPayoutEngine(
  {
    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY!,
      webhookSecrets: {
        payments: process.env.STRIPE_WEBHOOK_SECRET!,
        connect: process.env.STRIPE_CONNECT_WEBHOOK_SECRET!,
        payouts:
          process.env.STRIPE_PAYOUT_WEBHOOK_SECRET ||
          process.env.STRIPE_CONNECT_WEBHOOK_SECRET!,
        refunds:
          process.env.STRIPE_REFUND_WEBHOOK_SECRET ||
          process.env.STRIPE_WEBHOOK_SECRET!,
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
  },
  adapter
);
