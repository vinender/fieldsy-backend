/**
 * Stripe Balance Gate utilities.
 * Ensures transfers only happen when funds are actually available.
 * All functions take a Stripe client as parameter instead of importing a global singleton.
 */

import type Stripe from 'stripe';
import type { BalanceCheckResult, TransferResult, FundsAvailabilityResult } from '../types/models';
import type { Logger } from '../types/config';

/**
 * Check if the platform has sufficient available balance for a transfer.
 * MUST be called before any stripe.transfers.create() call.
 */
export async function checkPlatformBalance(
  stripe: Stripe,
  amountInCents: number,
  currency: string = 'gbp',
  logger?: Logger
): Promise<BalanceCheckResult> {
  const log = logger || console;
  try {
    const balance = await stripe.balance.retrieve();
    const availableBalance = balance.available.find((b) => b.currency === currency);
    const pendingBalance = balance.pending.find((b) => b.currency === currency);

    const availableAmount = availableBalance?.amount || 0;
    const pendingAmount = pendingBalance?.amount || 0;
    const hasAvailableBalance = availableAmount >= amountInCents;

    return {
      hasAvailableBalance,
      availableAmount,
      pendingAmount,
      currency,
      canTransfer: hasAvailableBalance,
      message: hasAvailableBalance
        ? `Sufficient balance: ${availableAmount / 100} ${currency.toUpperCase()} available`
        : `Insufficient balance: Need ${amountInCents / 100} ${currency.toUpperCase()}, only ${availableAmount / 100} available (${pendingAmount / 100} pending)`,
    };
  } catch (error: any) {
    log.error('[BalanceGate] Error checking platform balance:', error);
    return {
      hasAvailableBalance: false,
      availableAmount: 0,
      pendingAmount: 0,
      currency,
      canTransfer: false,
      message: `Balance check failed: ${error.message}`,
    };
  }
}

/**
 * Check connected account balance (for payouts to bank).
 */
export async function checkConnectedAccountBalance(
  stripe: Stripe,
  stripeAccountId: string,
  amountInCents: number,
  currency: string = 'gbp',
  logger?: Logger
): Promise<BalanceCheckResult> {
  const log = logger || console;
  try {
    const balance = await stripe.balance.retrieve({ stripeAccount: stripeAccountId });
    const availableBalance = balance.available.find((b) => b.currency === currency);
    const pendingBalance = balance.pending.find((b) => b.currency === currency);

    const availableAmount = availableBalance?.amount || 0;
    const pendingAmount = pendingBalance?.amount || 0;
    const hasAvailableBalance = availableAmount >= amountInCents;

    return {
      hasAvailableBalance,
      availableAmount,
      pendingAmount,
      currency,
      canTransfer: hasAvailableBalance,
      message: hasAvailableBalance
        ? `Connected account has sufficient balance: ${availableAmount / 100} ${currency.toUpperCase()}`
        : `Connected account insufficient: Need ${amountInCents / 100} ${currency.toUpperCase()}, only ${availableAmount / 100} available`,
    };
  } catch (error: any) {
    log.error('[BalanceGate] Error checking connected account balance:', error);
    return {
      hasAvailableBalance: false,
      availableAmount: 0,
      pendingAmount: 0,
      currency,
      canTransfer: false,
      message: `Connected account balance check failed: ${error.message}`,
    };
  }
}

/**
 * Get the estimated availability date for a charge.
 * Stripe typically makes funds available in 2 business days (UK).
 */
export async function getChargeAvailabilityDate(
  stripe: Stripe,
  chargeId: string,
  logger?: Logger
): Promise<Date | null> {
  const log = logger || console;
  try {
    const charge = await stripe.charges.retrieve(chargeId);
    if (charge.balance_transaction) {
      const btId =
        typeof charge.balance_transaction === 'string'
          ? charge.balance_transaction
          : charge.balance_transaction.id;
      const bt = await stripe.balanceTransactions.retrieve(btId);
      if (bt.available_on) {
        return new Date(bt.available_on * 1000);
      }
    }
    return null;
  } catch (error: any) {
    log.error('[BalanceGate] Error getting charge availability date:', error);
    return null;
  }
}

/**
 * Check if funds for a specific charge are now available.
 */
export async function checkChargeFundsAvailable(
  stripe: Stripe,
  chargeId: string,
  logger?: Logger
): Promise<FundsAvailabilityResult> {
  const log = logger || console;
  try {
    const charge = await stripe.charges.retrieve(chargeId);
    if (!charge.balance_transaction) {
      return {
        isAvailable: false,
        availableOn: null,
        status: 'unknown',
        message: 'No balance transaction associated with charge',
      };
    }

    const btId =
      typeof charge.balance_transaction === 'string'
        ? charge.balance_transaction
        : charge.balance_transaction.id;
    const bt = await stripe.balanceTransactions.retrieve(btId);

    const availableOn = bt.available_on ? new Date(bt.available_on * 1000) : null;
    const now = new Date();
    const isAvailable =
      bt.status === 'available' || (availableOn !== null && now >= availableOn);

    return {
      isAvailable,
      availableOn,
      status: isAvailable ? 'available' : 'pending',
      message: isAvailable
        ? 'Funds are available for transfer'
        : `Funds will be available on ${availableOn?.toISOString() || 'unknown date'}`,
    };
  } catch (error: any) {
    log.error('[BalanceGate] Error checking charge funds availability:', error);
    return {
      isAvailable: false,
      availableOn: null,
      status: 'unknown',
      message: `Error checking availability: ${error.message}`,
    };
  }
}

/**
 * Safe transfer with balance gate.
 * Wraps stripe.transfers.create with proper balance checking.
 * Returns null with reason if balance insufficient (deferred for retry).
 */
export async function safeTransferWithBalanceGate(
  stripe: Stripe,
  params: {
    amount: number;
    currency?: string;
    destination: string;
    transferGroup?: string;
    metadata?: Record<string, string>;
    description?: string;
  },
  logger?: Logger
): Promise<TransferResult> {
  const log = logger || console;
  const { amount, currency = 'gbp', destination, transferGroup, metadata, description } = params;

  // Step 1: Check platform balance
  const balanceCheck = await checkPlatformBalance(stripe, amount, currency, logger);
  if (!balanceCheck.canTransfer) {
    log.info(`[BalanceGate] Transfer deferred: ${balanceCheck.message}`);
    return {
      success: false,
      transfer: null,
      reason: balanceCheck.message,
      shouldDefer: true,
    };
  }

  // Step 2: Create transfer
  try {
    const transfer = await stripe.transfers.create({
      amount,
      currency,
      destination,
      transfer_group: transferGroup,
      metadata,
      description,
    });

    log.info(
      `[BalanceGate] Transfer successful: ${transfer.id} - ${amount / 100} ${currency.toUpperCase()}`
    );

    return {
      success: true,
      transfer,
      reason: 'Transfer completed successfully',
      shouldDefer: false,
    };
  } catch (error: any) {
    log.error('[BalanceGate] Transfer failed:', error);
    const isBalanceError =
      error.code === 'balance_insufficient' ||
      error.message?.includes('balance') ||
      error.message?.includes('insufficient');

    return {
      success: false,
      transfer: null,
      reason: error.message,
      shouldDefer: isBalanceError,
    };
  }
}
