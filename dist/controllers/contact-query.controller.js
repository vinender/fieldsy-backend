"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteContactQuery = exports.updateContactQuery = exports.getContactQueryById = exports.getAllContactQueries = exports.createContactQuery = void 0;
const database_1 = __importDefault(require("../config/database"));
// Create a new contact query (public endpoint)
const createContactQuery = async (req, res) => {
    try {
        const { name, email, phone, subject, message } = req.body;
        // Validation
        if (!name || !email || !subject || !message) {
            return res.status(400).json({
                success: false,
                message: 'Name, email, subject, and message are required',
            });
        }
        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid email format',
            });
        }
        // Create the contact query
        const contactQuery = await database_1.default.contactQuery.create({
            data: {
                name,
                email,
                phone: phone || null,
                subject,
                message,
                status: 'new',
            },
        });
        res.status(201).json({
            success: true,
            message: 'Your query has been submitted successfully. We will get back to you soon.',
            data: contactQuery,
        });
    }
    catch (error) {
        console.error('Error creating contact query:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit query. Please try again later.',
            error: error.message,
        });
    }
};
exports.createContactQuery = createContactQuery;
// Get all contact queries (admin only)
const getAllContactQueries = async (req, res) => {
    try {
        const { page = '1', limit = '10', status, search, sortBy = 'createdAt', order = 'desc', } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;
        // Build where clause
        const where = {};
        if (status && status !== 'all') {
            where.status = status;
        }
        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { subject: { contains: search, mode: 'insensitive' } },
                { message: { contains: search, mode: 'insensitive' } },
            ];
        }
        // Get total count
        const total = await database_1.default.contactQuery.count({ where });
        // Get queries with pagination
        const queries = await database_1.default.contactQuery.findMany({
            where,
            skip,
            take: limitNum,
            orderBy: {
                [sortBy]: order === 'asc' ? 'asc' : 'desc',
            },
        });
        // Get status counts
        const statusCounts = await database_1.default.contactQuery.groupBy({
            by: ['status'],
            _count: true,
        });
        const counts = {
            all: total,
            new: 0,
            'in-progress': 0,
            resolved: 0,
        };
        statusCounts.forEach((item) => {
            counts[item.status] = item._count;
        });
        res.status(200).json({
            success: true,
            data: queries,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum),
            },
            counts,
        });
    }
    catch (error) {
        console.error('Error fetching contact queries:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch queries',
            error: error.message,
        });
    }
};
exports.getAllContactQueries = getAllContactQueries;
// Get single contact query by ID (admin only)
const getContactQueryById = async (req, res) => {
    try {
        const { id } = req.params;
        const query = await database_1.default.contactQuery.findUnique({
            where: { id },
        });
        if (!query) {
            return res.status(404).json({
                success: false,
                message: 'Query not found',
            });
        }
        res.status(200).json({
            success: true,
            data: query,
        });
    }
    catch (error) {
        console.error('Error fetching contact query:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch query',
            error: error.message,
        });
    }
};
exports.getContactQueryById = getContactQueryById;
// Update contact query status (admin only)
const updateContactQuery = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, adminNotes } = req.body;
        // Validation
        if (status && !['new', 'in-progress', 'resolved'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status. Must be: new, in-progress, or resolved',
            });
        }
        const updateData = {};
        if (status)
            updateData.status = status;
        if (adminNotes !== undefined)
            updateData.adminNotes = adminNotes;
        const query = await database_1.default.contactQuery.update({
            where: { id },
            data: updateData,
        });
        res.status(200).json({
            success: true,
            message: 'Query updated successfully',
            data: query,
        });
    }
    catch (error) {
        console.error('Error updating contact query:', error);
        if (error.code === 'P2025') {
            return res.status(404).json({
                success: false,
                message: 'Query not found',
            });
        }
        res.status(500).json({
            success: false,
            message: 'Failed to update query',
            error: error.message,
        });
    }
};
exports.updateContactQuery = updateContactQuery;
// Delete contact query (admin only)
const deleteContactQuery = async (req, res) => {
    try {
        const { id } = req.params;
        await database_1.default.contactQuery.delete({
            where: { id },
        });
        res.status(200).json({
            success: true,
            message: 'Query deleted successfully',
        });
    }
    catch (error) {
        console.error('Error deleting contact query:', error);
        if (error.code === 'P2025') {
            return res.status(404).json({
                success: false,
                message: 'Query not found',
            });
        }
        res.status(500).json({
            success: false,
            message: 'Failed to delete query',
            error: error.message,
        });
    }
};
exports.deleteContactQuery = deleteContactQuery;
