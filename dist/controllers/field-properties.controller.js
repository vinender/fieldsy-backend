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
const _database = require("../config/database");
const _asyncHandler = require("../utils/asyncHandler");
const _AppError = require("../utils/AppError");
class FieldPropertiesController {
    // GET /field-properties - Get all field properties with their options
    getAllFieldProperties = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const options = await _database.prisma.fieldProperty.findMany({
            where: {
                isActive: true
            },
            orderBy: [
                {
                    category: 'asc'
                },
                {
                    order: 'asc'
                }
            ],
            select: {
                id: true,
                value: true,
                label: true,
                category: true,
                order: true
            }
        });
        // Group by category/field property
        const groupedData = options.reduce((acc, option)=>{
            if (!acc[option.category]) {
                acc[option.category] = [];
            }
            acc[option.category].push({
                id: option.id,
                value: option.value,
                label: option.label,
                order: option.order
            });
            return acc;
        }, {});
        res.json({
            success: true,
            data: groupedData
        });
    });
    // Get field options by property slug/category
    getFieldOptionsByProperty = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const { property } = req.params;
        if (!property) {
            throw new _AppError.AppError('Property slug is required', 400);
        }
        // Get all options for this category/property
        const options = await _database.prisma.fieldProperty.findMany({
            where: {
                category: property,
                isActive: true
            },
            orderBy: {
                order: 'asc'
            },
            select: {
                id: true,
                value: true,
                label: true,
                order: true
            }
        });
        if (options.length === 0) {
            throw new _AppError.AppError('No field options found for this property', 404);
        }
        res.json({
            success: true,
            data: options,
            fieldProperty: property
        });
    });
    // Admin: Get all field properties (including inactive)
    getAllFieldPropertiesAdmin = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const userRole = req.user?.role;
        if (userRole !== 'ADMIN') {
            throw new _AppError.AppError('Access denied. Admin only.', 403);
        }
        const { category, page = 1, limit = 50 } = req.query;
        const filter = {};
        if (category) {
            filter.category = category;
        }
        const [options, total] = await Promise.all([
            _database.prisma.fieldProperty.findMany({
                where: filter,
                orderBy: [
                    {
                        category: 'asc'
                    },
                    {
                        order: 'asc'
                    }
                ],
                skip: (Number(page) - 1) * Number(limit),
                take: Number(limit)
            }),
            _database.prisma.fieldProperty.count({
                where: filter
            })
        ]);
        res.json({
            success: true,
            data: {
                options,
                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    totalPages: Math.ceil(total / Number(limit))
                }
            }
        });
    });
    // Admin: Create field option
    createFieldOption = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const userRole = req.user?.role;
        if (userRole !== 'ADMIN') {
            throw new _AppError.AppError('Access denied. Admin only.', 403);
        }
        const { category, value, label, isActive = true, order = 0 } = req.body;
        if (!category || !value || !label) {
            throw new _AppError.AppError('Category, value, and label are required', 400);
        }
        // Check if option already exists
        const existing = await _database.prisma.fieldProperty.findUnique({
            where: {
                category_value: {
                    category,
                    value
                }
            }
        });
        if (existing) {
            throw new _AppError.AppError('Field option with this category and value already exists', 400);
        }
        const option = await _database.prisma.fieldProperty.create({
            data: {
                category,
                value,
                label,
                isActive,
                order
            }
        });
        res.status(201).json({
            success: true,
            message: 'Field option created successfully',
            data: option
        });
    });
    // Admin: Update field option
    updateFieldOption = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const userRole = req.user?.role;
        if (userRole !== 'ADMIN') {
            throw new _AppError.AppError('Access denied. Admin only.', 403);
        }
        const { id } = req.params;
        const { label, isActive, order } = req.body;
        const option = await _database.prisma.fieldProperty.findUnique({
            where: {
                id
            }
        });
        if (!option) {
            throw new _AppError.AppError('Field option not found', 404);
        }
        const updated = await _database.prisma.fieldProperty.update({
            where: {
                id
            },
            data: {
                ...label && {
                    label
                },
                ...typeof isActive === 'boolean' && {
                    isActive
                },
                ...typeof order === 'number' && {
                    order
                }
            }
        });
        res.json({
            success: true,
            message: 'Field option updated successfully',
            data: updated
        });
    });
    // Admin: Delete field option
    deleteFieldOption = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const userRole = req.user?.role;
        if (userRole !== 'ADMIN') {
            throw new _AppError.AppError('Access denied. Admin only.', 403);
        }
        const { id } = req.params;
        const option = await _database.prisma.fieldProperty.findUnique({
            where: {
                id
            }
        });
        if (!option) {
            throw new _AppError.AppError('Field option not found', 404);
        }
        await _database.prisma.fieldProperty.delete({
            where: {
                id
            }
        });
        res.json({
            success: true,
            message: 'Field option deleted successfully'
        });
    });
    // Admin: Bulk update order
    updateFieldPropertiesOrder = (0, _asyncHandler.asyncHandler)(async (req, res, next)=>{
        const userRole = req.user?.role;
        if (userRole !== 'ADMIN') {
            throw new _AppError.AppError('Access denied. Admin only.', 403);
        }
        const { updates } = req.body; // Array of { id, order }
        if (!Array.isArray(updates) || updates.length === 0) {
            throw new _AppError.AppError('Updates array is required', 400);
        }
        // Bulk update
        await Promise.all(updates.map(({ id, order })=>_database.prisma.fieldProperty.update({
                where: {
                    id
                },
                data: {
                    order
                }
            })));
        res.json({
            success: true,
            message: 'Field properties order updated successfully'
        });
    });
}
const _default = new FieldPropertiesController();

//# sourceMappingURL=field-properties.controller.js.map