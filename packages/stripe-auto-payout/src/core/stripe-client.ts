/**
 * Stripe client factory. Creates a configured Stripe instance from the config.
 */

import Stripe from 'stripe';
import type { StripeAutoPayoutConfig } from '../types/config';

export function createStripeClient(config: StripeAutoPayoutConfig): Stripe {
  if (!config.stripe.secretKey) {
    throw new Error('[StripeAutoPayout] stripe.secretKey is required');
  }

  return new Stripe(config.stripe.secretKey, {
    apiVersion: (config.stripe.apiVersion as any) || '2024-12-18.acacia',
    typescript: true,
  });
}
