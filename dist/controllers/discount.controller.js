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
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
class DiscountController {
    // Create a discount for a field (field owner only)
    createDiscount = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const userId = req.user.id;
        const { fieldId, value, startDate, startTime, endDate, endTime } = req.body;
        // Required fields (note: 'value' is checked separately below since 0 is falsy)
        if (!fieldId || !startDate || !startTime || !endDate || !endTime) {
            throw new _AppError.AppError('fieldId, startDate, startTime, endDate, and endTime are required', 400);
        }
        // Validate discount value: must be a positive integer between 1 and 100
        const numericValue = Number(value);
        if (value === undefined || value === null || value === '' || !Number.isFinite(numericValue) || !Number.isInteger(numericValue) || numericValue <= 0 || numericValue > 100) {
            throw new _AppError.AppError('Discount value must be a whole number between 1 and 100. Zero is not allowed.', 400);
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
        const parsedStartDate = new Date(startDate);
        const parsedEndDate = new Date(endDate);
        if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime())) {
            throw new _AppError.AppError('Invalid date format', 400);
        }
        if (parsedEndDate < parsedStartDate) {
            throw new _AppError.AppError('End date must be after start date', 400);
        }
        // Build full start/end timestamps for overlap check
        const newStart = new Date(`${startDate}T${startTime}`);
        const newEnd = new Date(`${endDate}T${endTime}`);
        if (newEnd <= newStart) {
            throw new _AppError.AppError('End date/time must be after start date/time', 400);
        }
        if (newStart < new Date()) {
            throw new _AppError.AppError('Start date/time cannot be in the past', 400);
        }
        // Discount time window must fall within the field's operating hours
        if (field.openingTime && field.closingTime) {
            const toMinutes = (t)=>{
                const parts = t.split(':');
                const h = parseInt(parts[0], 10);
                const m = parseInt(parts[1] || '0', 10);
                return h * 60 + (isNaN(m) ? 0 : m);
            };
            const fStart = toMinutes(field.openingTime);
            const fEnd = toMinutes(field.closingTime);
            const dStart = toMinutes(startTime);
            const dEnd = toMinutes(endTime);
            if (isNaN(dStart) || isNaN(dEnd)) {
                throw new _AppError.AppError('Invalid time format', 400);
            }
            if (dStart < fStart || dEnd > fEnd) {
                throw new _AppError.AppError(`Discount time must fall within the field's operating hours (${field.openingTime} - ${field.closingTime}).`, 400);
            }
        }
        // Check for overlapping enabled discounts on the same field
        const existingDiscounts = await _database.default.discount.findMany({
            where: {
                fieldId,
                enabled: true
            }
        });
        for (const existing of existingDiscounts){
            const exStart = new Date(`${existing.startDate.toISOString().split('T')[0]}T${existing.startTime}`);
            const exEnd = new Date(`${existing.endDate.toISOString().split('T')[0]}T${existing.endTime}`);
            // Two ranges overlap if one starts before the other ends AND vice versa
            if (newStart < exEnd && newEnd > exStart) {
                throw new _AppError.AppError(`This discount overlaps with an existing ${existing.value}% discount (${existing.startDate.toISOString().split('T')[0]} ${existing.startTime} - ${existing.endDate.toISOString().split('T')[0]} ${existing.endTime}). Please choose a different date/time range.`, 409);
            }
        }
        const discount = await _database.default.discount.create({
            data: {
                fieldId,
                value: numericValue,
                startDate: parsedStartDate,
                startTime,
                endDate: parsedEndDate,
                endTime
            }
        });
        res.status(201).json({
            success: true,
            message: 'Discount created successfully',
            data: discount
        });
    });
    // Get all discounts for a field (public)
    getFieldDiscounts = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const { fieldId } = req.params;
        const field = await _database.default.field.findUnique({
            where: {
                id: fieldId
            }
        });
        if (!field) {
            throw new _AppError.AppError('Field not found', 404);
        }
        const where = {
            fieldId
        };
        // Optional filter: only enabled discounts within validity range
        if (req.query.activeOnly === 'true') {
            const now = new Date();
            where.enabled = true;
            where.startDate = {
                lte: now
            };
            where.endDate = {
                gte: now
            };
        }
        const discounts = await _database.default.discount.findMany({
            where,
            orderBy: {
                createdAt: 'desc'
            }
        });
        res.json({
            success: true,
            data: discounts
        });
    });
    // Get currently active discounts for a field (public)
    getActiveDiscounts = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        let { fieldId } = req.params;
        // Resolve human-readable fieldId (e.g. "F2266") to ObjectId
        const isObjectId = fieldId.length === 24 && /^[0-9a-fA-F]+$/.test(fieldId);
        let field;
        if (isObjectId) {
            field = await _database.default.field.findUnique({
                where: {
                    id: fieldId
                }
            });
        } else {
            field = await _database.default.field.findFirst({
                where: {
                    fieldId: fieldId
                }
            });
            if (field) fieldId = field.id;
        }
        if (!field) {
            throw new _AppError.AppError('Field not found', 404);
        }
        const now = new Date();
        const discounts = await _database.default.discount.findMany({
            where: {
                fieldId: field.id,
                enabled: true,
                startDate: {
                    lte: now
                },
                endDate: {
                    gte: now
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        res.json({
            success: true,
            data: discounts
        });
    });
    // Toggle discount enabled/disabled (field owner only)
    toggleDiscount = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const userId = req.user.id;
        const { discountId } = req.params;
        const discount = await _database.default.discount.findUnique({
            where: {
                id: discountId
            },
            include: {
                field: true
            }
        });
        if (!discount) {
            throw new _AppError.AppError('Discount not found', 404);
        }
        if (discount.field.ownerId !== userId) {
            throw new _AppError.AppError('You are not the owner of this field', 403);
        }
        const updatedDiscount = await _database.default.discount.update({
            where: {
                id: discountId
            },
            data: {
                enabled: !discount.enabled
            }
        });
        res.json({
            success: true,
            message: `Discount ${updatedDiscount.enabled ? 'enabled' : 'disabled'} successfully`,
            data: updatedDiscount
        });
    });
    // Delete a discount (field owner only)
    deleteDiscount = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const userId = req.user.id;
        const { discountId } = req.params;
        const discount = await _database.default.discount.findUnique({
            where: {
                id: discountId
            },
            include: {
                field: true
            }
        });
        if (!discount) {
            throw new _AppError.AppError('Discount not found', 404);
        }
        if (discount.field.ownerId !== userId) {
            throw new _AppError.AppError('You are not the owner of this field', 403);
        }
        await _database.default.discount.delete({
            where: {
                id: discountId
            }
        });
        res.json({
            success: true,
            message: 'Discount deleted successfully'
        });
    });
}
const _default = new DiscountController();

//# sourceMappingURL=discount.controller.js.map