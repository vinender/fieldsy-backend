//@ts-nocheck
import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';

class DiscountController {
  // Create a discount for a field (field owner only)
  createDiscount = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;
    const { fieldId, value, startDate, startTime, endDate, endTime } = req.body;

    if (!fieldId || !value || !startDate || !startTime || !endDate || !endTime) {
      throw new AppError('fieldId, value, startDate, startTime, endDate, and endTime are required', 400);
    }

    if (value < 1 || value > 100) {
      throw new AppError('Discount value must be between 1 and 100', 400);
    }

    // Verify field exists and user is the owner
    const field = await prisma.field.findUnique({
      where: { id: fieldId }
    });

    if (!field) {
      throw new AppError('Field not found', 404);
    }

    if (field.ownerId !== userId) {
      throw new AppError('You are not the owner of this field', 403);
    }

    const parsedStartDate = new Date(startDate);
    const parsedEndDate = new Date(endDate);

    if (isNaN(parsedStartDate.getTime()) || isNaN(parsedEndDate.getTime())) {
      throw new AppError('Invalid date format', 400);
    }

    if (parsedEndDate < parsedStartDate) {
      throw new AppError('End date must be after start date', 400);
    }

    // Build full start/end timestamps for overlap check
    const newStart = new Date(`${startDate}T${startTime}`);
    const newEnd = new Date(`${endDate}T${endTime}`);

    if (newEnd <= newStart) {
      throw new AppError('End date/time must be after start date/time', 400);
    }

    if (newStart < new Date()) {
      throw new AppError('Start date/time cannot be in the past', 400);
    }

    // Check for overlapping enabled discounts on the same field
    const existingDiscounts = await prisma.discount.findMany({
      where: {
        fieldId,
        enabled: true,
      },
    });

    for (const existing of existingDiscounts) {
      const exStart = new Date(`${existing.startDate.toISOString().split('T')[0]}T${existing.startTime}`);
      const exEnd = new Date(`${existing.endDate.toISOString().split('T')[0]}T${existing.endTime}`);

      // Two ranges overlap if one starts before the other ends AND vice versa
      if (newStart < exEnd && newEnd > exStart) {
        throw new AppError(
          `This discount overlaps with an existing ${existing.value}% discount (${existing.startDate.toISOString().split('T')[0]} ${existing.startTime} - ${existing.endDate.toISOString().split('T')[0]} ${existing.endTime}). Please choose a different date/time range.`,
          409
        );
      }
    }

    const discount = await prisma.discount.create({
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
  getFieldDiscounts = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { fieldId } = req.params;

    const field = await prisma.field.findUnique({
      where: { id: fieldId }
    });

    if (!field) {
      throw new AppError('Field not found', 404);
    }

    const where: any = { fieldId };

    // Optional filter: only enabled discounts within validity range
    if (req.query.activeOnly === 'true') {
      const now = new Date();
      where.enabled = true;
      where.startDate = { lte: now };
      where.endDate = { gte: now };
    }

    const discounts = await prisma.discount.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: discounts
    });
  });

  // Get currently active discounts for a field (public)
  getActiveDiscounts = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    let { fieldId } = req.params;

    // Resolve human-readable fieldId (e.g. "F2266") to ObjectId
    const isObjectId = fieldId.length === 24 && /^[0-9a-fA-F]+$/.test(fieldId);
    let field;
    if (isObjectId) {
      field = await prisma.field.findUnique({ where: { id: fieldId } });
    } else {
      field = await prisma.field.findFirst({ where: { fieldId: fieldId } });
      if (field) fieldId = field.id;
    }

    if (!field) {
      throw new AppError('Field not found', 404);
    }

    const now = new Date();

    const discounts = await prisma.discount.findMany({
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
  toggleDiscount = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;
    const { discountId } = req.params;

    const discount = await prisma.discount.findUnique({
      where: { id: discountId },
      include: { field: true }
    });

    if (!discount) {
      throw new AppError('Discount not found', 404);
    }

    if (discount.field.ownerId !== userId) {
      throw new AppError('You are not the owner of this field', 403);
    }

    const updatedDiscount = await prisma.discount.update({
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
  deleteDiscount = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).user.id;
    const { discountId } = req.params;

    const discount = await prisma.discount.findUnique({
      where: { id: discountId },
      include: { field: true }
    });

    if (!discount) {
      throw new AppError('Discount not found', 404);
    }

    if (discount.field.ownerId !== userId) {
      throw new AppError('You are not the owner of this field', 403);
    }

    await prisma.discount.delete({
      where: { id: discountId }
    });

    res.json({
      success: true,
      message: 'Discount deleted successfully'
    });
  });
}

export default new DiscountController();
