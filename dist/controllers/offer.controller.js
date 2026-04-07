//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "default", {
    enumerable: true,
    get: function() {
        return _default;
    }
});
const _database = /*#__PURE__*/ _interop_require_default(require("../config/database"));
const _asyncHandler = require("../utils/asyncHandler");
const _AppError = require("../utils/AppError");
const _stripeconfig = require("../config/stripe.config");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
function _getRequireWildcardCache(nodeInterop) {
    if (typeof WeakMap !== "function") return null;
    var cacheBabelInterop = new WeakMap();
    var cacheNodeInterop = new WeakMap();
    return (_getRequireWildcardCache = function(nodeInterop) {
        return nodeInterop ? cacheNodeInterop : cacheBabelInterop;
    })(nodeInterop);
}
function _interop_require_wildcard(obj, nodeInterop) {
    if (!nodeInterop && obj && obj.__esModule) {
        return obj;
    }
    if (obj === null || typeof obj !== "object" && typeof obj !== "function") {
        return {
            default: obj
        };
    }
    var cache = _getRequireWildcardCache(nodeInterop);
    if (cache && cache.has(obj)) {
        return cache.get(obj);
    }
    var newObj = {
        __proto__: null
    };
    var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor;
    for(var key in obj){
        if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) {
            var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null;
            if (desc && (desc.get || desc.set)) {
                Object.defineProperty(newObj, key, desc);
            } else {
                newObj[key] = obj[key];
            }
        }
    }
    newObj.default = obj;
    if (cache) {
        cache.set(obj, newObj);
    }
    return newObj;
}
class OfferController {
    // Create an offer for a field (field owner only)
    createOffer = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const userId = req.user.id;
        const { fieldId, purchaseSlots, freeSlots, validity } = req.body;
        if (!fieldId || !purchaseSlots || !freeSlots || !validity) {
            throw new _AppError.AppError('fieldId, purchaseSlots, freeSlots, and validity are required', 400);
        }
        if (![
            '1 Week',
            '1 Month'
        ].includes(validity)) {
            throw new _AppError.AppError('Validity must be "1 Week" or "1 Month"', 400);
        }
        if (purchaseSlots < 1 || freeSlots < 1) {
            throw new _AppError.AppError('purchaseSlots and freeSlots must be at least 1', 400);
        }
        // Verify field exists and user is the owner
        const field = await _database.default.field.findUnique({
            where: {
                id: fieldId
            }
        });
        if (!field) {
            throw new _AppError.AppError('Field not found', 404);
        }
        if (field.ownerId !== userId) {
            throw new _AppError.AppError('You are not the owner of this field', 403);
        }
        const offer = await _database.default.offer.create({
            data: {
                fieldId,
                purchaseSlots,
                freeSlots,
                validity
            }
        });
        res.status(201).json({
            success: true,
            message: 'Offer created successfully',
            data: offer
        });
    });
    // Get all offers for a field (public)
    getFieldOffers = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const { fieldId } = req.params;
        const field = await _database.default.field.findUnique({
            where: {
                id: fieldId
            }
        });
        if (!field) {
            throw new _AppError.AppError('Field not found', 404);
        }
        const offers = await _database.default.offer.findMany({
            where: {
                fieldId
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        res.json({
            success: true,
            data: offers
        });
    });
    // Toggle offer enabled/disabled (field owner only)
    toggleOffer = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const userId = req.user.id;
        const { offerId } = req.params;
        const offer = await _database.default.offer.findUnique({
            where: {
                id: offerId
            },
            include: {
                field: true
            }
        });
        if (!offer) {
            throw new _AppError.AppError('Offer not found', 404);
        }
        if (offer.field.ownerId !== userId) {
            throw new _AppError.AppError('You are not the owner of this field', 403);
        }
        const updatedOffer = await _database.default.offer.update({
            where: {
                id: offerId
            },
            data: {
                enabled: !offer.enabled
            }
        });
        res.json({
            success: true,
            message: `Offer ${updatedOffer.enabled ? 'enabled' : 'disabled'} successfully`,
            data: updatedOffer
        });
    });
    // Delete an offer (field owner only)
    deleteOffer = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const userId = req.user.id;
        const { offerId } = req.params;
        const offer = await _database.default.offer.findUnique({
            where: {
                id: offerId
            },
            include: {
                field: true
            }
        });
        if (!offer) {
            throw new _AppError.AppError('Offer not found', 404);
        }
        if (offer.field.ownerId !== userId) {
            throw new _AppError.AppError('You are not the owner of this field', 403);
        }
        await _database.default.offer.delete({
            where: {
                id: offerId
            }
        });
        res.json({
            success: true,
            message: 'Offer deleted successfully'
        });
    });
    // Purchase an offer - creates Stripe payment intent (dog owner)
    purchaseOffer = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const userId = req.user.id;
        const { offerId } = req.params;
        const offer = await _database.default.offer.findUnique({
            where: {
                id: offerId
            },
            include: {
                field: true
            }
        });
        if (!offer) {
            throw new _AppError.AppError('Offer not found', 404);
        }
        if (!offer.enabled) {
            throw new _AppError.AppError('This offer is currently disabled', 400);
        }
        // Check if user already has an active (non-expired) credit for this offer's field
        const existingActiveCredit = await _database.default.slotCredit.findFirst({
            where: {
                userId,
                fieldId: offer.fieldId,
                status: 'active',
                remainingSlots: {
                    gt: 0
                },
                expiresAt: {
                    gt: new Date()
                }
            }
        });
        if (existingActiveCredit) {
            throw new _AppError.AppError(`You already have an active slot pack for this field with ${existingActiveCredit.remainingSlots} slots remaining. You can buy again after it expires or all slots are used.`, 400);
        }
        // Calculate the price based on purchase slots and field price
        const pricePerSlot = offer.field.price1hr || offer.field.price30min || 0;
        if (pricePerSlot === 0) {
            throw new _AppError.AppError('Field does not have a valid price configured', 400);
        }
        const totalAmount = Math.round(offer.purchaseSlots * pricePerSlot * 100); // Convert to pence/cents for Stripe
        // Find user's default saved card
        const user = await _database.default.user.findUnique({
            where: {
                id: userId
            }
        });
        const defaultCard = await _database.default.paymentMethod.findFirst({
            where: {
                userId,
                isDefault: true
            }
        });
        // Fallback to any saved card if no default
        const savedCard = defaultCard || await _database.default.paymentMethod.findFirst({
            where: {
                userId
            }
        });
        // Build payment intent params
        const paymentIntentParams = {
            amount: totalAmount,
            currency: 'gbp',
            metadata: {
                type: 'offer_purchase',
                offerId: offer.id,
                userId,
                fieldId: offer.fieldId,
                purchaseSlots: String(offer.purchaseSlots),
                freeSlots: String(offer.freeSlots),
                totalSlots: String(offer.purchaseSlots + offer.freeSlots),
                validity: offer.validity
            }
        };
        // If saved card exists, auto-confirm with it
        if (savedCard && user?.stripeCustomerId) {
            paymentIntentParams.customer = user.stripeCustomerId;
            paymentIntentParams.payment_method = savedCard.stripePaymentMethodId;
            paymentIntentParams.confirm = true;
            paymentIntentParams.return_url = `${process.env.FRONTEND_URL || 'https://fieldsy.co.uk'}/user/my-credits`;
            paymentIntentParams.automatic_payment_methods = {
                enabled: true,
                allow_redirects: 'always'
            };
        } else {
            paymentIntentParams.automatic_payment_methods = {
                enabled: true
            };
        }
        const paymentIntent = await _stripeconfig.stripe.paymentIntents.create(paymentIntentParams);
        res.json({
            success: true,
            data: {
                clientSecret: paymentIntent.client_secret,
                paymentIntentId: paymentIntent.id,
                amount: totalAmount,
                paymentSucceeded: paymentIntent.status === 'succeeded',
                requiresAction: paymentIntent.status === 'requires_action',
                offer: {
                    id: offer.id,
                    purchaseSlots: offer.purchaseSlots,
                    freeSlots: offer.freeSlots,
                    totalSlots: offer.purchaseSlots + offer.freeSlots,
                    validity: offer.validity
                }
            }
        });
    });
    // Confirm offer purchase after Stripe payment success (dog owner)
    confirmOfferPurchase = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const userId = req.user.id;
        const { offerId } = req.params;
        const { paymentIntentId } = req.body;
        if (!paymentIntentId) {
            throw new _AppError.AppError('paymentIntentId is required', 400);
        }
        const offer = await _database.default.offer.findUnique({
            where: {
                id: offerId
            }
        });
        if (!offer) {
            throw new _AppError.AppError('Offer not found', 404);
        }
        // Verify payment intent with Stripe
        const paymentIntent = await _stripeconfig.stripe.paymentIntents.retrieve(paymentIntentId);
        if (paymentIntent.status !== 'succeeded') {
            throw new _AppError.AppError('Payment has not been completed', 400);
        }
        // Verify the payment intent metadata matches
        if (paymentIntent.metadata.offerId !== offerId || paymentIntent.metadata.userId !== userId) {
            throw new _AppError.AppError('Payment intent does not match this offer purchase', 400);
        }
        // Check if a SlotCredit already exists for this payment intent (prevent duplicates)
        const existingCredit = await _database.default.slotCredit.findFirst({
            where: {
                paymentIntentId
            }
        });
        if (existingCredit) {
            return res.json({
                success: true,
                message: 'Offer purchase already confirmed',
                data: existingCredit
            });
        }
        // Calculate expiry based on offer validity
        const now = new Date();
        const expiresAt = new Date(now);
        if (offer.validity === '1 Week') {
            expiresAt.setDate(expiresAt.getDate() + 7);
        } else if (offer.validity === '1 Month') {
            expiresAt.setMonth(expiresAt.getMonth() + 1);
        }
        const totalSlots = offer.purchaseSlots + offer.freeSlots;
        const slotCredit = await _database.default.slotCredit.create({
            data: {
                userId,
                fieldId: offer.fieldId,
                offerId: offer.id,
                totalSlots,
                usedSlots: 0,
                remainingSlots: totalSlots,
                expiresAt,
                paymentIntentId,
                status: 'active'
            }
        });
        res.status(201).json({
            success: true,
            message: 'Offer purchase confirmed successfully',
            data: slotCredit
        });
    });
    // Get active credits for a specific field (dog owner)
    getFieldCredits = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const userId = req.user.id;
        let { fieldId } = req.params;
        // Resolve human-readable fieldId (e.g. "F2266") to ObjectId
        const isObjectId = fieldId.length === 24 && /^[0-9a-fA-F]+$/.test(fieldId);
        if (!isObjectId) {
            const field = await _database.default.field.findFirst({
                where: {
                    fieldId: fieldId
                },
                select: {
                    id: true
                }
            });
            if (field) fieldId = field.id;
            else return res.json({
                success: true,
                data: {
                    credits: [],
                    totalRemaining: 0,
                    hasCredits: false,
                    bestCredit: null
                }
            });
        }
        // Auto-expire
        await _database.default.slotCredit.updateMany({
            where: {
                userId,
                fieldId,
                status: 'active',
                expiresAt: {
                    lt: new Date()
                }
            },
            data: {
                status: 'expired'
            }
        });
        const credits = await _database.default.slotCredit.findMany({
            where: {
                userId,
                fieldId,
                status: 'active',
                remainingSlots: {
                    gt: 0
                }
            },
            orderBy: {
                expiresAt: 'asc'
            }
        });
        const totalRemaining = credits.reduce((sum, c)=>sum + c.remainingSlots, 0);
        res.json({
            success: true,
            data: {
                credits,
                totalRemaining,
                hasCredits: totalRemaining > 0,
                // Return the best credit to use (soonest expiring with slots)
                bestCredit: credits.length > 0 ? credits[0] : null
            }
        });
    });
    // Get current user's active slot credits (dog owner)
    getMyCredits = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const userId = req.user.id;
        // Auto-expire any credits that have passed their expiry date
        await _database.default.slotCredit.updateMany({
            where: {
                userId,
                status: 'active',
                expiresAt: {
                    lt: new Date()
                }
            },
            data: {
                status: 'expired'
            }
        });
        const credits = await _database.default.slotCredit.findMany({
            where: {
                userId
            },
            include: {
                offer: {
                    include: {
                        field: {
                            select: {
                                id: true,
                                name: true,
                                fieldId: true
                            }
                        }
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        res.json({
            success: true,
            data: credits
        });
    });
    // Use slot credits for booking — creates bookings without payment (dog owner)
    useCredit = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const userId = req.user.id;
        let { slotCreditId, fieldId, date, timeSlots, numberOfDogs, duration } = req.body;
        if (!slotCreditId || !fieldId) {
            throw new _AppError.AppError('slotCreditId and fieldId are required', 400);
        }
        // Resolve human-readable fieldId to ObjectId
        const isObjectId = fieldId.length === 24 && /^[0-9a-fA-F]+$/.test(fieldId);
        if (!isObjectId) {
            const field = await _database.default.field.findFirst({
                where: {
                    fieldId: fieldId
                },
                select: {
                    id: true
                }
            });
            if (field) fieldId = field.id;
            else throw new _AppError.AppError('Field not found', 404);
        }
        const credit = await _database.default.slotCredit.findUnique({
            where: {
                id: slotCreditId
            }
        });
        if (!credit) {
            throw new _AppError.AppError('Slot credit not found', 404);
        }
        if (credit.userId !== userId) {
            throw new _AppError.AppError('This slot credit does not belong to you', 403);
        }
        if (credit.fieldId !== fieldId) {
            throw new _AppError.AppError('This slot credit is not valid for this field', 400);
        }
        if (credit.status !== 'active') {
            throw new _AppError.AppError(`This slot credit is ${credit.status}`, 400);
        }
        if (credit.expiresAt < new Date()) {
            await _database.default.slotCredit.update({
                where: {
                    id: slotCreditId
                },
                data: {
                    status: 'expired'
                }
            });
            throw new _AppError.AppError('This slot credit has expired', 400);
        }
        // Validate slots
        const slotsNeeded = timeSlots?.length || 1;
        if (credit.remainingSlots < slotsNeeded) {
            throw new _AppError.AppError(`Not enough credits. You need ${slotsNeeded} slots but only have ${credit.remainingSlots} remaining.`, 400);
        }
        // If booking details provided, create the bookings
        const createdBookings = [];
        if (date && timeSlots && timeSlots.length > 0) {
            const field = await _database.default.field.findUnique({
                where: {
                    id: fieldId
                }
            });
            if (!field) throw new _AppError.AppError('Field not found', 404);
            const slotDuration = duration === '30min' ? 30 : 60;
            const { default: BookingModel } = await Promise.resolve().then(()=>/*#__PURE__*/ _interop_require_wildcard(require("../models/booking.model")));
            for (const slot of timeSlots){
                const [slotStart] = slot.split(' - ').map((t)=>t.trim());
                // Parse start time to calculate end time
                const match = slotStart.match(/(\d{1,2}):(\d{2})(AM|PM)?/i);
                if (!match) continue;
                let hours = parseInt(match[1]);
                const mins = parseInt(match[2]);
                const period = match[3]?.toUpperCase();
                if (period === 'PM' && hours !== 12) hours += 12;
                if (period === 'AM' && hours === 12) hours = 0;
                const startMinutes = hours * 60 + mins;
                const endMinutes = startMinutes + slotDuration;
                const endH = Math.floor(endMinutes / 60);
                const endM = endMinutes % 60;
                const endPeriod = endH >= 12 ? 'PM' : 'AM';
                const endDisplay = endH === 0 ? 12 : endH > 12 ? endH - 12 : endH;
                const endTime = `${endDisplay}:${String(endM).padStart(2, '0')}${endPeriod}`;
                const pricePerSlot = field.price1hr || field.price30min || 0;
                const booking = await _database.default.booking.create({
                    data: {
                        fieldId,
                        userId,
                        date: new Date(date),
                        startTime: slotStart,
                        endTime: endTime,
                        timeSlot: slot,
                        numberOfDogs: parseInt(numberOfDogs) || 1,
                        totalPrice: 0,
                        platformCommission: 0,
                        fieldOwnerAmount: 0,
                        bookingId: await BookingModel.generateBookingId(),
                        status: 'CONFIRMED',
                        paymentStatus: 'CREDIT',
                        payoutStatus: 'CREDIT',
                        bookingDuration: duration || '60min'
                    }
                });
                createdBookings.push(booking);
            }
        }
        // Deduct credits
        const newRemainingSlots = credit.remainingSlots - slotsNeeded;
        const newUsedSlots = credit.usedSlots + slotsNeeded;
        const newStatus = newRemainingSlots === 0 ? 'exhausted' : 'active';
        const updatedCredit = await _database.default.slotCredit.update({
            where: {
                id: slotCreditId
            },
            data: {
                remainingSlots: newRemainingSlots,
                usedSlots: newUsedSlots,
                status: newStatus
            }
        });
        res.json({
            success: true,
            message: newStatus === 'exhausted' ? `${slotsNeeded} slot(s) used. All credits exhausted.` : `${slotsNeeded} slot(s) used. ${newRemainingSlots} remaining.`,
            data: {
                credit: updatedCredit,
                bookings: createdBookings,
                bookingIds: createdBookings.map((b)=>b.id)
            }
        });
    });
}
const _default = new OfferController();

//# sourceMappingURL=offer.controller.js.map