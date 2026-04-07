/**
 * Transaction Lifecycle Service.
 * Tracks payment transactions through 6 stages:
 * PAYMENT_RECEIVED → FUNDS_PENDING → FUNDS_AVAILABLE → TRANSFERRED → PAYOUT_INITIATED → PAYOUT_COMPLETED
 */

import type Stripe from 'stripe';
import type { DatabaseAdapter } from '../types/adapter';
import type { StripeAutoPayoutConfig, Logger } from '../types/config';
import type { TransactionRecord } from '../types/models';
import { LifecycleStage } from '../types/enums';
import { checkChargeFundsAvailable } from '../utils/balance-gate';

export { LifecycleStage as LIFECYCLE_STAGES };

export class TransactionLifecycleService {
  constructor(
    private adapter: DatabaseAdapter,
    private stripe: Stripe,
    private config: StripeAutoPayoutConfig,
    private logger: Logger
  ) {}

  /** Create initial transaction when payment is received */
  async createPaymentTransaction(params: {
    orderId: string;
    customerId: string;
    merchantId?: string;
    amount: number;
    stripePaymentIntentId: string;
    stripeChargeId?: string;
    metadata?: Record<string, any>;
  }): Promise<TransactionRecord> {
    this.logger.info(`[Lifecycle] Creating payment transaction for order ${params.orderId}`);

    return this.adapter.createTransaction({
      orderId: params.orderId,
      customerId: params.customerId,
      merchantId: params.merchantId,
      amount: params.amount,
      type: 'PAYMENT',
      status: 'COMPLETED',
      lifecycleStage: LifecycleStage.PAYMENT_RECEIVED,
      stripePaymentIntentId: params.stripePaymentIntentId,
      stripeChargeId: params.stripeChargeId,
      paymentReceivedAt: new Date(),
      metadata: params.metadata,
    });
  }

  /** Update to FUNDS_PENDING when charge is captured */
  async updateFundsPending(
    stripePaymentIntentId: string,
    stripeChargeId: string,
    stripeBalanceTransactionId?: string
  ): Promise<TransactionRecord | null> {
    const tx = await this.adapter.findTransactionByPaymentIntentId(stripePaymentIntentId);
    if (!tx) {
      this.logger.warn(`[Lifecycle] No transaction found for PI: ${stripePaymentIntentId}`);
      return null;
    }

    return this.adapter.updateTransaction(tx.id, {
      lifecycleStage: LifecycleStage.FUNDS_PENDING,
      stripeChargeId,
      stripeBalanceTransactionId,
    });
  }

  /** Update to FUNDS_AVAILABLE when balance becomes available */
  async updateFundsAvailable(stripeChargeId: string): Promise<TransactionRecord | null> {
    const tx = await this.adapter.findTransactionByPaymentIntentId(stripeChargeId);
    // Try by charge ID if not found by payment intent
    const transaction = tx || (await this.findByChargeId(stripeChargeId));
    if (!transaction) return null;

    return this.adapter.updateTransaction(transaction.id, {
      lifecycleStage: LifecycleStage.FUNDS_AVAILABLE,
      fundsAvailableAt: new Date(),
    });
  }

  /** Update to TRANSFERRED when money is transferred to connected account */
  async updateTransferred(
    stripeTransferId: string,
    connectedAccountId?: string
  ): Promise<TransactionRecord | null> {
    const tx = await this.adapter.findTransactionByTransferId(stripeTransferId);
    if (!tx) {
      this.logger.warn(`[Lifecycle] No transaction found for transfer: ${stripeTransferId}`);
      return null;
    }

    return this.adapter.updateTransaction(tx.id, {
      lifecycleStage: LifecycleStage.TRANSFERRED,
      stripeTransferId,
      connectedAccountId,
      transferredAt: new Date(),
    });
  }

  /** Update to PAYOUT_INITIATED when payout is created on connected account */
  async updatePayoutInitiated(
    stripePayoutId: string,
    connectedAccountId?: string
  ): Promise<TransactionRecord | null> {
    const tx = await this.adapter.findTransactionByStripePayoutId(stripePayoutId);
    if (!tx) {
      this.logger.warn(`[Lifecycle] No transaction found for payout: ${stripePayoutId}`);
      return null;
    }

    return this.adapter.updateTransaction(tx.id, {
      lifecycleStage: LifecycleStage.PAYOUT_INITIATED,
      stripePayoutId,
      connectedAccountId,
      payoutInitiatedAt: new Date(),
    });
  }

  /** Update to PAYOUT_COMPLETED when payout reaches the bank */
  async updatePayoutCompleted(stripePayoutId: string): Promise<TransactionRecord | null> {
    const tx = await this.adapter.findTransactionByStripePayoutId(stripePayoutId);
    if (!tx) {
      this.logger.warn(`[Lifecycle] No transaction found for payout: ${stripePayoutId}`);
      return null;
    }

    return this.adapter.updateTransaction(tx.id, {
      lifecycleStage: LifecycleStage.PAYOUT_COMPLETED,
      payoutCompletedAt: new Date(),
      status: 'COMPLETED',
    });
  }

  /** Update to REFUNDED, optionally create a refund transaction */
  async updateRefunded(
    orderId: string,
    stripeRefundId: string,
    refundAmount: number
  ): Promise<TransactionRecord | null> {
    const tx = await this.adapter.findTransactionByOrderId(orderId, 'PAYMENT');
    if (!tx) {
      this.logger.warn(`[Lifecycle] No transaction found for order: ${orderId}`);
      return null;
    }

    // Update original transaction
    await this.adapter.updateTransaction(tx.id, {
      lifecycleStage: LifecycleStage.REFUNDED,
      stripeRefundId,
      refundedAt: new Date(),
    });

    // Create refund transaction record
    return this.adapter.createTransaction({
      orderId,
      customerId: tx.customerId,
      merchantId: tx.merchantId,
      amount: -refundAmount,
      type: 'REFUND',
      status: 'COMPLETED',
      lifecycleStage: LifecycleStage.REFUNDED,
      stripeRefundId,
      stripePaymentIntentId: tx.stripePaymentIntentId,
      refundedAt: new Date(),
    });
  }

  /** Update to FAILED with failure details */
  async updateFailed(
    orderId: string,
    failureCode?: string,
    failureMessage?: string
  ): Promise<TransactionRecord | null> {
    const tx = await this.adapter.findTransactionByOrderId(orderId);
    if (!tx) return null;

    return this.adapter.updateTransaction(tx.id, {
      lifecycleStage: LifecycleStage.FAILED,
      status: 'FAILED',
      failureCode,
      failureMessage,
    });
  }

  /** Get all transactions for an order */
  async getTransactionsByOrderId(orderId: string): Promise<TransactionRecord | null> {
    return this.adapter.findTransactionByOrderId(orderId);
  }

  /** Get transaction by payment intent */
  async getTransactionByPaymentIntent(
    stripePaymentIntentId: string
  ): Promise<TransactionRecord | null> {
    return this.adapter.findTransactionByPaymentIntentId(stripePaymentIntentId);
  }

  /**
   * Scheduled job: check pending fund transactions and update their status.
   * Called by the balance.available webhook and cron jobs.
   */
  async checkAndUpdateFundsAvailability(): Promise<number> {
    const pendingTransactions = await this.adapter.findPendingFundsTransactions(20);
    let updated = 0;

    for (const tx of pendingTransactions) {
      if (!tx.stripeChargeId) continue;

      try {
        const result = await checkChargeFundsAvailable(this.stripe, tx.stripeChargeId, this.logger);
        if (result.isAvailable) {
          await this.adapter.updateTransaction(tx.id, {
            lifecycleStage: LifecycleStage.FUNDS_AVAILABLE,
            fundsAvailableAt: new Date(),
          });
          updated++;
          this.logger.info(`[Lifecycle] Funds now available for charge ${tx.stripeChargeId}`);
        }
      } catch (error) {
        this.logger.error(`[Lifecycle] Error checking funds for ${tx.stripeChargeId}:`, error);
      }
    }

    return updated;
  }

  /** Helper to find transaction by charge ID (searches through payment intent) */
  private async findByChargeId(chargeId: string): Promise<TransactionRecord | null> {
    try {
      const charge = await this.stripe.charges.retrieve(chargeId);
      if (charge.payment_intent) {
        const piId =
          typeof charge.payment_intent === 'string'
            ? charge.payment_intent
            : charge.payment_intent.id;
        return this.adapter.findTransactionByPaymentIntentId(piId);
      }
    } catch {
      // Ignore
    }
    return null;
  }
}
