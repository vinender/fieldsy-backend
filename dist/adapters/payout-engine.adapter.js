"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FieldsyPayoutAdapter = void 0;
const database_1 = require("../config/database");
// ---------------------------------------------------------------------------
// Helpers — convert between Prisma rows and engine model shapes
// ---------------------------------------------------------------------------
function bookingToOrder(b) {
    return {
        id: b.id,
        customerId: b.userId,
        listingId: b.fieldId,
        merchantId: b.field?.ownerId ?? '',
        date: b.date,
        startTime: b.startTime,
        endTime: b.endTime,
        totalPrice: b.totalPrice,
        platformCommission: b.platformCommission ?? undefined,
        merchantAmount: b.fieldOwnerAmount ?? undefined,
        orderId: b.bookingId ?? undefined,
        status: b.status,
        paymentStatus: b.paymentStatus ?? undefined,
        paymentIntentId: b.paymentIntentId ?? undefined,
        payoutStatus: b.payoutStatus ?? undefined,
        payoutId: b.payoutId ?? undefined,
        payoutHeldReason: b.payoutHeldReason ?? undefined,
        payoutReleasedAt: b.payoutReleasedAt ?? undefined,
        subscriptionId: b.subscriptionId ?? undefined,
        cancellationReason: b.cancellationReason ?? undefined,
        cancelledAt: b.cancelledAt ?? undefined,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
        metadata: b.metadata ?? undefined,
    };
}
function stripeAccountToConnectedAccount(sa) {
    return {
        id: sa.id,
        userId: sa.userId,
        stripeAccountId: sa.stripeAccountId,
        accountType: sa.accountType ?? undefined,
        chargesEnabled: sa.chargesEnabled,
        payoutsEnabled: sa.payoutsEnabled,
        detailsSubmitted: sa.detailsSubmitted,
        defaultCurrency: sa.defaultCurrency ?? undefined,
        email: sa.email ?? undefined,
        bankAccountLast4: sa.bankAccountLast4 ?? undefined,
        requirementsCurrentlyDue: sa.requirementsCurrentlyDue ?? undefined,
        requirementsPastDue: sa.requirementsPastDue ?? undefined,
        requirementsEventuallyDue: sa.requirementsEventuallyDue ?? undefined,
    };
}
function payoutRowToRecord(p) {
    return {
        id: p.id,
        connectedAccountId: p.stripeAccountId, // DB reference ID to StripeAccount
        stripePayoutId: p.stripePayoutId ?? undefined,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        method: p.method ?? undefined,
        description: p.description ?? undefined,
        orderIds: p.bookingIds ?? [],
        arrivalDate: p.arrivalDate ?? undefined,
        failureCode: p.failureCode ?? undefined,
        failureMessage: p.failureMessage ?? undefined,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
    };
}
function transactionRowToRecord(t) {
    return {
        id: t.id,
        orderId: t.bookingId,
        customerId: t.userId,
        merchantId: t.fieldOwnerId ?? undefined,
        amount: t.amount,
        netAmount: t.netAmount ?? undefined,
        platformFee: t.platformFee ?? undefined,
        commissionRate: t.commissionRate ?? undefined,
        isCustomCommission: t.isCustomCommission ?? undefined,
        defaultCommissionRate: t.defaultCommissionRate ?? undefined,
        type: t.type,
        status: t.status,
        lifecycleStage: t.lifecycleStage ?? undefined,
        stripePaymentIntentId: t.stripePaymentIntentId ?? undefined,
        stripeChargeId: t.stripeChargeId ?? undefined,
        stripeBalanceTransactionId: t.stripeBalanceTransactionId ?? undefined,
        stripeTransferId: t.stripeTransferId ?? undefined,
        stripePayoutId: t.stripePayoutId ?? undefined,
        stripeRefundId: t.stripeRefundId ?? undefined,
        connectedAccountId: t.connectedAccountId ?? undefined,
        paymentReceivedAt: t.paymentReceivedAt ?? undefined,
        fundsAvailableAt: t.fundsAvailableAt ?? undefined,
        transferredAt: t.transferredAt ?? undefined,
        payoutInitiatedAt: t.payoutInitiatedAt ?? undefined,
        payoutCompletedAt: t.payoutCompletedAt ?? undefined,
        refundedAt: t.refundedAt ?? undefined,
        failureCode: t.failureCode ?? undefined,
        failureMessage: t.failureMessage ?? undefined,
        description: t.description ?? undefined,
        metadata: t.metadata ?? undefined,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
    };
}
function paymentRowToRecord(p) {
    return {
        id: p.id,
        orderId: p.bookingId,
        customerId: p.userId,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        stripePaymentId: p.stripePaymentId ?? undefined,
        stripeRefundId: p.stripeRefundId ?? undefined,
        refundAmount: p.refundAmount ?? undefined,
        refundReason: p.refundReason ?? undefined,
    };
}
function subscriptionRowToRecord(s) {
    return {
        id: s.id,
        customerId: s.userId,
        listingId: s.fieldId,
        stripeSubscriptionId: s.stripeSubscriptionId,
        stripeCustomerId: s.stripeCustomerId,
        status: s.status,
        interval: s.interval,
        intervalCount: s.intervalCount,
        currentPeriodStart: s.currentPeriodStart,
        currentPeriodEnd: s.currentPeriodEnd,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        canceledAt: s.canceledAt ?? undefined,
        timeSlot: s.timeSlot,
        timeSlots: s.timeSlots ?? undefined,
        dayOfWeek: s.dayOfWeek ?? undefined,
        dayOfMonth: s.dayOfMonth ?? undefined,
        startTime: s.startTime,
        endTime: s.endTime,
        numberOfItems: s.numberOfDogs ?? undefined,
        totalPrice: s.totalPrice,
        nextBillingDate: s.nextBillingDate ?? undefined,
        lastOrderDate: s.lastBookingDate ?? undefined,
        paymentRetryCount: s.paymentRetryCount,
        lastPaymentAttempt: s.lastPaymentAttempt ?? undefined,
        nextRetryDate: s.nextRetryDate ?? undefined,
        failureReason: s.failureReason ?? undefined,
        cancellationReason: s.cancellationReason ?? undefined,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
    };
}
// Reverse mappers: engine model fields -> Prisma column names
function orderDataToPrisma(data) {
    const mapped = {};
    if (data.customerId !== undefined)
        mapped.userId = data.customerId;
    if (data.listingId !== undefined)
        mapped.fieldId = data.listingId;
    // merchantId is resolved via Field relation; skip here
    if (data.date !== undefined)
        mapped.date = data.date;
    if (data.startTime !== undefined)
        mapped.startTime = data.startTime;
    if (data.endTime !== undefined)
        mapped.endTime = data.endTime;
    if (data.totalPrice !== undefined)
        mapped.totalPrice = data.totalPrice;
    if (data.platformCommission !== undefined)
        mapped.platformCommission = data.platformCommission;
    if (data.merchantAmount !== undefined)
        mapped.fieldOwnerAmount = data.merchantAmount;
    if (data.orderId !== undefined)
        mapped.bookingId = data.orderId;
    if (data.status !== undefined)
        mapped.status = data.status;
    if (data.paymentStatus !== undefined)
        mapped.paymentStatus = data.paymentStatus;
    if (data.paymentIntentId !== undefined)
        mapped.paymentIntentId = data.paymentIntentId;
    if (data.payoutStatus !== undefined)
        mapped.payoutStatus = data.payoutStatus;
    if (data.payoutId !== undefined)
        mapped.payoutId = data.payoutId;
    if (data.payoutHeldReason !== undefined)
        mapped.payoutHeldReason = data.payoutHeldReason;
    if (data.payoutReleasedAt !== undefined)
        mapped.payoutReleasedAt = data.payoutReleasedAt;
    if (data.subscriptionId !== undefined)
        mapped.subscriptionId = data.subscriptionId;
    if (data.cancellationReason !== undefined)
        mapped.cancellationReason = data.cancellationReason;
    if (data.cancelledAt !== undefined)
        mapped.cancelledAt = data.cancelledAt;
    if (data.metadata !== undefined)
        mapped.metadata = data.metadata;
    return mapped;
}
function payoutDataToPrisma(data) {
    const mapped = {};
    if (data.connectedAccountId !== undefined)
        mapped.stripeAccountId = data.connectedAccountId;
    if (data.stripePayoutId !== undefined)
        mapped.stripePayoutId = data.stripePayoutId;
    if (data.amount !== undefined)
        mapped.amount = data.amount;
    if (data.currency !== undefined)
        mapped.currency = data.currency;
    if (data.status !== undefined)
        mapped.status = data.status;
    if (data.method !== undefined)
        mapped.method = data.method;
    if (data.description !== undefined)
        mapped.description = data.description;
    if (data.orderIds !== undefined)
        mapped.bookingIds = data.orderIds;
    if (data.arrivalDate !== undefined)
        mapped.arrivalDate = data.arrivalDate;
    if (data.failureCode !== undefined)
        mapped.failureCode = data.failureCode;
    if (data.failureMessage !== undefined)
        mapped.failureMessage = data.failureMessage;
    return mapped;
}
function transactionDataToPrisma(data) {
    const mapped = {};
    if (data.orderId !== undefined)
        mapped.bookingId = data.orderId;
    if (data.customerId !== undefined)
        mapped.userId = data.customerId;
    if (data.merchantId !== undefined)
        mapped.fieldOwnerId = data.merchantId;
    if (data.amount !== undefined)
        mapped.amount = data.amount;
    if (data.netAmount !== undefined)
        mapped.netAmount = data.netAmount;
    if (data.platformFee !== undefined)
        mapped.platformFee = data.platformFee;
    if (data.commissionRate !== undefined)
        mapped.commissionRate = data.commissionRate;
    if (data.isCustomCommission !== undefined)
        mapped.isCustomCommission = data.isCustomCommission;
    if (data.defaultCommissionRate !== undefined)
        mapped.defaultCommissionRate = data.defaultCommissionRate;
    if (data.type !== undefined)
        mapped.type = data.type;
    if (data.status !== undefined)
        mapped.status = data.status;
    if (data.lifecycleStage !== undefined)
        mapped.lifecycleStage = data.lifecycleStage;
    if (data.stripePaymentIntentId !== undefined)
        mapped.stripePaymentIntentId = data.stripePaymentIntentId;
    if (data.stripeChargeId !== undefined)
        mapped.stripeChargeId = data.stripeChargeId;
    if (data.stripeBalanceTransactionId !== undefined)
        mapped.stripeBalanceTransactionId = data.stripeBalanceTransactionId;
    if (data.stripeTransferId !== undefined)
        mapped.stripeTransferId = data.stripeTransferId;
    if (data.stripePayoutId !== undefined)
        mapped.stripePayoutId = data.stripePayoutId;
    if (data.stripeRefundId !== undefined)
        mapped.stripeRefundId = data.stripeRefundId;
    if (data.connectedAccountId !== undefined)
        mapped.connectedAccountId = data.connectedAccountId;
    if (data.paymentReceivedAt !== undefined)
        mapped.paymentReceivedAt = data.paymentReceivedAt;
    if (data.fundsAvailableAt !== undefined)
        mapped.fundsAvailableAt = data.fundsAvailableAt;
    if (data.transferredAt !== undefined)
        mapped.transferredAt = data.transferredAt;
    if (data.payoutInitiatedAt !== undefined)
        mapped.payoutInitiatedAt = data.payoutInitiatedAt;
    if (data.payoutCompletedAt !== undefined)
        mapped.payoutCompletedAt = data.payoutCompletedAt;
    if (data.refundedAt !== undefined)
        mapped.refundedAt = data.refundedAt;
    if (data.failureCode !== undefined)
        mapped.failureCode = data.failureCode;
    if (data.failureMessage !== undefined)
        mapped.failureMessage = data.failureMessage;
    if (data.description !== undefined)
        mapped.description = data.description;
    if (data.metadata !== undefined)
        mapped.metadata = data.metadata;
    return mapped;
}
function subscriptionDataToPrisma(data) {
    const mapped = {};
    if (data.customerId !== undefined)
        mapped.userId = data.customerId;
    if (data.listingId !== undefined)
        mapped.fieldId = data.listingId;
    if (data.stripeSubscriptionId !== undefined)
        mapped.stripeSubscriptionId = data.stripeSubscriptionId;
    if (data.stripeCustomerId !== undefined)
        mapped.stripeCustomerId = data.stripeCustomerId;
    if (data.status !== undefined)
        mapped.status = data.status;
    if (data.interval !== undefined)
        mapped.interval = data.interval;
    if (data.intervalCount !== undefined)
        mapped.intervalCount = data.intervalCount;
    if (data.currentPeriodStart !== undefined)
        mapped.currentPeriodStart = data.currentPeriodStart;
    if (data.currentPeriodEnd !== undefined)
        mapped.currentPeriodEnd = data.currentPeriodEnd;
    if (data.cancelAtPeriodEnd !== undefined)
        mapped.cancelAtPeriodEnd = data.cancelAtPeriodEnd;
    if (data.canceledAt !== undefined)
        mapped.canceledAt = data.canceledAt;
    if (data.timeSlot !== undefined)
        mapped.timeSlot = data.timeSlot;
    if (data.timeSlots !== undefined)
        mapped.timeSlots = data.timeSlots;
    if (data.dayOfWeek !== undefined)
        mapped.dayOfWeek = data.dayOfWeek;
    if (data.dayOfMonth !== undefined)
        mapped.dayOfMonth = data.dayOfMonth;
    if (data.startTime !== undefined)
        mapped.startTime = data.startTime;
    if (data.endTime !== undefined)
        mapped.endTime = data.endTime;
    if (data.numberOfItems !== undefined)
        mapped.numberOfDogs = data.numberOfItems;
    if (data.totalPrice !== undefined)
        mapped.totalPrice = data.totalPrice;
    if (data.nextBillingDate !== undefined)
        mapped.nextBillingDate = data.nextBillingDate;
    if (data.lastOrderDate !== undefined)
        mapped.lastBookingDate = data.lastOrderDate;
    if (data.paymentRetryCount !== undefined)
        mapped.paymentRetryCount = data.paymentRetryCount;
    if (data.lastPaymentAttempt !== undefined)
        mapped.lastPaymentAttempt = data.lastPaymentAttempt;
    if (data.nextRetryDate !== undefined)
        mapped.nextRetryDate = data.nextRetryDate;
    if (data.failureReason !== undefined)
        mapped.failureReason = data.failureReason;
    if (data.cancellationReason !== undefined)
        mapped.cancellationReason = data.cancellationReason;
    return mapped;
}
// ---------------------------------------------------------------------------
// Adapter Implementation
// ---------------------------------------------------------------------------
class FieldsyPayoutAdapter {
    // ========================================================================
    // ORDER operations (Booking in Prisma)
    // ========================================================================
    async findOrderById(orderId) {
        const booking = await database_1.prisma.booking.findUnique({
            where: { id: orderId },
            include: { field: { select: { ownerId: true } } },
        });
        return booking ? bookingToOrder(booking) : null;
    }
    async findOrderByPaymentIntentId(paymentIntentId) {
        const booking = await database_1.prisma.booking.findFirst({
            where: { paymentIntentId },
            include: { field: { select: { ownerId: true } } },
        });
        return booking ? bookingToOrder(booking) : null;
    }
    async findOrdersEligibleForPayout() {
        const bookings = await database_1.prisma.booking.findMany({
            where: {
                status: { in: ['CONFIRMED', 'COMPLETED'] },
                paymentStatus: 'PAID',
                OR: [
                    { payoutStatus: { isSet: false } },
                    { payoutStatus: null },
                    { payoutStatus: 'PENDING' },
                    { payoutStatus: 'HELD' },
                ],
                // Exclude orphaned bookings (deleted field or user)
                field: { id: { not: undefined } },
                user: { id: { not: undefined } },
            },
            include: { field: { select: { ownerId: true } } },
        });
        return bookings.map(bookingToOrder);
    }
    async findPendingPayoutOrdersForMerchant(merchantId) {
        const fieldIds = await this.getListingIdsForMerchant(merchantId);
        if (fieldIds.length === 0)
            return [];
        const bookings = await database_1.prisma.booking.findMany({
            where: {
                fieldId: { in: fieldIds },
                status: 'COMPLETED',
                paymentStatus: 'PAID',
                OR: [
                    { payoutStatus: { isSet: false } },
                    { payoutStatus: null },
                    { payoutStatus: 'PENDING' },
                    { payoutStatus: 'PENDING_ACCOUNT' },
                ],
                field: { id: { not: undefined } },
                user: { id: { not: undefined } },
            },
            include: { field: { select: { ownerId: true } } },
        });
        return bookings.map(bookingToOrder);
    }
    async findHeldPayoutOrders(filter) {
        const where = {
            payoutStatus: 'HELD',
            status: { in: ['CONFIRMED', 'COMPLETED'] },
            paymentStatus: 'PAID',
            // Exclude orphaned bookings
            field: { id: { not: undefined } },
            user: { id: { not: undefined } },
        };
        if (filter?.merchantId) {
            const fieldIds = await this.getListingIdsForMerchant(filter.merchantId);
            where.fieldId = { in: fieldIds };
        }
        if (filter?.holdReason) {
            where.payoutHeldReason = filter.holdReason;
        }
        const bookings = await database_1.prisma.booking.findMany({
            where,
            include: { field: { include: { owner: true } } },
        });
        return bookings.map(bookingToOrder);
    }
    async findOrdersPendingBalance(reasonContains, limit) {
        const bookings = await database_1.prisma.booking.findMany({
            where: {
                payoutStatus: 'PENDING',
                payoutHeldReason: { contains: reasonContains },
                field: { id: { not: undefined } },
                user: { id: { not: undefined } },
            },
            take: limit,
            include: { field: { select: { ownerId: true } } },
        });
        return bookings.map(bookingToOrder);
    }
    async updateOrder(orderId, data) {
        const prismaData = orderDataToPrisma(data);
        const booking = await database_1.prisma.booking.update({
            where: { id: orderId },
            data: prismaData,
            include: { field: { select: { ownerId: true } } },
        });
        return bookingToOrder(booking);
    }
    async updateManyOrders(filter, data) {
        const where = {};
        if (filter.ids)
            where.id = { in: filter.ids };
        if (filter.subscriptionId)
            where.subscriptionId = filter.subscriptionId;
        if (filter.futureOnly)
            where.date = { gt: new Date() };
        const prismaData = orderDataToPrisma(data);
        const result = await database_1.prisma.booking.updateMany({ where, data: prismaData });
        return result.count;
    }
    async createOrder(data) {
        const prismaData = orderDataToPrisma(data);
        const booking = await database_1.prisma.booking.create({
            data: prismaData,
            include: { field: { select: { ownerId: true } } },
        });
        return bookingToOrder(booking);
    }
    async generateOrderId() {
        const counter = await database_1.prisma.counter.upsert({
            where: { name: 'booking' },
            update: { value: { increment: 1 } },
            create: { name: 'booking', value: 1111 },
        });
        return counter.value.toString();
    }
    async checkOrderAvailability(listingId, date, startTime, endTime) {
        const conflicting = await database_1.prisma.booking.findMany({
            where: {
                fieldId: listingId,
                date,
                status: { notIn: ['CANCELLED', 'COMPLETED'] },
            },
        });
        const toMinutes = (t) => {
            if (t.includes('AM') || t.includes('PM')) {
                const match = t.match(/(\d+):(\d+)(AM|PM)/i);
                if (match) {
                    let h = parseInt(match[1]);
                    const m = parseInt(match[2]);
                    if (match[3].toUpperCase() === 'PM' && h !== 12)
                        h += 12;
                    if (match[3].toUpperCase() === 'AM' && h === 12)
                        h = 0;
                    return h * 60 + m;
                }
            }
            const [h, m] = t.split(':').map(Number);
            return h * 60 + (m || 0);
        };
        const reqStart = toMinutes(startTime);
        const reqEnd = toMinutes(endTime);
        for (const b of conflicting) {
            const bStart = toMinutes(b.startTime);
            const bEnd = toMinutes(b.endTime);
            if ((reqStart >= bStart && reqStart < bEnd) ||
                (reqEnd > bStart && reqEnd <= bEnd) ||
                (reqStart <= bStart && reqEnd >= bEnd)) {
                return { available: false, reason: 'Time slot already booked' };
            }
        }
        return { available: true };
    }
    // ========================================================================
    // CONNECTED ACCOUNT operations (StripeAccount in Prisma)
    // ========================================================================
    async findConnectedAccountByUserId(userId) {
        const sa = await database_1.prisma.stripeAccount.findUnique({ where: { userId } });
        return sa ? stripeAccountToConnectedAccount(sa) : null;
    }
    async findConnectedAccountByStripeId(stripeAccountId) {
        const sa = await database_1.prisma.stripeAccount.findFirst({
            where: { stripeAccountId },
        });
        return sa ? stripeAccountToConnectedAccount(sa) : null;
    }
    async createConnectedAccount(data) {
        const sa = await database_1.prisma.stripeAccount.create({
            data: {
                userId: data.userId,
                stripeAccountId: data.stripeAccountId,
                accountType: data.accountType ?? 'express',
                chargesEnabled: data.chargesEnabled ?? false,
                payoutsEnabled: data.payoutsEnabled ?? false,
                detailsSubmitted: data.detailsSubmitted ?? false,
                defaultCurrency: data.defaultCurrency,
                bankAccountLast4: data.bankAccountLast4,
                requirementsCurrentlyDue: data.requirementsCurrentlyDue ?? [],
                requirementsPastDue: data.requirementsPastDue ?? [],
                requirementsEventuallyDue: data.requirementsEventuallyDue ?? [],
            },
        });
        return stripeAccountToConnectedAccount(sa);
    }
    async updateConnectedAccount(id, data) {
        const sa = await database_1.prisma.stripeAccount.update({
            where: { id },
            data: {
                ...(data.chargesEnabled !== undefined && { chargesEnabled: data.chargesEnabled }),
                ...(data.payoutsEnabled !== undefined && { payoutsEnabled: data.payoutsEnabled }),
                ...(data.detailsSubmitted !== undefined && { detailsSubmitted: data.detailsSubmitted }),
                ...(data.defaultCurrency !== undefined && { defaultCurrency: data.defaultCurrency }),
                ...(data.bankAccountLast4 !== undefined && { bankAccountLast4: data.bankAccountLast4 }),
                ...(data.requirementsCurrentlyDue !== undefined && {
                    requirementsCurrentlyDue: data.requirementsCurrentlyDue,
                }),
                ...(data.requirementsPastDue !== undefined && {
                    requirementsPastDue: data.requirementsPastDue,
                }),
                ...(data.requirementsEventuallyDue !== undefined && {
                    requirementsEventuallyDue: data.requirementsEventuallyDue,
                }),
            },
        });
        return stripeAccountToConnectedAccount(sa);
    }
    async updateConnectedAccountByStripeId(stripeAccountId, data) {
        const existing = await database_1.prisma.stripeAccount.findFirst({
            where: { stripeAccountId },
        });
        if (!existing)
            return null;
        return this.updateConnectedAccount(existing.id, data);
    }
    // ========================================================================
    // PAYOUT operations
    // ========================================================================
    async createPayout(data) {
        const prismaData = payoutDataToPrisma(data);
        const payout = await database_1.prisma.payout.create({ data: prismaData });
        return payoutRowToRecord(payout);
    }
    async findPayoutByStripeId(stripePayoutId) {
        const payout = await database_1.prisma.payout.findFirst({ where: { stripePayoutId } });
        return payout ? payoutRowToRecord(payout) : null;
    }
    async updatePayout(id, data) {
        const prismaData = payoutDataToPrisma(data);
        const payout = await database_1.prisma.payout.update({ where: { id }, data: prismaData });
        return payoutRowToRecord(payout);
    }
    async upsertPayoutByStripeId(stripePayoutId, data) {
        const prismaData = payoutDataToPrisma(data);
        const existing = await database_1.prisma.payout.findFirst({ where: { stripePayoutId } });
        if (existing) {
            const updated = await database_1.prisma.payout.update({
                where: { id: existing.id },
                data: prismaData,
            });
            return payoutRowToRecord(updated);
        }
        const created = await database_1.prisma.payout.create({
            data: { ...prismaData, stripePayoutId },
        });
        return payoutRowToRecord(created);
    }
    async findPayoutsForAccount(connectedAccountDbId, page, limit) {
        const [payouts, total] = await Promise.all([
            database_1.prisma.payout.findMany({
                where: { stripeAccountId: connectedAccountDbId },
                skip: (page - 1) * limit,
                take: limit,
                orderBy: { createdAt: 'desc' },
            }),
            database_1.prisma.payout.count({ where: { stripeAccountId: connectedAccountDbId } }),
        ]);
        return { payouts: payouts.map(payoutRowToRecord), total };
    }
    async findFailedPayouts(withinHours) {
        const since = new Date(Date.now() - withinHours * 60 * 60 * 1000);
        const payouts = await database_1.prisma.payout.findMany({
            where: {
                status: 'failed',
                createdAt: { gte: since },
            },
            include: { stripeAccount: true },
        });
        return payouts.map((p) => ({
            ...payoutRowToRecord(p),
            connectedAccount: stripeAccountToConnectedAccount(p.stripeAccount),
        }));
    }
    // ========================================================================
    // TRANSACTION operations
    // ========================================================================
    async createTransaction(data) {
        const prismaData = transactionDataToPrisma(data);
        const txn = await database_1.prisma.transaction.create({ data: prismaData });
        return transactionRowToRecord(txn);
    }
    async findTransactionByPaymentIntentId(stripePaymentIntentId) {
        const txn = await database_1.prisma.transaction.findFirst({ where: { stripePaymentIntentId } });
        return txn ? transactionRowToRecord(txn) : null;
    }
    async findTransactionByOrderId(orderId, type) {
        const where = { bookingId: orderId };
        if (type)
            where.type = type;
        const txn = await database_1.prisma.transaction.findFirst({ where });
        return txn ? transactionRowToRecord(txn) : null;
    }
    async findTransactionByTransferId(stripeTransferId) {
        const txn = await database_1.prisma.transaction.findFirst({ where: { stripeTransferId } });
        return txn ? transactionRowToRecord(txn) : null;
    }
    async findTransactionByStripePayoutId(stripePayoutId) {
        const txn = await database_1.prisma.transaction.findFirst({ where: { stripePayoutId } });
        return txn ? transactionRowToRecord(txn) : null;
    }
    async updateTransaction(id, data) {
        const prismaData = transactionDataToPrisma(data);
        const txn = await database_1.prisma.transaction.update({ where: { id }, data: prismaData });
        return transactionRowToRecord(txn);
    }
    async updateTransactionsByOrderId(orderId, data) {
        const prismaData = transactionDataToPrisma(data);
        const result = await database_1.prisma.transaction.updateMany({
            where: { bookingId: orderId },
            data: prismaData,
        });
        return result.count;
    }
    async findPendingFundsTransactions(limit) {
        const txns = await database_1.prisma.transaction.findMany({
            where: {
                lifecycleStage: 'FUNDS_PENDING',
                stripeChargeId: { not: null },
            },
            take: limit,
        });
        return txns.map(transactionRowToRecord);
    }
    // ========================================================================
    // PAYMENT operations
    // ========================================================================
    async findPaymentByOrderId(orderId) {
        const payment = await database_1.prisma.payment.findFirst({ where: { bookingId: orderId } });
        return payment ? paymentRowToRecord(payment) : null;
    }
    async createPayment(data) {
        const payment = await database_1.prisma.payment.create({
            data: {
                bookingId: data.orderId,
                userId: data.customerId,
                amount: data.amount,
                currency: data.currency,
                status: data.status,
                stripePaymentId: data.stripePaymentId,
                stripeRefundId: data.stripeRefundId,
                refundAmount: data.refundAmount,
                refundReason: data.refundReason,
            },
        });
        return paymentRowToRecord(payment);
    }
    async updatePayment(id, data) {
        const prismaData = {};
        if (data.status !== undefined)
            prismaData.status = data.status;
        if (data.stripePaymentId !== undefined)
            prismaData.stripePaymentId = data.stripePaymentId;
        if (data.stripeRefundId !== undefined)
            prismaData.stripeRefundId = data.stripeRefundId;
        if (data.refundAmount !== undefined)
            prismaData.refundAmount = data.refundAmount;
        if (data.refundReason !== undefined)
            prismaData.refundReason = data.refundReason;
        const payment = await database_1.prisma.payment.update({ where: { id }, data: prismaData });
        return paymentRowToRecord(payment);
    }
    // ========================================================================
    // SUBSCRIPTION operations
    // ========================================================================
    async findSubscriptionById(id) {
        const sub = await database_1.prisma.subscription.findUnique({ where: { id } });
        return sub ? subscriptionRowToRecord(sub) : null;
    }
    async findSubscriptionByStripeId(stripeSubscriptionId) {
        const sub = await database_1.prisma.subscription.findFirst({ where: { stripeSubscriptionId } });
        return sub ? subscriptionRowToRecord(sub) : null;
    }
    async createSubscription(data) {
        const prismaData = subscriptionDataToPrisma(data);
        const sub = await database_1.prisma.subscription.create({ data: prismaData });
        return subscriptionRowToRecord(sub);
    }
    async updateSubscription(id, data) {
        const prismaData = subscriptionDataToPrisma(data);
        const sub = await database_1.prisma.subscription.update({ where: { id }, data: prismaData });
        return subscriptionRowToRecord(sub);
    }
    async findSubscriptionsForRetry(now, maxRetries) {
        const subs = await database_1.prisma.subscription.findMany({
            where: {
                status: 'past_due',
                paymentRetryCount: { lt: maxRetries },
                OR: [
                    { nextRetryDate: { lte: now } },
                    { nextRetryDate: { isSet: false } },
                    { nextRetryDate: null },
                ],
            },
        });
        return subs.map(subscriptionRowToRecord);
    }
    // ========================================================================
    // SETTINGS & MERCHANT operations
    // ========================================================================
    async getSystemSettings() {
        const settings = await database_1.prisma.systemSettings.findFirst();
        if (!settings)
            return null;
        return {
            defaultCommissionRate: settings.defaultCommissionRate,
            cancellationWindowHours: settings.cancellationWindowHours,
            payoutReleaseSchedule: settings.payoutReleaseSchedule ?? 'after_cancellation_window',
            maxAdvanceBookingDays: settings.maxAdvanceBookingDays ?? undefined,
        };
    }
    async getMerchantCommissionRate(merchantId) {
        const user = await database_1.prisma.user.findUnique({
            where: { id: merchantId },
            select: { commissionRate: true },
        });
        return user?.commissionRate ?? null;
    }
    async getMerchantInfo(merchantId) {
        const user = await database_1.prisma.user.findUnique({
            where: { id: merchantId },
            select: { id: true, name: true, email: true },
        });
        if (!user)
            return null;
        return { id: user.id, name: user.name ?? undefined, email: user.email ?? undefined };
    }
    async getCustomerInfo(customerId) {
        const user = await database_1.prisma.user.findUnique({
            where: { id: customerId },
            select: { id: true, name: true, email: true },
        });
        if (!user)
            return null;
        return { id: user.id, name: user.name ?? undefined, email: user.email ?? undefined };
    }
    async getListingIdsForMerchant(merchantId) {
        const fields = await database_1.prisma.field.findMany({
            where: { ownerId: merchantId },
            select: { id: true },
        });
        return fields.map((f) => f.id);
    }
}
exports.FieldsyPayoutAdapter = FieldsyPayoutAdapter;
