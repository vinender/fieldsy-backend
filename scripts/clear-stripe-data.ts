/**
 * Clear all Stripe-related data from MongoDB after switching to a new Stripe account.
 *
 * This script:
 * - Clears stripeCustomerId from all users (so new Stripe customers get created)
 * - Deletes all saved payment methods (tied to old Stripe account)
 * - Deletes all Stripe connected accounts (field owners need to re-onboard)
 * - Deletes all payout records (from old Stripe account)
 * - Deletes all subscription records (from old Stripe account)
 * - Clears Stripe IDs from payment and transaction records (keeps the records themselves)
 *
 * Run: npx ts-node scripts/clear-stripe-data.ts
 */

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function clearStripeData() {
  console.log('=== Clearing Stripe Data for New Account ===\n');

  // 1. Clear stripeCustomerId from users
  const usersResult = await prisma.user.updateMany({
    where: { stripeCustomerId: { not: undefined } },
    data: { stripeCustomerId: null },
  });
  console.log(`✓ Cleared stripeCustomerId from ${usersResult.count} users`);

  // 2. Delete all payment methods
  const pmResult = await prisma.paymentMethod.deleteMany({});
  console.log(`✓ Deleted ${pmResult.count} payment methods`);

  // 3. Delete all payouts FIRST (has relation to StripeAccount)
  const payoutResult = await prisma.payout.deleteMany({});
  console.log(`✓ Deleted ${payoutResult.count} payout records`);

  // 4. Delete all Stripe connected accounts (after payouts are cleared)
  const stripeAccResult = await prisma.stripeAccount.deleteMany({});
  console.log(`✓ Deleted ${stripeAccResult.count} Stripe connected accounts`);

  // 5. Delete all subscriptions
  try {
    const subResult = await prisma.subscription.deleteMany({});
    console.log(`✓ Deleted ${subResult.count} subscription records`);
  } catch (e) {
    console.log('⊘ No subscription model found, skipping');
  }

  // 6. Clear Stripe IDs from payments (keep payment records)
  const paymentResult = await prisma.payment.updateMany({
    data: {
      stripePaymentId: null,
      stripeRefundId: null,
    },
  });
  console.log(`✓ Cleared Stripe IDs from ${paymentResult.count} payment records`);

  // 7. Clear Stripe IDs from transactions (keep transaction records)
  const txResult = await prisma.transaction.updateMany({
    data: {
      stripePaymentIntentId: null,
      stripeChargeId: null,
      stripeBalanceTransactionId: null,
      stripeTransferId: null,
      stripePayoutId: null,
      stripeRefundId: null,
    },
  });
  console.log(`✓ Cleared Stripe IDs from ${txResult.count} transaction records`);

  console.log('\n=== Done! All Stripe data cleared. ===');
  console.log('\nNext steps:');
  console.log('- Users will get new Stripe customers created on next payment');
  console.log('- Users need to re-add their payment methods (cards)');
  console.log('- Field owners need to re-onboard their Stripe Connect accounts');
}

clearStripeData()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
