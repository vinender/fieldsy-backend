/**
 * Generic model interfaces for the Stripe Auto-Payout system.
 * Uses domain-neutral naming: Order (not Booking), Merchant (not FieldOwner), Listing (not Field).
 */

/** Represents any billable order in the consuming application */
export interface Order {
  id: string;
  /** Customer who placed the order */
  customerId: string;
  /** The listing/product/service being ordered */
  listingId: string;
  /** The merchant/seller who owns the listing */
  merchantId: string;
  /** Order date */
  date: Date;
  startTime: string;
  endTime: string;
  totalPrice: number;
  /** Platform's commission amount */
  platformCommission?: number;
  /** Amount the merchant receives */
  merchantAmount?: number;
  /** Human-readable order ID */
  orderId?: string;
  /** PENDING, CONFIRMED, COMPLETED, CANCELLED */
  status: string;
  /** PENDING, PAID, FAILED, REFUNDED */
  paymentStatus?: string;
  /** Stripe payment intent ID */
  paymentIntentId?: string;
  /** PENDING, PROCESSING, COMPLETED, FAILED, HELD, PENDING_ACCOUNT */
  payoutStatus?: string;
  /** Reference to payout record */
  payoutId?: string;
  /** Reason payout is held */
  payoutHeldReason?: string;
  /** When held payout was released */
  payoutReleasedAt?: Date;
  /** Reference to subscription if recurring */
  subscriptionId?: string;
  cancellationReason?: string;
  cancelledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  /** Arbitrary metadata the consuming app can attach */
  metadata?: Record<string, any>;
}

/** Represents a Stripe Connect connected account */
export interface ConnectedAccount {
  id: string;
  userId: string;
  stripeAccountId: string;
  accountType?: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  defaultCurrency?: string;
  country?: string;
  email?: string;
  bankAccountLast4?: string;
  requirementsCurrentlyDue?: string[];
  requirementsPastDue?: string[];
  requirementsEventuallyDue?: string[];
}

/** Represents a payout to a merchant's bank account */
export interface PayoutRecord {
  id: string;
  /** DB ID of the connected account record */
  connectedAccountId: string;
  /** Stripe payout ID (po_xxx) */
  stripePayoutId?: string;
  /** Amount in major currency units (e.g., pounds, not pence) */
  amount: number;
  currency: string;
  /** pending, paid, failed, canceled */
  status: string;
  /** standard or instant */
  method?: string;
  description?: string;
  /** Order IDs included in this payout */
  orderIds: string[];
  arrivalDate?: Date;
  failureCode?: string;
  failureMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Represents a transaction lifecycle record for audit tracking */
export interface TransactionRecord {
  id: string;
  orderId: string;
  customerId: string;
  merchantId?: string;
  amount: number;
  netAmount?: number;
  platformFee?: number;
  commissionRate?: number;
  isCustomCommission?: boolean;
  defaultCommissionRate?: number;
  /** PAYMENT, REFUND, TRANSFER, PAYOUT */
  type: string;
  /** PENDING, PROCESSING, COMPLETED, FAILED, CANCELLED */
  status: string;
  lifecycleStage?: string;
  stripePaymentIntentId?: string;
  stripeChargeId?: string;
  stripeBalanceTransactionId?: string;
  stripeTransferId?: string;
  stripePayoutId?: string;
  stripeRefundId?: string;
  connectedAccountId?: string;
  paymentReceivedAt?: Date;
  fundsAvailableAt?: Date;
  transferredAt?: Date;
  payoutInitiatedAt?: Date;
  payoutCompletedAt?: Date;
  refundedAt?: Date;
  failureCode?: string;
  failureMessage?: string;
  description?: string;
  metadata?: Record<string, any>;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Represents a payment record */
export interface PaymentRecord {
  id: string;
  orderId: string;
  customerId: string;
  amount: number;
  currency: string;
  status: string;
  stripePaymentId?: string;
  stripeRefundId?: string;
  refundAmount?: number;
  refundReason?: string;
}

/** Represents a recurring subscription */
export interface SubscriptionRecord {
  id: string;
  customerId: string;
  listingId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  /** active, canceled, past_due, paused */
  status: string;
  /** weekly, monthly */
  interval: string;
  intervalCount: number;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt?: Date;
  timeSlot: string;
  timeSlots?: string[];
  dayOfWeek?: string;
  dayOfMonth?: number;
  startTime: string;
  endTime: string;
  numberOfItems?: number;
  totalPrice: number;
  nextBillingDate?: Date;
  lastOrderDate?: Date;
  paymentRetryCount: number;
  lastPaymentAttempt?: Date;
  nextRetryDate?: Date;
  failureReason?: string;
  cancellationReason?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** System-level configuration stored in the consuming app's database */
export interface SystemSettings {
  defaultCommissionRate: number;
  cancellationWindowHours: number;
  payoutReleaseSchedule: string;
  maxAdvanceBookingDays?: number;
}

/** Commission calculation result */
export interface CommissionResult {
  merchantAmount: number;
  platformFeeAmount: number;
  platformCommission: number;
  commissionRate: number;
  isCustomCommission: boolean;
  defaultCommissionRate: number;
  stripeFee: number;
  netAmount: number;
}

/** Balance check result */
export interface BalanceCheckResult {
  hasAvailableBalance: boolean;
  availableAmount: number;
  pendingAmount: number;
  currency: string;
  canTransfer: boolean;
  message: string;
}

/** Transfer result from balance-gated transfer */
export interface TransferResult {
  success: boolean;
  transfer: any | null;
  reason: string;
  shouldDefer: boolean;
}

/** Funds availability check result */
export interface FundsAvailabilityResult {
  isAvailable: boolean;
  availableOn: Date | null;
  status: 'pending' | 'available' | 'unknown';
  message: string;
}

/** Payout processing result */
export interface PayoutProcessingResult {
  processed: number;
  skipped: number;
  failed: number;
  deferred: number;
  details: Array<{
    orderId: string;
    status: string;
    message: string;
  }>;
}
