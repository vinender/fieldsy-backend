/**
 * Connect Webhook Handler.
 * Handles Stripe Connect account events: account.updated, deauthorized, capability changes.
 */

import type Stripe from 'stripe';
import type { DatabaseAdapter } from '../types/adapter';
import type { Logger } from '../types/config';
import type { PayoutEventBus } from '../core/event-bus';

export class ConnectWebhookHandler {
  constructor(
    private adapter: DatabaseAdapter,
    private stripe: Stripe,
    private events: PayoutEventBus,
    private logger: Logger
  ) {}

  /**
   * Route a verified Stripe event to the appropriate handler.
   */
  async handleEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'account.updated':
        await this.handleAccountUpdated(event);
        break;
      case 'account.application.deauthorized':
        await this.handleAccountDeauthorized(event);
        break;
      case 'capability.updated':
        await this.handleCapabilityUpdated(event);
        break;
      default:
        this.logger.debug(`[ConnectWebhook] Unhandled event: ${event.type}`);
    }
  }

  private async handleAccountUpdated(event: Stripe.Event): Promise<void> {
    const account = event.data.object as Stripe.Account;
    this.logger.info(`[ConnectWebhook] Account updated: ${account.id} (charges: ${account.charges_enabled}, payouts: ${account.payouts_enabled})`);

    const existingAccount = await this.adapter.findConnectedAccountByStripeId(account.id);

    if (existingAccount) {
      const wasPayoutsEnabled = existingAccount.payoutsEnabled;

      await this.adapter.updateConnectedAccount(existingAccount.id, {
        chargesEnabled: account.charges_enabled ?? false,
        payoutsEnabled: account.payouts_enabled ?? false,
        detailsSubmitted: account.details_submitted ?? false,
        requirementsCurrentlyDue: account.requirements?.currently_due || [],
        requirementsEventuallyDue: account.requirements?.eventually_due || [],
        requirementsPastDue: account.requirements?.past_due || [],
      });

      // Notify if payouts just became enabled
      if (!wasPayoutsEnabled && account.payouts_enabled) {
        this.events.notifyUser(
          existingAccount.userId,
          'connect:account_ready',
          'Stripe Account Ready',
          'Your Stripe account is now fully set up! You can start receiving payouts.',
          {
            userId: existingAccount.userId,
            stripeAccountId: account.id,
            chargesEnabled: account.charges_enabled ?? false,
            payoutsEnabled: account.payouts_enabled ?? false,
          }
        );
      }

      // Notify if there are requirements due
      if (account.requirements?.currently_due?.length) {
        this.events.notifyUser(
          existingAccount.userId,
          'connect:requirements_due',
          'Action Required',
          'Your Stripe account needs additional information. Please complete the setup to receive payouts.',
          {
            userId: existingAccount.userId,
            stripeAccountId: account.id,
            chargesEnabled: account.charges_enabled ?? false,
            payoutsEnabled: account.payouts_enabled ?? false,
          }
        );
      }
    } else {
      // Create new record if metadata has userId
      const userId = account.metadata?.userId;
      if (userId) {
        this.logger.info(`[ConnectWebhook] Creating new connected account for user: ${userId}`);
        await this.adapter.createConnectedAccount({
          userId,
          stripeAccountId: account.id,
          chargesEnabled: account.charges_enabled ?? false,
          payoutsEnabled: account.payouts_enabled ?? false,
          detailsSubmitted: account.details_submitted ?? false,
          requirementsCurrentlyDue: account.requirements?.currently_due || [],
          requirementsEventuallyDue: account.requirements?.eventually_due || [],
          requirementsPastDue: account.requirements?.past_due || [],
        });
      }
    }
  }

  private async handleAccountDeauthorized(event: Stripe.Event): Promise<void> {
    const connectedAccountId = (event as any).account as string;
    if (!connectedAccountId) return;

    this.logger.info(`[ConnectWebhook] Account deauthorized: ${connectedAccountId}`);

    const existingAccount = await this.adapter.findConnectedAccountByStripeId(connectedAccountId);
    if (existingAccount) {
      await this.adapter.updateConnectedAccount(existingAccount.id, {
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
      });

      this.events.notifyUser(
        existingAccount.userId,
        'connect:account_disconnected',
        'Stripe Account Disconnected',
        'Your Stripe account has been disconnected. You will not receive payouts until you reconnect.',
        {
          userId: existingAccount.userId,
          stripeAccountId: connectedAccountId,
          chargesEnabled: false,
          payoutsEnabled: false,
        }
      );
    }
  }

  private async handleCapabilityUpdated(event: Stripe.Event): Promise<void> {
    const capability = event.data.object as Stripe.Capability;
    const connectedAccountId = (event as any).account as string;

    this.logger.debug(`[ConnectWebhook] Capability updated: ${capability.id} (${capability.status})`);

    if (connectedAccountId) {
      try {
        const account = await this.stripe.accounts.retrieve(connectedAccountId);
        await this.adapter.updateConnectedAccountByStripeId(connectedAccountId, {
          chargesEnabled: account.charges_enabled ?? false,
          payoutsEnabled: account.payouts_enabled ?? false,
        });
      } catch (err: any) {
        this.logger.error(`[ConnectWebhook] Error refreshing account: ${err.message}`);
      }
    }
  }
}
