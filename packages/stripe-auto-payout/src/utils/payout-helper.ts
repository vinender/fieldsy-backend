/**
 * Helper to create a payout on a connected Stripe account.
 * Takes a Stripe client as parameter instead of importing a global singleton.
 */

import type Stripe from 'stripe';

export interface CreatePayoutParams {
  stripeAccountId: string;
  amountInMinorUnits: number;
  currency?: string;
  metadata?: Record<string, string>;
  description?: string;
  method?: 'standard' | 'instant';
}

/**
 * Create a payout on a connected Stripe account.
 * Returns the Stripe payout object so callers can persist status/arrival details.
 */
export async function createConnectedAccountPayout(
  stripe: Stripe,
  {
    stripeAccountId,
    amountInMinorUnits,
    currency = 'gbp',
    metadata = {},
    description,
    method = 'standard',
  }: CreatePayoutParams
): Promise<Stripe.Payout> {
  const payout = await stripe.payouts.create(
    {
      amount: amountInMinorUnits,
      currency,
      metadata,
      description,
      method,
    },
    {
      stripeAccount: stripeAccountId,
    }
  );

  return payout;
}
