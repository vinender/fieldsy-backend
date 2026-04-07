# @fieldsy/stripe-auto-payout

A standalone Stripe Connect auto-payout engine for marketplace platforms. Handles automatic payouts to merchants, refunds, recurring subscriptions, transaction lifecycle tracking, and Stripe webhook processing.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Database Adapter](#database-adapter)
- [Services API](#services-api)
- [Webhook Handling](#webhook-handling)
- [Event System](#event-system)
- [Background Jobs](#background-jobs)
- [Data Models](#data-models)
- [Enumerations](#enumerations)
- [Example Integration](#example-integration)

---

## Overview

This package is an **embeddable library** (not a standalone service). You install it into your Express application, provide a database adapter, and it handles:

- Automatic payouts to merchants after a configurable cancellation window
- Platform balance checks before transfers (prevents failed payouts)
- Commission calculation with per-merchant overrides
- 6-stage transaction lifecycle tracking
- Recurring subscriptions via Stripe Billing
- Time-based refund percentages (100% / 50% / 0%)
- Held payout scheduling (immediate, weekend, after cancellation)
- 4 Stripe webhook endpoints (payments, connect, payouts, refunds)
- Cron-based background job scheduling
- Typed event bus for notifications

### How It Works

```
Customer pays → Platform receives payment → Cancellation window passes
→ Engine calculates commission → Transfers to merchant's Stripe Connect account
→ Stripe pays out to merchant's bank account
```

### Integration Model

| Question | Answer |
|----------|--------|
| Install package or call API? | Install package, call functions directly |
| Expose endpoints? | Mount the provided webhook router (1 line) |
| Separate service? | No — runs in-process with your Express app |
| Database requirement | Implement the DatabaseAdapter interface (~40 methods) |
| Stripe requirement | Stripe Connect with 4 webhook endpoints configured |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Your Express App                       │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │           StripeAutoPayoutEngine                    │  │
│  │                                                     │  │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────────────┐  │  │
│  │  │ Payout   │ │ Refund   │ │ Subscription      │  │  │
│  │  │ Service  │ │ Service  │ │ Service            │  │  │
│  │  └──────────┘ └──────────┘ └───────────────────┘  │  │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────────────┐  │  │
│  │  │ AutoPay  │ │ HeldPay  │ │ Lifecycle         │  │  │
│  │  │ Service  │ │ Service  │ │ Service            │  │  │
│  │  └──────────┘ └──────────┘ └───────────────────┘  │  │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────────────┐  │  │
│  │  │ Webhook  │ │ Event    │ │ Scheduler         │  │  │
│  │  │ Router   │ │ Bus      │ │ (Cron Jobs)       │  │  │
│  │  └──────────┘ └──────────┘ └───────────────────┘  │  │
│  │                     │                               │  │
│  │              DatabaseAdapter                        │  │
│  │          (you implement this)                       │  │
│  └─────────────────────┬──────────────────────────────┘  │
│                        │                                  │
│                 Your Database (Prisma, Sequelize, etc.)   │
└─────────────────────────────────────────────────────────┘
```

---

## Quick Start

### 1. Install

```bash
# Local monorepo reference
npm install file:../packages/stripe-auto-payout

# Or if published to npm
npm install @fieldsy/stripe-auto-payout
```

**Peer dependencies** (your app must have these):
- `express` >= 4.x
- `stripe` >= 14.x
- `node-cron` >= 3.x

### 2. Implement the Database Adapter

Create a class that implements the `DatabaseAdapter` interface. This maps the engine's generic models to your database schema. See [Database Adapter](#database-adapter) section for the full interface.

```typescript
// adapters/payout-adapter.ts
import { DatabaseAdapter, Order } from '@fieldsy/stripe-auto-payout';
import prisma from '../config/database';

export class MyPayoutAdapter implements DatabaseAdapter {
  async findOrderById(orderId: string): Promise<Order | null> {
    const booking = await prisma.booking.findUnique({ where: { id: orderId } });
    if (!booking) return null;
    return {
      id: booking.id,
      customerId: booking.userId,
      listingId: booking.fieldId,
      merchantId: booking.field?.ownerId,
      totalPrice: booking.totalPrice,
      // ... map all fields
    };
  }

  // Implement all ~40 methods...
}
```

### 3. Instantiate the Engine

```typescript
// config/payout-engine.ts
import { StripeAutoPayoutEngine } from '@fieldsy/stripe-auto-payout';
import { MyPayoutAdapter } from '../adapters/payout-adapter';

const adapter = new MyPayoutAdapter();

export const payoutEngine = new StripeAutoPayoutEngine(
  {
    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY!,
      webhookSecrets: {
        payments: process.env.STRIPE_PAYMENT_WEBHOOK_SECRET!,
        connect: process.env.STRIPE_CONNECT_WEBHOOK_SECRET!,
        payouts: process.env.STRIPE_PAYOUT_WEBHOOK_SECRET!,
        refunds: process.env.STRIPE_REFUND_WEBHOOK_SECRET!,
      },
    },
    currency: 'gbp',
    commission: {
      defaultRate: 20,
      stripeFeePercent: 0.015,
      stripeFeeFixed: 0.20,
    },
    scheduling: {
      payoutReleaseSchedule: 'after_cancellation_window',
      cancellationWindowHours: 24,
    },
  },
  adapter
);
```

### 4. Mount Webhooks (BEFORE body parsers)

```typescript
// server.ts
import express from 'express';
import { payoutEngine } from './config/payout-engine';

const app = express();

// Webhook routes MUST come before express.json() — Stripe needs raw body
app.use('/api/webhooks', payoutEngine.createWebhookRouter(express));

// Now add body parsers
app.use(express.json());
```

This creates 4 endpoints:
- `POST /api/webhooks/payments` — payment_intent.*, charge.*
- `POST /api/webhooks/connect` — account.*, capability.*
- `POST /api/webhooks/payouts` — payout.*, transfer.*, balance.available
- `POST /api/webhooks/refunds` — charge.refunded, refund.*

### 5. Start Background Jobs

```typescript
import cron from 'node-cron';

payoutEngine.startScheduler(cron);
```

### 6. Subscribe to Events

```typescript
payoutEngine.events.on('payout:completed', (event) => {
  sendEmail(event.targetUserId, `Payout of £${event.data.amount} is on its way!`);
});

payoutEngine.events.on('refund:processed', (event) => {
  sendPushNotification(event.targetUserId, event.message);
});

payoutEngine.events.on('admin:payout_failed', (event) => {
  slackAlert(`Payout failed: ${event.data.failureMessage}`);
});
```

---

## Configuration

```typescript
interface StripeAutoPayoutConfig {
  stripe: {
    secretKey: string;              // sk_test_... or sk_live_...
    apiVersion?: string;            // Stripe API version
    webhookSecrets: {
      payments: string;             // whsec_... for payment events
      connect: string;              // whsec_... for connect account events
      payouts: string;              // whsec_... for payout/transfer events
      refunds: string;              // whsec_... for refund events
    };
  };

  currency: string;                 // 'gbp', 'usd', 'eur', etc.

  commission: {
    defaultRate: number;            // Platform commission % (e.g., 20 for 20%)
    stripeFeePercent: number;       // Stripe's fee % (e.g., 0.015 for 1.5%)
    stripeFeeFixed: number;         // Stripe's fixed fee (e.g., 0.20 for 20p)
  };

  scheduling: {
    payoutReleaseSchedule:          // When to release payouts
      | 'immediate'                 // As soon as cancellation window passes
      | 'on_weekend'               // Friday 6pm batch
      | 'after_cancellation_window'; // After configurable hours
    cancellationWindowHours: number; // Hours to wait before payout (e.g., 24)
  };

  cron?: {                          // Override default cron schedules
    processPayouts?: string;        // Default: '0 * * * *' (hourly)
    releaseHeldPayouts?: string;    // Default: '0 * * * *' (hourly)
    weekendRelease?: string;        // Default: '0 18 * * 5' (Fri 6pm)
    dailySummary?: string;          // Default: '0 9 * * *' (9am daily)
    subscriptionRetry?: string;     // Default: '0 6 * * *' (6am daily)
  };

  subscription?: {
    maxRetryAttempts?: number;      // Default: 3
    retryIntervalHours?: number;    // Default: 24
  };

  logger?: Logger;                  // Custom logger (defaults to console)
}
```

### Required Environment Variables

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PAYMENT_WEBHOOK_SECRET=whsec_...
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_...
STRIPE_PAYOUT_WEBHOOK_SECRET=whsec_...
STRIPE_REFUND_WEBHOOK_SECRET=whsec_...
```

---

## Database Adapter

Your app must implement this interface to connect the engine to your database. Every method is required unless marked optional.

### Order Operations

```typescript
// Find a single order by its ID
findOrderById(orderId: string): Promise<Order | null>;

// Find order by Stripe payment intent ID
findOrderByPaymentIntentId(paymentIntentId: string): Promise<Order | null>;

// Find all orders eligible for automatic payout
// (confirmed, paid, past cancellation window, not yet paid out)
findOrdersEligibleForPayout(): Promise<Order[]>;

// Find pending payout orders for a specific merchant
findPendingPayoutOrdersForMerchant(merchantId: string): Promise<Order[]>;

// Find orders with held payouts
findHeldPayoutOrders(filter?: {
  merchantId?: string;
  holdReason?: string;
}): Promise<Order[]>;

// Find orders pending balance availability
findOrdersPendingBalance(reasonContains: string, limit?: number): Promise<Order[]>;

// Update a single order
updateOrder(orderId: string, data: Partial<Order>): Promise<Order>;

// Bulk update orders
updateManyOrders(
  filter: { ids?: string[]; subscriptionId?: string; futureOnly?: boolean },
  data: Partial<Order>
): Promise<number>;  // Returns count of updated orders

// Create a new order
createOrder(
  data: Partial<Order> & { customerId: string; listingId: string }
): Promise<Order>;

// Generate a unique human-readable order ID (e.g., "ORD-1234")
generateOrderId(): Promise<string>;

// Optional: Check if a time slot is available before creating an order
checkOrderAvailability?(
  listingId: string,
  date: Date,
  startTime: string,
  endTime: string
): Promise<{ available: boolean; reason?: string }>;
```

### Connected Account Operations

```typescript
// Find Stripe Connect account by your app's user ID
findConnectedAccountByUserId(userId: string): Promise<ConnectedAccount | null>;

// Find by Stripe account ID (acct_xxx)
findConnectedAccountByStripeId(stripeAccountId: string): Promise<ConnectedAccount | null>;

// Create a new connected account record
createConnectedAccount(
  data: Partial<ConnectedAccount> & { userId: string; stripeAccountId: string }
): Promise<ConnectedAccount>;

// Update connected account by your DB ID
updateConnectedAccount(
  id: string, data: Partial<ConnectedAccount>
): Promise<ConnectedAccount>;

// Update by Stripe account ID (used by webhooks)
updateConnectedAccountByStripeId(
  stripeAccountId: string,
  data: Partial<ConnectedAccount>
): Promise<ConnectedAccount | null>;
```

### Payout Operations

```typescript
// Create a payout record
createPayout(
  data: Omit<PayoutRecord, 'id' | 'createdAt' | 'updatedAt'>
): Promise<PayoutRecord>;

// Find payout by Stripe payout ID (po_xxx)
findPayoutByStripeId(stripePayoutId: string): Promise<PayoutRecord | null>;

// Update payout
updatePayout(id: string, data: Partial<PayoutRecord>): Promise<PayoutRecord>;

// Create or update payout by Stripe ID (webhook-safe upsert)
upsertPayoutByStripeId(
  stripePayoutId: string, data: Partial<PayoutRecord>
): Promise<PayoutRecord>;

// Paginated payout history for a connected account
findPayoutsForAccount(
  connectedAccountDbId: string, page: number, limit: number
): Promise<{ payouts: PayoutRecord[]; total: number }>;

// Find recently failed payouts for retry
findFailedPayouts(
  withinHours: number
): Promise<Array<PayoutRecord & { connectedAccount: ConnectedAccount }>>;
```

### Transaction Operations

```typescript
createTransaction(
  data: Omit<TransactionRecord, 'id'>
): Promise<TransactionRecord>;

findTransactionByPaymentIntentId(
  stripePaymentIntentId: string
): Promise<TransactionRecord | null>;

findTransactionByOrderId(
  orderId: string, type?: string
): Promise<TransactionRecord | null>;

findTransactionByTransferId(
  stripeTransferId: string
): Promise<TransactionRecord | null>;

findTransactionByStripePayoutId(
  stripePayoutId: string
): Promise<TransactionRecord | null>;

updateTransaction(
  id: string, data: Partial<TransactionRecord>
): Promise<TransactionRecord>;

updateTransactionsByOrderId(
  orderId: string, data: Partial<TransactionRecord>
): Promise<number>;

findPendingFundsTransactions(limit?: number): Promise<TransactionRecord[]>;
```

### Payment Operations

```typescript
findPaymentByOrderId(orderId: string): Promise<PaymentRecord | null>;

createPayment(data: Omit<PaymentRecord, 'id'>): Promise<PaymentRecord>;

updatePayment(id: string, data: Partial<PaymentRecord>): Promise<PaymentRecord>;
```

### Subscription Operations

```typescript
findSubscriptionById(id: string): Promise<SubscriptionRecord | null>;

findSubscriptionByStripeId(
  stripeSubscriptionId: string
): Promise<SubscriptionRecord | null>;

createSubscription(
  data: Omit<SubscriptionRecord, 'id'>
): Promise<SubscriptionRecord>;

updateSubscription(
  id: string, data: Partial<SubscriptionRecord>
): Promise<SubscriptionRecord>;

findSubscriptionsForRetry(
  now: Date, maxRetries: number
): Promise<SubscriptionRecord[]>;
```

### Settings & Merchant Operations

```typescript
// Get platform-wide settings
getSystemSettings(): Promise<SystemSettings | null>;

// Get custom commission rate for a merchant (null = use default)
getMerchantCommissionRate(merchantId: string): Promise<number | null>;

// Get merchant display info (for notifications)
getMerchantInfo(merchantId: string): Promise<{
  id: string; name?: string; email?: string;
} | null>;

// Get customer display info (for notifications)
getCustomerInfo(customerId: string): Promise<{
  id: string; name?: string; email?: string;
} | null>;

// Get all listing IDs owned by a merchant
getListingIdsForMerchant(merchantId: string): Promise<string[]>;
```

---

## Services API

All services are accessed via the engine instance:

```typescript
const engine = new StripeAutoPayoutEngine(config, adapter);

engine.payoutService        // Single order payouts
engine.autoPayoutService    // Automatic batch payouts
engine.refundService        // Refund processing
engine.heldPayoutService    // Held payout management
engine.subscriptionService  // Recurring subscriptions
engine.lifecycleService     // Transaction lifecycle tracking
```

### PayoutService

```typescript
// Process payout for a single order
await engine.payoutService.processOrderPayout(orderId);
// Returns: { success, message, payoutId? }

// Process all pending payouts for a merchant
await engine.payoutService.processPendingPayouts(merchantId);
// Returns: { processed, failed, results[] }

// Get payout history (paginated)
await engine.payoutService.getPayoutHistory(merchantId, page, limit);
// Returns: { payouts[], total, page, limit }
```

### AutoPayoutService

```typescript
// Process all eligible payouts automatically
await engine.autoPayoutService.processEligiblePayouts();
// Returns: { processed, skipped, failed, deferred, details[] }

// Process single order payout with balance check
await engine.autoPayoutService.processOrderPayout(orderId);
// Returns: { success, message, deferred?, payoutId? }

// Get earnings summary for a merchant
await engine.autoPayoutService.getMerchantPayoutSummary(merchantId);
// Returns: { totalEarnings, pendingPayouts, completedPayouts, upcomingPayouts }
```

### RefundService

```typescript
// Process a refund (calculates amount based on time until booking)
await engine.refundService.processRefund(orderId, reason);
// Returns: { success, message, refundAmount?, refundPercentage? }
//
// Refund tiers:
//   >= cancellationWindowHours before booking → 100% refund
//   >= half cancellationWindowHours           → 50% refund
//   < half cancellationWindowHours            → 0% refund

// Process payouts for completed (past) orders
await engine.refundService.processCompletedOrderPayouts();
// Returns: { processed, failed }
```

### HeldPayoutService

```typescript
// Release held payouts for a merchant (e.g., after they set up Stripe account)
await engine.heldPayoutService.releaseHeldPayouts(merchantId);
// Returns: { released }

// Process all scheduled payout releases
await engine.heldPayoutService.processScheduledReleases();
// Returns: { released, checked }
```

### SubscriptionService

```typescript
// Create a new recurring subscription
await engine.subscriptionService.createSubscription({
  customerId: 'user_123',
  listingId: 'field_456',
  date: '2024-03-20',
  timeSlot: '9:00AM - 10:00AM',
  startTime: '9:00AM',
  endTime: '10:00AM',
  numberOfItems: 1,
  interval: 'weekly',        // or 'monthly'
  amount: 15.00,
  paymentMethodId: 'pm_xxx',
  customerEmail: 'user@example.com',
  productName: 'Weekly booking at Meadow Field',
  merchantId: 'owner_789',
});
// Returns: { subscription, stripeSubscription, clientSecret? }

// Create an order from an existing subscription (for next billing cycle)
await engine.subscriptionService.createOrderFromSubscription(subscriptionId, orderDate);

// Retry failed subscription payments
await engine.subscriptionService.retryFailedPayments();
// Returns: { retried, succeeded, failed }

// Cancel a subscription
await engine.subscriptionService.cancelSubscription(subscriptionId, cancelImmediately);

// Refund a specific subscription order
await engine.subscriptionService.refundSubscriptionOrder(orderId, reason);
// Returns: { success, refundAmount, stripeRefundId? }
```

### TransactionLifecycleService

Tracks each transaction through 6 stages:

```
PAYMENT_RECEIVED → FUNDS_PENDING → FUNDS_AVAILABLE → TRANSFERRED → PAYOUT_INITIATED → PAYOUT_COMPLETED
```

```typescript
// Stage 1: Payment received
await engine.lifecycleService.createPaymentTransaction({
  orderId, customerId, merchantId, amount, stripePaymentIntentId
});

// Stage 2: Funds pending in Stripe
await engine.lifecycleService.updateFundsPending(
  stripePaymentIntentId, stripeChargeId, stripeBalanceTransactionId
);

// Stage 3: Funds available for transfer
await engine.lifecycleService.updateFundsAvailable(stripeChargeId);

// Stage 4: Transferred to connected account
await engine.lifecycleService.updateTransferred(stripeTransferId, connectedAccountId);

// Stage 5: Payout initiated to bank
await engine.lifecycleService.updatePayoutInitiated(stripePayoutId, connectedAccountId);

// Stage 6: Payout completed (money in bank)
await engine.lifecycleService.updatePayoutCompleted(stripePayoutId);

// Error states
await engine.lifecycleService.updateRefunded(orderId, stripeRefundId, refundAmount);
await engine.lifecycleService.updateFailed(orderId, failureCode, failureMessage);

// Batch check: update funds that have become available
await engine.lifecycleService.checkAndUpdateFundsAvailability();
```

---

## Webhook Handling

### Stripe Dashboard Setup

Create 4 webhook endpoints in your Stripe Dashboard pointing to:

| Endpoint | Events |
|----------|--------|
| `https://yourdomain.com/api/webhooks/payments` | `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.succeeded`, `charge.failed` |
| `https://yourdomain.com/api/webhooks/connect` | `account.updated`, `account.application.deauthorized`, `capability.updated` |
| `https://yourdomain.com/api/webhooks/payouts` | `payout.created`, `payout.updated`, `payout.paid`, `payout.failed`, `payout.canceled`, `transfer.created`, `transfer.reversed`, `balance.available` |
| `https://yourdomain.com/api/webhooks/refunds` | `charge.refunded`, `refund.updated`, `refund.failed` |

### Express Setup

The webhook router MUST be mounted before `express.json()` because Stripe signature verification requires the raw request body.

```typescript
// CORRECT - webhooks before body parsers
app.use('/api/webhooks', engine.createWebhookRouter(express));
app.use(express.json());

// WRONG - body parser strips raw body before webhooks can verify
app.use(express.json());
app.use('/api/webhooks', engine.createWebhookRouter(express));
```

---

## Event System

The engine emits typed events you can subscribe to for notifications, emails, logging, or any side effects.

### All Events

| Event | When | Target |
|-------|------|--------|
| `payout:completed` | Payout reached merchant's bank | Merchant |
| `payout:failed` | Payout failed | Merchant + Admin |
| `payout:processing` | Payout transfer initiated | Merchant |
| `payout:held` | Payout held (no Stripe account) | Merchant |
| `payout:released` | Held payout released | Merchant |
| `payout:pending_account` | Waiting for Stripe account setup | Merchant |
| `payout:retry_success` | Failed payout retried successfully | Merchant |
| `refund:processed` | Refund issued to customer | Customer |
| `refund:failed` | Refund failed | Admin |
| `refund:reversal` | Transfer reversal detected | Admin |
| `payment:succeeded` | Payment confirmed | Customer + Merchant |
| `payment:failed` | Payment failed | Customer |
| `subscription:created` | New subscription started | Customer |
| `subscription:renewed` | Subscription renewed (new order created) | Customer |
| `subscription:payment_failed` | Subscription payment failed | Customer |
| `subscription:cancelled` | Subscription cancelled (system) | Customer |
| `subscription:cancelled_user` | Subscription cancelled (by user) | Customer |
| `connect:account_ready` | Merchant Stripe account fully set up | Merchant |
| `connect:account_disconnected` | Merchant disconnected Stripe | Admin |
| `connect:requirements_due` | Stripe requires more info from merchant | Merchant |
| `order:confirmed` | Order confirmed after payment | Customer + Merchant |
| `order:new` | New order created | Merchant |
| `admin:payout_failed` | Payout failure alert | Admin |
| `admin:job_error` | Background job error | Admin |
| `admin:job_summary` | Job completion summary | Admin |
| `admin:daily_summary` | Daily platform summary | Admin |
| `admin:earnings_update` | Merchant earnings changed | Merchant |

### Subscribing to Events

```typescript
// Single event
engine.events.on('payout:completed', (event) => {
  // event.type          - 'payout:completed'
  // event.targetUserId  - merchant's user ID
  // event.title         - 'Payout Completed'
  // event.message       - 'Your payout of £50.00 has been sent...'
  // event.data          - PayoutCompletedData
  // event.timestamp     - Date
  // event.isAdminEvent  - false
});

// All events (for logging)
engine.events.onAny((event) => {
  logger.info(`[PayoutEngine] ${event.type}: ${event.message}`);
});
```

### Event Payload Types

```typescript
// payout:completed
interface PayoutCompletedData {
  orderId: string;
  payoutId: string;
  stripePayoutId?: string;
  amount: number;
  currency: string;
  merchantId: string;
  arrivalDate?: Date;
}

// payout:failed, admin:payout_failed
interface PayoutFailedData {
  orderId?: string;
  payoutId?: string;
  stripePayoutId?: string;
  connectedAccountId?: string;
  amount: number;
  merchantId?: string;
  failureCode?: string;
  failureMessage?: string;
}

// refund:processed
interface RefundProcessedData {
  orderId: string;
  refundAmount: number;
  refundPercentage: number;
  stripeRefundId?: string;
  customerId: string;
  merchantId?: string;
}

// payment:succeeded
interface PaymentSucceededData {
  orderId: string;
  paymentIntentId: string;
  amount: number;
  customerId: string;
  merchantId?: string;
}

// subscription:created, subscription:renewed
interface SubscriptionEventData {
  subscriptionId: string;
  stripeSubscriptionId?: string;
  merchantId?: string;
  customerId: string;
  listingId: string;
  interval: string;
  totalPrice: number;
}

// subscription:payment_failed
interface SubscriptionPaymentFailedData extends SubscriptionEventData {
  attemptNumber: number;
  maxAttempts: number;
  failureReason?: string;
  nextRetryDate?: Date;
}

// connect:account_ready
interface ConnectAccountReadyData {
  userId: string;
  stripeAccountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
}

// admin:job_summary
interface AdminJobSummaryData {
  jobName: string;
  processed: number;
  failed: number;
  skipped: number;
  details?: string[];
}
```

---

## Background Jobs

The scheduler runs cron jobs for automatic processing:

```typescript
const scheduler = engine.startScheduler(cron);

// Later, to stop all jobs:
scheduler.stop();
```

### Default Schedule

| Job | Schedule | What It Does |
|-----|----------|-------------|
| Process payouts | Every hour | Finds eligible orders, transfers to merchants |
| Release held payouts | Every hour | Releases payouts that were waiting for Stripe accounts |
| Weekend batch release | Friday 6pm | Releases payouts on `on_weekend` schedule |
| Subscription retry | Daily 6am | Retries failed subscription payments |
| Daily summary | Daily 9am | Emits `admin:daily_summary` event |

### Manual Triggers

For admin endpoints or testing:

```typescript
await engine.processPayoutsNow();
await engine.releaseHeldPayoutsNow();
await engine.retrySubscriptionPaymentsNow();
```

---

## Data Models

### Order

```typescript
interface Order {
  id: string;
  customerId: string;           // Your app's customer/user ID
  listingId: string;            // Your app's listing/product ID
  merchantId: string;           // Your app's merchant/seller ID
  date: Date;
  startTime: string;
  endTime: string;
  totalPrice: number;           // Total amount charged
  platformCommission?: number;  // Platform's cut
  merchantAmount?: number;      // Merchant's cut
  orderId?: string;             // Human-readable ID
  status: string;               // PENDING | CONFIRMED | COMPLETED | CANCELLED
  paymentStatus?: string;       // PENDING | PAID | FAILED | REFUNDED
  paymentIntentId?: string;     // Stripe pi_xxx
  payoutStatus?: string;        // PENDING | PROCESSING | COMPLETED | FAILED | HELD
  payoutId?: string;
  payoutHeldReason?: string;
  subscriptionId?: string;
  cancellationReason?: string;
  cancelledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

### ConnectedAccount

```typescript
interface ConnectedAccount {
  id: string;
  userId: string;               // Your app's user ID
  stripeAccountId: string;      // Stripe acct_xxx
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  defaultCurrency?: string;
  country?: string;
  email?: string;
  bankAccountLast4?: string;
}
```

### TransactionRecord

```typescript
interface TransactionRecord {
  id: string;
  orderId: string;
  customerId: string;
  merchantId?: string;
  amount: number;
  netAmount?: number;
  platformFee?: number;
  commissionRate?: number;
  type: string;                  // PAYMENT | REFUND | TRANSFER | PAYOUT
  status: string;                // PENDING | PROCESSING | COMPLETED | FAILED
  lifecycleStage?: string;       // 6-stage tracking
  stripePaymentIntentId?: string;
  stripeChargeId?: string;
  stripeTransferId?: string;
  stripePayoutId?: string;
  stripeRefundId?: string;
  connectedAccountId?: string;
  // Lifecycle timestamps
  paymentReceivedAt?: Date;
  fundsAvailableAt?: Date;
  transferredAt?: Date;
  payoutInitiatedAt?: Date;
  payoutCompletedAt?: Date;
  refundedAt?: Date;
  failureCode?: string;
  failureMessage?: string;
}
```

---

## Enumerations

```typescript
// Order status
OrderStatus.PENDING | CONFIRMED | COMPLETED | CANCELLED

// Payment status
PaymentStatus.PENDING | PAID | FAILED | REFUNDED | CANCELLED

// Payout status
PayoutStatus.PENDING | PENDING_ACCOUNT | PROCESSING | COMPLETED
           | FAILED | HELD | REFUNDED | CANCELLED

// Transaction lifecycle stages
LifecycleStage.PAYMENT_RECEIVED | FUNDS_PENDING | FUNDS_AVAILABLE
              | TRANSFERRED | PAYOUT_INITIATED | PAYOUT_COMPLETED
              | REFUNDED | FAILED | CANCELLED

// Transaction types
TransactionType.PAYMENT | REFUND | TRANSFER | PAYOUT

// Payout release schedule
PayoutReleaseSchedule.IMMEDIATE | ON_WEEKEND | AFTER_CANCELLATION_WINDOW

// Subscription
SubscriptionInterval.WEEKLY | MONTHLY
SubscriptionStatus.ACTIVE | PAST_DUE | CANCELLED | PAUSED
```

---

## Example Integration

Here is a complete minimal Express integration:

```typescript
import express from 'express';
import cron from 'node-cron';
import { StripeAutoPayoutEngine } from '@fieldsy/stripe-auto-payout';
import { MyDatabaseAdapter } from './adapters/my-adapter';

const app = express();
const adapter = new MyDatabaseAdapter();

// 1. Create engine
const engine = new StripeAutoPayoutEngine({
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY!,
    webhookSecrets: {
      payments: process.env.STRIPE_PAYMENT_WEBHOOK_SECRET!,
      connect: process.env.STRIPE_CONNECT_WEBHOOK_SECRET!,
      payouts: process.env.STRIPE_PAYOUT_WEBHOOK_SECRET!,
      refunds: process.env.STRIPE_REFUND_WEBHOOK_SECRET!,
    },
  },
  currency: 'gbp',
  commission: { defaultRate: 20, stripeFeePercent: 0.015, stripeFeeFixed: 0.20 },
  scheduling: { payoutReleaseSchedule: 'after_cancellation_window', cancellationWindowHours: 24 },
}, adapter);

// 2. Mount webhooks BEFORE body parsers
app.use('/api/webhooks', engine.createWebhookRouter(express));
app.use(express.json());

// 3. Wire up events
engine.events.on('payout:completed', (e) => console.log('Payout done:', e.data));
engine.events.on('refund:processed', (e) => console.log('Refund done:', e.data));
engine.events.on('admin:payout_failed', (e) => console.error('ALERT:', e.message));

// 4. API routes that use the engine
app.post('/api/orders/:id/refund', async (req, res) => {
  const result = await engine.refundService.processRefund(req.params.id, req.body.reason);
  res.json(result);
});

app.post('/api/admin/process-payouts', async (req, res) => {
  const result = await engine.processPayoutsNow();
  res.json(result);
});

app.get('/api/merchants/:id/earnings', async (req, res) => {
  const summary = await engine.autoPayoutService.getMerchantPayoutSummary(req.params.id);
  res.json(summary);
});

// 5. Start server and scheduler
app.listen(5000, () => {
  engine.startScheduler(cron);
  console.log('Server running with payout engine');
});
```

---

## Feature Flags

The engine can be feature-flagged so your app can fall back to built-in logic:

```typescript
const USE_PAYOUT_ENGINE = process.env.USE_PAYOUT_ENGINE === 'true';

// Conditionally mount webhooks
if (USE_PAYOUT_ENGINE) {
  app.use('/api/webhooks', engine.createWebhookRouter(express));
}

// Conditionally start scheduler
if (USE_PAYOUT_ENGINE) {
  engine.startScheduler(cron);
}

// In your service layer, delegate to engine or built-in
async function processRefund(orderId: string, reason: string) {
  if (USE_PAYOUT_ENGINE) {
    return engine.refundService.processRefund(orderId, reason);
  }
  return builtInRefundService.processRefund(orderId, reason);
}
```
