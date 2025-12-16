/**
 * Seed Test Balance Script
 *
 * This script creates a test charge using Stripe's special test card
 * that makes funds immediately available for transfers.
 *
 * Test card: 4000000000000077 (Charge succeeds and funds are immediately available)
 *
 * Usage: npx ts-node scripts/seed-test-balance.ts
 */

import Stripe from 'stripe';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from the backend directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia' as any,
});

async function seedTestBalance() {
  console.log('🏦 Seeding Stripe Test Balance...\n');

  try {
    // Check current balance
    const balanceBefore = await stripe.balance.retrieve();
    const availableBefore = balanceBefore.available.find(b => b.currency === 'gbp')?.amount || 0;
    const pendingBefore = balanceBefore.pending.find(b => b.currency === 'gbp')?.amount || 0;

    console.log('Current Balance:');
    console.log(`  Available: £${(availableBefore / 100).toFixed(2)}`);
    console.log(`  Pending: £${(pendingBefore / 100).toFixed(2)}\n`);

    // Create a PaymentIntent with the special test card that makes funds immediately available
    // Card 4000000000000077 - Charge succeeds and funds are immediately available
    const amounts = [50000000, 10000000, 15000000]; // £50, £100, £150 in pence

    for (const amount of amounts) {
      console.log(`Creating charge for £${(amount / 100).toFixed(2)}...`);

      // Use Stripe's test token instead of raw card numbers
      // tok_bypassPending - Token that results in charges with funds immediately available
      const paymentMethod = await stripe.paymentMethods.create({
        type: 'card',
        card: {
          token: 'tok_bypassPending', // Stripe test token for immediate fund availability
        },
      });

      // Create and confirm a PaymentIntent
      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: 'gbp',
        payment_method: paymentMethod.id,
        confirm: true,
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: 'never',
        },
        metadata: {
          purpose: 'test_balance_seed',
          createdAt: new Date().toISOString(),
        },
        description: 'Test charge to seed platform balance',
      });

      if (paymentIntent.status === 'succeeded') {
        console.log(`  ✅ Charge successful: ${paymentIntent.id}`);

        // Get the charge to check balance transaction
        if (paymentIntent.latest_charge) {
          const chargeId = typeof paymentIntent.latest_charge === 'string'
            ? paymentIntent.latest_charge
            : paymentIntent.latest_charge.id;

          const charge = await stripe.charges.retrieve(chargeId);

          if (charge.balance_transaction) {
            const btId = typeof charge.balance_transaction === 'string'
              ? charge.balance_transaction
              : charge.balance_transaction.id;

            const balanceTransaction = await stripe.balanceTransactions.retrieve(btId);
            console.log(`  Balance Transaction: ${btId}`);
            console.log(`  Status: ${balanceTransaction.status}`);
            console.log(`  Available On: ${new Date(balanceTransaction.available_on * 1000).toISOString()}`);
          }
        }
      } else {
        console.log(`  ❌ Charge status: ${paymentIntent.status}`);
      }

      console.log('');
    }

    // Check balance after
    // Wait a moment for balance to update
    await new Promise(resolve => setTimeout(resolve, 2000));

    const balanceAfter = await stripe.balance.retrieve();
    const availableAfter = balanceAfter.available.find(b => b.currency === 'gbp')?.amount || 0;
    const pendingAfter = balanceAfter.pending.find(b => b.currency === 'gbp')?.amount || 0;

    console.log('Updated Balance:');
    console.log(`  Available: £${(availableAfter / 100).toFixed(2)} (was £${(availableBefore / 100).toFixed(2)})`);
    console.log(`  Pending: £${(pendingAfter / 100).toFixed(2)} (was £${(pendingBefore / 100).toFixed(2)})`);
    console.log(`\n  Total added: £${((availableAfter + pendingAfter - availableBefore - pendingBefore) / 100).toFixed(2)}`);

    console.log('\n✅ Test balance seeding complete!');
    console.log('\nNote: With card 4000000000000077, funds should be immediately available.');
    console.log('If funds show as pending, they will become available according to your Stripe payout schedule.');

  } catch (error: any) {
    console.error('❌ Error seeding test balance:', error.message);
    if (error.type === 'StripeCardError') {
      console.error('Card error:', error.code);
    }
    process.exit(1);
  }
}

// Run the script
seedTestBalance();
