"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentMethodController = void 0;
const stripe_config_1 = require("../config/stripe.config");
const database_1 = __importDefault(require("../config/database"));
exports.paymentMethodController = {
    // Create or get Stripe customer for user
    async getOrCreateStripeCustomer(userId) {
        const user = await database_1.default.user.findUnique({
            where: { id: userId }
        });
        if (!user) {
            throw new Error('User not found');
        }
        // If user already has a Stripe customer ID, verify it still exists
        if (user.stripeCustomerId) {
            try {
                // Try to retrieve the customer from Stripe
                const customer = await stripe_config_1.stripe.customers.retrieve(user.stripeCustomerId);
                // Check if customer is deleted
                if (customer.deleted) {
                    console.log(`Stripe customer ${user.stripeCustomerId} was deleted, creating new one`);
                }
                else {
                    // Customer exists and is valid
                    return user.stripeCustomerId;
                }
            }
            catch (error) {
                // Customer doesn't exist in Stripe (404 error)
                if (error.statusCode === 404 || error.code === 'resource_missing') {
                    console.log(`Stripe customer ${user.stripeCustomerId} not found, creating new one`);
                }
                else {
                    // Some other error occurred, throw it
                    throw error;
                }
            }
        }
        // Create a new Stripe customer
        const customer = await stripe_config_1.stripe.customers.create({
            email: user.email,
            name: user.name || undefined,
            metadata: {
                userId: user.id
            }
        });
        // Save the Stripe customer ID to the user
        await database_1.default.user.update({
            where: { id: userId },
            data: { stripeCustomerId: customer.id }
        });
        return customer.id;
    },
    // Create setup intent for adding a new card
    async createSetupIntent(req, res) {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    error: 'Unauthorized'
                });
            }
            // Get or create Stripe customer for this user
            const customerId = await exports.paymentMethodController.getOrCreateStripeCustomer(userId);
            // Create a SetupIntent to collect card details securely
            const setupIntent = await stripe_config_1.stripe.setupIntents.create({
                customer: customerId,
                payment_method_types: ['card'],
                usage: 'off_session', // Allow future payments
                metadata: {
                    userId,
                    createdAt: new Date().toISOString()
                }
            });
            if (!setupIntent.client_secret) {
                throw new Error('Failed to create setup intent - no client secret');
            }
            res.json({
                success: true,
                clientSecret: setupIntent.client_secret,
                customerId
            });
        }
        catch (error) {
            console.error('Create setup intent error:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to create setup intent'
            });
        }
    },
    // Save payment method after successful setup
    async savePaymentMethod(req, res) {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    error: 'Unauthorized'
                });
            }
            const { paymentMethodId, isDefault } = req.body;
            if (!paymentMethodId) {
                return res.status(400).json({
                    success: false,
                    error: 'Payment method ID is required'
                });
            }
            // Get or create Stripe customer
            const customerId = await exports.paymentMethodController.getOrCreateStripeCustomer(userId);
            // Retrieve payment method from Stripe
            const paymentMethod = await stripe_config_1.stripe.paymentMethods.retrieve(paymentMethodId);
            // Attach payment method to customer if not already attached
            if (!paymentMethod.customer) {
                await stripe_config_1.stripe.paymentMethods.attach(paymentMethodId, {
                    customer: customerId
                });
            }
            // Check if payment method already exists in our database
            const existingMethod = await database_1.default.paymentMethod.findUnique({
                where: { stripePaymentMethodId: paymentMethodId }
            });
            if (existingMethod) {
                return res.status(400).json({
                    success: false,
                    error: 'Payment method already saved'
                });
            }
            // Determine if this should be default
            const shouldBeDefault = isDefault !== undefined ? isDefault : false;
            // Check if user has any existing payment methods
            const existingMethods = await database_1.default.paymentMethod.findMany({
                where: { userId }
            });
            // If this is the first card, make it default
            const finalIsDefault = existingMethods.length === 0 ? true : shouldBeDefault;
            // If this is set as default, unset other defaults
            if (finalIsDefault) {
                await database_1.default.paymentMethod.updateMany({
                    where: { userId },
                    data: { isDefault: false }
                });
                // Set as default in Stripe
                try {
                    await stripe_config_1.stripe.customers.update(customerId, {
                        invoice_settings: {
                            default_payment_method: paymentMethodId
                        }
                    });
                }
                catch (stripeError) {
                    console.error('Error setting default in Stripe:', stripeError);
                    // Continue - we'll still save locally
                }
            }
            // Save payment method to database
            const savedMethod = await database_1.default.paymentMethod.create({
                data: {
                    userId,
                    stripePaymentMethodId: paymentMethodId,
                    type: paymentMethod.type,
                    brand: paymentMethod.card?.brand || null,
                    last4: paymentMethod.card?.last4 || '',
                    expiryMonth: paymentMethod.card?.exp_month || null,
                    expiryYear: paymentMethod.card?.exp_year || null,
                    cardholderName: paymentMethod.billing_details?.name || null,
                    isDefault: finalIsDefault
                }
            });
            res.json({
                success: true,
                message: 'Card added successfully',
                paymentMethod: {
                    id: savedMethod.id,
                    brand: savedMethod.brand,
                    last4: savedMethod.last4,
                    expiryMonth: savedMethod.expiryMonth,
                    expiryYear: savedMethod.expiryYear,
                    cardholderName: savedMethod.cardholderName,
                    isDefault: savedMethod.isDefault
                }
            });
        }
        catch (error) {
            console.error('Save payment method error:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to save payment method'
            });
        }
    },
    // Get all payment methods for a user
    async getPaymentMethods(req, res) {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            const paymentMethods = await database_1.default.paymentMethod.findMany({
                where: { userId },
                orderBy: [
                    { createdAt: 'desc' }
                ]
            });
            res.json({
                success: true,
                paymentMethods
            });
        }
        catch (error) {
            console.error('Get payment methods error:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to fetch payment methods'
            });
        }
    },
    // Set a payment method as default
    async setDefaultPaymentMethod(req, res) {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            const { paymentMethodId } = req.params;
            // Check if payment method exists and belongs to user
            const paymentMethod = await database_1.default.paymentMethod.findFirst({
                where: {
                    id: paymentMethodId,
                    userId
                }
            });
            if (!paymentMethod) {
                return res.status(404).json({ error: 'Payment method not found' });
            }
            // Unset all other defaults
            await database_1.default.paymentMethod.updateMany({
                where: { userId },
                data: { isDefault: false }
            });
            // Set this one as default
            const updatedMethod = await database_1.default.paymentMethod.update({
                where: { id: paymentMethodId },
                data: { isDefault: true }
            });
            // Also set it as default in Stripe
            try {
                const customerId = await exports.paymentMethodController.getOrCreateStripeCustomer(userId);
                await stripe_config_1.stripe.customers.update(customerId, {
                    invoice_settings: {
                        default_payment_method: paymentMethod.stripePaymentMethodId
                    }
                });
            }
            catch (stripeError) {
                console.error('Error setting default payment method in Stripe:', stripeError);
                // Continue even if Stripe update fails - local DB is already updated
            }
            res.json({
                success: true,
                paymentMethod: updatedMethod
            });
        }
        catch (error) {
            console.error('Set default payment method error:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to set default payment method'
            });
        }
    },
    // Delete a payment method
    async deletePaymentMethod(req, res) {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            const { paymentMethodId } = req.params;
            // Check if payment method exists and belongs to user
            const paymentMethod = await database_1.default.paymentMethod.findFirst({
                where: {
                    id: paymentMethodId,
                    userId
                }
            });
            if (!paymentMethod) {
                return res.status(404).json({ error: 'Payment method not found' });
            }
            // Detach from Stripe customer
            try {
                await stripe_config_1.stripe.paymentMethods.detach(paymentMethod.stripePaymentMethodId);
            }
            catch (stripeError) {
                console.error('Error detaching from Stripe:', stripeError);
                // Continue with local deletion even if Stripe detach fails
            }
            // Delete from database
            await database_1.default.paymentMethod.delete({
                where: { id: paymentMethodId }
            });
            // If this was the default, set another as default
            if (paymentMethod.isDefault) {
                const nextDefault = await database_1.default.paymentMethod.findFirst({
                    where: { userId },
                    orderBy: { createdAt: 'desc' }
                });
                if (nextDefault) {
                    await database_1.default.paymentMethod.update({
                        where: { id: nextDefault.id },
                        data: { isDefault: true }
                    });
                }
            }
            res.json({
                success: true,
                message: 'Payment method deleted successfully'
            });
        }
        catch (error) {
            console.error('Delete payment method error:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to delete payment method'
            });
        }
    }
};
