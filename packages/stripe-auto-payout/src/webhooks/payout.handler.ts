/**
 * Payout Webhook Handler.
 * Handles payout.*, transfer.*, and balance.available events from Stripe.
 */

import type Stripe from 'stripe';
import type { DatabaseAdapter } from '../types/adapter';
import type { StripeAutoPayoutConfig, Logger } from '../types/config';
import type { PayoutEventBus } from '../core/event-bus';
import type { AutoPayoutService } from '../services/auto-payout.service';
import { LifecycleStage, PayoutStatus } from '../types/enums';
import { checkChargeFundsAvailable } from '../utils/balance-gate';

export class PayoutWebhookHandler {
  constructor(
    private adapter: DatabaseAdapter,
    private stripe: Stripe,
    private config: StripeAutoPayoutConfig,
    private events: PayoutEventBus,
    private autoPayoutService: AutoPayoutService,
    private logger: Logger
  ) {}

  /**
   * Route a verified Stripe event to the appropriate handler.
   */
  async handleEvent(event: Stripe.Event): Promise<void> {
    const connectedAccountId = (event as any).account as string | undefined;

    switch (event.type) {
      case 'payout.created':
      case 'payout.updated':
        await this.syncPayoutRecord(event.data.object as Stripe.Payout, connectedAccountId);
        break;
      case 'payout.paid':
        await this.handlePayoutPaid(event);
        break;
      case 'payout.failed':
        await this.handlePayoutFailed(event);
        break;
      case 'payout.canceled':
        await this.syncPayoutRecord(event.data.object as Stripe.Payout, connectedAccountId);
        break;
      case 'transfer.created':
        await this.handleTransferCreated(event);
        break;
      case 'transfer.reversed':
        await this.handleTransferReversed(event);
        break;
      case 'balance.available':
        await this.handleBalanceAvailable(event);
        break;
      default:
        this.logger.debug(`[PayoutWebhook] Unhandled event: ${event.type}`);
    }
  }

  private async handlePayoutPaid(event: Stripe.Event): Promise<void> {
    const payout = event.data.object as Stripe.Payout;
    const connectedAccountId = (event as any).account as string | undefined;

    this.logger.info(`[PayoutWebhook] Payout PAID: ${payout.id} (£${(payout.amount / 100).toFixed(2)})`);

    await this.syncPayoutRecord(payout, connectedAccountId);

    // Update lifecycle to PAYOUT_COMPLETED
    const tx = await this.adapter.findTransactionByStripePayoutId(payout.id);
    if (tx) {
      await this.adapter.updateTransaction(tx.id, {
        lifecycleStage: LifecycleStage.PAYOUT_COMPLETED,
        payoutCompletedAt: new Date(),
      });
    }

    if (connectedAccountId) {
      const account = await this.adapter.findConnectedAccountByStripeId(connectedAccountId);
      if (account) {
        // Notify merchant
        this.events.notifyUser(
          account.userId,
          'payout:completed',
          'Payout Completed',
          `Your payout of £${(payout.amount / 100).toFixed(2)} has been deposited to your bank account.`,
          {
            orderId: payout.metadata?.orderId || '',
            payoutId: payout.id,
            stripePayoutId: payout.id,
            amount: payout.amount / 100,
            currency: payout.currency,
            merchantId: account.userId,
            arrivalDate: payout.arrival_date
              ? new Date(payout.arrival_date * 1000)
              : undefined,
          }
        );

        // Update related orders to COMPLETED
        const orderIds = this.extractOrderIds(payout.metadata);
        for (const orderId of orderIds) {
          try {
            await this.adapter.updateOrder(orderId, { payoutStatus: PayoutStatus.COMPLETED });
          } catch {
            // Order might not exist
          }
        }
      }
    }
  }

  private async handlePayoutFailed(event: Stripe.Event): Promise<void> {
    const payout = event.data.object as Stripe.Payout;
    const connectedAccountId = (event as any).account as string | undefined;

    this.logger.error(
      `[PayoutWebhook] Payout FAILED: ${payout.id} — ${payout.failure_message || payout.failure_code}`
    );

    await this.syncPayoutRecord(payout, connectedAccountId);

    if (connectedAccountId) {
      const account = await this.adapter.findConnectedAccountByStripeId(connectedAccountId);
      const merchantInfo = account
        ? await this.adapter.getMerchantInfo(account.userId)
        : null;
      const ownerName = merchantInfo?.name || merchantInfo?.email || connectedAccountId;

      // Notify admins (keep merchant's payout visible as "pending")
      this.events.notifyAdmins(
        'admin:payout_failed',
        'Payout Failed — Action Required',
        `Payout of £${(payout.amount / 100).toFixed(2)} to ${ownerName} failed. ` +
        `Reason: ${payout.failure_message || payout.failure_code || 'Unknown'}.`,
        {
          orderId: payout.metadata?.orderId,
          payoutId: payout.id,
          stripePayoutId: payout.id,
          connectedAccountId,
          amount: payout.amount / 100,
          merchantId: account?.userId,
          failureCode: payout.failure_code || undefined,
          failureMessage: payout.failure_message || undefined,
        }
      );
    }
  }

  private async handleTransferCreated(event: Stripe.Event): Promise<void> {
    const transfer = event.data.object as Stripe.Transfer;
    this.logger.info(`[PayoutWebhook] Transfer created: ${transfer.id} (£${(transfer.amount / 100).toFixed(2)})`);

    const destination = typeof transfer.destination === 'string'
      ? transfer.destination
      : transfer.destination?.id;

    if (!destination) return;

    const orderId = transfer.metadata?.orderId;
    if (orderId) {
      const tx = await this.adapter.findTransactionByOrderId(orderId);
      if (tx) {
        await this.adapter.updateTransaction(tx.id, {
          lifecycleStage: LifecycleStage.TRANSFERRED,
          stripeTransferId: transfer.id,
          connectedAccountId: destination,
          transferredAt: new Date(),
        });
      }
    }
  }

  private async handleTransferReversed(event: Stripe.Event): Promise<void> {
    const transfer = event.data.object as Stripe.Transfer;
    this.logger.info(`[PayoutWebhook] Transfer reversed: ${transfer.id}`);

    const tx = await this.adapter.findTransactionByTransferId(transfer.id);
    if (tx) {
      await this.adapter.updateTransaction(tx.id, {
        lifecycleStage: LifecycleStage.FAILED,
        failureMessage: 'Transfer reversed',
      });
    }
  }

  /**
   * Handle balance.available — signal to process deferred payouts.
   */
  private async handleBalanceAvailable(event: Stripe.Event): Promise<void> {
    const balance = event.data.object as Stripe.Balance;
    const connectedAccountId = (event as any).account as string | undefined;

    const currencyBalance = balance.available.find(
      (b) => b.currency === this.config.currency
    );

    this.logger.info(
      `[PayoutWebhook] Balance available: ${currencyBalance?.amount ? currencyBalance.amount / 100 : 0} ` +
      `${this.config.currency.toUpperCase()} (${connectedAccountId || 'platform'})`
    );

    // Platform balance event — process deferred payouts
    if (!connectedAccountId && currencyBalance && currencyBalance.amount > 0) {
      try {
        // Process orders pending due to insufficient balance
        const pendingOrders = await this.adapter.findOrdersPendingBalance(
          'Insufficient platform balance',
          10
        );

        for (const order of pendingOrders) {
          try {
            await this.autoPayoutService.processOrderPayout(order.id);
          } catch (err: any) {
            this.logger.error(`[PayoutWebhook] Failed to process deferred order ${order.id}: ${err.message}`);
          }
        }

        // Process orders waiting for funds availability
        const fundsWaiting = await this.adapter.findOrdersPendingBalance(
          'Funds pending availability',
          10
        );

        for (const order of fundsWaiting) {
          try {
            await this.autoPayoutService.processOrderPayout(order.id);
          } catch (err: any) {
            this.logger.error(`[PayoutWebhook] Failed to process funds-waiting order ${order.id}: ${err.message}`);
          }
        }

        // Update transactions in FUNDS_PENDING to FUNDS_AVAILABLE
        const pendingTx = await this.adapter.findPendingFundsTransactions(20);
        for (const tx of pendingTx) {
          if (!tx.stripeChargeId) continue;
          try {
            const fundsCheck = await checkChargeFundsAvailable(
              this.stripe, tx.stripeChargeId, this.logger
            );
            if (fundsCheck.isAvailable) {
              await this.adapter.updateTransaction(tx.id, {
                lifecycleStage: LifecycleStage.FUNDS_AVAILABLE,
                fundsAvailableAt: new Date(),
              });
            }
          } catch (err: any) {
            this.logger.error(`[PayoutWebhook] Error checking transaction ${tx.id}: ${err.message}`);
          }
        }
      } catch (err: any) {
        this.logger.error(`[PayoutWebhook] Error processing pending payouts on balance available: ${err.message}`);
      }
    }
  }

  /**
   * Sync a Stripe payout object with our database record.
   */
  private async syncPayoutRecord(
    payout: Stripe.Payout,
    connectedAccountId?: string
  ): Promise<void> {
    try {
      const existing = await this.adapter.findPayoutByStripeId(payout.id);

      if (existing) {
        await this.adapter.updatePayout(existing.id, {
          status: payout.status,
          arrivalDate: payout.arrival_date
            ? new Date(payout.arrival_date * 1000)
            : undefined,
          failureCode: payout.failure_code || undefined,
          failureMessage: payout.failure_message || undefined,
        });
      } else if (connectedAccountId) {
        const account = await this.adapter.findConnectedAccountByStripeId(connectedAccountId);
        if (account) {
          await this.adapter.upsertPayoutByStripeId(payout.id, {
            connectedAccountId: account.id,
            stripePayoutId: payout.id,
            amount: payout.amount / 100,
            currency: payout.currency,
            status: payout.status,
            description: payout.description || `Payout ${payout.id}`,
            orderIds: this.extractOrderIds(payout.metadata),
            arrivalDate: payout.arrival_date
              ? new Date(payout.arrival_date * 1000)
              : undefined,
            failureCode: payout.failure_code || undefined,
            failureMessage: payout.failure_message || undefined,
          });
        }
      }
    } catch (err: any) {
      this.logger.error(`[PayoutWebhook] Error syncing payout record: ${err.message}`);
    }
  }

  private extractOrderIds(metadata?: Stripe.Metadata | null): string[] {
    if (!metadata) return [];
    if (metadata.orderId) return [metadata.orderId];
    if (metadata.orderIds) {
      try {
        const parsed = JSON.parse(metadata.orderIds);
        if (Array.isArray(parsed)) return parsed.filter(Boolean);
      } catch {
        return metadata.orderIds.split(',').map((id) => id.trim()).filter(Boolean);
      }
    }
    return [];
  }
}
