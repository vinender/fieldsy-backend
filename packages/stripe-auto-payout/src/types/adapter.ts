/**
 * DatabaseAdapter interface.
 * The consuming application implements this single interface to connect
 * its own ORM/database to the payout engine.
 *
 * Every Prisma call in the original Fieldsy codebase maps to a method here.
 */

import type {
  Order,
  ConnectedAccount,
  PayoutRecord,
  TransactionRecord,
  PaymentRecord,
  SubscriptionRecord,
  SystemSettings,
} from './models';

export interface DatabaseAdapter {
  // ========================================================================
  // ORDER operations
  // ========================================================================

  /** Find a single order by ID */
  findOrderById(orderId: string): Promise<Order | null>;

  /** Find a single order by Stripe payment intent ID */
  findOrderByPaymentIntentId(paymentIntentId: string): Promise<Order | null>;

  /**
   * Find orders eligible for automatic payout.
   * Expected filter: status CONFIRMED/COMPLETED, paymentStatus PAID,
   * payoutStatus null or PENDING or HELD, end time has passed.
   */
  findOrdersEligibleForPayout(): Promise<Order[]>;

  /**
   * Find orders pending payout for a specific merchant.
   * Expected filter: merchant's listings, status COMPLETED, paymentStatus PAID,
   * payoutStatus null or PENDING or PENDING_ACCOUNT.
   */
  findPendingPayoutOrdersForMerchant(merchantId: string): Promise<Order[]>;

  /**
   * Find orders with held payouts.
   * Optional filter by merchant ID and/or hold reason.
   */
  findHeldPayoutOrders(filter?: {
    merchantId?: string;
    holdReason?: string;
  }): Promise<Order[]>;

  /**
   * Find orders with PENDING payoutStatus where payoutHeldReason
   * contains the given string. Used by balance.available webhook.
   */
  findOrdersPendingBalance(reasonContains: string, limit?: number): Promise<Order[]>;

  /** Partially update an order */
  updateOrder(orderId: string, data: Partial<Order>): Promise<Order>;

  /**
   * Update multiple orders matching a filter.
   * Returns the number of updated records.
   */
  updateManyOrders(
    filter: { ids?: string[]; subscriptionId?: string; futureOnly?: boolean },
    data: Partial<Order>
  ): Promise<number>;

  /** Create a new order (used by webhook-created orders and subscriptions) */
  createOrder(data: Partial<Order> & { customerId: string; listingId: string }): Promise<Order>;

  /** Generate a unique human-readable order ID (e.g., "1234", "ORD-5678") */
  generateOrderId(): Promise<string>;

  /**
   * Check if an order time slot is available for a listing.
   * Used by subscription service when creating recurring orders.
   * Optional — if not implemented, subscriptions skip availability checks.
   */
  checkOrderAvailability?(
    listingId: string,
    date: Date,
    startTime: string,
    endTime: string
  ): Promise<{ available: boolean; reason?: string }>;

  // ========================================================================
  // CONNECTED ACCOUNT operations
  // ========================================================================

  /** Find connected account by the merchant's user ID */
  findConnectedAccountByUserId(userId: string): Promise<ConnectedAccount | null>;

  /** Find connected account by Stripe account ID (acct_xxx) */
  findConnectedAccountByStripeId(stripeAccountId: string): Promise<ConnectedAccount | null>;

  /** Create a new connected account record */
  createConnectedAccount(
    data: Partial<ConnectedAccount> & { userId: string; stripeAccountId: string }
  ): Promise<ConnectedAccount>;

  /** Update connected account by DB record ID */
  updateConnectedAccount(id: string, data: Partial<ConnectedAccount>): Promise<ConnectedAccount>;

  /** Update connected account by Stripe account ID */
  updateConnectedAccountByStripeId(
    stripeAccountId: string,
    data: Partial<ConnectedAccount>
  ): Promise<ConnectedAccount | null>;

  // ========================================================================
  // PAYOUT operations
  // ========================================================================

  /** Create a new payout record */
  createPayout(data: Omit<PayoutRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<PayoutRecord>;

  /** Find payout by Stripe payout ID (po_xxx) */
  findPayoutByStripeId(stripePayoutId: string): Promise<PayoutRecord | null>;

  /** Update a payout record by DB ID */
  updatePayout(id: string, data: Partial<PayoutRecord>): Promise<PayoutRecord>;

  /** Upsert a payout record by Stripe payout ID (handles webhook race conditions) */
  upsertPayoutByStripeId(stripePayoutId: string, data: Partial<PayoutRecord>): Promise<PayoutRecord>;

  /**
   * Find payouts for a connected account with pagination.
   * connectedAccountDbId is the DB record ID (not Stripe's acct_xxx).
   */
  findPayoutsForAccount(
    connectedAccountDbId: string,
    page: number,
    limit: number
  ): Promise<{ payouts: PayoutRecord[]; total: number }>;

  /** Find failed payouts created within the last N hours */
  findFailedPayouts(
    withinHours: number
  ): Promise<Array<PayoutRecord & { connectedAccount: ConnectedAccount }>>;

  // ========================================================================
  // TRANSACTION operations
  // ========================================================================

  /** Create a new transaction lifecycle record */
  createTransaction(data: Omit<TransactionRecord, 'id'>): Promise<TransactionRecord>;

  /** Find transaction by Stripe payment intent ID */
  findTransactionByPaymentIntentId(stripePaymentIntentId: string): Promise<TransactionRecord | null>;

  /** Find transaction by order ID and optionally by type */
  findTransactionByOrderId(orderId: string, type?: string): Promise<TransactionRecord | null>;

  /** Find transaction by Stripe transfer ID */
  findTransactionByTransferId(stripeTransferId: string): Promise<TransactionRecord | null>;

  /** Find transaction by Stripe payout ID */
  findTransactionByStripePayoutId(stripePayoutId: string): Promise<TransactionRecord | null>;

  /** Update a transaction by ID */
  updateTransaction(id: string, data: Partial<TransactionRecord>): Promise<TransactionRecord>;

  /** Update all transactions matching an order ID */
  updateTransactionsByOrderId(orderId: string, data: Partial<TransactionRecord>): Promise<number>;

  /**
   * Find transactions in FUNDS_PENDING stage with a charge ID.
   * Used to check if funds have become available.
   */
  findPendingFundsTransactions(limit?: number): Promise<TransactionRecord[]>;

  // ========================================================================
  // PAYMENT operations
  // ========================================================================

  /** Find payment record by order ID */
  findPaymentByOrderId(orderId: string): Promise<PaymentRecord | null>;

  /** Create a payment record */
  createPayment(data: Omit<PaymentRecord, 'id'>): Promise<PaymentRecord>;

  /** Update a payment record */
  updatePayment(id: string, data: Partial<PaymentRecord>): Promise<PaymentRecord>;

  // ========================================================================
  // SUBSCRIPTION operations
  // ========================================================================

  /** Find subscription by DB record ID */
  findSubscriptionById(id: string): Promise<SubscriptionRecord | null>;

  /** Find subscription by Stripe subscription ID */
  findSubscriptionByStripeId(stripeSubscriptionId: string): Promise<SubscriptionRecord | null>;

  /** Create a subscription record */
  createSubscription(data: Omit<SubscriptionRecord, 'id'>): Promise<SubscriptionRecord>;

  /** Update a subscription */
  updateSubscription(id: string, data: Partial<SubscriptionRecord>): Promise<SubscriptionRecord>;

  /** Find subscriptions that need payment retry (past_due, nextRetryDate <= now) */
  findSubscriptionsForRetry(now: Date, maxRetries: number): Promise<SubscriptionRecord[]>;

  // ========================================================================
  // SETTINGS & MERCHANT operations
  // ========================================================================

  /** Get current system settings from the consuming app's database */
  getSystemSettings(): Promise<SystemSettings | null>;

  /** Get custom commission rate for a merchant. Return null to use default. */
  getMerchantCommissionRate(merchantId: string): Promise<number | null>;

  /** Get user info for a merchant (name/email for notification context) */
  getMerchantInfo(merchantId: string): Promise<{ id: string; name?: string; email?: string } | null>;

  /** Get customer info (name/email for notification context) */
  getCustomerInfo(customerId: string): Promise<{ id: string; name?: string; email?: string } | null>;

  /** Get listing IDs owned by a merchant */
  getListingIdsForMerchant(merchantId: string): Promise<string[]>;
}
