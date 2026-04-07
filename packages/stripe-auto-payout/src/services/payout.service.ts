/**
 * Payout Service.
 * Processes payouts from the platform to merchant bank accounts via Stripe Connect.
 * Implements balance gates, commission calculation, and lifecycle tracking.
 */

import type Stripe from 'stripe';
import type { DatabaseAdapter } from '../types/adapter';
import type { StripeAutoPayoutConfig, Logger } from '../types/config';
import type { PayoutEventBus } from '../core/event-bus';
import type { TransactionLifecycleService } from './transaction-lifecycle.service';
import { PayoutStatus, LifecycleStage } from '../types/enums';
import { calculatePayoutAmounts } from '../utils/commission';
import { createConnectedAccountPayout } from '../utils/payout-helper';
import {
  checkChargeFundsAvailable,
  checkPlatformBalance,
  safeTransferWithBalanceGate,
} from '../utils/balance-gate';

export class PayoutService {
  constructor(
    private adapter: DatabaseAdapter,
    private stripe: Stripe,
    private config: StripeAutoPayoutConfig,
    private events: PayoutEventBus,
    private lifecycleService: TransactionLifecycleService,
    private logger: Logger
  ) {}

  /**
   * Process payout for a single order.
   * The main payout processor — validates, checks balances, transfers, and pays out.
   */
  async processOrderPayout(orderId: string): Promise<{
    success: boolean;
    message: string;
    payoutId?: string;
  }> {
    this.logger.info(`[Payout] Processing payout for order: ${orderId}`);

    // 1. Validate order
    const order = await this.adapter.findOrderById(orderId);
    if (!order) {
      return { success: false, message: 'Order not found' };
    }

    if (order.status !== 'COMPLETED' && order.status !== 'CONFIRMED') {
      return { success: false, message: `Order status is ${order.status}, must be COMPLETED or CONFIRMED` };
    }

    if (order.paymentStatus !== 'PAID') {
      return { success: false, message: `Payment status is ${order.paymentStatus}, must be PAID` };
    }

    if (
      order.payoutStatus === PayoutStatus.COMPLETED ||
      order.payoutStatus === PayoutStatus.PROCESSING
    ) {
      return { success: false, message: `Payout already ${order.payoutStatus}` };
    }

    // 2. Check merchant's Stripe account
    const connectedAccount = await this.adapter.findConnectedAccountByUserId(order.merchantId);
    if (!connectedAccount) {
      await this.adapter.updateOrder(orderId, {
        payoutStatus: PayoutStatus.PENDING_ACCOUNT,
        payoutHeldReason: 'NO_STRIPE_ACCOUNT',
      });

      this.events.notifyUser(order.merchantId, 'payout:pending_account', 'Payout Pending',
        'You have earnings waiting. Please connect your Stripe account to receive payouts.',
        { orderId }
      );

      return { success: false, message: 'Merchant has no Stripe account' };
    }

    if (!connectedAccount.chargesEnabled || !connectedAccount.payoutsEnabled) {
      await this.adapter.updateOrder(orderId, {
        payoutStatus: PayoutStatus.PENDING_ACCOUNT,
        payoutHeldReason: 'STRIPE_ACCOUNT_INCOMPLETE',
      });

      this.events.notifyUser(order.merchantId, 'payout:pending_account', 'Stripe Setup Incomplete',
        'Please complete your Stripe account setup to receive payouts.',
        { orderId }
      );

      return { success: false, message: 'Stripe account not fully onboarded' };
    }

    // 3. Balance gate: check if charge funds are available
    if (order.paymentIntentId) {
      try {
        const charge = await this.stripe.paymentIntents.retrieve(order.paymentIntentId);
        const chargeId = (charge.latest_charge as string) || undefined;

        if (chargeId) {
          const fundsCheck = await checkChargeFundsAvailable(this.stripe, chargeId, this.logger);
          if (!fundsCheck.isAvailable) {
            await this.adapter.updateOrder(orderId, {
              payoutStatus: PayoutStatus.PENDING,
              payoutHeldReason: `Funds pending availability until ${fundsCheck.availableOn?.toISOString() || 'unknown'}`,
            });

            // Update transaction lifecycle
            const tx = await this.adapter.findTransactionByOrderId(orderId);
            if (tx) {
              await this.adapter.updateTransaction(tx.id, {
                lifecycleStage: LifecycleStage.FUNDS_PENDING,
              });
            }

            return { success: false, message: fundsCheck.message };
          }
        }
      } catch (err: any) {
        this.logger.warn(`[Payout] Could not verify charge funds: ${err.message}`);
      }
    }

    // 4. Calculate commission
    const commission = await calculatePayoutAmounts(
      this.adapter,
      this.config,
      order.totalPrice,
      order.merchantId,
      this.logger
    );

    const amountInCents = Math.round(commission.merchantAmount * 100);

    // 5. Balance gate: safe transfer to connected account
    const transferResult = await safeTransferWithBalanceGate(
      this.stripe,
      {
        amount: amountInCents,
        currency: this.config.currency,
        destination: connectedAccount.stripeAccountId,
        transferGroup: `order_${orderId}`,
        metadata: { orderId, merchantId: order.merchantId },
        description: `Payout for order ${order.orderId || orderId}`,
      },
      this.logger
    );

    if (!transferResult.success) {
      if (transferResult.shouldDefer) {
        await this.adapter.updateOrder(orderId, {
          payoutStatus: PayoutStatus.PENDING,
          payoutHeldReason: `Insufficient platform balance: ${transferResult.reason}`,
        });
        return { success: false, message: `Transfer deferred: ${transferResult.reason}` };
      }

      // Permanent failure
      await this.adapter.updateOrder(orderId, { payoutStatus: PayoutStatus.FAILED });
      this.events.notifyAdmins('admin:payout_failed', 'Payout Transfer Failed',
        `Transfer for order ${orderId} failed: ${transferResult.reason}`,
        { orderId, merchantId: order.merchantId, amount: commission.merchantAmount, reason: transferResult.reason }
      );
      return { success: false, message: `Transfer failed: ${transferResult.reason}` };
    }

    // 6. Create payout on connected account
    let stripePayout: Stripe.Payout | null = null;
    try {
      stripePayout = await createConnectedAccountPayout(this.stripe, {
        stripeAccountId: connectedAccount.stripeAccountId,
        amountInMinorUnits: amountInCents,
        currency: this.config.currency,
        metadata: { orderId, merchantId: order.merchantId },
        description: `Payout for order ${order.orderId || orderId}`,
      });
    } catch (err: any) {
      this.logger.warn(`[Payout] Connected account payout creation failed (transfer was successful): ${err.message}`);
    }

    // 7. Create payout record in database
    const payoutRecord = await this.adapter.createPayout({
      connectedAccountId: connectedAccount.id,
      stripePayoutId: stripePayout?.id,
      amount: commission.merchantAmount,
      currency: this.config.currency,
      status: stripePayout?.status || 'pending',
      method: 'standard',
      description: `Payout for order ${order.orderId || orderId}`,
      orderIds: [orderId],
      arrivalDate: stripePayout?.arrival_date
        ? new Date(stripePayout.arrival_date * 1000)
        : undefined,
    });

    // 8. Update order
    const payoutStatus =
      stripePayout?.status === 'paid' ? PayoutStatus.COMPLETED : PayoutStatus.PROCESSING;

    await this.adapter.updateOrder(orderId, {
      payoutStatus,
      payoutId: payoutRecord.id,
      merchantAmount: commission.merchantAmount,
      platformCommission: commission.platformCommission,
      payoutHeldReason: undefined,
    });

    // 9. Update transaction lifecycle
    const tx = await this.adapter.findTransactionByOrderId(orderId);
    if (tx) {
      await this.adapter.updateTransaction(tx.id, {
        stripeTransferId: transferResult.transfer?.id,
        stripePayoutId: stripePayout?.id,
        connectedAccountId: connectedAccount.stripeAccountId,
        netAmount: commission.netAmount,
        platformFee: commission.platformFeeAmount,
        commissionRate: commission.commissionRate,
        isCustomCommission: commission.isCustomCommission,
        defaultCommissionRate: commission.defaultCommissionRate,
        lifecycleStage:
          payoutStatus === PayoutStatus.COMPLETED
            ? LifecycleStage.PAYOUT_COMPLETED
            : LifecycleStage.PAYOUT_INITIATED,
        transferredAt: new Date(),
        payoutInitiatedAt: new Date(),
        ...(payoutStatus === PayoutStatus.COMPLETED ? { payoutCompletedAt: new Date() } : {}),
      });
    }

    // 10. Notify merchant
    this.events.notifyUser(order.merchantId, 'payout:processing', 'Payout Processing',
      `Your payout of £${commission.merchantAmount.toFixed(2)} is being processed.`,
      {
        orderId,
        payoutId: payoutRecord.id,
        amount: commission.merchantAmount,
        currency: this.config.currency,
        merchantId: order.merchantId,
      }
    );

    this.logger.info(`[Payout] Successfully processed payout for order ${orderId}: £${commission.merchantAmount.toFixed(2)}`);

    return {
      success: true,
      message: `Payout of £${commission.merchantAmount.toFixed(2)} initiated`,
      payoutId: payoutRecord.id,
    };
  }

  /**
   * Process all pending payouts for a merchant (e.g., after Stripe onboarding).
   */
  async processPendingPayouts(merchantId: string): Promise<{
    processed: number;
    failed: number;
    results: Array<{ orderId: string; success: boolean; message: string }>;
  }> {
    const orders = await this.adapter.findPendingPayoutOrdersForMerchant(merchantId);
    const results: Array<{ orderId: string; success: boolean; message: string }> = [];
    let processed = 0;
    let failed = 0;

    for (const order of orders) {
      const result = await this.processOrderPayout(order.id);
      results.push({ orderId: order.id, ...result });
      if (result.success) processed++;
      else failed++;
    }

    return { processed, failed, results };
  }

  /**
   * Get payout history for a merchant with pagination.
   */
  async getPayoutHistory(
    merchantId: string,
    page: number = 1,
    limit: number = 10
  ): Promise<{ payouts: any[]; total: number; page: number; limit: number }> {
    const connectedAccount = await this.adapter.findConnectedAccountByUserId(merchantId);
    if (!connectedAccount) {
      return { payouts: [], total: 0, page, limit };
    }

    const { payouts, total } = await this.adapter.findPayoutsForAccount(
      connectedAccount.id,
      page,
      limit
    );

    return { payouts, total, page, limit };
  }
}
