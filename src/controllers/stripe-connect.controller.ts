//@ts-nocheck
import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import Stripe from 'stripe';
import { payoutService } from '../services/payout.service';
import { heldPayoutService } from '../services/held-payout.service';
import { FRONTEND_URL } from '../config/constants';

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-07-30.basil'
});

class StripeConnectController {
  // Create Stripe Connect account
  createConnectAccount = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;

    // Only field owners can create connect accounts
    if (userRole !== 'FIELD_OWNER') {
      throw new AppError('Only field owners can connect bank accounts', 403);
    }

    // Check if user already has a Stripe account
    const existingAccount = await prisma.stripeAccount.findUnique({
      where: { userId }
    });

    if (existingAccount) {
      // Return existing account
      return res.json({
        success: true,
        data: {
          hasAccount: true,
          accountId: existingAccount.id,
          chargesEnabled: existingAccount.chargesEnabled,
          payoutsEnabled: existingAccount.payoutsEnabled,
          detailsSubmitted: existingAccount.detailsSubmitted,
          requirementsCurrentlyDue: existingAccount.requirementsCurrentlyDue
        }
      });
    }

    // Get user details
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Create Stripe Connect account
    let account;
    try {
      account = await stripe.accounts.create({
        type: 'express',
        country: 'GB', // Default to UK
        email: user.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true }
        },
        business_type: 'individual',
        metadata: {
          userId: userId
        }
      });
    } catch (stripeError: any) {
      console.error('Stripe Connect Error:', stripeError);
      // If Stripe Connect is not enabled, provide a helpful message
      if (stripeError.message?.includes('Connect')) {
        throw new AppError(
          'Stripe Connect is not configured for this account. Please contact support.',
          400
        );
      }
      throw new AppError(stripeError.message || 'Failed to create Stripe account', 400);
    }

    // Save account to database
    const stripeAccount = await prisma.stripeAccount.create({
      data: {
        userId,
        stripeAccountId: account.id,
        accountType: 'express',
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        defaultCurrency: account.default_currency || 'gbp',
        country: account.country || 'GB',
        email: user.email
      }
    });

    res.json({
      success: true,
      message: 'Stripe Connect account created successfully',
      data: {
        accountId: stripeAccount.id,
        stripeAccountId: account.id
      }
    });
  });

  // Generate Stripe Connect onboarding link
  getOnboardingLink = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;
    const { returnUrl, refreshUrl, isMobile } = req.body;

    // Get Stripe account
    const stripeAccount = await prisma.stripeAccount.findUnique({
      where: { userId }
    });

    if (!stripeAccount) {
      throw new AppError('No Stripe account found. Please create one first.', 404);
    }

    // Check if account needs updating or initial onboarding
    const account = await stripe.accounts.retrieve(stripeAccount.stripeAccountId);

    // Stripe requires HTTPS URLs - app deep links are not supported
    // For mobile apps, we need to use a web redirect page that then deep links back to the app
    let finalReturnUrl: string;
    let finalRefreshUrl: string;

    if (isMobile) {
      // For mobile, use web-based redirect URLs that will deep link back to app
      // The web pages will handle the deep link redirect
      finalReturnUrl = `${FRONTEND_URL}/stripe-redirect?status=success&type=mobile`;
      finalRefreshUrl = `${FRONTEND_URL}/stripe-redirect?status=refresh&type=mobile`;
      console.log(`Mobile redirect URLs: return=${finalReturnUrl}, refresh=${finalRefreshUrl}`);
    } else {
      // For web, use provided URLs or defaults
      finalReturnUrl = returnUrl || `${FRONTEND_URL}/field-owner/payouts?success=true`;
      finalRefreshUrl = refreshUrl || `${FRONTEND_URL}/field-owner/payouts?refresh=true`;
    }

    // Validate URLs are HTTPS in production
    if (process.env.NODE_ENV === 'production') {
      if (!finalReturnUrl.startsWith('https://') || !finalRefreshUrl.startsWith('https://')) {
        throw new AppError('Return and refresh URLs must use HTTPS in production', 400);
      }
    }

    // For Express accounts, we always use 'account_onboarding' type
    // The onboarding flow will automatically show only the required fields
    // based on what's missing or needs to be updated
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccount.stripeAccountId,
      refresh_url: finalRefreshUrl,
      return_url: finalReturnUrl,
      type: 'account_onboarding', // Always use account_onboarding for Express accounts
      // Collection options can be specified to focus on specific requirements
      collection_options: {
        fields: 'eventually_due', // This will prioritize eventually due fields in the onboarding flow
        future_requirements: 'include' // Include future requirements in the collection
      }
    });

    console.log(`Created onboarding link for user ${userId}, account ${stripeAccount.stripeAccountId}, isMobile: ${isMobile}`);

    res.json({
      success: true,
      data: {
        url: accountLink.url,
        type: 'account_onboarding',
        isMobile: isMobile || false
      }
    });
  });

  // Get Stripe account status
  getAccountStatus = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;

    // Get Stripe account from database
    const stripeAccount = await prisma.stripeAccount.findUnique({
      where: { userId }
    });

    if (!stripeAccount) {
      return res.json({
        success: true,
        data: {
          hasAccount: false
        }
      });
    }

    // Get updated account info from Stripe
    const account = await stripe.accounts.retrieve(stripeAccount.stripeAccountId);

    // Check if account just became fully enabled
    const wasNotEnabled = !stripeAccount.chargesEnabled || !stripeAccount.payoutsEnabled;
    const isNowEnabled = account.charges_enabled && account.payouts_enabled;
    
    // Update database with latest info
    await prisma.stripeAccount.update({
      where: { id: stripeAccount.id },
      data: {
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
        requirementsCurrentlyDue: account.requirements?.currently_due || [],
        requirementsPastDue: account.requirements?.past_due || [],
        requirementsEventuallyDue: account.requirements?.eventually_due || []
      }
    });
    
    // If account just became fully enabled, release held payouts and process pending ones
    if (wasNotEnabled && isNowEnabled) {
      console.log(`Stripe account for user ${userId} is now fully enabled. Releasing held payouts...`);
      
      // First, release any held payouts
      try {
        await heldPayoutService.releaseHeldPayouts(userId);
        console.log(`Released held payouts for user ${userId}`);
      } catch (error) {
        console.error(`Failed to release held payouts for user ${userId}:`, error);
        // Don't throw - continue with processing
      }
      
      // Then process pending payouts
      try {
        const results = await payoutService.processPendingPayouts(userId);
        console.log(`Processed pending payouts for user ${userId}:`, results);
      } catch (error) {
        console.error(`Failed to process pending payouts for user ${userId}:`, error);
        // Don't throw - continue with response
      }
    }

    // Check if account is restricted or has issues
    const hasCriticalRequirements = (account.requirements?.currently_due && account.requirements.currently_due.length > 0) ||
                                   (account.requirements?.past_due && account.requirements.past_due.length > 0);
    const hasEventualRequirements = account.requirements?.eventually_due && account.requirements.eventually_due.length > 0;
    const hasRequirements = hasCriticalRequirements || hasEventualRequirements;
    const isRestricted = !account.charges_enabled || !account.payouts_enabled;
    const requiresAction = hasCriticalRequirements || isRestricted; // Only critical requirements need immediate action

    // Format requirements for frontend
    const formatRequirements = (requirements: string[] = []) => {
      return requirements.map(req => {
        // Convert Stripe requirement codes to human-readable text
        const requirementLabels: { [key: string]: string } = {
          'individual.verification.document': 'Identity verification document',
          'individual.dob.day': 'Date of birth',
          'individual.dob.month': 'Date of birth',
          'individual.dob.year': 'Date of birth',
          'individual.first_name': 'First name',
          'individual.last_name': 'Last name',
          'individual.address.line1': 'Address',
          'individual.address.city': 'City',
          'individual.address.postal_code': 'Postal code',
          'individual.address.country': 'Country',
          'individual.email': 'Email address',
          'individual.phone': 'Phone number',
          'external_account': 'Bank account details',
          'tos_acceptance.date': 'Terms of service acceptance',
          'tos_acceptance.ip': 'Terms of service acceptance'
        };
        return {
          code: req,
          label: requirementLabels[req] || req.replace(/_/g, ' ').replace(/\./g, ' - ')
        };
      });
    };

    res.json({
      success: true,
      data: {
        hasAccount: true,
        accountId: stripeAccount.id,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
        requiresAction,
        isRestricted,
        hasRequirements,
        hasCriticalRequirements,
        hasEventualRequirements,
        requirements: {
          currentlyDue: formatRequirements(account.requirements?.currently_due),
          pastDue: formatRequirements(account.requirements?.past_due),
          eventuallyDue: formatRequirements(account.requirements?.eventually_due),
          errors: account.requirements?.errors || [],
          disabledReason: account.requirements?.disabled_reason || null
        },
        bankAccountLast4: stripeAccount.bankAccountLast4,
        bankAccountBrand: stripeAccount.bankAccountBrand
      }
    });
  });

  // Get Stripe balance
  getBalance = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;

    // Get Stripe account
    const stripeAccount = await prisma.stripeAccount.findUnique({
      where: { userId }
    });

    if (!stripeAccount) {
      return res.json({
        success: true,
        data: {
          availableBalance: 0,
          pendingBalance: 0,
          currency: 'gbp'
        }
      });
    }

    // Get balance from Stripe
    let availableBalance = 0;
    let pendingBalance = 0;
    
    try {
      const balance = await stripe.balance.retrieve({
        stripeAccount: stripeAccount.stripeAccountId
      });

      // Get GBP balance (or default currency)
      const available = balance.available.find(b => b.currency === 'gbp');
      const pending = balance.pending.find(b => b.currency === 'gbp');
      
      availableBalance = available ? available.amount / 100 : 0;
      pendingBalance = pending ? pending.amount / 100 : 0;
    } catch (error) {
      console.error('Error fetching Stripe balance:', error);
    }

    res.json({
      success: true,
      data: {
        availableBalance,
        pendingBalance,
        currency: 'gbp'
      }
    });
  });

  // Create manual payout (if instant payouts are enabled)
  createPayout = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;
    const { amount, currency = 'gbp', method = 'standard' } = req.body;

    // Get Stripe account
    const stripeAccount = await prisma.stripeAccount.findUnique({
      where: { userId }
    });

    if (!stripeAccount) {
      throw new AppError('No Stripe account found', 404);
    }

    if (!stripeAccount.payoutsEnabled) {
      throw new AppError('Payouts are not enabled for your account', 400);
    }

    // Create payout in Stripe
    const payout = await stripe.payouts.create(
      {
        amount: Math.round(amount * 100), // Convert to smallest currency unit
        currency,
        method: method as Stripe.PayoutCreateParams.Method,
        metadata: {
          userId
        }
      },
      {
        stripeAccount: stripeAccount.stripeAccountId
      }
    );

    // Save payout to database
    const savedPayout = await prisma.payout.create({
      data: {
        stripeAccountId: stripeAccount.id,
        stripePayoutId: payout.id,
        amount: payout.amount,
        currency: payout.currency,
        status: payout.status,
        method: method,
        arrivalDate: payout.arrival_date ? new Date(payout.arrival_date * 1000) : null
      }
    });

    res.json({
      success: true,
      message: 'Payout initiated successfully',
      data: savedPayout
    });
  });

  // Update bank account
  updateBankAccount = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;

    // Get Stripe account
    const stripeAccount = await prisma.stripeAccount.findUnique({
      where: { userId }
    });

    if (!stripeAccount) {
      throw new AppError('No Stripe account found', 404);
    }

    // For Express accounts, we use account_onboarding type
    // The onboarding flow will automatically detect what needs to be updated
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccount.stripeAccountId,
      refresh_url: `${process.env.FRONTEND_URL}/field-owner/payouts?refresh=true`,
      return_url: `${process.env.FRONTEND_URL}/field-owner/payouts?updated=true`,
      type: 'account_onboarding', // Express accounts only support account_onboarding
      collection_options: {
        fields: 'currently_due' // Focus on currently due requirements
      }
    });

    res.json({
      success: true,
      data: {
        url: accountLink.url
      }
    });
  });

  // Disconnect Stripe account
  disconnectAccount = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;

    // Get Stripe account
    const stripeAccount = await prisma.stripeAccount.findUnique({
      where: { userId }
    });

    if (!stripeAccount) {
      throw new AppError('No Stripe account found', 404);
    }

    // Delete account from Stripe
    try {
      await stripe.accounts.del(stripeAccount.stripeAccountId);
    } catch (error) {
      console.error('Error deleting Stripe account:', error);
    }

    // Delete from database
    await prisma.stripeAccount.delete({
      where: { id: stripeAccount.id }
    });

    res.json({
      success: true,
      message: 'Bank account disconnected successfully'
    });
  });

  // Get payout history
  getPayoutHistory = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;
    const { page = 1, limit = 10, status } = req.query;

    // Get Stripe account
    const stripeAccount = await prisma.stripeAccount.findUnique({
      where: { userId }
    });

    if (!stripeAccount) {
      return res.json({
        success: true,
        data: {
          payouts: [],
          total: 0,
          page: Number(page),
          totalPages: 0
        }
      });
    }

    // Build filter
    const filter: any = {
      stripeAccountId: stripeAccount.id
    };

    if (status) {
      filter.status = status as string;
    }

    // Get payouts
    const [payouts, total] = await Promise.all([
      prisma.payout.findMany({
        where: filter,
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
        orderBy: { createdAt: 'desc' }
      }),
      prisma.payout.count({ where: filter })
    ]);

    res.json({
      success: true,
      data: {
        payouts,
        total,
        page: Number(page),
        totalPages: Math.ceil(total / Number(limit))
      }
    });
  });
}

export default new StripeConnectController();
