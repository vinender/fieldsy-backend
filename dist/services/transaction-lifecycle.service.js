"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.transactionLifecycleService = exports.TransactionLifecycleService = exports.LIFECYCLE_STAGES = void 0;
//@ts-nocheck
const database_1 = __importDefault(require("../config/database"));
const stripe_config_1 = require("../config/stripe.config");
/**
 * Transaction Lifecycle Stages:
 *
 * 1. PAYMENT_RECEIVED - Dog owner's payment captured by Stripe
 * 2. FUNDS_PENDING - Funds in Stripe pending balance (typically 2-7 days)
 * 3. FUNDS_AVAILABLE - Funds available in Stripe balance for payout
 * 4. TRANSFERRED - Platform transferred funds to connected account
 * 5. PAYOUT_INITIATED - Payout to field owner's bank initiated
 * 6. PAYOUT_COMPLETED - Funds deposited in field owner's bank
 *
 * Additional stages for edge cases:
 * - REFUNDED - Payment was refunded
 * - FAILED - Payment or payout failed
 * - CANCELLED - Booking was cancelled
 */
exports.LIFECYCLE_STAGES = {
    PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
    FUNDS_PENDING: 'FUNDS_PENDING',
    FUNDS_AVAILABLE: 'FUNDS_AVAILABLE',
    TRANSFERRED: 'TRANSFERRED',
    PAYOUT_INITIATED: 'PAYOUT_INITIATED',
    PAYOUT_COMPLETED: 'PAYOUT_COMPLETED',
    REFUNDED: 'REFUNDED',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED'
};
class TransactionLifecycleService {
    /**
     * Create initial transaction when payment is received
     */
    async createPaymentTransaction(params) {
        try {
            // Check if transaction already exists for this payment intent
            const existing = await database_1.default.transaction.findFirst({
                where: { stripePaymentIntentId: params.stripePaymentIntentId }
            });
            if (existing) {
                console.log(`[TransactionLifecycle] Transaction already exists for PI: ${params.stripePaymentIntentId}`);
                return existing;
            }
            const transaction = await database_1.default.transaction.create({
                data: {
                    bookingId: params.bookingId,
                    userId: params.userId,
                    fieldOwnerId: params.fieldOwnerId,
                    amount: params.amount,
                    platformFee: params.platformFee,
                    netAmount: params.netAmount,
                    commissionRate: params.commissionRate,
                    isCustomCommission: params.isCustomCommission ?? false,
                    defaultCommissionRate: params.defaultCommissionRate,
                    type: 'PAYMENT',
                    status: 'COMPLETED',
                    lifecycleStage: exports.LIFECYCLE_STAGES.PAYMENT_RECEIVED,
                    stripePaymentIntentId: params.stripePaymentIntentId,
                    stripeChargeId: params.stripeChargeId,
                    connectedAccountId: params.connectedAccountId,
                    paymentReceivedAt: new Date(),
                    description: params.description || `Payment for booking ${params.bookingId}`,
                    metadata: {
                        bookingId: params.bookingId,
                        createdAt: new Date().toISOString()
                    }
                }
            });
            console.log(`[TransactionLifecycle] Created payment transaction: ${transaction.id} - Stage: PAYMENT_RECEIVED`);
            return transaction;
        }
        catch (error) {
            console.error('[TransactionLifecycle] Error creating payment transaction:', error);
            throw error;
        }
    }
    /**
     * Update transaction when charge is captured and balance transaction created
     */
    async updateFundsPending(stripePaymentIntentId, balanceTransactionId) {
        try {
            const transaction = await database_1.default.transaction.findFirst({
                where: { stripePaymentIntentId }
            });
            if (!transaction) {
                console.log(`[TransactionLifecycle] No transaction found for PI: ${stripePaymentIntentId}`);
                return null;
            }
            const updated = await database_1.default.transaction.update({
                where: { id: transaction.id },
                data: {
                    lifecycleStage: exports.LIFECYCLE_STAGES.FUNDS_PENDING,
                    stripeBalanceTransactionId: balanceTransactionId
                }
            });
            console.log(`[TransactionLifecycle] Updated to FUNDS_PENDING: ${transaction.id}`);
            return updated;
        }
        catch (error) {
            console.error('[TransactionLifecycle] Error updating funds pending:', error);
            return null;
        }
    }
    /**
     * Update transaction when funds become available in Stripe balance
     */
    async updateFundsAvailable(stripePaymentIntentId) {
        try {
            const transaction = await database_1.default.transaction.findFirst({
                where: { stripePaymentIntentId }
            });
            if (!transaction) {
                console.log(`[TransactionLifecycle] No transaction found for PI: ${stripePaymentIntentId}`);
                return null;
            }
            const updated = await database_1.default.transaction.update({
                where: { id: transaction.id },
                data: {
                    lifecycleStage: exports.LIFECYCLE_STAGES.FUNDS_AVAILABLE,
                    fundsAvailableAt: new Date()
                }
            });
            console.log(`[TransactionLifecycle] Updated to FUNDS_AVAILABLE: ${transaction.id}`);
            return updated;
        }
        catch (error) {
            console.error('[TransactionLifecycle] Error updating funds available:', error);
            return null;
        }
    }
    /**
     * Update transaction when transfer to connected account is made
     */
    async updateTransferred(params) {
        try {
            let transaction;
            if (params.stripePaymentIntentId) {
                transaction = await database_1.default.transaction.findFirst({
                    where: { stripePaymentIntentId: params.stripePaymentIntentId }
                });
            }
            else if (params.bookingId) {
                transaction = await database_1.default.transaction.findFirst({
                    where: { bookingId: params.bookingId, type: 'PAYMENT' }
                });
            }
            if (!transaction) {
                console.log(`[TransactionLifecycle] No transaction found for transfer update`);
                return null;
            }
            const updated = await database_1.default.transaction.update({
                where: { id: transaction.id },
                data: {
                    lifecycleStage: exports.LIFECYCLE_STAGES.TRANSFERRED,
                    stripeTransferId: params.stripeTransferId,
                    connectedAccountId: params.connectedAccountId,
                    transferredAt: new Date()
                }
            });
            console.log(`[TransactionLifecycle] Updated to TRANSFERRED: ${transaction.id}`);
            return updated;
        }
        catch (error) {
            console.error('[TransactionLifecycle] Error updating transferred:', error);
            return null;
        }
    }
    /**
     * Update transaction when payout is initiated to field owner's bank
     */
    async updatePayoutInitiated(params) {
        try {
            let transaction;
            if (params.stripeTransferId) {
                transaction = await database_1.default.transaction.findFirst({
                    where: { stripeTransferId: params.stripeTransferId }
                });
            }
            else if (params.bookingId) {
                transaction = await database_1.default.transaction.findFirst({
                    where: { bookingId: params.bookingId, type: 'PAYMENT' }
                });
            }
            if (!transaction) {
                console.log(`[TransactionLifecycle] No transaction found for payout update`);
                return null;
            }
            const updated = await database_1.default.transaction.update({
                where: { id: transaction.id },
                data: {
                    lifecycleStage: exports.LIFECYCLE_STAGES.PAYOUT_INITIATED,
                    stripePayoutId: params.stripePayoutId,
                    payoutInitiatedAt: new Date()
                }
            });
            console.log(`[TransactionLifecycle] Updated to PAYOUT_INITIATED: ${transaction.id}`);
            return updated;
        }
        catch (error) {
            console.error('[TransactionLifecycle] Error updating payout initiated:', error);
            return null;
        }
    }
    /**
     * Update transaction when payout reaches field owner's bank
     */
    async updatePayoutCompleted(stripePayoutId) {
        try {
            const transaction = await database_1.default.transaction.findFirst({
                where: { stripePayoutId }
            });
            if (!transaction) {
                // Try to find by looking at bookings connected to this payout
                console.log(`[TransactionLifecycle] No transaction found for payout: ${stripePayoutId}`);
                return null;
            }
            const updated = await database_1.default.transaction.update({
                where: { id: transaction.id },
                data: {
                    lifecycleStage: exports.LIFECYCLE_STAGES.PAYOUT_COMPLETED,
                    payoutCompletedAt: new Date()
                }
            });
            console.log(`[TransactionLifecycle] Updated to PAYOUT_COMPLETED: ${transaction.id}`);
            return updated;
        }
        catch (error) {
            console.error('[TransactionLifecycle] Error updating payout completed:', error);
            return null;
        }
    }
    /**
     * Update transaction for refund
     */
    async updateRefunded(params) {
        try {
            let transaction;
            if (params.stripePaymentIntentId) {
                transaction = await database_1.default.transaction.findFirst({
                    where: { stripePaymentIntentId: params.stripePaymentIntentId }
                });
            }
            else if (params.bookingId) {
                transaction = await database_1.default.transaction.findFirst({
                    where: { bookingId: params.bookingId, type: 'PAYMENT' }
                });
            }
            if (!transaction) {
                console.log(`[TransactionLifecycle] No transaction found for refund update`);
                return null;
            }
            // Update the original payment transaction
            await database_1.default.transaction.update({
                where: { id: transaction.id },
                data: {
                    lifecycleStage: exports.LIFECYCLE_STAGES.REFUNDED,
                    stripeRefundId: params.stripeRefundId,
                    refundedAt: new Date()
                }
            });
            // Create a separate refund transaction record
            const refundTransaction = await database_1.default.transaction.create({
                data: {
                    bookingId: transaction.bookingId,
                    userId: transaction.userId,
                    fieldOwnerId: transaction.fieldOwnerId,
                    amount: -params.refundAmount, // Negative amount for refund
                    type: 'REFUND',
                    status: 'COMPLETED',
                    lifecycleStage: exports.LIFECYCLE_STAGES.REFUNDED,
                    stripePaymentIntentId: transaction.stripePaymentIntentId,
                    stripeRefundId: params.stripeRefundId,
                    connectedAccountId: transaction.connectedAccountId,
                    refundedAt: new Date(),
                    description: `Refund for booking ${transaction.bookingId}`,
                    metadata: {
                        originalTransactionId: transaction.id,
                        refundAmount: params.refundAmount
                    }
                }
            });
            console.log(`[TransactionLifecycle] Created refund transaction: ${refundTransaction.id}`);
            return refundTransaction;
        }
        catch (error) {
            console.error('[TransactionLifecycle] Error updating refunded:', error);
            return null;
        }
    }
    /**
     * Update transaction for failure
     */
    async updateFailed(params) {
        try {
            let transaction;
            if (params.stripePaymentIntentId) {
                transaction = await database_1.default.transaction.findFirst({
                    where: { stripePaymentIntentId: params.stripePaymentIntentId }
                });
            }
            else if (params.bookingId) {
                transaction = await database_1.default.transaction.findFirst({
                    where: { bookingId: params.bookingId, type: 'PAYMENT' }
                });
            }
            if (!transaction) {
                console.log(`[TransactionLifecycle] No transaction found for failure update`);
                return null;
            }
            const updated = await database_1.default.transaction.update({
                where: { id: transaction.id },
                data: {
                    status: 'FAILED',
                    lifecycleStage: exports.LIFECYCLE_STAGES.FAILED,
                    failureCode: params.failureCode,
                    failureMessage: params.failureMessage
                }
            });
            console.log(`[TransactionLifecycle] Updated to FAILED: ${transaction.id}`);
            return updated;
        }
        catch (error) {
            console.error('[TransactionLifecycle] Error updating failed:', error);
            return null;
        }
    }
    /**
     * Get transaction lifecycle by booking ID
     */
    async getTransactionsByBookingId(bookingId) {
        try {
            const transactions = await database_1.default.transaction.findMany({
                where: { bookingId },
                orderBy: { createdAt: 'desc' },
                include: {
                    user: {
                        select: { id: true, name: true, email: true }
                    },
                    booking: {
                        include: {
                            field: {
                                include: {
                                    owner: { select: { id: true, name: true, email: true } }
                                }
                            }
                        }
                    }
                }
            });
            return transactions;
        }
        catch (error) {
            console.error('[TransactionLifecycle] Error getting transactions by booking:', error);
            return [];
        }
    }
    /**
     * Get transaction lifecycle by payment intent
     */
    async getTransactionByPaymentIntent(stripePaymentIntentId) {
        try {
            const transaction = await database_1.default.transaction.findFirst({
                where: { stripePaymentIntentId },
                include: {
                    user: {
                        select: { id: true, name: true, email: true }
                    },
                    booking: {
                        include: {
                            field: {
                                include: {
                                    owner: { select: { id: true, name: true, email: true } }
                                }
                            }
                        }
                    }
                }
            });
            return transaction;
        }
        catch (error) {
            console.error('[TransactionLifecycle] Error getting transaction by PI:', error);
            return null;
        }
    }
    /**
     * Check and update funds availability for pending transactions
     * This can be run as a scheduled job to update lifecycle stages
     */
    async checkAndUpdateFundsAvailability() {
        try {
            // Find transactions in FUNDS_PENDING stage older than 2 days
            const twoDaysAgo = new Date();
            twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
            const pendingTransactions = await database_1.default.transaction.findMany({
                where: {
                    lifecycleStage: exports.LIFECYCLE_STAGES.FUNDS_PENDING,
                    paymentReceivedAt: { lte: twoDaysAgo }
                }
            });
            console.log(`[TransactionLifecycle] Checking ${pendingTransactions.length} pending transactions`);
            for (const transaction of pendingTransactions) {
                if (transaction.stripeChargeId) {
                    try {
                        const charge = await stripe_config_1.stripe.charges.retrieve(transaction.stripeChargeId);
                        // Check if balance transaction is available
                        if (charge.balance_transaction) {
                            const balanceTransaction = await stripe_config_1.stripe.balanceTransactions.retrieve(typeof charge.balance_transaction === 'string'
                                ? charge.balance_transaction
                                : charge.balance_transaction.id);
                            if (balanceTransaction.status === 'available') {
                                await this.updateFundsAvailable(transaction.stripePaymentIntentId);
                            }
                        }
                    }
                    catch (stripeError) {
                        console.error(`[TransactionLifecycle] Error checking charge ${transaction.stripeChargeId}:`, stripeError);
                    }
                }
            }
        }
        catch (error) {
            console.error('[TransactionLifecycle] Error in checkAndUpdateFundsAvailability:', error);
        }
    }
}
exports.TransactionLifecycleService = TransactionLifecycleService;
exports.transactionLifecycleService = new TransactionLifecycleService();
