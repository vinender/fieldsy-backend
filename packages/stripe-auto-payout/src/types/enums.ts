/**
 * Domain enumerations for the Stripe Auto-Payout system.
 * Uses const objects for runtime access + type extraction.
 */

export const PayoutStatus = {
  PENDING: 'PENDING',
  PENDING_ACCOUNT: 'PENDING_ACCOUNT',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  HELD: 'HELD',
  REFUNDED: 'REFUNDED',
  CANCELLED: 'CANCELLED',
} as const;
export type PayoutStatus = (typeof PayoutStatus)[keyof typeof PayoutStatus];

export const LifecycleStage = {
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  FUNDS_PENDING: 'FUNDS_PENDING',
  FUNDS_AVAILABLE: 'FUNDS_AVAILABLE',
  TRANSFERRED: 'TRANSFERRED',
  PAYOUT_INITIATED: 'PAYOUT_INITIATED',
  PAYOUT_COMPLETED: 'PAYOUT_COMPLETED',
  REFUNDED: 'REFUNDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type LifecycleStage = (typeof LifecycleStage)[keyof typeof LifecycleStage];

export const OrderStatus = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const PaymentStatus = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  CANCELLED: 'CANCELLED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const TransactionType = {
  PAYMENT: 'PAYMENT',
  REFUND: 'REFUND',
  TRANSFER: 'TRANSFER',
  PAYOUT: 'PAYOUT',
} as const;
export type TransactionType = (typeof TransactionType)[keyof typeof TransactionType];

export const PayoutReleaseSchedule = {
  IMMEDIATE: 'immediate',
  ON_WEEKEND: 'on_weekend',
  AFTER_CANCELLATION_WINDOW: 'after_cancellation_window',
} as const;
export type PayoutReleaseSchedule = (typeof PayoutReleaseSchedule)[keyof typeof PayoutReleaseSchedule];

export const SubscriptionInterval = {
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
} as const;
export type SubscriptionInterval = (typeof SubscriptionInterval)[keyof typeof SubscriptionInterval];

export const SubscriptionStatus = {
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELLED: 'canceled',
  PAUSED: 'paused',
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];
