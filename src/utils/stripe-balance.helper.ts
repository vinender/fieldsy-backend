//@ts-nocheck
import { stripe } from '../config/stripe.config';

/**
 * Stripe Balance Helper
 *
 * IMPORTANT: Stripe funds are NOT immediately available after payment.
 * - Standard accounts: 2 business days in UK
 * - Test mode: Funds may appear immediately but transfers still require available balance
 *
 * This helper ensures we only attempt transfers when funds are actually available.
 */

export interface BalanceCheckResult {
  hasAvailableBalance: boolean;
  availableAmount: number;
  pendingAmount: number;
  currency: string;
  canTransfer: boolean;
  message: string;
}

/**
 * Check if platform has sufficient available balance for a transfer
 * This MUST be called before any stripe.transfers.create() call
 *
 * @param amountInCents - The amount to transfer in minor units (cents/pence)
 * @param currency - The currency code (default: 'gbp')
 * @returns BalanceCheckResult with availability info
 */
export async function checkPlatformBalance(
  amountInCents: number,
  currency: string = 'gbp'
): Promise<BalanceCheckResult> {
  try {
    const balance = await stripe.balance.retrieve();

    // Find available and pending balances for the currency
    const availableBalance = balance.available.find(b => b.currency === currency);
    const pendingBalance = balance.pending.find(b => b.currency === currency);

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
        : `Insufficient balance: Need ${amountInCents / 100} ${currency.toUpperCase()}, only ${availableAmount / 100} available (${pendingAmount / 100} pending)`
    };
  } catch (error: any) {
    console.error('[StripeBalance] Error checking platform balance:', error);
    return {
      hasAvailableBalance: false,
      availableAmount: 0,
      pendingAmount: 0,
      currency,
      canTransfer: false,
      message: `Balance check failed: ${error.message}`
    };
  }
}

/**
 * Check connected account balance (for payouts to bank)
 *
 * @param stripeAccountId - The connected account ID (acct_xxx)
 * @param amountInCents - The amount to payout in minor units
 * @param currency - The currency code (default: 'gbp')
 */
export async function checkConnectedAccountBalance(
  stripeAccountId: string,
  amountInCents: number,
  currency: string = 'gbp'
): Promise<BalanceCheckResult> {
  try {
    const balance = await stripe.balance.retrieve({
      stripeAccount: stripeAccountId
    });

    const availableBalance = balance.available.find(b => b.currency === currency);
    const pendingBalance = balance.pending.find(b => b.currency === currency);

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
        : `Connected account insufficient: Need ${amountInCents / 100} ${currency.toUpperCase()}, only ${availableAmount / 100} available`
    };
  } catch (error: any) {
    console.error('[StripeBalance] Error checking connected account balance:', error);
    return {
      hasAvailableBalance: false,
      availableAmount: 0,
      pendingAmount: 0,
      currency,
      canTransfer: false,
      message: `Connected account balance check failed: ${error.message}`
    };
  }
}

/**
 * Get the estimated availability date for a charge
 * Stripe typically makes funds available in 2 business days (UK)
 *
 * @param chargeId - The Stripe charge ID
 * @returns Date when funds will be available, or null if not determinable
 */
export async function getChargeAvailabilityDate(chargeId: string): Promise<Date | null> {
  try {
    const charge = await stripe.charges.retrieve(chargeId);

    if (charge.balance_transaction) {
      const balanceTransactionId = typeof charge.balance_transaction === 'string'
        ? charge.balance_transaction
        : charge.balance_transaction.id;

      const balanceTransaction = await stripe.balanceTransactions.retrieve(balanceTransactionId);

      // available_on is a Unix timestamp
      if (balanceTransaction.available_on) {
        return new Date(balanceTransaction.available_on * 1000);
      }
    }

    return null;
  } catch (error: any) {
    console.error('[StripeBalance] Error getting charge availability date:', error);
    return null;
  }
}

/**
 * Check if funds for a specific charge are now available
 *
 * @param chargeId - The Stripe charge ID
 * @returns Object with availability status and details
 */
export async function checkChargeFundsAvailable(chargeId: string): Promise<{
  isAvailable: boolean;
  availableOn: Date | null;
  status: 'pending' | 'available' | 'unknown';
  message: string;
}> {
  try {
    const charge = await stripe.charges.retrieve(chargeId);

    if (!charge.balance_transaction) {
      return {
        isAvailable: false,
        availableOn: null,
        status: 'unknown',
        message: 'No balance transaction associated with charge'
      };
    }

    const balanceTransactionId = typeof charge.balance_transaction === 'string'
      ? charge.balance_transaction
      : charge.balance_transaction.id;

    const balanceTransaction = await stripe.balanceTransactions.retrieve(balanceTransactionId);

    const availableOn = balanceTransaction.available_on
      ? new Date(balanceTransaction.available_on * 1000)
      : null;

    const now = new Date();
    const isAvailable = balanceTransaction.status === 'available' ||
                        (availableOn !== null && now >= availableOn);

    return {
      isAvailable,
      availableOn,
      status: isAvailable ? 'available' : 'pending',
      message: isAvailable
        ? 'Funds are available for transfer'
        : `Funds will be available on ${availableOn?.toISOString() || 'unknown date'}`
    };
  } catch (error: any) {
    console.error('[StripeBalance] Error checking charge funds availability:', error);
    return {
      isAvailable: false,
      availableOn: null,
      status: 'unknown',
      message: `Error checking availability: ${error.message}`
    };
  }
}

/**
 * Safe transfer with balance gate
 * This wraps stripe.transfers.create with proper balance checking
 *
 * @returns The transfer object if successful, or null with reason if balance insufficient
 */
export async function safeTransferWithBalanceGate(params: {
  amount: number; // in cents
  currency?: string;
  destination: string;
  transferGroup?: string;
  metadata?: Record<string, string>;
  description?: string;
}): Promise<{
  success: boolean;
  transfer: any | null;
  reason: string;
  shouldDefer: boolean;
}> {
  const { amount, currency = 'gbp', destination, transferGroup, metadata, description } = params;

  // Step 1: Check platform balance
  const balanceCheck = await checkPlatformBalance(amount, currency);

  if (!balanceCheck.canTransfer) {
    console.log(`[StripeBalance] Transfer deferred: ${balanceCheck.message}`);
    return {
      success: false,
      transfer: null,
      reason: balanceCheck.message,
      shouldDefer: true // Indicates we should retry later, not fail permanently
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
      description
    });

    console.log(`[StripeBalance] Transfer successful: ${transfer.id} - ${amount / 100} ${currency.toUpperCase()}`);

    return {
      success: true,
      transfer,
      reason: 'Transfer completed successfully',
      shouldDefer: false
    };
  } catch (error: any) {
    console.error('[StripeBalance] Transfer failed:', error);

    // Check if it's a balance-related error
    const isBalanceError = error.code === 'balance_insufficient' ||
                           error.message?.includes('balance') ||
                           error.message?.includes('insufficient');

    return {
      success: false,
      transfer: null,
      reason: error.message,
      shouldDefer: isBalanceError // If balance error, defer for retry
    };
  }
}
