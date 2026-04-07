//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get checkChargeFundsAvailable () {
        return checkChargeFundsAvailable;
    },
    get checkConnectedAccountBalance () {
        return checkConnectedAccountBalance;
    },
    get checkPlatformBalance () {
        return checkPlatformBalance;
    },
    get getChargeAvailabilityDate () {
        return getChargeAvailabilityDate;
    },
    get safeTransferWithBalanceGate () {
        return safeTransferWithBalanceGate;
    }
});
const _stripeconfig = require("../config/stripe.config");
async function checkPlatformBalance(amountInCents, currency = 'gbp') {
    try {
        const balance = await _stripeconfig.stripe.balance.retrieve();
        // Find available and pending balances for the currency
        const availableBalance = balance.available.find((b)=>b.currency === currency);
        const pendingBalance = balance.pending.find((b)=>b.currency === currency);
        const availableAmount = availableBalance?.amount || 0;
        const pendingAmount = pendingBalance?.amount || 0;
        const hasAvailableBalance = availableAmount >= amountInCents;
        return {
            hasAvailableBalance,
            availableAmount,
            pendingAmount,
            currency,
            canTransfer: hasAvailableBalance,
            message: hasAvailableBalance ? `Sufficient balance: ${availableAmount / 100} ${currency.toUpperCase()} available` : `Insufficient balance: Need ${amountInCents / 100} ${currency.toUpperCase()}, only ${availableAmount / 100} available (${pendingAmount / 100} pending)`
        };
    } catch (error) {
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
async function checkConnectedAccountBalance(stripeAccountId, amountInCents, currency = 'gbp') {
    try {
        const balance = await _stripeconfig.stripe.balance.retrieve({
            stripeAccount: stripeAccountId
        });
        const availableBalance = balance.available.find((b)=>b.currency === currency);
        const pendingBalance = balance.pending.find((b)=>b.currency === currency);
        const availableAmount = availableBalance?.amount || 0;
        const pendingAmount = pendingBalance?.amount || 0;
        const hasAvailableBalance = availableAmount >= amountInCents;
        return {
            hasAvailableBalance,
            availableAmount,
            pendingAmount,
            currency,
            canTransfer: hasAvailableBalance,
            message: hasAvailableBalance ? `Connected account has sufficient balance: ${availableAmount / 100} ${currency.toUpperCase()}` : `Connected account insufficient: Need ${amountInCents / 100} ${currency.toUpperCase()}, only ${availableAmount / 100} available`
        };
    } catch (error) {
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
async function getChargeAvailabilityDate(chargeId) {
    try {
        const charge = await _stripeconfig.stripe.charges.retrieve(chargeId);
        if (charge.balance_transaction) {
            const balanceTransactionId = typeof charge.balance_transaction === 'string' ? charge.balance_transaction : charge.balance_transaction.id;
            const balanceTransaction = await _stripeconfig.stripe.balanceTransactions.retrieve(balanceTransactionId);
            // available_on is a Unix timestamp
            if (balanceTransaction.available_on) {
                return new Date(balanceTransaction.available_on * 1000);
            }
        }
        return null;
    } catch (error) {
        console.error('[StripeBalance] Error getting charge availability date:', error);
        return null;
    }
}
async function checkChargeFundsAvailable(chargeId) {
    try {
        const charge = await _stripeconfig.stripe.charges.retrieve(chargeId);
        if (!charge.balance_transaction) {
            return {
                isAvailable: false,
                availableOn: null,
                status: 'unknown',
                message: 'No balance transaction associated with charge'
            };
        }
        const balanceTransactionId = typeof charge.balance_transaction === 'string' ? charge.balance_transaction : charge.balance_transaction.id;
        const balanceTransaction = await _stripeconfig.stripe.balanceTransactions.retrieve(balanceTransactionId);
        const availableOn = balanceTransaction.available_on ? new Date(balanceTransaction.available_on * 1000) : null;
        const now = new Date();
        const isAvailable = balanceTransaction.status === 'available' || availableOn !== null && now >= availableOn;
        return {
            isAvailable,
            availableOn,
            status: isAvailable ? 'available' : 'pending',
            message: isAvailable ? 'Funds are available for transfer' : `Funds will be available on ${availableOn?.toISOString() || 'unknown date'}`
        };
    } catch (error) {
        console.error('[StripeBalance] Error checking charge funds availability:', error);
        return {
            isAvailable: false,
            availableOn: null,
            status: 'unknown',
            message: `Error checking availability: ${error.message}`
        };
    }
}
async function safeTransferWithBalanceGate(params) {
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
        const transfer = await _stripeconfig.stripe.transfers.create({
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
    } catch (error) {
        console.error('[StripeBalance] Transfer failed:', error);
        // Check if it's a balance-related error
        const isBalanceError = error.code === 'balance_insufficient' || error.message?.includes('balance') || error.message?.includes('insufficient');
        return {
            success: false,
            transfer: null,
            reason: error.message,
            shouldDefer: isBalanceError // If balance error, defer for retry
        };
    }
}

//# sourceMappingURL=stripe-balance.helper.js.map