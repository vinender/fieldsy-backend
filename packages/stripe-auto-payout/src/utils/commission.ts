/**
 * Commission calculation utility.
 * Replaces hardcoded Stripe fee values with config-driven parameters.
 * Uses the DatabaseAdapter for custom merchant commission rates.
 */

import type { DatabaseAdapter } from '../types/adapter';
import type { StripeAutoPayoutConfig, Logger } from '../types/config';
import type { CommissionResult } from '../types/models';

/**
 * Get the effective commission rate for a merchant.
 * Checks for custom rate via adapter, falls back to config default.
 */
export async function getEffectiveCommissionRate(
  adapter: DatabaseAdapter,
  config: StripeAutoPayoutConfig,
  merchantId: string,
  logger?: Logger
): Promise<{
  effectiveRate: number;
  isCustomRate: boolean;
  defaultRate: number;
}> {
  const log = logger || console;
  try {
    const customRate = await adapter.getMerchantCommissionRate(merchantId);
    const settings = await adapter.getSystemSettings();
    const defaultRate = settings?.defaultCommissionRate || config.commission.defaultRate;

    if (customRate !== null && customRate !== undefined) {
      return { effectiveRate: customRate, isCustomRate: true, defaultRate };
    }

    return { effectiveRate: defaultRate, isCustomRate: false, defaultRate };
  } catch (error) {
    log.error('Error getting commission rate:', error);
    return {
      effectiveRate: config.commission.defaultRate,
      isCustomRate: false,
      defaultRate: config.commission.defaultRate,
    };
  }
}

/**
 * Calculate payout amounts: merchant's share, platform fee, and Stripe fee.
 *
 * Formula:
 *   stripeFee     = (totalAmount × stripeFeePercent) + stripeFeeFixed
 *   netAmount     = totalAmount - stripeFee
 *   platformFee   = netAmount × (commissionRate / 100)
 *   merchantAmount = netAmount - platformFee
 */
export async function calculatePayoutAmounts(
  adapter: DatabaseAdapter,
  config: StripeAutoPayoutConfig,
  totalAmount: number,
  merchantId: string,
  logger?: Logger
): Promise<CommissionResult> {
  const { effectiveRate, isCustomRate, defaultRate } = await getEffectiveCommissionRate(
    adapter,
    config,
    merchantId,
    logger
  );

  const stripeFee =
    totalAmount * config.commission.stripeFeePercent + config.commission.stripeFeeFixed;
  const netAmount = totalAmount - stripeFee;
  const platformFeeAmount = (netAmount * effectiveRate) / 100;

  let merchantAmount = netAmount - platformFeeAmount;
  if (merchantAmount < 0) merchantAmount = 0;

  // Round to 2 decimal places
  merchantAmount = Math.round((merchantAmount + Number.EPSILON) * 100) / 100;

  return {
    merchantAmount,
    platformFeeAmount: Math.round((platformFeeAmount + Number.EPSILON) * 100) / 100,
    platformCommission: Math.round((platformFeeAmount + Number.EPSILON) * 100) / 100,
    commissionRate: effectiveRate,
    isCustomCommission: isCustomRate,
    defaultCommissionRate: defaultRate,
    stripeFee: Math.round((stripeFee + Number.EPSILON) * 100) / 100,
    netAmount: Math.round((netAmount + Number.EPSILON) * 100) / 100,
  };
}
