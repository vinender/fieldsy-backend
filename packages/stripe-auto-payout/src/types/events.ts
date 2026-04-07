/**
 * Event system types. Replaces all direct notification/email calls
 * with a typed event bus that consumers subscribe to.
 */

export type PayoutEventType =
  // Payout lifecycle
  | 'payout:pending_account'
  | 'payout:processing'
  | 'payout:completed'
  | 'payout:failed'
  | 'payout:held'
  | 'payout:released'
  | 'payout:retry_success'
  // Refund
  | 'refund:processed'
  | 'refund:failed'
  | 'refund:reversal'
  // Payment
  | 'payment:succeeded'
  | 'payment:failed'
  // Subscription
  | 'subscription:created'
  | 'subscription:renewed'
  | 'subscription:payment_failed'
  | 'subscription:cancelled'
  | 'subscription:cancelled_user'
  // Connect account
  | 'connect:account_ready'
  | 'connect:account_disconnected'
  | 'connect:requirements_due'
  // Admin alerts
  | 'admin:payout_failed'
  | 'admin:job_error'
  | 'admin:job_summary'
  | 'admin:daily_summary'
  | 'admin:earnings_update'
  // Order
  | 'order:confirmed'
  | 'order:new';

/** Payload emitted with every event */
export interface PayoutEvent<T = any> {
  type: PayoutEventType;
  /** User ID this event targets (for notification routing) */
  targetUserId?: string;
  /** If true, should be broadcast to all admin users */
  isAdminEvent?: boolean;
  /** Human-readable title */
  title: string;
  /** Human-readable message */
  message: string;
  /** Structured data payload */
  data: T;
  timestamp: Date;
}

// --- Specific event data interfaces for type safety ---

export interface PayoutCompletedData {
  orderId: string;
  payoutId: string;
  stripePayoutId?: string;
  amount: number;
  currency: string;
  merchantId: string;
  arrivalDate?: Date;
}

export interface PayoutFailedData {
  orderId?: string;
  payoutId?: string;
  stripePayoutId?: string;
  connectedAccountId?: string;
  amount: number;
  merchantId?: string;
  failureCode?: string;
  failureMessage?: string;
}

export interface RefundProcessedData {
  orderId: string;
  refundAmount: number;
  refundPercentage: number;
  stripeRefundId?: string;
  customerId: string;
  merchantId?: string;
}

export interface PaymentSucceededData {
  orderId: string;
  paymentIntentId: string;
  amount: number;
  customerId: string;
  merchantId?: string;
}

export interface SubscriptionEventData {
  subscriptionId: string;
  stripeSubscriptionId?: string;
  merchantId?: string;
  customerId: string;
  listingId: string;
  interval: string;
  totalPrice: number;
}

export interface SubscriptionPaymentFailedData extends SubscriptionEventData {
  attemptNumber: number;
  maxAttempts: number;
  failureReason?: string;
  nextRetryDate?: Date;
}

export interface SubscriptionCancelledData extends SubscriptionEventData {
  cancellationReason: string;
  totalAttempts?: number;
}

export interface ConnectAccountReadyData {
  userId: string;
  stripeAccountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
}

export interface AdminJobSummaryData {
  jobName: string;
  processed: number;
  failed: number;
  skipped: number;
  details?: string[];
}
