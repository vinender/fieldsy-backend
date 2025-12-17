//@ts-nocheck
import prisma from '../config/database';

/**
 * Get the effective commission rate for a field owner
 * Returns the custom rate if set, otherwise the system default
 * Also returns whether a custom rate was used and the default rate for auditing
 */
export async function getEffectiveCommissionRate(userId: string): Promise<{
  effectiveRate: number;
  isCustomRate: boolean;
  defaultRate: number;
}> {
  try {
    // Get the field owner's custom commission rate
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { commissionRate: true }
    });

    // Get the system default
    const settings = await prisma.systemSettings.findFirst();
    const defaultRate = settings?.defaultCommissionRate || 20;

    // If user has a custom rate, use it
    if (user?.commissionRate !== null && user?.commissionRate !== undefined) {
      return {
        effectiveRate: user.commissionRate,
        isCustomRate: true,
        defaultRate
      };
    }

    // Otherwise, use the system default
    return {
      effectiveRate: defaultRate,
      isCustomRate: false,
      defaultRate
    };
  } catch (error) {
    console.error('Error getting commission rate:', error);
    // Return default 20% on error
    return {
      effectiveRate: 20,
      isCustomRate: false,
      defaultRate: 20
    };
  }
}

/**
 * Calculate field owner amount and platform fee based on commission rate
 *
 * Commission rate represents what the PLATFORM takes as a percentage.
 * Example: If dog owner pays £100:
 * With 20% commission rate: Platform takes 20% = £20
 * Field owner gets the remaining 80% = £80
 */
export async function calculatePayoutAmounts(
  totalAmount: number,
  fieldOwnerId: string
): Promise<{
  fieldOwnerAmount: number;
  platformFeeAmount: number;
  platformCommission: number;
  commissionRate: number;
  isCustomCommission: boolean;
  defaultCommissionRate: number;
}> {
  const { effectiveRate, isCustomRate, defaultRate } = await getEffectiveCommissionRate(fieldOwnerId);

  // Platform takes the commission percentage
  const platformFeeAmount = (totalAmount * effectiveRate) / 100;
  const platformCommission = platformFeeAmount; // Same value, different name for DB compatibility

  // Field owner gets the remaining amount after platform commission
  const fieldOwnerAmount = totalAmount - platformFeeAmount;

  return {
    fieldOwnerAmount,
    platformFeeAmount,
    platformCommission, // DB field name
    commissionRate: effectiveRate,
    isCustomCommission: isCustomRate,
    defaultCommissionRate: defaultRate
  };
}
