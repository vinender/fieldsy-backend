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
const client_1 = require("@prisma/client");
const admin_middleware_1 = require("../middleware/admin.middleware");
const field_controller_1 = __importDefault(require("../controllers/field.controller"));
const router = (0, express_1.Router)();
const prisma = new client_1.PrismaClient();
// Admin login endpoint
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        // Find admin user - first find by email, then check role
        const admin = await prisma.user.findFirst({
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
router.get('/stats', admin_middleware_1.authenticateAdmin, async (req, res) => {
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
            prisma.user.count(),
            prisma.field.count(),
            prisma.booking.count(),
            prisma.booking.aggregate({
                _sum: { totalPrice: true },
                where: { paymentStatus: 'PAID' }
            }),
            prisma.booking.count({
                where: {
                    date: { gte: now },
                    status: { in: ['PENDING', 'CONFIRMED'] }
                }
            }),
            prisma.booking.findMany({
                take: 5,
                orderBy: { createdAt: 'desc' },
                include: {
                    user: true,
                    field: true
                }
            }),
            prisma.user.count({ where: { role: 'DOG_OWNER' } }),
            prisma.user.count({ where: { role: 'FIELD_OWNER' } }),
            // Previous period stats for comparison
            prisma.user.count({
                where: {
                    createdAt: { lte: compareEndDate }
                }
            }),
            prisma.field.count({
                where: {
                    createdAt: { lte: compareEndDate }
                }
            }),
            prisma.booking.count({
                where: {
                    createdAt: { lte: compareEndDate }
                }
            }),
            prisma.booking.aggregate({
                _sum: { totalPrice: true },
                where: {
                    paymentStatus: 'PAID',
                    createdAt: { lte: compareEndDate }
                }
            }),
            prisma.booking.count({
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
        const totalRevenue = await prisma.booking.aggregate({
            _sum: { totalPrice: true },
            where: { paymentStatus: 'PAID' }
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
        const whereClause = {};
        let shortBookingIdSearch = null;
        // Search filter - supports searching by user name OR booking ID (full or short format)
        if (searchName && typeof searchName === 'string' && searchName.trim()) {
            let searchTerm = searchName.trim();
            // Check if search term looks like a booking ID (MongoDB ObjectId format: 24 hex characters)
            const isFullBookingId = /^[a-f0-9]{24}$/i.test(searchTerm);
            // Check if search term looks like a short booking ID (e.g., #ABC123 or ABC123 - 6 hex characters)
            // Remove # prefix if present
            const shortIdTerm = searchTerm.startsWith('#') ? searchTerm.slice(1) : searchTerm;
            const isShortBookingId = /^[a-f0-9]{6}$/i.test(shortIdTerm);
            if (isFullBookingId) {
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
            const allBookings = await prisma.booking.findMany({
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
                prisma.booking.findMany({
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
                prisma.booking.count({ where: whereClause })
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
        const booking = await prisma.booking.findUnique({
            where: { id: req.params.id },
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
        // Map the commission fields for frontend display
        const enrichedBooking = {
            ...booking,
            adminCommission: booking.platformCommission || 0,
            fieldOwnerCommission: booking.fieldOwnerAmount || 0,
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
        const user = await prisma.user.findUnique({
            where: { id: req.params.id },
            select: {
                id: true,
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
                                location: true
                            }
                        }
                    }
                }
            }
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({
            success: true,
            user
        });
    }
    catch (error) {
        console.error('Get user details error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Get all users for admin
router.get('/users', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const { page = '1', limit = '10', role } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const where = role ? { role: role } : {};
        const [users, total] = await Promise.all([
            prisma.user.findMany({
                where,
                skip,
                take: parseInt(limit),
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
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
            prisma.user.count({ where })
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
        const searchFilter = search && search.trim() !== '' ? {
            OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { address: { contains: search, mode: 'insensitive' } },
                { city: { contains: search, mode: 'insensitive' } },
                { state: { contains: search, mode: 'insensitive' } },
                { owner: { name: { contains: search, mode: 'insensitive' } } }
            ]
        } : {};
        // Fetch fields with owner details
        const [fields, total] = await Promise.all([
            prisma.field.findMany({
                where: searchFilter,
                skip,
                take: parseInt(limit),
                orderBy: { createdAt: 'desc' },
                include: {
                    owner: true,
                    _count: {
                        select: {
                            bookings: true
                        }
                    }
                }
            }),
            prisma.field.count({ where: searchFilter })
        ]);
        // Calculate total earnings for each field (sum of successful payouts from payouts collection)
        const fieldsWithEarnings = await Promise.all(fields.map(async (field) => {
            // Find Stripe Account for the owner
            const stripeAccount = await prisma.stripeAccount.findUnique({
                where: { userId: field.ownerId }
            });
            let totalPayouts = 0;
            if (stripeAccount) {
                // Get all bookings for THIS specific field
                const fieldBookings = await prisma.booking.findMany({
                    where: {
                        fieldId: field.id,
                        paymentStatus: 'PAID'
                    },
                    select: { id: true }
                });
                const fieldBookingIds = fieldBookings.map(b => b.id);
                if (fieldBookingIds.length > 0) {
                    // Get payouts that include bookings from THIS field
                    const payouts = await prisma.payout.findMany({
                        where: {
                            stripeAccountId: stripeAccount.id,
                            status: 'paid',
                            bookingIds: {
                                hasSome: fieldBookingIds
                            }
                        }
                    });
                    // Calculate the portion of each payout that belongs to this field
                    totalPayouts = payouts.reduce((sum, payout) => {
                        // Count how many bookings in this payout belong to this field
                        const payoutFieldBookings = payout.bookingIds.filter(id => fieldBookingIds.includes(id));
                        // Calculate proportional amount
                        // If payout has 3 bookings and 2 are from this field, this field gets 2/3 of the payout
                        const proportion = payout.bookingIds.length > 0
                            ? payoutFieldBookings.length / payout.bookingIds.length
                            : 0;
                        return sum + (payout.amount * proportion);
                    }, 0);
                }
            }
            return {
                ...field,
                totalEarnings: totalPayouts
            };
        }));
        res.json({
            success: true,
            fields: fieldsWithEarnings,
            total,
            pages: Math.ceil(total / parseInt(limit))
        });
    }
    catch (error) {
        console.error('Get fields error:', error);
        res.status(500).json({ error: 'Internal server error' });
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
            prisma.notification.findMany({
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
            prisma.notification.count(),
            // Count unread admin notifications
            prisma.notification.count({
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
        const notification = await prisma.notification.update({
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
        await prisma.notification.updateMany({
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
        await prisma.notification.delete({
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
            prisma.payment.findMany({
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
            prisma.payment.count()
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
router.get('/booking-stats', admin_middleware_1.authenticateAdmin, async (req, res) => {
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
            prisma.booking.count({
                where: {
                    status: 'COMPLETED',
                    createdAt: { gte: startDate, lte: endDate }
                }
            }),
            prisma.booking.count({
                where: {
                    status: 'CANCELLED',
                    createdAt: { gte: startDate, lte: endDate }
                }
            }),
            prisma.booking.count({
                where: {
                    paymentStatus: 'REFUNDED',
                    createdAt: { gte: startDate, lte: endDate }
                }
            }),
            prisma.booking.count({
                where: {
                    status: 'PENDING',
                    createdAt: { gte: startDate, lte: endDate }
                }
            }),
            prisma.booking.count({
                where: {
                    status: 'CONFIRMED',
                    createdAt: { gte: startDate, lte: endDate }
                }
            })
        ]);
        // Calculate data points for chart
        let chartData = [];
        if (period === 'Today' || period === 'Weekly') {
            // Show daily data
            const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
            for (let i = 0; i < 7; i++) {
                const dayStart = new Date(startDate);
                dayStart.setDate(startDate.getDate() + i);
                const dayEnd = new Date(dayStart);
                dayEnd.setDate(dayEnd.getDate() + 1);
                const [dayCompleted, dayCancelled, dayRefunded] = await Promise.all([
                    prisma.booking.count({
                        where: {
                            status: 'COMPLETED',
                            createdAt: { gte: dayStart, lt: dayEnd }
                        }
                    }),
                    prisma.booking.count({
                        where: {
                            status: 'CANCELLED',
                            createdAt: { gte: dayStart, lt: dayEnd }
                        }
                    }),
                    prisma.booking.count({
                        where: {
                            paymentStatus: 'REFUNDED',
                            createdAt: { gte: dayStart, lt: dayEnd }
                        }
                    })
                ]);
                const dayIndex = dayStart.getDay();
                chartData.push({
                    day: days[dayIndex === 0 ? 6 : dayIndex - 1],
                    values: [dayCompleted, dayCancelled, dayRefunded]
                });
            }
        }
        else if (period === 'Monthly') {
            // Show weekly data for the month
            const weeks = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
            for (let i = 0; i < 4; i++) {
                const weekStart = new Date(startDate);
                weekStart.setDate(startDate.getDate() + (i * 7));
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekEnd.getDate() + 7);
                const [weekCompleted, weekCancelled, weekRefunded] = await Promise.all([
                    prisma.booking.count({
                        where: {
                            status: 'COMPLETED',
                            createdAt: { gte: weekStart, lt: weekEnd }
                        }
                    }),
                    prisma.booking.count({
                        where: {
                            status: 'CANCELLED',
                            createdAt: { gte: weekStart, lt: weekEnd }
                        }
                    }),
                    prisma.booking.count({
                        where: {
                            paymentStatus: 'REFUNDED',
                            createdAt: { gte: weekStart, lt: weekEnd }
                        }
                    })
                ]);
                chartData.push({
                    day: weeks[i],
                    values: [weekCompleted, weekCancelled, weekRefunded]
                });
            }
        }
        else {
            // Show monthly data for the year
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            for (let i = 0; i < 12; i++) {
                const monthStart = new Date(now.getFullYear(), i, 1);
                const monthEnd = new Date(now.getFullYear(), i + 1, 0);
                const [monthCompleted, monthCancelled, monthRefunded] = await Promise.all([
                    prisma.booking.count({
                        where: {
                            status: 'COMPLETED',
                            createdAt: { gte: monthStart, lte: monthEnd }
                        }
                    }),
                    prisma.booking.count({
                        where: {
                            status: 'CANCELLED',
                            createdAt: { gte: monthStart, lte: monthEnd }
                        }
                    }),
                    prisma.booking.count({
                        where: {
                            paymentStatus: 'REFUNDED',
                            createdAt: { gte: monthStart, lte: monthEnd }
                        }
                    })
                ]);
                chartData.push({
                    day: months[i],
                    values: [monthCompleted, monthCancelled, monthRefunded]
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
router.get('/field-utilization', admin_middleware_1.authenticateAdmin, async (req, res) => {
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
        const topFields = await prisma.field.findMany({
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
                    prisma.field.count({
                        where: {
                            bookings: {
                                some: {
                                    createdAt: { gte: dayStart, lt: dayEnd }
                                }
                            }
                        }
                    }),
                    prisma.booking.count({
                        where: {
                            createdAt: { gte: dayStart, lt: dayEnd }
                        }
                    }),
                    prisma.field.count()
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
                    prisma.field.count({
                        where: {
                            bookings: {
                                some: {
                                    createdAt: { gte: weekStart, lt: weekEnd }
                                }
                            }
                        }
                    }),
                    prisma.booking.count({
                        where: {
                            createdAt: { gte: weekStart, lt: weekEnd }
                        }
                    }),
                    prisma.field.count()
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
                    prisma.field.count({
                        where: {
                            bookings: {
                                some: {
                                    createdAt: { gte: monthStart, lte: monthEnd }
                                }
                            }
                        }
                    }),
                    prisma.booking.count({
                        where: {
                            createdAt: { gte: monthStart, lte: monthEnd }
                        }
                    }),
                    prisma.field.count()
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
            prisma.fieldClaim.findMany({
                where,
                orderBy: {
                    createdAt: 'desc'
                },
                skip,
                take: parseInt(limit)
            }),
            prisma.fieldClaim.count({ where })
        ]);
        // Fetch field data separately to handle null fields gracefully
        const claims = await Promise.all(claimsWithoutField.map(async (claim) => {
            let field = null;
            if (claim.fieldId) {
                try {
                    field = await prisma.field.findUnique({
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
        const claim = await prisma.fieldClaim.findUnique({
            where: { id: claimId }
        });
        if (!claim) {
            return res.status(404).json({ error: 'Claim not found' });
        }
        // Fetch field data separately to handle null fields
        let field = null;
        if (claim.fieldId) {
            try {
                field = await prisma.field.findUnique({
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
        // Update the claim
        const updatedClaim = await prisma.fieldClaim.update({
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
        // If approved, update the field
        if (status === 'APPROVED' && updatedClaim.field) {
            await prisma.field.update({
                where: { id: updatedClaim.fieldId },
                data: {
                    isClaimed: true,
                    ownerId: updatedClaim.userId || undefined
                }
            });
        }
        res.json({
            success: true,
            claim: updatedClaim,
            message: `Claim ${status.toLowerCase()} successfully`
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
        const updatedAdmin = await prisma.user.update({
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
            const updatedAdmin = await prisma.user.update({
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
        const updatedAdmin = await prisma.user.update({
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
// Block user (admin only)
router.patch('/users/:userId/block', admin_middleware_1.authenticateAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { reason } = req.body;
        // Check if user exists
        const user = await prisma.user.findUnique({
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
        const blockedUser = await prisma.user.update({
            where: { id: userId },
            data: {
                isBlocked: true,
                blockedAt: new Date(),
                blockReason: reason || 'Blocked by admin'
            }
        });
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
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        // Unblock the user
        const unblockedUser = await prisma.user.update({
            where: { id: userId },
            data: {
                isBlocked: false,
                blockedAt: null,
                blockReason: null
            }
        });
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
// ============================================================================
// TRANSACTIONS - Admin Financial Overview
// ============================================================================
// Get all transactions (payments, refunds, payouts, transfers)
router.get('/transactions', admin_middleware_1.authenticateAdmin, async (req, res) => {
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
        // Build booking filter
        const bookingWhere = {};
        if (dateRange !== 'ALL') {
            bookingWhere.createdAt = dateFilter;
        }
        if (search) {
            bookingWhere.OR = [
                { user: { name: { contains: search, mode: 'insensitive' } } },
                { user: { email: { contains: search, mode: 'insensitive' } } },
                { field: { name: { contains: search, mode: 'insensitive' } } },
                { id: { contains: search, mode: 'insensitive' } }
            ];
        }
        // Get bookings with all related data
        const bookings = await prisma.booking.findMany({
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
            orderBy: { createdAt: 'desc' }
        });
        // Transform bookings into transaction records (one row per booking)
        let allTransactions = bookings.map(booking => {
            // Find payment transaction
            const paymentTransaction = booking.transactions.find(t => t.type === 'PAYMENT');
            // Find refund transaction
            const refundTransaction = booking.transactions.find(t => t.type === 'REFUND');
            // Get main transaction (payment if exists, otherwise first transaction)
            const mainTransaction = paymentTransaction || booking.transactions[0];
            if (!mainTransaction) {
                return null; // Skip bookings without transactions
            }
            // Calculate fees
            const amount = mainTransaction.amount || 0;
            const stripeFee = amount > 0 ? Math.round(((amount * 0.015) + 0.20) * 100) / 100 : 0;
            const amountAfterStripeFee = Math.round((amount - stripeFee) * 100) / 100;
            const platformCommissionRate = mainTransaction.commissionRate || 20;
            const platformFee = Math.round((amountAfterStripeFee * platformCommissionRate) / 100 * 100) / 100;
            const fieldOwnerEarnings = Math.round((amountAfterStripeFee - platformFee) * 100) / 100;
            return {
                id: mainTransaction.id,
                bookingId: booking.id,
                type: 'PAYMENT', // Always show as PAYMENT in table, details show refund/payout status
                amount: amount,
                stripeFee,
                amountAfterStripeFee,
                platformFee,
                fieldOwnerEarnings,
                commissionRate: platformCommissionRate,
                status: mainTransaction.status,
                description: mainTransaction.description,
                // Payment identifiers
                stripePaymentIntentId: paymentTransaction?.stripePaymentIntentId,
                stripeChargeId: paymentTransaction?.stripeChargeId,
                stripeBalanceTransactionId: paymentTransaction?.stripeBalanceTransactionId,
                // Transfer identifiers
                stripeTransferId: mainTransaction.stripeTransferId,
                connectedAccountId: mainTransaction.connectedAccountId,
                // Refund identifiers
                stripeRefundId: refundTransaction?.stripeRefundId,
                // Lifecycle - compute effective lifecycle stage based on booking status
                lifecycleStage: (() => {
                    // If booking is cancelled and refunded, show REFUNDED
                    if (booking.status === 'CANCELLED' && refundTransaction) {
                        return 'REFUNDED';
                    }
                    // If booking is cancelled (no refund yet or not refundable), show CANCELLED
                    if (booking.status === 'CANCELLED') {
                        return 'CANCELLED';
                    }
                    // Otherwise use the transaction's lifecycle stage
                    return mainTransaction.lifecycleStage;
                })(),
                paymentReceivedAt: mainTransaction.paymentReceivedAt || mainTransaction.createdAt,
                fundsAvailableAt: mainTransaction.fundsAvailableAt,
                transferredAt: mainTransaction.transferredAt,
                payoutInitiatedAt: mainTransaction.payoutInitiatedAt,
                payoutCompletedAt: mainTransaction.payoutCompletedAt,
                refundedAt: refundTransaction?.refundedAt || refundTransaction?.createdAt,
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
                    field: booking.field
                },
                // Refund info (if exists)
                hasRefund: !!refundTransaction,
                refundAmount: refundTransaction?.amount,
                refundStatus: refundTransaction?.status,
                // Payout info from booking
                payoutStatus: booking.payoutStatus,
                payoutReleasedAt: booking.payoutReleasedAt
            };
        }).filter(t => t !== null); // Remove null entries
        // Apply type filter after transformation
        if (type !== 'ALL') {
            if (type === 'REFUND') {
                allTransactions = allTransactions.filter(t => t.hasRefund);
            }
            else if (type === 'PAYOUT') {
                allTransactions = allTransactions.filter(t => t.payoutStatus === 'RELEASED' || t.payoutStatus === 'COMPLETED');
            }
            // For PAYMENT, show all (default)
        }
        // Apply status filter
        if (status !== 'ALL') {
            allTransactions = allTransactions.filter(t => t.status === status);
        }
        // Get total before pagination
        const total = allTransactions.length;
        // Apply pagination
        const paginatedTransactions = allTransactions.slice(skip, skip + take);
        // Calculate stats
        const [totalPaymentsResult, totalRefundsResult, totalPayoutsResult, platformFeeResult] = await Promise.all([
            prisma.transaction.aggregate({
                where: { type: 'PAYMENT', status: 'COMPLETED' },
                _sum: { amount: true }
            }),
            prisma.transaction.aggregate({
                where: { type: 'REFUND', status: 'COMPLETED' },
                _sum: { amount: true }
            }),
            prisma.payout.aggregate({
                where: { status: 'paid' },
                _sum: { amount: true }
            }),
            prisma.transaction.aggregate({
                where: { type: 'PAYMENT', status: 'COMPLETED' },
                _sum: { platformFee: true }
            })
        ]);
        const stats = {
            totalPayments: totalPaymentsResult._sum.amount || 0,
            totalRefunds: totalRefundsResult._sum.amount || 0,
            totalPayouts: totalPayoutsResult._sum.amount || 0,
            totalTransfers: 0, // Can be calculated from separate transfers if tracked
            netRevenue: platformFeeResult._sum.platformFee || 0
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
        let transaction = await prisma.transaction.findUnique({
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
            const platformFee = Math.round((amountAfterStripe * platformCommissionRate) / 100 * 100) / 100;
            const fieldOwnerEarnings = Math.round((amountAfterStripe - platformFee) * 100) / 100;
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
        const payout = await prisma.payout.findUnique({
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
                bookingDetails = await prisma.booking.findFirst({
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
