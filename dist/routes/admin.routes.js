"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
//@ts-nocheck
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const database_1 = __importDefault(require("../config/database"));
const admin_middleware_1 = require("../middleware/admin.middleware");
const field_controller_1 = __importDefault(require("../controllers/field.controller"));
const email_service_1 = require("../services/email.service");
const otp_service_1 = require("../services/otp.service");
const constants_1 = require("../config/constants");
const rateLimiter_middleware_1 = require("../middleware/rateLimiter.middleware");
const router = (0, express_1.Router)();
// Admin login endpoint
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        // Find admin user - first find by email, then check role
        const admin = await database_1.default.user.findFirst({
            where: {
                email,
                role: 'ADMIN'
            }
        });
        if (!admin) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        // Verify password
        const validPassword = await bcryptjs_1.default.compare(password, admin.password || '');
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        // Generate JWT token
        const token = jsonwebtoken_1.default.sign({ userId: admin.id, email: admin.email, role: admin.role }, process.env.JWT_SECRET || 'your-secret-key', { expiresIn: '24h' });
        // Return admin data without password
        const { password: _, ...adminData } = admin;
        res.json({
            success: true,
            token,
            admin: adminData
        });
    }
    catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Verify admin token endpoint
router.get('/verify', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const admin = req.admin;
        const { password: _, ...adminData } = admin;
        res.json({
            success: true,
            admin: adminData
        });
    }
    catch (error) {
        console.error('Admin verify error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get dashboard statistics
router.get('/stats', admin_middleware_1.authenticateAdmin, rateLimiter_middleware_1.strictLimiter, async (req, res) => {
    try {
        const { period = 'Today' } = req.query;
        // Get current date and calculate date ranges based on period
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        let startDate;
        let compareStartDate;
        let compareEndDate;
        switch (period) {
            case 'Today':
                startDate = startOfToday;
                compareStartDate = new Date(startOfToday);
                compareStartDate.setDate(compareStartDate.getDate() - 1);
                compareEndDate = new Date(startOfToday);
                compareEndDate.setMilliseconds(compareEndDate.getMilliseconds() - 1);
                break;
            case 'Weekly':
                startDate = new Date(startOfToday);
                startDate.setDate(startDate.getDate() - 7);
                compareStartDate = new Date(startDate);
                compareStartDate.setDate(compareStartDate.getDate() - 7);
                compareEndDate = new Date(startDate);
                compareEndDate.setMilliseconds(compareEndDate.getMilliseconds() - 1);
                break;
            case 'Monthly':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                compareStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                compareEndDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
                break;
            case 'Yearly':
                startDate = new Date(now.getFullYear(), 0, 1);
                compareStartDate = new Date(now.getFullYear() - 1, 0, 1);
                compareEndDate = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
                break;
            default:
                startDate = startOfToday;
                compareStartDate = new Date(startOfToday);
                compareStartDate.setDate(compareStartDate.getDate() - 1);
                compareEndDate = new Date(startOfToday);
                compareEndDate.setMilliseconds(compareEndDate.getMilliseconds() - 1);
        }
        // Get current statistics
        const [totalUsers, totalFields, totalBookings, totalRevenue, upcomingBookings, recentBookings, dogOwners, fieldOwners, 
        // Yesterday's stats for comparison
        yesterdayUsers, yesterdayFields, yesterdayBookings, yesterdayRevenue, yesterdayUpcomingBookings] = await Promise.all([
            // Current stats
            database_1.default.user.count(),
            database_1.default.field.count(),
            database_1.default.booking.count({
                where: {
                    field: { id: { not: undefined } },
                    user: { id: { not: undefined } }
                }
            }),
            database_1.default.booking.aggregate({
                _sum: { totalPrice: true },
                where: {
                    paymentStatus: 'PAID',
                    field: { id: { not: undefined } },
                    user: { id: { not: undefined } }
                }
            }),
            database_1.default.booking.count({
                where: {
                    date: { gte: now },
                    status: { in: ['PENDING', 'CONFIRMED'] }
                }
            }),
            database_1.default.booking.findMany({
                where: {
                    field: { id: { not: undefined } },
                    user: { id: { not: undefined } }
                },
                take: 5,
                orderBy: { createdAt: 'desc' },
                include: {
                    user: true,
                    field: true
                }
            }),
            database_1.default.user.count({ where: { role: 'DOG_OWNER' } }),
            database_1.default.user.count({ where: { role: 'FIELD_OWNER' } }),
            // Previous period stats for comparison
            database_1.default.user.count({
                where: {
                    createdAt: { lte: compareEndDate }
                }
            }),
            database_1.default.field.count({
                where: {
                    createdAt: { lte: compareEndDate }
                }
            }),
            database_1.default.booking.count({
                where: {
                    createdAt: { lte: compareEndDate },
                    field: { id: { not: undefined } },
                    user: { id: { not: undefined } }
                }
            }),
            database_1.default.booking.aggregate({
                _sum: { totalPrice: true },
                where: {
                    paymentStatus: 'PAID',
                    createdAt: { lte: compareEndDate },
                    field: { id: { not: undefined } },
                    user: { id: { not: undefined } }
                }
            }),
            database_1.default.booking.count({
                where: {
                    date: { gte: compareStartDate },
                    createdAt: { lte: compareEndDate },
                    status: { in: ['PENDING', 'CONFIRMED'] }
                }
            })
        ]);
        // Calculate growth percentages
        const calculateGrowth = (current, yesterday) => {
            if (!yesterday || yesterday === 0) {
                return current > 0 ? 100 : 0;
            }
            return Number(((current - yesterday) / yesterday * 100).toFixed(1));
        };
        const currentRevenue = totalRevenue._sum.totalPrice || 0;
        const yesterdayRevenueValue = yesterdayRevenue._sum.totalPrice || 0;
        res.json({
            success: true,
            stats: {
                totalUsers,
                totalFields,
                totalBookings,
                totalRevenue: currentRevenue,
                upcomingBookings,
                dogOwners,
                fieldOwners,
                recentBookings,
                // Growth percentages
                growth: {
                    users: calculateGrowth(totalUsers, yesterdayUsers),
                    fields: calculateGrowth(totalFields, yesterdayFields),
                    bookings: calculateGrowth(totalBookings, yesterdayBookings),
                    revenue: calculateGrowth(currentRevenue, yesterdayRevenueValue),
                    upcomingBookings: calculateGrowth(upcomingBookings, yesterdayUpcomingBookings)
                }
            }
        });
    }
    catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get total revenue
router.get('/revenue/total', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const totalRevenue = await database_1.default.booking.aggregate({
            _sum: { totalPrice: true },
            where: {
                paymentStatus: 'PAID',
                field: { id: { not: undefined } },
                user: { id: { not: undefined } }
            }
        });
        res.json({
            success: true,
            totalRevenue: totalRevenue._sum.totalPrice || 0
        });
    }
    catch (error) {
        console.error('Revenue error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get all bookings for admin
router.get('/bookings', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const { page = '1', limit = '10', searchName, status, dateRange } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const take = parseInt(limit);
        // Build where clause for filters
        // Exclude bookings with deleted fields or users (orphaned references)
        const whereClause = {
            field: { id: { not: undefined } },
            user: { id: { not: undefined } }
        };
        let shortBookingIdSearch = null;
        // Search filter - supports searching by user name OR booking ID (full, short, or sequential format)
        if (searchName && typeof searchName === 'string' && searchName.trim()) {
            let searchTerm = searchName.trim();
            // Check if search term is a sequential booking ID (e.g. 1111 or #1111)
            const isSequentialBookingId = /^(#)?\d+$/.test(searchTerm);
            // Check if search term looks like a booking ID (MongoDB ObjectId format: 24 hex characters)
            const isFullBookingId = /^[a-f0-9]{24}$/i.test(searchTerm);
            // Check if search term looks like a short booking ID (e.g., #ABC123 or ABC123 - 6 hex characters)
            // Remove # prefix if present
            const shortIdTerm = searchTerm.startsWith('#') ? searchTerm.slice(1) : searchTerm;
            const isShortBookingId = !isSequentialBookingId && /^[a-f0-9]{6}$/i.test(shortIdTerm);
            if (isSequentialBookingId) {
                // Search by new human-readable bookingId
                const cleanId = searchTerm.startsWith('#') ? searchTerm.slice(1) : searchTerm;
                whereClause.bookingId = cleanId;
            }
            else if (isFullBookingId) {
                // Search by full booking ID directly
                whereClause.id = searchTerm;
            }
            else if (isShortBookingId) {
                // For short booking ID search, we'll filter in application code
                // because MongoDB ObjectIds can't use string endsWith
                shortBookingIdSearch = shortIdTerm.toLowerCase();
            }
            else {
                // Search by user name (case-insensitive)
                whereClause.user = {
                    name: {
                        contains: searchTerm,
                        mode: 'insensitive'
                    }
                };
            }
        }
        // Status filter (skip if 'All' or not provided)
        if (status && typeof status === 'string' && status.toLowerCase() !== 'all') {
            whereClause.status = status.toUpperCase();
        }
        // Date range filter
        if (dateRange && typeof dateRange === 'string' && dateRange.toLowerCase() !== 'all') {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            switch (dateRange) {
                case 'Today':
                    const tomorrow = new Date(today);
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    whereClause.date = {
                        gte: today,
                        lt: tomorrow
                    };
                    break;
                case 'This Week':
                    const weekStart = new Date(today);
                    weekStart.setDate(today.getDate() - today.getDay());
                    whereClause.date = {
                        gte: weekStart
                    };
                    break;
                case 'This Month':
                    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
                    whereClause.date = {
                        gte: monthStart
                    };
                    break;
                case 'Last Month':
                    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999);
                    whereClause.date = {
                        gte: lastMonthStart,
                        lte: lastMonthEnd
                    };
                    break;
            }
        }
        let bookings;
        let total;
        if (shortBookingIdSearch) {
            // For short booking ID search, fetch all matching bookings and filter by ID suffix
            // This is less efficient but necessary because MongoDB ObjectIds are binary, not strings
            const allBookings = await database_1.default.booking.findMany({
                where: whereClause,
                orderBy: { createdAt: 'desc' },
                include: {
                    user: true,
                    field: {
                        include: {
                            owner: true
                        }
                    },
                    payment: true
                }
            });
            // Filter by last 6 characters of booking ID
            const filteredBookings = allBookings.filter(booking => booking.id.toLowerCase().endsWith(shortBookingIdSearch));
            total = filteredBookings.length;
            bookings = filteredBookings.slice(skip, skip + take);
        }
        else {
            // Standard query with pagination
            [bookings, total] = await Promise.all([
                database_1.default.booking.findMany({
                    where: whereClause,
                    skip,
                    take,
                    orderBy: { createdAt: 'desc' },
                    include: {
                        user: true,
                        field: {
                            include: {
                                owner: true
                            }
                        },
                        payment: true
                    }
                }),
                database_1.default.booking.count({ where: whereClause })
            ]);
        }
        res.json({
            success: true,
            bookings,
            total,
            pages: Math.ceil(total / take)
        });
    }
    catch (error) {
        console.error('Get bookings error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get booking details
router.get('/bookings/:id', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const isObjectId = id.length === 24 && /^[0-9a-fA-F]+$/.test(id);
        // Use findUnique for ObjectId, findFirst for human-readable bookingId
        const booking = isObjectId
            ? await database_1.default.booking.findUnique({
                where: { id },
                include: {
                    user: true,
                    field: {
                        include: {
                            owner: true
                        }
                    },
                    payment: true
                }
            })
            : await database_1.default.booking.findFirst({
                where: { bookingId: id },
                include: {
                    user: true,
                    field: {
                        include: {
                            owner: true
                        }
                    },
                    payment: true
                }
            });
        if (!booking) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        // Calculate Stripe processing fee (1.5% + £0.20)
        const totalPrice = booking.totalPrice || 0;
        const stripeFee = totalPrice > 0 ? Math.round(((totalPrice * 0.015) + 0.20) * 100) / 100 : 0;
        const amountAfterStripeFee = Math.round((totalPrice - stripeFee) * 100) / 100;
        // Get commission rate from field owner or default
        const commissionRate = booking.field?.owner?.commissionRate || 20;
        // Map the commission fields for frontend display
        const enrichedBooking = {
            ...booking,
            adminCommission: booking.platformCommission || 0,
            fieldOwnerCommission: booking.fieldOwnerAmount || 0,
            stripeFee,
            amountAfterStripeFee,
            commissionRate,
        };
        res.json({
            success: true,
            booking: enrichedBooking
        });
    }
    catch (error) {
        console.error('Get booking details error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get user details with bookings
router.get('/users/:id', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const { bookingPage = '1', bookingLimit = '10' } = req.query;
        const bPage = parseInt(bookingPage);
        const bLimit = parseInt(bookingLimit);
        const bSkip = (bPage - 1) * bLimit;
        const paramId = req.params.id;
        const isObjectId = paramId.length === 24 && /^[0-9a-fA-F]+$/.test(paramId);
        const selectFields = {
            id: true,
            userId: true,
            email: true,
            name: true,
            role: true,
            phone: true,
            image: true,
            googleImage: true,
            emailVerified: true,
            createdAt: true,
            updatedAt: true,
            _count: {
                select: {
                    bookings: true,
                    ownedFields: true
                }
            },
            bookings: {
                orderBy: { createdAt: 'desc' },
                skip: bSkip,
                take: bLimit,
                select: {
                    id: true,
                    date: true,
                    startTime: true,
                    endTime: true,
                    numberOfDogs: true,
                    totalPrice: true,
                    status: true,
                    paymentStatus: true,
                    createdAt: true,
                    field: {
                        select: {
                            name: true,
                            location: true,
                            address: true
                        }
                    }
                }
            }
        };
        // Support both MongoDB ObjectId and human-readable userId
        const user = isObjectId
            ? await database_1.default.user.findUnique({
                where: { id: paramId },
                select: selectFields
            })
            : await database_1.default.user.findUnique({
                where: { userId: paramId },
                select: selectFields
            });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const totalBookings = user._count?.bookings || 0;
        res.json({
            success: true,
            user,
            bookingPagination: {
                page: bPage,
                limit: bLimit,
                total: totalBookings,
                totalPages: Math.ceil(totalBookings / bLimit)
            }
        });
    }
    catch (error) {
        console.error('Get user details error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get all users for admin (supports search by name, email, or userId)
router.get('/users', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const { page = '1', limit = '10', role, search } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const where = {};
        if (role) {
            where.role = role;
        }
        // Add search filter: search by name, email, or human-readable userId
        if (search && typeof search === 'string' && search.trim()) {
            const searchStr = search.trim();
            // Check if search is numeric (could be a userId like "1234" or "#1234")
            const numericSearch = searchStr.replace(/^#/, '');
            const isNumeric = /^\d+$/.test(numericSearch);
            if (isNumeric) {
                // Search by userId (numeric) OR name containing the search term
                where.OR = [
                    { userId: numericSearch },
                    { name: { contains: searchStr, mode: 'insensitive' } },
                    { email: { contains: searchStr, mode: 'insensitive' } }
                ];
            }
            else {
                where.OR = [
                    { name: { contains: searchStr, mode: 'insensitive' } },
                    { email: { contains: searchStr, mode: 'insensitive' } },
                    { phone: { contains: searchStr, mode: 'insensitive' } }
                ];
            }
        }
        const [users, total] = await Promise.all([
            database_1.default.user.findMany({
                where,
                skip,
                take: parseInt(limit),
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    userId: true,
                    email: true,
                    name: true,
                    role: true,
                    phone: true,
                    emailVerified: true,
                    createdAt: true,
                    isBlocked: true,
                    blockedAt: true,
                    blockReason: true,
                    _count: {
                        select: {
                            bookings: true,
                            ownedFields: true
                        }
                    }
                }
            }),
            database_1.default.user.count({ where })
        ]);
        res.json({
            success: true,
            users,
            total,
            pages: Math.ceil(total / parseInt(limit))
        });
    }
    catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get all fields for admin
router.get('/fields', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const { page = '1', limit = '10', search = '' } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        // Build search filter
        const finalSearchFilter = {};
        // Add search conditions if provided
        if (search && search.trim() !== '') {
            finalSearchFilter.OR = [
                { fieldId: { contains: search, mode: 'insensitive' } },
                { name: { contains: search, mode: 'insensitive' } },
                { address: { contains: search, mode: 'insensitive' } },
                { city: { contains: search, mode: 'insensitive' } },
                { state: { contains: search, mode: 'insensitive' } },
                { owner: { name: { contains: search, mode: 'insensitive' } } }
            ];
        }
        const [fields, total] = await Promise.all([
            database_1.default.field.findMany({
                where: finalSearchFilter,
                skip,
                take: parseInt(limit),
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    fieldId: true,
                    name: true,
                    description: true,
                    address: true,
                    city: true,
                    state: true,
                    zipCode: true,
                    latitude: true,
                    longitude: true,
                    price: true,
                    price30min: true,
                    price1hr: true,
                    pricePerDay: true,
                    pricePerHour: true,
                    size: true,
                    type: true,
                    amenities: true,
                    images: true,
                    availability: true,
                    isActive: true,
                    isBlocked: true,
                    isApproved: true,
                    isSubmitted: true,
                    isClaimed: true, // Explicitly include isClaimed
                    entryCode: true,
                    lastEditedBy: true,
                    lastEditedByRole: true,
                    lastEditedAt: true,
                    ownerId: true,
                    createdAt: true,
                    bookingDuration: true,
                    maxDogs: true,
                    _count: {
                        select: {
                            bookings: true
                        }
                    }
                }
            }).catch((error) => {
                console.error('Field findMany error:', {
                    filter: finalSearchFilter,
                    message: error.message
                });
                throw error;
            }),
            database_1.default.field.count({ where: finalSearchFilter })
        ]);
        // Separately fetch owners for fields that have them (avoid null owner issues)
        const fieldIds = fields.map(f => f.id);
        const ownerIds = fields.map(f => f.ownerId).filter((id) => id !== null);
        // Fetch owners separately
        const owners = ownerIds.length > 0
            ? await database_1.default.user.findMany({
                where: { id: { in: ownerIds } },
                select: { id: true, name: true, email: true, phone: true }
            })
            : [];
        const ownerMap = new Map(owners.map(o => [o.id, o]));
        // 1. Batch-fetch stripe accounts for owners (only those that exist)
        const stripeAccounts = ownerIds.length > 0
            ? await database_1.default.stripeAccount.findMany({
                where: { userId: { in: ownerIds } }
            })
            : [];
        const stripeAccountByOwnerId = new Map(stripeAccounts.map(sa => [sa.userId, sa]));
        // 2. Batch-fetch all paid booking IDs for fields on this page
        const allFieldBookings = await database_1.default.booking.findMany({
            where: {
                fieldId: { in: fieldIds },
                paymentStatus: 'PAID'
            },
            select: { id: true, fieldId: true }
        });
        // Group booking IDs by fieldId for quick lookup
        const bookingIdsByFieldId = new Map();
        const allBookingIds = [];
        for (const b of allFieldBookings) {
            if (!bookingIdsByFieldId.has(b.fieldId)) {
                bookingIdsByFieldId.set(b.fieldId, new Set());
            }
            bookingIdsByFieldId.get(b.fieldId).add(b.id);
            allBookingIds.push(b.id);
        }
        // 3. Batch-fetch all paid payouts that reference any of these bookings
        const stripeAccountIds = stripeAccounts.map(sa => sa.id);
        const allPayouts = allBookingIds.length > 0 && stripeAccountIds.length > 0
            ? await database_1.default.payout.findMany({
                where: {
                    stripeAccountId: { in: stripeAccountIds },
                    status: 'paid',
                    bookingIds: { hasSome: allBookingIds }
                }
            })
            : [];
        // Build a map from stripeAccountId to its payouts for fast lookup
        const payoutsByStripeAccountId = new Map();
        for (const payout of allPayouts) {
            if (!payoutsByStripeAccountId.has(payout.stripeAccountId)) {
                payoutsByStripeAccountId.set(payout.stripeAccountId, []);
            }
            payoutsByStripeAccountId.get(payout.stripeAccountId).push(payout);
        }
        // Calculate earnings per field in-memory (no additional queries)
        const fieldsWithEarnings = fields.map((field) => {
            const stripeAccount = stripeAccountByOwnerId.get(field.ownerId);
            let totalPayouts = 0;
            if (stripeAccount) {
                const fieldBookingIdSet = bookingIdsByFieldId.get(field.id);
                if (fieldBookingIdSet && fieldBookingIdSet.size > 0) {
                    const payouts = payoutsByStripeAccountId.get(stripeAccount.id) || [];
                    totalPayouts = payouts.reduce((sum, payout) => {
                        // Safety check: ensure bookingIds is an array
                        if (!Array.isArray(payout.bookingIds) || payout.bookingIds.length === 0) {
                            return sum;
                        }
                        // Count how many bookings in this payout belong to this field
                        const payoutFieldBookings = payout.bookingIds.filter(id => fieldBookingIdSet.has(id));
                        // Calculate proportional amount
                        // If payout has 3 bookings and 2 are from this field, this field gets 2/3 of the payout
                        const proportion = payoutFieldBookings.length / payout.bookingIds.length;
                        return sum + (payout.amount * proportion);
                    }, 0);
                }
            }
            return {
                ...field,
                owner: field.ownerId ? ownerMap.get(field.ownerId) || null : null,
                totalEarnings: totalPayouts
            };
        });
        res.json({
            success: true,
            fields: fieldsWithEarnings,
            total,
            pages: Math.ceil(total / parseInt(limit))
        });
    }
    catch (error) {
        console.error('Get fields error:', {
            message: error.message,
            code: error.code,
            stack: error.stack,
            fullError: error
        });
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
});
// Get field details for admin (with owner and booking data)
router.get('/fields/:id', admin_middleware_1.authenticateAdmin, field_controller_1.default.getFieldDetailsForAdmin);
// Get all notifications for admin (including both dog owner and field owner notifications)
router.get('/notifications', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const { page = '1', limit = '20' } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        // Get admin user ID to also show admin-specific notifications
        const adminId = req.userId;
        // Get all notifications (system-wide) with user details
        const [notifications, total, unreadCount] = await Promise.all([
            database_1.default.notification.findMany({
                skip,
                take: parseInt(limit),
                orderBy: { createdAt: 'desc' },
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            role: true
                        }
                    }
                }
            }),
            database_1.default.notification.count(),
            // Count unread admin notifications
            database_1.default.notification.count({
                where: {
                    OR: [
                        { userId: adminId }, // Admin's own notifications
                        { type: { in: ['user_registered', 'field_added', 'payment_received', 'booking_received'] } } // System-wide events
                    ],
                    read: false
                }
            })
        ]);
        res.json({
            success: true,
            notifications,
            total,
            unreadCount,
            pages: Math.ceil(total / parseInt(limit))
        });
    }
    catch (error) {
        console.error('Get admin notifications error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Mark notification as read for admin
router.patch('/notifications/:id/read', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const notification = await database_1.default.notification.update({
            where: { id: req.params.id },
            data: {
                read: true,
                readAt: new Date()
            }
        });
        res.json({
            success: true,
            notification
        });
    }
    catch (error) {
        console.error('Mark notification as read error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Mark all admin notifications as read
router.patch('/notifications/read-all', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const adminId = req.userId;
        // Mark all system-wide notifications as read
        await database_1.default.notification.updateMany({
            where: {
                OR: [
                    { userId: adminId },
                    { type: { in: ['user_registered', 'field_added', 'payment_received', 'booking_received'] } }
                ],
                read: false
            },
            data: {
                read: true,
                readAt: new Date()
            }
        });
        res.json({
            success: true,
            message: 'All notifications marked as read'
        });
    }
    catch (error) {
        console.error('Mark all notifications as read error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Delete notification for admin
router.delete('/notifications/:id', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        await database_1.default.notification.delete({
            where: { id: req.params.id }
        });
        res.json({
            success: true,
            message: 'Notification deleted'
        });
    }
    catch (error) {
        console.error('Delete notification error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get all payments for admin
router.get('/payments', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const { page = '1', limit = '10' } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [payments, total] = await Promise.all([
            database_1.default.payment.findMany({
                skip,
                take: parseInt(limit),
                orderBy: { createdAt: 'desc' },
                include: {
                    booking: {
                        include: {
                            user: true,
                            field: true
                        }
                    }
                }
            }),
            database_1.default.payment.count()
        ]);
        res.json({
            success: true,
            payments,
            total,
            pages: Math.ceil(total / parseInt(limit))
        });
    }
    catch (error) {
        console.error('Get payments error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get booking stats based on period
router.get('/booking-stats', admin_middleware_1.authenticateAdmin, rateLimiter_middleware_1.strictLimiter, async (req, res) => {
    try {
        const { period = 'Today' } = req.query;
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        let startDate;
        let endDate = now;
        switch (period) {
            case 'Today':
                startDate = startOfToday;
                break;
            case 'Weekly':
                startDate = new Date(startOfToday);
                startDate.setDate(startDate.getDate() - 7);
                break;
            case 'Monthly':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            case 'Yearly':
                startDate = new Date(now.getFullYear(), 0, 1);
                break;
            default:
                startDate = startOfToday;
        }
        // Get booking stats by status
        const [completed, cancelled, refunded, pending, confirmed] = await Promise.all([
            database_1.default.booking.count({
                where: {
                    status: 'COMPLETED',
                    createdAt: { gte: startDate, lte: endDate }
                }
            }),
            database_1.default.booking.count({
                where: {
                    status: 'CANCELLED',
                    createdAt: { gte: startDate, lte: endDate }
                }
            }),
            database_1.default.booking.count({
                where: {
                    paymentStatus: 'REFUNDED',
                    createdAt: { gte: startDate, lte: endDate }
                }
            }),
            database_1.default.booking.count({
                where: {
                    status: 'PENDING',
                    createdAt: { gte: startDate, lte: endDate }
                }
            }),
            database_1.default.booking.count({
                where: {
                    status: 'CONFIRMED',
                    createdAt: { gte: startDate, lte: endDate }
                }
            })
        ]);
        // Single query: fetch all bookings in range with only the fields we need
        const chartQueryStart = period === 'Yearly' ? new Date(now.getFullYear(), 0, 1) : startDate;
        const chartQueryEnd = period === 'Yearly' ? new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999) : endDate;
        const chartBookings = await database_1.default.booking.findMany({
            where: {
                createdAt: { gte: chartQueryStart, lte: chartQueryEnd }
            },
            select: { status: true, paymentStatus: true, createdAt: true }
        });
        // Bucket bookings in-memory by period and status
        let chartData = [];
        if (period === 'Today' || period === 'Weekly') {
            // Show daily data
            const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
            const buckets = [];
            for (let i = 0; i < 7; i++) {
                buckets.push({ completed: 0, cancelled: 0, refunded: 0 });
            }
            for (const b of chartBookings) {
                const bDate = new Date(b.createdAt);
                const diffMs = bDate.getTime() - startDate.getTime();
                const dayIndex = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                if (dayIndex < 0 || dayIndex >= 7)
                    continue;
                if (b.status === 'COMPLETED')
                    buckets[dayIndex].completed++;
                if (b.status === 'CANCELLED')
                    buckets[dayIndex].cancelled++;
                if (b.paymentStatus === 'REFUNDED')
                    buckets[dayIndex].refunded++;
            }
            for (let i = 0; i < 7; i++) {
                const dayStart = new Date(startDate);
                dayStart.setDate(startDate.getDate() + i);
                const jsDay = dayStart.getDay();
                chartData.push({
                    day: days[jsDay === 0 ? 6 : jsDay - 1],
                    values: [buckets[i].completed, buckets[i].cancelled, buckets[i].refunded]
                });
            }
        }
        else if (period === 'Monthly') {
            // Show weekly data for the month
            const weeks = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
            const buckets = [];
            for (let i = 0; i < 4; i++) {
                buckets.push({ completed: 0, cancelled: 0, refunded: 0 });
            }
            for (const b of chartBookings) {
                const bDate = new Date(b.createdAt);
                const diffMs = bDate.getTime() - startDate.getTime();
                const weekIndex = Math.min(Math.floor(diffMs / (1000 * 60 * 60 * 24 * 7)), 3);
                if (weekIndex < 0)
                    continue;
                if (b.status === 'COMPLETED')
                    buckets[weekIndex].completed++;
                if (b.status === 'CANCELLED')
                    buckets[weekIndex].cancelled++;
                if (b.paymentStatus === 'REFUNDED')
                    buckets[weekIndex].refunded++;
            }
            for (let i = 0; i < 4; i++) {
                chartData.push({
                    day: weeks[i],
                    values: [buckets[i].completed, buckets[i].cancelled, buckets[i].refunded]
                });
            }
        }
        else {
            // Show monthly data for the year
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const buckets = [];
            for (let i = 0; i < 12; i++) {
                buckets.push({ completed: 0, cancelled: 0, refunded: 0 });
            }
            for (const b of chartBookings) {
                const bDate = new Date(b.createdAt);
                const monthIndex = bDate.getMonth();
                if (b.status === 'COMPLETED')
                    buckets[monthIndex].completed++;
                if (b.status === 'CANCELLED')
                    buckets[monthIndex].cancelled++;
                if (b.paymentStatus === 'REFUNDED')
                    buckets[monthIndex].refunded++;
            }
            for (let i = 0; i < 12; i++) {
                chartData.push({
                    day: months[i],
                    values: [buckets[i].completed, buckets[i].cancelled, buckets[i].refunded]
                });
            }
        }
        res.json({
            success: true,
            stats: {
                completed,
                cancelled,
                refunded,
                pending,
                confirmed,
                total: completed + cancelled + refunded + pending + confirmed
            },
            chartData
        });
    }
    catch (error) {
        console.error('Booking stats error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get field utilization stats
router.get('/field-utilization', admin_middleware_1.authenticateAdmin, rateLimiter_middleware_1.strictLimiter, async (req, res) => {
    try {
        const { period = 'Today' } = req.query;
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        let startDate;
        let endDate = now;
        switch (period) {
            case 'Today':
                startDate = startOfToday;
                break;
            case 'Weekly':
                startDate = new Date(startOfToday);
                startDate.setDate(startDate.getDate() - 7);
                break;
            case 'Monthly':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                break;
            case 'Yearly':
                startDate = new Date(now.getFullYear(), 0, 1);
                break;
            default:
                startDate = startOfToday;
        }
        // Get top fields by bookings
        const topFields = await database_1.default.field.findMany({
            take: 5,
            orderBy: {
                bookings: {
                    _count: 'desc'
                }
            },
            include: {
                _count: {
                    select: {
                        bookings: {
                            where: {
                                createdAt: { gte: startDate, lte: endDate }
                            }
                        }
                    }
                }
            }
        });
        // Calculate utilization chart data
        let chartData = [];
        if (period === 'Today' || period === 'Weekly') {
            // Show daily utilization
            const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
            for (let i = 0; i < 7; i++) {
                const dayStart = new Date(startDate);
                dayStart.setDate(startDate.getDate() + i);
                const dayEnd = new Date(dayStart);
                dayEnd.setDate(dayEnd.getDate() + 1);
                const [fieldsWithBookings, totalBookings, avgUtilization] = await Promise.all([
                    database_1.default.field.count({
                        where: {
                            bookings: {
                                some: {
                                    createdAt: { gte: dayStart, lt: dayEnd }
                                }
                            }
                        }
                    }),
                    database_1.default.booking.count({
                        where: {
                            createdAt: { gte: dayStart, lt: dayEnd }
                        }
                    }),
                    database_1.default.field.count()
                ]);
                const utilizationRate = avgUtilization > 0 ? Math.round((fieldsWithBookings / avgUtilization) * 100) : 0;
                const dayIndex = dayStart.getDay();
                chartData.push({
                    day: days[dayIndex === 0 ? 6 : dayIndex - 1],
                    values: [fieldsWithBookings, totalBookings, utilizationRate]
                });
            }
        }
        else if (period === 'Monthly') {
            // Show weekly utilization
            const weeks = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
            for (let i = 0; i < 4; i++) {
                const weekStart = new Date(startDate);
                weekStart.setDate(startDate.getDate() + (i * 7));
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekEnd.getDate() + 7);
                const [fieldsWithBookings, totalBookings, avgUtilization] = await Promise.all([
                    database_1.default.field.count({
                        where: {
                            bookings: {
                                some: {
                                    createdAt: { gte: weekStart, lt: weekEnd }
                                }
                            }
                        }
                    }),
                    database_1.default.booking.count({
                        where: {
                            createdAt: { gte: weekStart, lt: weekEnd }
                        }
                    }),
                    database_1.default.field.count()
                ]);
                const utilizationRate = avgUtilization > 0 ? Math.round((fieldsWithBookings / avgUtilization) * 100) : 0;
                chartData.push({
                    day: weeks[i],
                    values: [fieldsWithBookings, totalBookings, utilizationRate]
                });
            }
        }
        else {
            // Show monthly utilization
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            for (let i = 0; i < 12; i++) {
                const monthStart = new Date(now.getFullYear(), i, 1);
                const monthEnd = new Date(now.getFullYear(), i + 1, 0);
                const [fieldsWithBookings, totalBookings, avgUtilization] = await Promise.all([
                    database_1.default.field.count({
                        where: {
                            bookings: {
                                some: {
                                    createdAt: { gte: monthStart, lte: monthEnd }
                                }
                            }
                        }
                    }),
                    database_1.default.booking.count({
                        where: {
                            createdAt: { gte: monthStart, lte: monthEnd }
                        }
                    }),
                    database_1.default.field.count()
                ]);
                const utilizationRate = avgUtilization > 0 ? Math.round((fieldsWithBookings / avgUtilization) * 100) : 0;
                chartData.push({
                    day: months[i],
                    values: [fieldsWithBookings, totalBookings, utilizationRate]
                });
            }
        }
        res.json({
            success: true,
            topFields,
            chartData
        });
    }
    catch (error) {
        console.error('Field utilization error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get all claims for admin
router.get('/claims', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const { status, page = '1', limit = '10' } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const where = {};
        if (status) {
            where.status = status;
        }
        const [claimsWithoutField, total] = await Promise.all([
            database_1.default.fieldClaim.findMany({
                where,
                orderBy: {
                    createdAt: 'desc'
                },
                skip,
                take: parseInt(limit)
            }),
            database_1.default.fieldClaim.count({ where })
        ]);
        // Fetch field data separately to handle null fields gracefully
        const claims = await Promise.all(claimsWithoutField.map(async (claim) => {
            let field = null;
            if (claim.fieldId) {
                try {
                    field = await database_1.default.field.findUnique({
                        where: { id: claim.fieldId },
                        select: {
                            id: true,
                            name: true,
                            address: true,
                            city: true,
                            state: true
                        }
                    });
                }
                catch (err) {
                    // Field might not exist, continue with null
                }
            }
            return {
                ...claim,
                field
            };
        }));
        res.json({
            success: true,
            claims,
            total,
            pages: Math.ceil(total / parseInt(limit)),
            currentPage: parseInt(page)
        });
    }
    catch (error) {
        console.error('Get claims error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get single claim details for admin
router.get('/claims/:claimId', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const { claimId } = req.params;
        const claim = await database_1.default.fieldClaim.findUnique({
            where: { id: claimId }
        });
        if (!claim) {
            return res.status(404).json({ error: 'Claim not found' });
        }
        // Fetch field data separately to handle null fields
        let field = null;
        if (claim.fieldId) {
            try {
                field = await database_1.default.field.findUnique({
                    where: { id: claim.fieldId },
                    select: {
                        id: true,
                        name: true,
                        address: true,
                        city: true,
                        state: true,
                        location: true
                    }
                });
            }
            catch (err) {
                // Field might not exist, continue with null
            }
        }
        res.json({
            success: true,
            claim: {
                ...claim,
                field
            }
        });
    }
    catch (error) {
        console.error('Get claim details error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Update claim status (approve/reject) for admin
router.patch('/claims/:claimId/status', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const { claimId } = req.params;
        const { status, reviewNotes } = req.body;
        const adminId = req.userId;
        if (!['APPROVED', 'REJECTED'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status. Must be APPROVED or REJECTED' });
        }
        // Get the claim with field details
        const claim = await database_1.default.fieldClaim.findUnique({
            where: { id: claimId },
            include: {
                field: {
                    select: {
                        id: true,
                        name: true,
                        address: true,
                        city: true,
                        state: true
                    }
                }
            }
        });
        if (!claim) {
            return res.status(404).json({ error: 'Claim not found' });
        }
        // Variables for credentials (used if approved)
        let generatedPassword;
        let fieldOwner = null;
        // Update the claim
        const updatedClaim = await database_1.default.fieldClaim.update({
            where: { id: claimId },
            data: {
                status,
                reviewNotes,
                reviewedAt: new Date(),
                reviewedBy: adminId
            },
            include: {
                field: true
            }
        });
        // If approved, get the field's existing owner account and generate new password for claimer
        if (status === 'APPROVED') {
            try {
                console.log('========================================');
                console.log('🔍 CLAIM APPROVAL - LOOKING UP FIELD OWNER');
                console.log('========================================');
                console.log('🔍 Claim fieldId:', claim.fieldId);
                // Get the field with its current owner
                const fieldWithOwner = await database_1.default.field.findUnique({
                    where: { id: claim.fieldId },
                    include: {
                        owner: true
                    }
                });
                console.log('🔍 Field found:', fieldWithOwner?.name || 'NOT FOUND');
                console.log('🔍 Field ownerId:', fieldWithOwner?.ownerId || 'NONE');
                console.log('🔍 Field owner object:', fieldWithOwner?.owner ? 'EXISTS' : 'NULL');
                if (fieldWithOwner?.owner) {
                    console.log('🔍 Field owner email:', fieldWithOwner.owner.email);
                    console.log('🔍 Field owner name:', fieldWithOwner.owner.name);
                }
                if (fieldWithOwner?.owner) {
                    // Field has an existing owner - generate new password for them
                    fieldOwner = fieldWithOwner.owner;
                    console.log('✅ Using existing field owner:', fieldOwner.email);
                    // Generate a new password for the existing owner
                    generatedPassword = crypto_1.default.randomBytes(8).toString('hex');
                    const hashedPassword = await bcryptjs_1.default.hash(generatedPassword, constants_1.BCRYPT_ROUNDS);
                    // Update the owner's password and mark email as verified
                    await database_1.default.user.update({
                        where: { id: fieldOwner.id },
                        data: {
                            password: hashedPassword,
                            emailVerified: new Date(), // DateTime field
                            provider: 'general' // Update provider to general since they now have password login
                        }
                    });
                    // Mark the field as claimed
                    await database_1.default.field.update({
                        where: { id: claim.fieldId },
                        data: {
                            isClaimed: true
                        }
                    });
                    console.log(`✅ Updated password for existing field owner: ${fieldOwner.email}`);
                    console.log('✅ Credentials will be sent for:', fieldOwner.email);
                }
                else {
                    // Field has no owner - this shouldn't happen normally, but handle it
                    // Create a new owner account using claimer's details
                    console.log('⚠️ Field has no owner - creating new account from claim data');
                    generatedPassword = crypto_1.default.randomBytes(8).toString('hex');
                    const hashedPassword = await bcryptjs_1.default.hash(generatedPassword, constants_1.BCRYPT_ROUNDS);
                    // Check if user already exists with this email (any role)
                    const existingFieldOwner = await database_1.default.user.findFirst({
                        where: { email: claim.email }
                    });
                    if (!existingFieldOwner) {
                        fieldOwner = await database_1.default.user.create({
                            data: {
                                email: claim.email,
                                name: claim.fullName,
                                password: hashedPassword,
                                role: 'FIELD_OWNER',
                                phone: claim.phoneCode && claim.phoneNumber ? `${claim.phoneCode}${claim.phoneNumber}` : null,
                                provider: 'general',
                                hasField: true,
                                emailVerified: new Date() // DateTime field
                            }
                        });
                        console.log(`✅ Created new field owner account for ${claim.email}`);
                    }
                    else {
                        fieldOwner = existingFieldOwner;
                        // Update password for existing user
                        await database_1.default.user.update({
                            where: { id: existingFieldOwner.id },
                            data: {
                                password: hashedPassword,
                                emailVerified: new Date() // DateTime field
                            }
                        });
                        console.log(`✅ Updated password for existing field owner: ${existingFieldOwner.email}`);
                    }
                    // Update the field with the owner
                    await database_1.default.field.update({
                        where: { id: claim.fieldId },
                        data: {
                            isClaimed: true,
                            ownerId: fieldOwner.id
                        }
                    });
                }
            }
            catch (accountError) {
                console.error('Failed to process field owner account:', accountError);
                return res.status(500).json({ error: 'Failed to process field owner account' });
            }
        }
        // Send email notification about status update
        try {
            const fieldAddress = claim.field.address ?
                `${claim.field.address}${claim.field.city ? ', ' + claim.field.city : ''}${claim.field.state ? ', ' + claim.field.state : ''}` :
                'Address not specified';
            // Comprehensive logging for debugging email issues
            console.log('========================================');
            console.log('📧 CLAIM STATUS EMAIL - DEBUG START');
            console.log('========================================');
            console.log('📧 Notification email (claimer):', claim.email);
            console.log('📧 Claimer name:', claim.fullName);
            console.log('📧 Field name:', claim.field.name || 'Unnamed Field');
            console.log('📧 Field address:', fieldAddress);
            console.log('📧 Claim status:', status);
            console.log('📧 Review notes:', reviewNotes || 'None');
            console.log('📧 Has credentials:', !!generatedPassword);
            if (fieldOwner) {
                console.log('📧 Field owner ID:', fieldOwner.id);
                console.log('📧 Field owner email (for login):', fieldOwner.email);
                console.log('📧 Field owner provider:', fieldOwner.provider);
            }
            if (generatedPassword) {
                console.log('📧 Generated password length:', generatedPassword.length);
            }
            console.log('📧 Calling emailService.sendFieldClaimStatusEmail...');
            const emailResult = await email_service_1.emailService.sendFieldClaimStatusEmail({
                email: claim.email, // Send notification to claimer's email
                fullName: claim.fullName,
                fieldName: claim.field.name || 'Unnamed Field',
                fieldAddress: fieldAddress,
                status: status,
                reviewNotes: reviewNotes,
                documents: claim.documents,
                // Credentials are for the FIELD OWNER's account (not the claim email)
                credentials: status === 'APPROVED' && generatedPassword && fieldOwner ? {
                    email: fieldOwner.email, // Use field owner's email for login credentials
                    password: generatedPassword
                } : undefined
            });
            console.log('📧 Email send result:', emailResult ? 'SUCCESS' : 'FAILED');
            console.log('========================================');
            console.log('📧 CLAIM STATUS EMAIL - DEBUG END');
            console.log('========================================');
        }
        catch (emailError) {
            // Log error but don't fail the status update
            console.error('========================================');
            console.error('❌ CLAIM STATUS EMAIL - ERROR');
            console.error('========================================');
            console.error('❌ Error message:', emailError?.message || 'Unknown error');
            console.error('❌ Error name:', emailError?.name);
            console.error('❌ Error code:', emailError?.code);
            console.error('❌ Error stack:', emailError?.stack);
            console.error('========================================');
        }
        res.json({
            success: true,
            claim: updatedClaim,
            message: `Claim ${status.toLowerCase()} successfully. An email notification has been sent to the claimer.`
        });
    }
    catch (error) {
        console.error('Update claim status error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Update admin profile
router.patch('/profile', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const adminId = req.userId;
        const { name, phone, bio } = req.body;
        const updates = {};
        if (name !== undefined)
            updates.name = name;
        if (phone !== undefined)
            updates.phone = phone;
        if (bio !== undefined)
            updates.bio = bio;
        const updatedAdmin = await database_1.default.user.update({
            where: { id: adminId },
            data: updates
        });
        const { password: _, ...adminData } = updatedAdmin;
        res.json({
            success: true,
            admin: adminData
        });
    }
    catch (error) {
        console.error('Update admin profile error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Upload admin profile image
router.post('/profile/upload-image', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const adminId = req.userId;
        const upload = await Promise.resolve().then(() => __importStar(require('../middleware/upload.middleware')));
        const uploadSingle = upload.uploadSingle('image');
        uploadSingle(req, res, async (err) => {
            if (err) {
                return res.status(400).json({ error: err.message });
            }
            const file = req.file;
            if (!file) {
                return res.status(400).json({ error: 'No file uploaded' });
            }
            const updatedAdmin = await database_1.default.user.update({
                where: { id: adminId },
                data: { image: file.location }
            });
            const { password: _, ...adminData } = updatedAdmin;
            res.json({
                success: true,
                admin: adminData,
                imageUrl: file.location
            });
        });
    }
    catch (error) {
        console.error('Upload admin profile image error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Delete admin profile image
router.delete('/profile/delete-image', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const adminId = req.userId;
        const updatedAdmin = await database_1.default.user.update({
            where: { id: adminId },
            data: { image: null }
        });
        const { password: _, ...adminData } = updatedAdmin;
        res.json({
            success: true,
            admin: adminData
        });
    }
    catch (error) {
        console.error('Delete admin profile image error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Admin: Request email change OTP for own profile
router.post('/profile/request-email-change', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const adminId = req.userId;
        const { newEmail } = req.body;
        if (!newEmail) {
            return res.status(400).json({ error: 'New email is required' });
        }
        const trimmedEmail = newEmail.trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(trimmedEmail)) {
            return res.status(400).json({ error: 'Please enter a valid email address' });
        }
        const admin = await database_1.default.user.findUnique({ where: { id: adminId } });
        if (!admin) {
            return res.status(404).json({ error: 'Admin not found' });
        }
        if (trimmedEmail === admin.email.toLowerCase()) {
            return res.status(400).json({ error: 'New email must be different from your current email' });
        }
        // Check if email is already in use by any user (regardless of role)
        const existingUser = await database_1.default.user.findFirst({
            where: { email: trimmedEmail }
        });
        if (existingUser) {
            return res.status(409).json({ error: 'This email is already in use by another account' });
        }
        await otp_service_1.otpService.sendOtp(trimmedEmail, 'EMAIL_CHANGE', admin.name || undefined);
        res.json({ success: true, message: 'Verification code sent to the new email' });
    }
    catch (error) {
        console.error('Admin profile request email change error:', error);
        res.status(500).json({ error: 'Failed to send verification code' });
    }
});
// Admin: Verify email change OTP for own profile
router.post('/profile/verify-email-change', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const adminId = req.userId;
        const { newEmail, otp } = req.body;
        if (!newEmail || !otp) {
            return res.status(400).json({ error: 'New email and OTP are required' });
        }
        const trimmedEmail = newEmail.trim().toLowerCase();
        const admin = await database_1.default.user.findUnique({ where: { id: adminId } });
        if (!admin) {
            return res.status(404).json({ error: 'Admin not found' });
        }
        // Re-check uniqueness (regardless of role)
        const existingUser = await database_1.default.user.findFirst({
            where: { email: trimmedEmail }
        });
        if (existingUser) {
            return res.status(409).json({ error: 'This email is already in use by another account' });
        }
        const isValid = await otp_service_1.otpService.verifyOtp(trimmedEmail, otp, 'EMAIL_CHANGE');
        if (!isValid) {
            return res.status(400).json({ error: 'Invalid or expired verification code' });
        }
        const updatedAdmin = await database_1.default.user.update({
            where: { id: adminId },
            data: { email: trimmedEmail }
        });
        const { password: _, ...adminData } = updatedAdmin;
        res.json({
            success: true,
            message: 'Email updated successfully',
            admin: adminData
        });
    }
    catch (error) {
        console.error('Admin profile verify email change error:', error);
        res.status(500).json({ error: 'Failed to update email' });
    }
});
// Admin: Change own password
router.patch('/profile/change-password', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const adminId = req.userId;
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current password and new password are required' });
        }
        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters' });
        }
        const admin = await database_1.default.user.findUnique({ where: { id: adminId } });
        if (!admin) {
            return res.status(404).json({ error: 'Admin not found' });
        }
        // Verify current password
        const validPassword = await bcryptjs_1.default.compare(currentPassword, admin.password || '');
        if (!validPassword) {
            return res.status(400).json({ error: 'Current password is incorrect' });
        }
        const hashedPassword = await bcryptjs_1.default.hash(newPassword, constants_1.BCRYPT_ROUNDS);
        await database_1.default.user.update({
            where: { id: adminId },
            data: { password: hashedPassword }
        });
        res.json({ success: true, message: 'Password updated successfully' });
    }
    catch (error) {
        console.error('Admin profile change password error:', error);
        res.status(500).json({ error: 'Failed to update password' });
    }
});
// Block user (admin only)
router.patch('/users/:userId/block', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { reason } = req.body;
        // Check if user exists
        const user = await database_1.default.user.findUnique({
            where: { id: userId }
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        // Prevent blocking other admins
        if (user.role === 'ADMIN') {
            return res.status(403).json({ error: 'Cannot block admin users' });
        }
        // Block the user
        const blockedUser = await database_1.default.user.update({
            where: { id: userId },
            data: {
                isBlocked: true,
                blockedAt: new Date(),
                blockReason: reason || 'Blocked by admin'
            }
        });
        // If user is a FIELD_OWNER, also block all their fields
        if (user.role === 'FIELD_OWNER') {
            await database_1.default.field.updateMany({
                where: { ownerId: userId },
                data: { isBlocked: true }
            });
        }
        const { password: _, ...userData } = blockedUser;
        res.json({
            success: true,
            message: 'User blocked successfully',
            user: userData
        });
    }
    catch (error) {
        console.error('Block user error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Unblock user (admin only)
router.patch('/users/:userId/unblock', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        // Check if user exists
        const user = await database_1.default.user.findUnique({
            where: { id: userId }
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        // Unblock the user
        const unblockedUser = await database_1.default.user.update({
            where: { id: userId },
            data: {
                isBlocked: false,
                blockedAt: null,
                blockReason: null
            }
        });
        // If user is a FIELD_OWNER, also unblock all their fields
        if (user.role === 'FIELD_OWNER') {
            await database_1.default.field.updateMany({
                where: { ownerId: userId },
                data: { isBlocked: false }
            });
        }
        const { password: _, ...userData } = unblockedUser;
        res.json({
            success: true,
            message: 'User unblocked successfully',
            user: userData
        });
    }
    catch (error) {
        console.error('Unblock user error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Admin: Request email change OTP for a user
router.post('/users/:userId/request-email-change', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { newEmail } = req.body;
        if (!newEmail) {
            return res.status(400).json({ error: 'New email is required' });
        }
        const trimmedEmail = newEmail.trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(trimmedEmail)) {
            return res.status(400).json({ error: 'Please enter a valid email address' });
        }
        // Check if user exists
        const user = await database_1.default.user.findUnique({ where: { id: userId } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        if (trimmedEmail === user.email.toLowerCase()) {
            return res.status(400).json({ error: 'New email must be different from the current email' });
        }
        // Check if the new email is already in use by any user (regardless of role)
        const existingUser = await database_1.default.user.findFirst({
            where: { email: trimmedEmail }
        });
        if (existingUser) {
            return res.status(409).json({ error: 'This email is already in use by another account' });
        }
        // Send OTP to the new email
        await otp_service_1.otpService.sendOtp(trimmedEmail, 'EMAIL_CHANGE', user.name || undefined);
        res.json({ success: true, message: 'Verification code sent to the new email' });
    }
    catch (error) {
        console.error('Admin request email change error:', error);
        res.status(500).json({ error: 'Failed to send verification code' });
    }
});
// Admin: Verify email change OTP and update user email
router.post('/users/:userId/verify-email-change', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { newEmail, otp } = req.body;
        if (!newEmail || !otp) {
            return res.status(400).json({ error: 'New email and OTP are required' });
        }
        const trimmedEmail = newEmail.trim().toLowerCase();
        // Check if user exists
        const user = await database_1.default.user.findUnique({ where: { id: userId } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        // Re-check email uniqueness (regardless of role)
        const existingUser = await database_1.default.user.findFirst({
            where: { email: trimmedEmail }
        });
        if (existingUser) {
            return res.status(409).json({ error: 'This email is already in use by another account' });
        }
        // Verify OTP
        const isValid = await otp_service_1.otpService.verifyOtp(trimmedEmail, otp, 'EMAIL_CHANGE');
        if (!isValid) {
            return res.status(400).json({ error: 'Invalid or expired verification code' });
        }
        // Update user email
        const updatedUser = await database_1.default.user.update({
            where: { id: userId },
            data: { email: trimmedEmail }
        });
        const { password: _, ...userData } = updatedUser;
        res.json({
            success: true,
            message: 'Email updated successfully',
            user: userData
        });
    }
    catch (error) {
        console.error('Admin verify email change error:', error);
        res.status(500).json({ error: 'Failed to update email' });
    }
});
// Admin: Change user password
router.patch('/users/:userId/change-password', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { newPassword } = req.body;
        if (!newPassword) {
            return res.status(400).json({ error: 'New password is required' });
        }
        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }
        // Check if user exists
        const user = await database_1.default.user.findUnique({ where: { id: userId } });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        // Hash new password
        const hashedPassword = await bcryptjs_1.default.hash(newPassword, constants_1.BCRYPT_ROUNDS);
        await database_1.default.user.update({
            where: { id: userId },
            data: { password: hashedPassword }
        });
        res.json({ success: true, message: 'Password updated successfully' });
    }
    catch (error) {
        console.error('Admin change password error:', error);
        res.status(500).json({ error: 'Failed to update password' });
    }
});
// ============================================================================
// TRANSACTIONS - Admin Financial Overview
// ============================================================================
// Get all transactions (payments, refunds, payouts, transfers)
router.get('/transactions', admin_middleware_1.authenticateAdmin, rateLimiter_middleware_1.strictLimiter, async (req, res) => {
    try {
        const { page = '1', limit = '20', search = '', type = 'ALL', status = 'ALL', dateRange = 'ALL' } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const take = parseInt(limit);
        // Build date filter
        let dateFilter = {};
        const now = new Date();
        switch (dateRange) {
            case 'today':
                const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                dateFilter = { gte: startOfToday };
                break;
            case 'week':
                const weekAgo = new Date(now);
                weekAgo.setDate(weekAgo.getDate() - 7);
                dateFilter = { gte: weekAgo };
                break;
            case 'month':
                const monthAgo = new Date(now);
                monthAgo.setMonth(monthAgo.getMonth() - 1);
                dateFilter = { gte: monthAgo };
                break;
            case 'quarter':
                const quarterAgo = new Date(now);
                quarterAgo.setMonth(quarterAgo.getMonth() - 3);
                dateFilter = { gte: quarterAgo };
                break;
            case 'year':
                const yearAgo = new Date(now);
                yearAgo.setFullYear(yearAgo.getFullYear() - 1);
                dateFilter = { gte: yearAgo };
                break;
        }
        // GROUP BY BOOKING APPROACH: Get all bookings with their payment, refund, and payout status
        // This ensures ONE ROW PER BOOKING instead of multiple rows per transaction event
        // Build booking filter (exclude orphaned bookings with deleted fields or users)
        const bookingWhere = {
            field: { id: { not: undefined } },
            user: { id: { not: undefined } }
        };
        if (dateRange !== 'ALL') {
            bookingWhere.createdAt = dateFilter;
        }
        if (search) {
            const searchTerm = search.trim().replace(/^#/, '');
            // Search by human-readable bookingId (e.g. 2241)
            bookingWhere.bookingId = searchTerm;
        }
        // Apply type filter at DB level where possible
        if (type === 'REFUND') {
            bookingWhere.paymentStatus = 'REFUNDED';
        }
        else if (type === 'PAYOUT') {
            bookingWhere.payoutStatus = { in: ['RELEASED', 'COMPLETED'] };
        }
        // Apply status filter at DB level
        if (status !== 'ALL') {
            bookingWhere.transactions = { some: { status: status } };
        }
        // Only need transactions for pagination, not full scan
        // Get total count first (cheap)
        const total = await database_1.default.booking.count({ where: bookingWhere });
        // Get paginated bookings (DB-level pagination)
        const bookings = await database_1.default.booking.findMany({
            where: bookingWhere,
            include: {
                user: {
                    select: { id: true, name: true, email: true }
                },
                field: {
                    include: {
                        owner: {
                            select: { id: true, name: true, email: true }
                        }
                    }
                },
                transactions: {
                    orderBy: { createdAt: 'asc' }
                }
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take,
        });
        // Transform bookings into transaction records (one row per booking)
        let allTransactions = bookings.map(booking => {
            // Find payment transaction
            const paymentTransaction = booking.transactions.find(t => t.type === 'PAYMENT');
            // Find refund transaction (could be a separate REFUND type OR the payment itself marked as REFUNDED)
            const refundTransaction = booking.transactions.find(t => t.type === 'REFUND');
            // Get main transaction (payment if exists, otherwise first transaction)
            const mainTransaction = paymentTransaction || booking.transactions[0];
            if (!mainTransaction) {
                return null; // Skip bookings without transactions
            }
            // Detect refund: either a separate REFUND transaction exists, or the booking/payment is marked as refunded
            const isRefunded = !!refundTransaction ||
                booking.paymentStatus === 'REFUNDED' ||
                mainTransaction.lifecycleStage === 'REFUNDED' ||
                !!mainTransaction.refundedAt;
            // Calculate fees
            const amount = mainTransaction.amount || 0;
            const stripeFee = amount > 0 ? Math.round(((amount * 0.015) + 0.20) * 100) / 100 : 0;
            const amountAfterStripeFee = Math.round((amount - stripeFee) * 100) / 100;
            const platformCommissionRate = mainTransaction.commissionRate || 20;
            const platformFee = Math.floor((amountAfterStripeFee * platformCommissionRate) / 100 * 100) / 100;
            const fieldOwnerEarnings = Math.floor((amountAfterStripeFee - platformFee) * 100) / 100;
            // Refund amount: from separate refund tx, or full amount if refunded via Stripe directly
            const refundAmount = refundTransaction?.amount || (isRefunded ? amount : 0);
            return {
                id: mainTransaction.id,
                bookingId: booking.bookingId || booking.id,
                type: 'PAYMENT',
                amount: amount,
                stripeFee,
                amountAfterStripeFee,
                platformFee,
                fieldOwnerEarnings,
                commissionRate: platformCommissionRate,
                status: mainTransaction.status,
                description: mainTransaction.description,
                // Payment identifiers
                stripePaymentIntentId: paymentTransaction?.stripePaymentIntentId || mainTransaction.stripePaymentIntentId,
                stripeChargeId: paymentTransaction?.stripeChargeId || mainTransaction.stripeChargeId,
                stripeBalanceTransactionId: paymentTransaction?.stripeBalanceTransactionId,
                // Transfer identifiers
                stripeTransferId: mainTransaction.stripeTransferId,
                connectedAccountId: mainTransaction.connectedAccountId,
                // Refund identifiers
                stripeRefundId: refundTransaction?.stripeRefundId || mainTransaction.stripeRefundId,
                // Lifecycle
                lifecycleStage: (() => {
                    if (isRefunded)
                        return 'REFUNDED';
                    if (booking.status === 'CANCELLED')
                        return 'CANCELLED';
                    return mainTransaction.lifecycleStage;
                })(),
                paymentReceivedAt: mainTransaction.paymentReceivedAt || mainTransaction.createdAt,
                fundsAvailableAt: mainTransaction.fundsAvailableAt,
                transferredAt: mainTransaction.transferredAt,
                payoutInitiatedAt: mainTransaction.payoutInitiatedAt,
                payoutCompletedAt: mainTransaction.payoutCompletedAt,
                refundedAt: refundTransaction?.refundedAt || mainTransaction.refundedAt,
                failureCode: mainTransaction.failureCode,
                failureMessage: mainTransaction.failureMessage,
                createdAt: booking.createdAt,
                // Booking details
                bookingDate: booking.date,
                bookingStatus: booking.status,
                // User and field info
                user: booking.user,
                booking: {
                    id: booking.id,
                    date: booking.date,
                    startTime: booking.startTime,
                    endTime: booking.endTime,
                    numberOfDogs: booking.numberOfDogs,
                    totalPrice: booking.totalPrice,
                    status: booking.status,
                    paymentStatus: booking.paymentStatus,
                    payoutStatus: booking.payoutStatus,
                    payoutReleasedAt: booking.payoutReleasedAt,
                    cancellationReason: booking.cancellationReason,
                    cancelledAt: booking.cancelledAt,
                    createdAt: booking.createdAt,
                    repeatBooking: booking.repeatBooking,
                    subscriptionId: booking.subscriptionId,
                    field: booking.field
                },
                // Refund info
                hasRefund: isRefunded,
                refundAmount: refundAmount,
                refundStatus: isRefunded ? 'COMPLETED' : null,
                // Payout info from booking
                payoutStatus: booking.payoutStatus,
                payoutReleasedAt: booking.payoutReleasedAt
            };
        }).filter(t => t !== null); // Remove null entries
        // Pagination already applied at DB level
        const paginatedTransactions = allTransactions;
        // Compute stats with aggregate queries (not full scans)
        // Build a base where clause for stats (same date filter, ignore pagination)
        const statsWhere = {
            field: { id: { not: undefined } },
            user: { id: { not: undefined } }
        };
        if (dateRange !== 'ALL' && Object.keys(dateFilter).length > 0) {
            statsWhere.createdAt = dateFilter;
        }
        const [paymentStats, refundStats, payoutAgg] = await Promise.all([
            // Total payments (non-refunded)
            database_1.default.booking.aggregate({
                where: { ...statsWhere, paymentStatus: 'PAID' },
                _sum: { totalPrice: true, platformCommission: true },
            }),
            // Total refunds
            database_1.default.booking.aggregate({
                where: { ...statsWhere, paymentStatus: 'REFUNDED' },
                _sum: { totalPrice: true },
            }),
            // Total payouts
            database_1.default.payout.aggregate({
                where: { status: 'paid' },
                _sum: { amount: true },
            }),
        ]);
        const totalPayments = paymentStats._sum.totalPrice || 0;
        const totalRefunds = refundStats._sum.totalPrice || 0;
        const platformRevenue = paymentStats._sum.platformCommission || 0;
        const totalPayoutsAmount = payoutAgg._sum.amount || 0;
        const stats = {
            totalPayments: Math.round(totalPayments * 100) / 100,
            totalRefunds: Math.round(totalRefunds * 100) / 100,
            totalPayouts: Math.round(totalPayoutsAmount * 100) / 100,
            totalTransfers: 0,
            netRevenue: Math.round(platformRevenue * 100) / 100
        };
        res.json({
            success: true,
            transactions: paginatedTransactions,
            total,
            pages: Math.ceil(total / take),
            stats
        });
    }
    catch (error) {
        console.error('Get transactions error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get single transaction details with complete breakdown
router.get('/transactions/:id', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        // Try to find in Transaction model first
        let transaction = await database_1.default.transaction.findUnique({
            where: { id },
            include: {
                user: {
                    select: { id: true, name: true, email: true, phone: true }
                },
                booking: {
                    include: {
                        field: {
                            include: {
                                owner: {
                                    select: { id: true, name: true, email: true }
                                }
                            }
                        },
                        transactions: {
                            orderBy: { createdAt: 'asc' }
                        }
                    }
                }
            }
        });
        if (transaction) {
            const booking = transaction.booking;
            // Get all transactions for this booking to show complete history
            const allBookingTransactions = booking?.transactions || [];
            const paymentTransaction = allBookingTransactions.find((t) => t.type === 'PAYMENT');
            const refundTransaction = allBookingTransactions.find((t) => t.type === 'REFUND');
            // Calculate Stripe processing fee estimate (approximately 1.5% + 20p for UK/EU cards)
            const grossAmount = transaction.amount;
            const stripeProcessingFee = grossAmount > 0 ? Math.round(((grossAmount * 0.015) + 0.20) * 100) / 100 : 0;
            const amountAfterStripe = Math.round((grossAmount - stripeProcessingFee) * 100) / 100;
            // Calculate platform fee and field owner earnings
            // Commission rate = platform/admin fee percentage (what Fieldsy takes)
            // Field owner receives the remainder after Stripe fees and platform commission
            const platformCommissionRate = transaction.commissionRate || 20; // Default 20% platform fee
            const platformFee = Math.floor((amountAfterStripe * platformCommissionRate) / 100 * 100) / 100;
            const fieldOwnerEarnings = Math.floor((amountAfterStripe - platformFee) * 100) / 100;
            return res.json({
                success: true,
                transaction: {
                    ...transaction,
                    type: transaction.type,
                    amount: transaction.amount,
                    // Stripe fee and net after Stripe
                    stripeFee: stripeProcessingFee,
                    amountAfterStripeFee: amountAfterStripe,
                    // Platform fee and field owner earnings
                    platformFee,
                    fieldOwnerEarnings,
                    commissionRate: platformCommissionRate,
                    status: transaction.status,
                    // Lifecycle tracking
                    lifecycleStage: transaction.lifecycleStage,
                    stripeChargeId: transaction.stripeChargeId,
                    stripeBalanceTransactionId: transaction.stripeBalanceTransactionId,
                    stripeTransferId: transaction.stripeTransferId,
                    stripePayoutId: transaction.stripePayoutId,
                    connectedAccountId: transaction.connectedAccountId,
                    paymentReceivedAt: transaction.paymentReceivedAt,
                    fundsAvailableAt: transaction.fundsAvailableAt,
                    transferredAt: transaction.transferredAt,
                    payoutInitiatedAt: transaction.payoutInitiatedAt,
                    payoutCompletedAt: transaction.payoutCompletedAt,
                    refundedAt: transaction.refundedAt,
                    failureCode: transaction.failureCode,
                    failureMessage: transaction.failureMessage,
                    // Enhanced booking details
                    booking: booking ? {
                        id: booking.id,
                        bookingId: booking.bookingId || booking.id,
                        date: booking.date,
                        timeSlot: booking.timeSlot,
                        startTime: booking.startTime,
                        endTime: booking.endTime,
                        numberOfDogs: booking.numberOfDogs,
                        totalPrice: booking.totalPrice,
                        status: booking.status,
                        paymentStatus: booking.paymentStatus,
                        payoutStatus: booking.payoutStatus,
                        payoutReleasedAt: booking.payoutReleasedAt,
                        cancellationReason: booking.cancellationReason,
                        cancelledAt: booking.cancelledAt,
                        createdAt: booking.createdAt,
                        field: booking.field
                    } : null,
                    // Payment breakdown for complete financial picture
                    paymentBreakdown: {
                        grossAmount: grossAmount,
                        stripeProcessingFee: Math.round(stripeProcessingFee * 100) / 100,
                        amountAfterStripe: Math.round(amountAfterStripe * 100) / 100,
                        platformCommission: platformFee,
                        fieldOwnerAmount: fieldOwnerEarnings,
                        commissionRate: platformCommissionRate
                    },
                    // Related transactions for this booking
                    relatedTransactions: {
                        payment: paymentTransaction ? {
                            id: paymentTransaction.id,
                            amount: paymentTransaction.amount,
                            status: paymentTransaction.status,
                            lifecycleStage: paymentTransaction.lifecycleStage,
                            createdAt: paymentTransaction.createdAt,
                            payoutCompletedAt: paymentTransaction.payoutCompletedAt
                        } : null,
                        refund: refundTransaction ? {
                            id: refundTransaction.id,
                            amount: refundTransaction.amount,
                            status: refundTransaction.status,
                            stripeRefundId: refundTransaction.stripeRefundId,
                            createdAt: refundTransaction.createdAt,
                            refundedAt: refundTransaction.refundedAt
                        } : null
                    }
                }
            });
        }
        // Try to find in Payout model
        const payout = await database_1.default.payout.findUnique({
            where: { id },
            include: {
                stripeAccount: {
                    include: {
                        user: {
                            select: { id: true, name: true, email: true, phone: true }
                        }
                    }
                }
            }
        });
        if (payout) {
            let bookingDetails = null;
            if (payout.bookingIds && payout.bookingIds.length > 0) {
                bookingDetails = await database_1.default.booking.findFirst({
                    where: { id: payout.bookingIds[0] },
                    include: {
                        field: {
                            include: {
                                owner: {
                                    select: { id: true, name: true, email: true }
                                }
                            }
                        }
                    }
                });
            }
            return res.json({
                success: true,
                transaction: {
                    id: payout.id,
                    type: 'PAYOUT',
                    amount: payout.amount,
                    status: payout.status.toUpperCase(),
                    description: payout.description,
                    stripePayoutId: payout.stripePayoutId,
                    stripeAccountId: payout.stripeAccountId,
                    arrivalDate: payout.arrivalDate,
                    failureCode: payout.failureCode,
                    failureMessage: payout.failureMessage,
                    createdAt: payout.createdAt,
                    user: payout.stripeAccount?.user,
                    booking: bookingDetails
                }
            });
        }
        res.status(404).json({ error: 'Transaction not found' });
    }
    catch (error) {
        console.error('Get transaction details error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
