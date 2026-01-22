"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifySiteAccess = exports.getPublicSettings = exports.updatePlatformImages = exports.updateSystemSettings = exports.getSystemSettings = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
// (Removed DEFAULT_TERMS)
// Get system settings
const getSystemSettings = async (req, res) => {
    try {
        // Get the first settings record or create one with defaults
        let settings = await prisma.systemSettings.findFirst();
        if (!settings) {
            // Create default settings if none exist
            settings = await prisma.systemSettings.create({
                data: {
                    defaultCommissionRate: 20,
                    cancellationWindowHours: 24,
                    maxBookingsPerUser: 10,
                    minimumFieldOperatingHours: 4,
                    payoutReleaseSchedule: 'after_cancellation_window',
                    siteName: 'Fieldsy',
                    siteUrl: 'https://fieldsy.com',
                    supportEmail: 'support@fieldsy.com',
                    maintenanceMode: false,
                    enableNotifications: true,
                    enableEmailNotifications: true,
                    enableSmsNotifications: false,
                    bannerText: 'Find Safe, private dog walking fields',
                    highlightedText: 'near you',
                    highlightedText: 'near you',
                    isLive: true
                }
            });
        }
        res.json({
            success: true,
            data: settings
        });
    }
    catch (error) {
        console.error('Error fetching system settings:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch system settings'
        });
    }
};
exports.getSystemSettings = getSystemSettings;
// Update system settings (Admin only)
const updateSystemSettings = async (req, res) => {
    try {
        const { defaultCommissionRate, cancellationWindowHours, maxAdvanceBookingDays, maxBookingsPerUser, minimumFieldOperatingHours, payoutReleaseSchedule, siteName, siteUrl, supportEmail, adminEmail, maintenanceMode, enableNotifications, enableEmailNotifications, enableSmsNotifications, bannerText, highlightedText, isLive, aboutTitle, aboutDogImage, aboutFamilyImage, aboutDogIcons, bypassUsername, bypassPassword, } = req.body;
        // Validate maxAdvanceBookingDays is between 30 and 60
        if (maxAdvanceBookingDays !== undefined) {
            if (maxAdvanceBookingDays < 30 || maxAdvanceBookingDays > 60) {
                return res.status(400).json({
                    success: false,
                    message: 'Max advance booking days must be between 30 and 60 days'
                });
            }
        }
        // Validate defaultCommissionRate: must be 1-50%, whole numbers only, no 0
        if (defaultCommissionRate !== undefined) {
            const rate = Number(defaultCommissionRate);
            if (isNaN(rate) || rate < 1 || rate > 50 || !Number.isInteger(rate)) {
                return res.status(400).json({
                    success: false,
                    message: 'Commission rate must be a whole number between 1% and 50%'
                });
            }
        }
        // Get existing settings or create if not exists
        let settings = await prisma.systemSettings.findFirst();
        if (!settings) {
            // Create with provided values
            settings = await prisma.systemSettings.create({
                data: {
                    defaultCommissionRate: defaultCommissionRate || 20,
                    cancellationWindowHours: cancellationWindowHours || 24,
                    maxAdvanceBookingDays: maxAdvanceBookingDays || 30,
                    maxBookingsPerUser: maxBookingsPerUser || 10,
                    minimumFieldOperatingHours: minimumFieldOperatingHours || 4,
                    payoutReleaseSchedule: payoutReleaseSchedule || 'after_cancellation_window',
                    siteName: siteName || 'Fieldsy',
                    siteUrl: siteUrl || 'https://fieldsy.com',
                    supportEmail: supportEmail || 'support@fieldsy.com',
                    maintenanceMode: maintenanceMode || false,
                    enableNotifications: enableNotifications ?? true,
                    enableEmailNotifications: enableEmailNotifications ?? true,
                    enableSmsNotifications: enableSmsNotifications ?? false,
                    bannerText: bannerText || 'Find Safe, private dog walking fields',
                    highlightedText: highlightedText || 'near you',
                    isLive: isLive ?? true,
                    aboutTitle: aboutTitle || 'At Fieldsy, we believe every dog deserves the freedom to run, sniff, and play safely.',
                    aboutDogImage: aboutDogImage || '',
                    aboutFamilyImage: aboutFamilyImage || '',
                    aboutDogImage: aboutDogImage || '',
                    aboutFamilyImage: aboutFamilyImage || '',
                    aboutDogIcons: aboutDogIcons || []
                }
            });
        }
        else {
            // Update existing settings
            settings = await prisma.systemSettings.update({
                where: { id: settings.id },
                data: {
                    ...(defaultCommissionRate !== undefined && { defaultCommissionRate }),
                    ...(payoutReleaseSchedule !== undefined && { payoutReleaseSchedule }),
                    ...(cancellationWindowHours !== undefined && { cancellationWindowHours }),
                    ...(maxAdvanceBookingDays !== undefined && { maxAdvanceBookingDays }),
                    ...(maxBookingsPerUser !== undefined && { maxBookingsPerUser }),
                    ...(minimumFieldOperatingHours !== undefined && { minimumFieldOperatingHours }),
                    ...(siteName !== undefined && { siteName }),
                    ...(siteUrl !== undefined && { siteUrl }),
                    ...(supportEmail !== undefined && { supportEmail }),
                    ...(adminEmail !== undefined && { adminEmail }),
                    ...(maintenanceMode !== undefined && { maintenanceMode }),
                    ...(enableNotifications !== undefined && { enableNotifications }),
                    ...(enableEmailNotifications !== undefined && { enableEmailNotifications }),
                    ...(enableSmsNotifications !== undefined && { enableSmsNotifications }),
                    ...(bannerText !== undefined && { bannerText }),
                    ...(highlightedText !== undefined && { highlightedText }),
                    ...(isLive !== undefined && { isLive }),
                    ...(bypassUsername !== undefined && { bypassUsername }),
                    ...(bypassPassword !== undefined && { bypassPassword }),
                    ...(aboutTitle !== undefined && { aboutTitle }),
                    ...(aboutDogImage !== undefined && { aboutDogImage }),
                    ...(aboutFamilyImage !== undefined && { aboutFamilyImage }),
                    ...(aboutDogIcons !== undefined && { aboutDogIcons }),
                    ...(req.body.platformDogOwnersImage !== undefined && { platformDogOwnersImage: req.body.platformDogOwnersImage }),
                    ...(req.body.platformFieldOwnersImage !== undefined && { platformFieldOwnersImage: req.body.platformFieldOwnersImage }),
                    ...(req.body.platformWaveImage !== undefined && { platformWaveImage: req.body.platformWaveImage }),
                    ...(req.body.platformHoverImage !== undefined && { platformHoverImage: req.body.platformHoverImage }),
                }
            });
        }
        res.json({
            success: true,
            data: settings,
            message: 'System settings updated successfully'
        });
    }
    catch (error) {
        console.error('Error updating system settings:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update system settings'
        });
    }
};
exports.updateSystemSettings = updateSystemSettings;
// Update platform section (Admin only)
const updatePlatformImages = async (req, res) => {
    try {
        const { platformDogOwnersImage, platformFieldOwnersImage, platformTitle, platformDogOwnersSubtitle, platformDogOwnersTitle, platformDogOwnersBullets, platformFieldOwnersSubtitle, platformFieldOwnersTitle, platformFieldOwnersBullets } = req.body;
        // Get existing settings or create if not exists
        let settings = await prisma.systemSettings.findFirst();
        if (!settings) {
            // Create with provided values
            settings = await prisma.systemSettings.create({
                data: {
                    defaultCommissionRate: 20,
                    cancellationWindowHours: 24,
                    maxBookingsPerUser: 10,
                    siteName: 'Fieldsy',
                    siteUrl: 'https://fieldsy.com',
                    supportEmail: 'support@fieldsy.com',
                    maintenanceMode: false,
                    enableNotifications: true,
                    enableEmailNotifications: true,
                    enableSmsNotifications: false,
                    bannerText: 'Find Safe, private dog walking fields',
                    highlightedText: 'near you',
                    platformDogOwnersImage: platformDogOwnersImage || '',
                    platformFieldOwnersImage: platformFieldOwnersImage || '',
                    platformTitle: platformTitle || 'One Platform, Two Tail-Wagging Experiences',
                    platformDogOwnersSubtitle: platformDogOwnersSubtitle || 'For Dog Owners:',
                    platformDogOwnersTitle: platformDogOwnersTitle || 'Find & Book Private Dog Walking Fields in Seconds',
                    platformDogOwnersBullets: platformDogOwnersBullets || ["Stress-free walks for reactive or energetic dogs", "Fully fenced, secure spaces", "GPS-powered search", "Instant hourly bookings"],
                    platformFieldOwnersSubtitle: platformFieldOwnersSubtitle || 'For Field Owners:',
                    platformFieldOwnersTitle: platformFieldOwnersTitle || "Turn Your Land into a Dog's Dream & Earn",
                    platformFieldOwnersBullets: platformFieldOwnersBullets || ["Earn passive income while helping pets", "Host dog owners with full control", "Set your availability and pricing", "List your field for free"]
                }
            });
        }
        else {
            // Update existing settings
            settings = await prisma.systemSettings.update({
                where: { id: settings.id },
                data: {
                    ...(platformDogOwnersImage !== undefined && { platformDogOwnersImage }),
                    ...(platformFieldOwnersImage !== undefined && { platformFieldOwnersImage }),
                    ...(platformTitle !== undefined && { platformTitle }),
                    ...(platformDogOwnersSubtitle !== undefined && { platformDogOwnersSubtitle }),
                    ...(platformDogOwnersTitle !== undefined && { platformDogOwnersTitle }),
                    ...(platformDogOwnersBullets !== undefined && { platformDogOwnersBullets }),
                    ...(platformFieldOwnersSubtitle !== undefined && { platformFieldOwnersSubtitle }),
                    ...(platformFieldOwnersTitle !== undefined && { platformFieldOwnersTitle }),
                    ...(platformFieldOwnersBullets !== undefined && { platformFieldOwnersBullets })
                }
            });
        }
        res.json({
            success: true,
            data: {
                platformDogOwnersImage: settings.platformDogOwnersImage,
                platformFieldOwnersImage: settings.platformFieldOwnersImage,
                platformTitle: settings.platformTitle,
                platformDogOwnersSubtitle: settings.platformDogOwnersSubtitle,
                platformDogOwnersTitle: settings.platformDogOwnersTitle,
                platformDogOwnersBullets: settings.platformDogOwnersBullets,
                platformFieldOwnersSubtitle: settings.platformFieldOwnersSubtitle,
                platformFieldOwnersTitle: settings.platformFieldOwnersTitle,
                platformFieldOwnersBullets: settings.platformFieldOwnersBullets
            },
            message: 'Platform section updated successfully'
        });
    }
    catch (error) {
        console.error('Error updating platform section:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update platform section'
        });
    }
};
exports.updatePlatformImages = updatePlatformImages;
// Get public settings (for frontend use, no auth required)
const getPublicSettings = async (req, res) => {
    try {
        let settings = await prisma.systemSettings.findFirst({
            select: {
                defaultCommissionRate: true,
                cancellationWindowHours: true,
                maxAdvanceBookingDays: true,
                maxBookingsPerUser: true,
                minimumFieldOperatingHours: true,
                siteName: true,
                siteUrl: true,
                supportEmail: true,
                maintenanceMode: true,
                bannerText: true,
                highlightedText: true,
                isLive: true,
                aboutTitle: true,
                aboutDogImage: true,
                aboutFamilyImage: true,
                aboutDogIcons: true,
                platformDogOwnersImage: true,
                platformFieldOwnersImage: true,
                platformTitle: true,
                platformDogOwnersSubtitle: true,
                platformDogOwnersTitle: true,
                platformDogOwnersBullets: true,
                platformFieldOwnersSubtitle: true,
                platformFieldOwnersTitle: true,
                platformFieldOwnersBullets: true,
            }
        });
        if (!settings) {
            // Return default values if no settings exist
            settings = {
                defaultCommissionRate: 20,
                cancellationWindowHours: 24,
                maxAdvanceBookingDays: 30,
                maxBookingsPerUser: 10,
                minimumFieldOperatingHours: 4,
                siteName: 'Fieldsy',
                siteUrl: 'https://fieldsy.com',
                supportEmail: 'support@fieldsy.com',
                maintenanceMode: false,
                bannerText: 'Find Safe, private dog walking fields',
                highlightedText: 'near you',
                isLive: true,
                aboutTitle: 'At Fieldsy, we believe every dog deserves the freedom to run, sniff, and play safely.',
                aboutDogImage: '',
                aboutFamilyImage: '',
                aboutDogImage: '',
                aboutFamilyImage: '',
                aboutDogIcons: [],
            };
        }
        // Check access for requesting IP
        // Try to get IP from x-forwarded-for header (standard for proxies/load balancers)
        // or fallback to connection remoteAddress
        const forwarded = req.headers['x-forwarded-for'];
        const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket.remoteAddress;
        let hasAccess = false;
        if (ip) {
            const allowedIp = await prisma.allowedIp.findUnique({
                where: { ip }
            });
            if (allowedIp) {
                hasAccess = true;
            }
        }
        res.json({
            success: true,
            data: {
                ...settings,
                hasAccess
            }
        });
    }
    catch (error) {
        console.error('Error fetching public settings:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch public settings'
        });
    }
};
exports.getPublicSettings = getPublicSettings;
// Verify site password and whitelist IP
const verifySiteAccess = async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: 'Username and password are required'
            });
        }
        const settings = await prisma.systemSettings.findFirst();
        if (!settings) {
            return res.status(500).json({
                success: false,
                message: 'System settings not found'
            });
        }
        // Default credentials if not set
        const validUsername = settings.bypassUsername || 'admin';
        const validPassword = settings.bypassPassword || 'fieldsy123';
        if (username !== validUsername || password !== validPassword) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }
        // Get IP
        const forwarded = req.headers['x-forwarded-for'];
        const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket.remoteAddress;
        if (!ip) {
            return res.status(400).json({
                success: false,
                message: 'Could not determine IP address'
            });
        }
        // Add to whitelist
        await prisma.allowedIp.upsert({
            where: { ip },
            update: { updatedAt: new Date() },
            create: {
                ip,
                label: 'User Bypass'
            }
        });
        res.json({
            success: true,
            message: 'Access granted'
        });
    }
    catch (error) {
        console.error('Error verifying site access:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to verify access'
        });
    }
};
exports.verifySiteAccess = verifySiteAccess;
