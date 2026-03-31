"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = __importDefault(require("../config/database"));
const asyncHandler_1 = require("../utils/asyncHandler");
const AppError_1 = require("../utils/AppError");
class DiscountController {
    // Create a discount for a field (field owner only)
    createDiscount = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const userId = req.user.id;
        const { fieldId, value, startDate, startTime, endDate, endTime } = req.body;
        if (!fieldId || !value || !startDate || !startTime || !endDate || !endTime) {
            throw new AppError_1.AppError('fieldId, value, startDate, startTime, endDate, and endTime are required', 400);
        }
        if (value < 1 || value > 100) {
            throw new AppError_1.AppError('Discount value must be between 1 and 100', 400);
        }
        // Verify field exists and user is the owner
        const field = await database_1.default.field.findUnique({
            where: { id: fieldId }
        });
        if (!field) {
            throw new AppError_1.AppError('Field not found', 404);
        }
        if (field.ownerId !== userId) {
            throw new AppError_1.AppError('You are not the owner of this field', 403);
        }
        const parsedStartDate = new Date(startDate);
        const parsedEndDate = new Date(endDate);
        if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime())) {
            throw new AppError_1.AppError('Invalid date format', 400);
        }
        if (parsedEndDate < parsedStartDate) {
            throw new AppError_1.AppError('End date must be after start date', 400);
        }
        const discount = await database_1.default.discount.create({
            data: {
                fieldId,
                value,
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
    getFieldDiscounts = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { fieldId } = req.params;
        const field = await database_1.default.field.findUnique({
            where: { id: fieldId }
        });
        if (!field) {
            throw new AppError_1.AppError('Field not found', 404);
        }
        const where = { fieldId };
        // Optional filter: only enabled discounts within validity range
        if (req.query.activeOnly === 'true') {
            const now = new Date();
            where.enabled = true;
            where.startDate = { lte: now };
            where.endDate = { gte: now };
        }
        const discounts = await database_1.default.discount.findMany({
            where,
            orderBy: { createdAt: 'desc' }
        });
        res.json({
            success: true,
            data: discounts
        });
    });
    // Get currently active discounts for a field (public)
    getActiveDiscounts = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        let { fieldId } = req.params;
        // Resolve human-readable fieldId (e.g. "F2266") to ObjectId
        const isObjectId = fieldId.length === 24 && /^[0-9a-fA-F]+$/.test(fieldId);
        let field;
        if (isObjectId) {
            field = await database_1.default.field.findUnique({ where: { id: fieldId } });
        }
        else {
            field = await database_1.default.field.findFirst({ where: { fieldId: fieldId } });
            if (field)
                fieldId = field.id;
        }
        if (!field) {
            throw new AppError_1.AppError('Field not found', 404);
        }
        const now = new Date();
        const discounts = await database_1.default.discount.findMany({
            where: {
                fieldId: field.id,
                enabled: true,
                startDate: { lte: now },
                endDate: { gte: now }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json({
            success: true,
            data: discounts
        });
    });
    // Toggle discount enabled/disabled (field owner only)
    toggleDiscount = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const userId = req.user.id;
        const { discountId } = req.params;
        const discount = await database_1.default.discount.findUnique({
            where: { id: discountId },
            include: { field: true }
        });
        if (!discount) {
            throw new AppError_1.AppError('Discount not found', 404);
        }
        if (discount.field.ownerId !== userId) {
            throw new AppError_1.AppError('You are not the owner of this field', 403);
        }
        const updatedDiscount = await database_1.default.discount.update({
            where: { id: discountId },
            data: { enabled: !discount.enabled }
        });
        res.json({
            success: true,
            message: `Discount ${updatedDiscount.enabled ? 'enabled' : 'disabled'} successfully`,
            data: updatedDiscount
        });
    });
    // Delete a discount (field owner only)
    deleteDiscount = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const userId = req.user.id;
        const { discountId } = req.params;
        const discount = await database_1.default.discount.findUnique({
            where: { id: discountId },
            include: { field: true }
        });
        if (!discount) {
            throw new AppError_1.AppError('Discount not found', 404);
        }
        if (discount.field.ownerId !== userId) {
            throw new AppError_1.AppError('You are not the owner of this field', 403);
        }
        await database_1.default.discount.delete({
            where: { id: discountId }
        });
        res.json({
            success: true,
            message: 'Discount deleted successfully'
        });
    });
}
exports.default = new DiscountController();
