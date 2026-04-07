# @fieldsy/stripe-auto-payout

Standalone Stripe Connect auto-payout engine with subscriptions, refunds, and lifecycle tracking. Plug into any Express/Node.js application with a Stripe Connect marketplace.

## Features

- **Automatic Payouts** — Process payouts to merchants after configurable cancellation windows
- **Balance Gates** — Never transfer without verifying available platform balance
- **Commission Calculation** — Configurable platform commission with per-merchant overrides
- **Transaction Lifecycle** — 6-stage audit trail: Payment Received → Funds Pending → Funds Available → Transferred → Payout Initiated → Payout Completed
- **Recurring Subscriptions** — Create Stripe subscriptions with automatic order creation and payment retry
- **Refund Engine** — Time-based refund percentages (100%, 50%, 0%) with partial merchant payouts
- **Held Payouts** — Hold and release payouts based on schedules (immediate, weekend, after cancellation window)
- **4 Webhook Endpoints** — Payments, Connect, Payouts, Refunds with signature verification
- **Cron Scheduler** — Automatic payout processing, held payout release, subscription retry
- **Event Bus** — Subscribe to typed events instead of hardcoded notification calls

## Quick Start

```bash
npm install @fieldsy/stripe-auto-payout stripe express node-cron
```

```typescript
import express from 'express';
import cron from 'node-cron';
import { StripeAutoPayoutEngine } from '@fieldsy/stripe-auto-payout';
import { myDatabaseAdapter } from './adapter'; // you implement this

const engine = new StripeAutoPayoutEngine({
  stripe: {
    secretKey: 'sk_...',
    webhookSecrets: {
      payments: 'whsec_...',
      connect: 'whsec_...',
      payouts: 'whsec_...',
      refunds: 'whsec_...',
    },
  },
  currency: 'gbp',
  commission: {
    defaultRate: 20,            // 20% platform commission
    stripeFeePercent: 0.015,    // 1.5% Stripe fee
    stripeFeeFixed: 0.20,       // 20p fixed Stripe fee
  },
  scheduling: {
    payoutReleaseSchedule: 'after_cancellation_window',
    cancellationWindowHours: 24,
  },
}, myDatabaseAdapter);

// 1. Subscribe to events (replaces all notification/email calls)
engine.events.on('payout:completed', (event) => {
  sendEmail(event.data.merchantId, event.title, event.message);
});

engine.events.on('admin:payout_failed', (event) => {
  slackAlert(event.message);
});

// 2. Mount webhooks BEFORE body parsers
const app = express();
app.use('/api/webhooks', engine.createWebhookRouter(express));
app.use(express.json()); // after webhooks

// 3. Start cron jobs
const scheduler = engine.startScheduler(cron);

// 4. Use services in your controllers
app.post('/api/orders/:id/payout', async (req, res) => {
  const result = await engine.payoutService.processOrderPayout(req.params.id);
  res.json(result);
});

app.post('/api/orders/:id/refund', async (req, res) => {
  const result = await engine.refundService.processRefund(req.params.id, req.body.reason);
  res.json(result);
});

app.listen(3000);
```

## Configuration

```typescript
interface StripeAutoPayoutConfig {
  stripe: {
    secretKey: string;
    apiVersion?: string;
    webhookSecrets: {
      payments: string;
      connect: string;
      payouts: string;
      refunds: string;
    };
  };
  currency: string;                    // 'gbp', 'usd', 'eur'
  commission: {
    defaultRate: number;               // percentage (e.g., 20 for 20%)
    stripeFeePercent: number;          // e.g., 0.015 for 1.5%
    stripeFeeFixed: number;            // e.g., 0.20 for 20p
  };
  scheduling: {
    payoutReleaseSchedule: 'immediate' | 'on_weekend' | 'after_cancellation_window';
    cancellationWindowHours: number;
  };
  cron?: {                             // all optional, sensible defaults
    processPayouts?: string;           // default: '0 * * * *' (hourly)
    releaseHeldPayouts?: string;       // default: '0 * * * *' (hourly)
    weekendRelease?: string;           // default: '0 18 * * 5' (Fri 6PM)
    dailySummary?: string;             // default: '0 9 * * *' (9AM)
    subscriptionRetry?: string;        // default: '0 6 * * *' (6AM)
  };
  subscription?: {
    maxRetryAttempts?: number;         // default: 3
    retryIntervalHours?: number;       // default: 24
  };
  logger?: Logger;                     // default: console
}
```

## Database Adapter

You implement the `DatabaseAdapter` interface to connect your ORM/database. All ~40 methods are typed. Here's a Prisma example:

```typescript
import { DatabaseAdapter, Order } from '@fieldsy/stripe-auto-payout';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const adapter: DatabaseAdapter = {
  async findOrderById(orderId) {
    return prisma.order.findUnique({ where: { id: orderId } });
  },

  async findOrderByPaymentIntentId(paymentIntentId) {
    return prisma.order.findFirst({ where: { paymentIntentId } });
  },

  async findOrdersEligibleForPayout() {
    return prisma.order.findMany({
      where: {
        status: { in: ['CONFIRMED', 'COMPLETED'] },
        paymentStatus: 'PAID',
        payoutStatus: { in: [null, 'PENDING', 'HELD'] },
      },
    });
  },

  async updateOrder(orderId, data) {
    return prisma.order.update({ where: { id: orderId }, data });
  },

  async createOrder(data) {
    return prisma.order.create({ data });
  },

  async generateOrderId() {
    const count = await prisma.order.count();
    return String(count + 1);
  },

  async findConnectedAccountByUserId(userId) {
    return prisma.stripeAccount.findUnique({ where: { userId } });
  },

  // ... implement remaining methods
};
```

## Events

Instead of hardcoded notification/email calls, the engine emits typed events:

| Event | When |
|-------|------|
| `payout:completed` | Payout deposited to merchant's bank |
| `payout:failed` | Payout failed |
| `payout:processing` | Payout transfer initiated |
| `payout:pending_account` | Merchant needs to connect Stripe |
| `payout:held` | Payout held per schedule |
| `payout:released` | Held payout released |
| `refund:processed` | Customer refund processed |
| `subscription:created` | New recurring subscription |
| `subscription:renewed` | Subscription payment succeeded |
| `subscription:payment_failed` | Subscription payment failed |
| `subscription:cancelled` | Subscription auto-cancelled (payment failure) |
| `connect:account_ready` | Merchant's Stripe account fully set up |
| `admin:payout_failed` | Admin alert: payout failure |
| `admin:daily_summary` | Daily payout summary |
| `admin:job_error` | Cron job encountered errors |

```typescript
engine.events.on('payout:completed', (event) => {
  // event.type: 'payout:completed'
  // event.targetUserId: merchant's ID
  // event.title: 'Payout Completed'
  // event.message: 'Your payout of £50.00 has been deposited...'
  // event.data: { orderId, payoutId, amount, currency, merchantId }
});

// Listen to all events
engine.events.on('*', (event) => {
  auditLog.record(event);
});
```

## Webhook Setup

Create 4 webhook endpoints in your Stripe Dashboard:

1. **Payments** (`/api/webhooks/payments`) — Events on your account
   - `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.succeeded`, `charge.failed`

2. **Connect** (`/api/webhooks/connect`) — Events on Connected accounts
   - `account.updated`, `account.application.deauthorized`, `capability.updated`

3. **Payouts** (`/api/webhooks/payouts`) — Events on Connected accounts
   - `payout.created`, `payout.paid`, `payout.failed`, `transfer.created`, `balance.available`

4. **Refunds** (`/api/webhooks/refunds`) — Events on your account
   - `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`

## Services

Access services directly for custom controller logic:

```typescript
// Process a single order payout
await engine.payoutService.processOrderPayout(orderId);

// Process all pending payouts for a merchant
await engine.payoutService.processPendingPayouts(merchantId);

// Process refund with time-based percentage
await engine.refundService.processRefund(orderId, 'Customer requested');

// Create subscription
await engine.subscriptionService.createSubscription({ ... });

// Cancel subscription
await engine.subscriptionService.cancelSubscription(subscriptionId, true);

// Manual triggers (for admin endpoints)
await engine.processPayoutsNow();
await engine.releaseHeldPayoutsNow();
await engine.retrySubscriptionPaymentsNow();
```

## License

MIT
