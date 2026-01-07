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
const mongodb_1 = require("mongodb");
const field_model_1 = __importDefault(require("../models/field.model"));
const asyncHandler_1 = require("../utils/asyncHandler");
const AppError_1 = require("../utils/AppError");
const database_1 = __importDefault(require("../config/database"));
const amenity_utils_1 = require("../utils/amenity.utils");
const amenity_converter_1 = require("../utils/amenity.converter");
const client_s3_1 = require("@aws-sdk/client-s3");
// Initialize S3 client for image deletion
const s3Client = new client_s3_1.S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});
// Helper function to check if an image URL is valid (not placeholder, not empty)
const isValidImageUrl = (img) => {
    if (!img)
        return false;
    const lowerImg = img.toLowerCase();
    // Skip placeholder images
    if (lowerImg.includes('placeholder') ||
        lowerImg.includes('/fields/field') ||
        lowerImg === 'null' ||
        lowerImg === '') {
        return false;
    }
    // Must be a proper URL (starts with http)
    if (!lowerImg.startsWith('http')) {
        return false;
    }
    return true;
};
// Helper function to check if an image is a premium URL (S3, CDN, etc. - not WordPress)
const isPremiumImageUrl = (img) => {
    const lowerImg = img.toLowerCase();
    // WordPress URLs are valid but not "premium"
    if (lowerImg.includes('dogwalkingfields.co.uk/wp-content') ||
        lowerImg.includes('/wp-content/uploads/')) {
        return false;
    }
    return true;
};
// Helper function to get the first valid image
// Prioritizes non-WordPress URLs, but falls back to WordPress URLs if that's all available
const getFirstValidImage = (images) => {
    if (!images || images.length === 0)
        return null;
    // First, try to find a premium image (S3, CDN, etc.)
    const premiumImage = images.find((img) => {
        if (!isValidImageUrl(img))
            return false;
        return isPremiumImageUrl(img);
    });
    if (premiumImage)
        return premiumImage;
    // Fall back to any valid image (including WordPress)
    const anyValidImage = images.find((img) => isValidImageUrl(img));
    return anyValidImage || null;
};
const formatRecurringFrequency = (repeatBooking) => {
    if (!repeatBooking)
        return 'NA';
    const normalized = repeatBooking.trim().toLowerCase();
    if (!normalized || normalized === 'none' || normalized === 'na' || normalized === 'no') {
        return 'NA';
    }
    const labelMap = {
        everyday: 'Everyday',
        daily: 'Everyday',
        weekly: 'Weekly',
        monthly: 'Monthly',
        weekdays: 'Weekdays',
        weekday: 'Weekdays',
        weekend: 'Weekends',
        weekends: 'Weekends',
    };
    return labelMap[normalized] || repeatBooking.charAt(0).toUpperCase() + repeatBooking.slice(1);
};
/**
 * Generate a unique orderId from MongoDB ObjectId
 * Uses the LAST 6 characters to match admin panel format:
 * - First 4 bytes (8 hex chars) = timestamp (same for bookings created in same second)
 * - Last 6 hex chars = counter (guaranteed unique per document)
 */
const generateOrderId = (bookingId) => {
    if (!bookingId || bookingId.length < 6) {
        return `#${bookingId?.toUpperCase() || 'UNKNOWN'}`;
    }
    // Use last 6 characters of the ObjectId for uniqueness (matches admin panel)
    return `#${bookingId.slice(-6).toUpperCase()}`;
};
class FieldController {
    // Create new field
    createField = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const ownerId = req.user.id;
        const userRole = req.user.role;
        // Only field owners can create fields
        if (userRole !== 'FIELD_OWNER' && userRole !== 'ADMIN') {
            throw new AppError_1.AppError('Only field owners can create fields', 403);
        }
        // Validate minimum operating hours if times are provided
        if (req.body.openingTime && req.body.closingTime) {
            const settings = await database_1.default.systemSettings.findFirst();
            const minimumHours = settings?.minimumFieldOperatingHours || 4;
            const timeToMinutes = (timeStr) => {
                const [hours, minutes] = timeStr.split(':').map(Number);
                return hours * 60 + (minutes || 0);
            };
            const openingMinutes = timeToMinutes(req.body.openingTime);
            const closingMinutes = timeToMinutes(req.body.closingTime);
            const diffHours = (closingMinutes - openingMinutes) / 60;
            if (diffHours < 0) {
                throw new AppError_1.AppError('Closing time must be after opening time', 400);
            }
            if (diffHours < minimumHours) {
                throw new AppError_1.AppError(`Field must be open for at least ${minimumHours} hours`, 400);
            }
        }
        // Convert amenity IDs to names if amenities are provided
        let amenityNames = req.body.amenities || [];
        if (amenityNames && amenityNames.length > 0) {
            amenityNames = await (0, amenity_converter_1.convertAmenityIdsToNames)(amenityNames);
        }
        const fieldData = {
            ...req.body,
            amenities: amenityNames,
            ownerId,
        };
        const field = await field_model_1.default.create(fieldData);
        // Enrich field with full amenity objects
        const enrichedField = await (0, amenity_utils_1.enrichFieldWithAmenities)(field);
        res.status(201).json({
            success: true,
            message: 'Field created successfully',
            data: enrichedField,
        });
    });
    // Get all fields with filters and pagination (admin - includes all fields)
    getAllFields = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { search, zipCode, lat, lng, city, state, type, minPrice, maxPrice, amenities, minRating, maxDistance, date, startTime, endTime, numberOfDogs, size, terrainType, fenceType, instantBooking, availability, sortBy, sortOrder, page = 1, limit = 10, } = req.query;
        const pageNum = Number(page);
        const limitNum = Number(limit);
        const skip = (pageNum - 1) * limitNum;
        // Parse amenities if it's a comma-separated string
        const amenitiesArray = amenities
            ? amenities.split(',').map(a => a.trim())
            : undefined;
        // Parse availability if it's a comma-separated string (e.g., "Morning,Afternoon")
        const availabilityArray = availability
            ? availability.split(',').map(a => a.trim())
            : undefined;
        const result = await field_model_1.default.findAll({
            search: search,
            zipCode: zipCode,
            lat: lat ? Number(lat) : undefined,
            lng: lng ? Number(lng) : undefined,
            city: city,
            state: state,
            type: type,
            minPrice: minPrice ? Number(minPrice) : undefined,
            maxPrice: maxPrice ? Number(maxPrice) : undefined,
            amenities: amenitiesArray,
            minRating: minRating ? Number(minRating) : undefined,
            maxDistance: maxDistance ? Number(maxDistance) : undefined,
            date: date ? new Date(date) : undefined,
            startTime: startTime,
            endTime: endTime,
            numberOfDogs: numberOfDogs ? Number(numberOfDogs) : undefined,
            size: size,
            terrainType: terrainType,
            fenceType: fenceType,
            instantBooking: instantBooking === 'true' ? true : instantBooking === 'false' ? false : undefined,
            availability: availabilityArray,
            sortBy: sortBy,
            sortOrder: sortOrder,
            skip,
            take: limitNum,
        });
        // Enrich fields with full amenity objects
        const enrichedFields = await (0, amenity_utils_1.enrichFieldsWithAmenities)(result.fields);
        const totalPages = Math.ceil(result.total / limitNum);
        res.json({
            success: true,
            data: enrichedFields,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: result.total,
                totalPages,
                hasNextPage: pageNum < totalPages,
                hasPrevPage: pageNum > 1,
            },
        });
    });
    // Get active fields only (public - for field listing/search)
    getActiveFields = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { search, zipCode, lat, lng, city, state, type, minPrice, maxPrice, amenities, minRating, maxDistance, date, startTime, endTime, numberOfDogs, size, terrainType, fenceType, instantBooking, availability, sortBy, sortOrder, page = 1, limit = 10, } = req.query;
        const pageNum = Number(page);
        const limitNum = Number(limit);
        const skip = (pageNum - 1) * limitNum;
        // Parse amenities if it's a comma-separated string
        const amenitiesArray = amenities
            ? amenities.split(',').map(a => a.trim())
            : undefined;
        // Parse availability if it's a comma-separated string (e.g., "Morning,Afternoon")
        const availabilityArray = availability
            ? availability.split(',').map(a => a.trim())
            : undefined;
        // This method already filters by isActive: true and isSubmitted: true
        const result = await field_model_1.default.findAll({
            search: search,
            zipCode: zipCode,
            lat: lat ? Number(lat) : undefined,
            lng: lng ? Number(lng) : undefined,
            city: city,
            state: state,
            type: type,
            minPrice: minPrice ? Number(minPrice) : undefined,
            maxPrice: maxPrice ? Number(maxPrice) : undefined,
            amenities: amenitiesArray,
            minRating: minRating ? Number(minRating) : undefined,
            maxDistance: maxDistance ? Number(maxDistance) : undefined,
            date: date ? new Date(date) : undefined,
            startTime: startTime,
            endTime: endTime,
            numberOfDogs: numberOfDogs ? Number(numberOfDogs) : undefined,
            size: size,
            terrainType: terrainType,
            fenceType: fenceType,
            instantBooking: instantBooking === 'true' ? true : instantBooking === 'false' ? false : undefined,
            availability: availabilityArray,
            sortBy: sortBy,
            sortOrder: sortOrder,
            skip,
            take: limitNum,
        });
        // Transform and calculate distance for each field if user location is provided
        const userLat = lat ? Number(lat) : null;
        const userLng = lng ? Number(lng) : null;
        const transformedFields = result.fields.map((field) => {
            // Get field coordinates from location JSON or legacy lat/lng fields
            // Handle both Prisma Json type and actual parsed object
            const locationData = typeof field.location === 'string'
                ? JSON.parse(field.location)
                : field.location;
            const fieldLat = locationData?.lat || field.latitude;
            const fieldLng = locationData?.lng || field.longitude;
            // Build optimized response with only necessary fields
            const optimizedField = {
                id: field.id,
                name: field.name,
                image: getFirstValidImage(field.images), // First valid image (not WordPress URL)
                price: field.price,
                price30min: field.price30min, // New price field for 30 min slots
                price1hr: field.price1hr, // New price field for 1 hour slots
                duration: field.bookingDuration || 'hour', // 'hour' or '30min'
                rating: field.averageRating || 0,
                reviewCount: field.totalReviews || 0,
                amenities: field.amenities?.slice(0, 4) || [], // Only first 4 amenities for card
                isClaimed: field.isClaimed,
                owner: field.ownerName || 'Field Owner',
                maxDogs: field.maxDogs || 10, // Maximum dogs allowed per booking
                // Location info
                location: {
                    address: field.address,
                    city: field.city,
                    state: field.state,
                    zipCode: field.zipCode,
                    lat: fieldLat,
                    lng: fieldLng,
                },
                // Formatted location string for display
                locationDisplay: [field.city, field.state].filter(Boolean).join(', '),
            };
            // Calculate distance if user location is provided and field has coordinates
            if (userLat && userLng && fieldLat && fieldLng) {
                // Haversine formula to calculate distance in miles
                const R = 3959; // Earth's radius in miles
                const dLat = (fieldLat - userLat) * Math.PI / 180;
                const dLng = (fieldLng - userLng) * Math.PI / 180;
                const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(userLat * Math.PI / 180) * Math.cos(fieldLat * Math.PI / 180) *
                        Math.sin(dLng / 2) * Math.sin(dLng / 2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                const distanceMiles = R * c;
                optimizedField.distance = Number(distanceMiles.toFixed(1));
                optimizedField.distanceDisplay = distanceMiles < 1
                    ? `${(distanceMiles * 1760).toFixed(0)} yards`
                    : `${distanceMiles.toFixed(1)} miles`;
            }
            return optimizedField;
        });
        // Enrich fields with full amenity objects (only for the amenities we're sending)
        const enrichedFields = await (0, amenity_utils_1.enrichFieldsWithAmenities)(transformedFields);
        // Get user's liked fields if authenticated
        const userId = req.user?.id;
        let userLikedFieldIds = new Set();
        if (userId) {
            const userFavorites = await database_1.default.favorite.findMany({
                where: { userId },
                select: { fieldId: true }
            });
            userLikedFieldIds = new Set(userFavorites.map(f => f.fieldId));
        }
        // Add isLiked to each field
        const fieldsWithLikeStatus = enrichedFields.map((field) => ({
            ...field,
            isLiked: userLikedFieldIds.has(field.id)
        }));
        const totalPages = Math.ceil(result.total / limitNum);
        res.json({
            success: true,
            data: fieldsWithLikeStatus,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: result.total,
                totalPages,
                hasNextPage: pageNum < totalPages,
                hasPrevPage: pageNum > 1,
            },
        });
    });
    // Get field suggestions for search
    getFieldSuggestions = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { query } = req.query;
        if (!query || query.length < 2) {
            return res.json({
                success: true,
                data: [],
            });
        }
        const suggestions = await field_model_1.default.getSuggestions(query);
        res.json({
            success: true,
            data: suggestions,
        });
    });
    // Get field by ID
    getField = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { id } = req.params;
        const { lat, lng } = req.query;
        const field = await field_model_1.default.findById(id);
        if (!field) {
            throw new AppError_1.AppError('Field not found', 404);
        }
        // Calculate distance if user location (lat/lng) is provided
        if (lat && lng && field.latitude && field.longitude) {
            const userLat = Number(lat);
            const userLng = Number(lng);
            // Haversine formula to calculate distance in miles
            const R = 3959; // Earth's radius in miles
            const dLat = (field.latitude - userLat) * Math.PI / 180;
            const dLng = (field.longitude - userLng) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(userLat * Math.PI / 180) * Math.cos(field.latitude * Math.PI / 180) *
                    Math.sin(dLng / 2) * Math.sin(dLng / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const distanceMiles = R * c;
            // Add distanceMiles to field response
            field.distanceMiles = Number(distanceMiles.toFixed(1));
        }
        const amenityObjects = await (0, amenity_utils_1.transformAmenitiesToObjects)(field.amenities || []);
        const amenitiesWithIcons = amenityObjects.map((amenity) => ({
            id: amenity.id,
            label: amenity.label,
            value: amenity.value,
            iconUrl: amenity.iconUrl ?? null,
            imageIconUrl: amenity.iconUrl ?? null,
        }));
        const enrichedField = {
            ...field,
            amenities: amenitiesWithIcons,
        };
        res.json({
            success: true,
            data: enrichedField,
        });
    });
    // Get field by ID with minimal data (optimized for SSG/ISR builds)
    getFieldMinimal = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { id } = req.params;
        const field = await field_model_1.default.findByIdMinimal(id);
        if (!field) {
            throw new AppError_1.AppError('Field not found', 404);
        }
        // Transform amenities to objects
        const amenityObjects = await (0, amenity_utils_1.transformAmenitiesToObjects)(field.amenities || []);
        const amenitiesWithIcons = amenityObjects.map((amenity) => ({
            id: amenity.id,
            label: amenity.label,
            value: amenity.value,
            iconUrl: amenity.iconUrl ?? null,
        }));
        const enrichedField = {
            ...field,
            amenities: amenitiesWithIcons,
        };
        res.json({
            success: true,
            data: enrichedField,
        });
    });
    // Get fields by owner
    getMyFields = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const ownerId = req.user.id;
        const fields = await field_model_1.default.findByOwner(ownerId);
        // Enrich fields with full amenity objects
        const enrichedFields = await (0, amenity_utils_1.enrichFieldsWithAmenities)(fields);
        res.json({
            success: true,
            data: enrichedFields,
            total: enrichedFields.length,
        });
    });
    // Update field
    updateField = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { id } = req.params;
        const userId = req.user.id;
        const userRole = req.user.role;
        const formatAddress = (address, city, state, zipCode) => {
            return [address, city, state, zipCode]
                .map(part => (part && typeof part === 'string' ? part.trim() : part))
                .filter(Boolean)
                .join(', ') || 'Not provided';
        };
        // Check ownership
        const field = await field_model_1.default.findById(id);
        if (!field) {
            throw new AppError_1.AppError('Field not found', 404);
        }
        if (field.ownerId !== userId && userRole !== 'ADMIN') {
            throw new AppError_1.AppError('You can only update your own fields', 403);
        }
        // Prevent updating certain fields
        delete req.body.id;
        delete req.body.ownerId;
        // Detailed logging for address change detection
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('🔍 FIELD UPDATE - ADDRESS CHANGE DETECTION');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('📋 Field ID:', id);
        console.log('📋 Field Name:', field.name || 'N/A');
        console.log('👤 User Role:', userRole);
        console.log('───────────────────────────────────────────────────────────────');
        console.log('📍 Current Address in DB:');
        console.log('   - address:', field.address || 'null');
        console.log('   - city:', field.city || 'null');
        console.log('   - state:', field.state || 'null');
        console.log('   - zipCode:', field.zipCode || 'null');
        console.log('───────────────────────────────────────────────────────────────');
        console.log('📍 Incoming Address in Request:');
        console.log('   - address:', req.body.address !== undefined ? req.body.address : '(not in request)');
        console.log('   - city:', req.body.city !== undefined ? req.body.city : '(not in request)');
        console.log('   - state:', req.body.state !== undefined ? req.body.state : '(not in request)');
        console.log('   - zipCode:', req.body.zipCode !== undefined ? req.body.zipCode : '(not in request)');
        console.log('───────────────────────────────────────────────────────────────');
        const addressChanged = (req.body.address !== undefined && req.body.address !== field.address);
        const cityChanged = (req.body.city !== undefined && req.body.city !== field.city);
        const stateChanged = (req.body.state !== undefined && req.body.state !== field.state);
        const zipCodeChanged = (req.body.zipCode !== undefined && req.body.zipCode !== field.zipCode);
        console.log('🔄 Change Detection Results:');
        console.log('   - Address changed:', addressChanged);
        console.log('   - City changed:', cityChanged);
        console.log('   - State changed:', stateChanged);
        console.log('   - ZipCode changed:', zipCodeChanged);
        const addressUpdated = addressChanged || cityChanged || stateChanged || zipCodeChanged;
        const shouldNotifyAdmin = userRole === 'FIELD_OWNER' && addressUpdated;
        console.log('───────────────────────────────────────────────────────────────');
        console.log('📊 Final Decision:');
        console.log('   - Address Updated:', addressUpdated);
        console.log('   - User is FIELD_OWNER:', userRole === 'FIELD_OWNER');
        console.log('   - Should Notify Admin:', shouldNotifyAdmin);
        console.log('═══════════════════════════════════════════════════════════════');
        const previousAddressSnapshot = shouldNotifyAdmin
            ? formatAddress(field.address, field.city, field.state, field.zipCode)
            : null;
        // Convert amenity IDs to names if amenities are being updated
        if (req.body.amenities && req.body.amenities.length > 0) {
            req.body.amenities = await (0, amenity_converter_1.convertAmenityIdsToNames)(req.body.amenities);
        }
        // Validate minimum operating hours if times are being updated
        if (req.body.openingTime || req.body.closingTime) {
            const settings = await database_1.default.systemSettings.findFirst();
            const minimumHours = settings?.minimumFieldOperatingHours || 4;
            // Get the current field data to merge with updates
            const openingTime = req.body.openingTime || field.openingTime;
            const closingTime = req.body.closingTime || field.closingTime;
            if (openingTime && closingTime) {
                const timeToMinutes = (timeStr) => {
                    const [hours, minutes] = timeStr.split(':').map(Number);
                    return hours * 60 + (minutes || 0);
                };
                const openingMinutes = timeToMinutes(openingTime);
                const closingMinutes = timeToMinutes(closingTime);
                const diffHours = (closingMinutes - openingMinutes) / 60;
                if (diffHours < 0) {
                    throw new AppError_1.AppError('Closing time must be after opening time', 400);
                }
                if (diffHours < minimumHours) {
                    throw new AppError_1.AppError(`Field must be open for at least ${minimumHours} hours`, 400);
                }
            }
        }
        const updatedField = await field_model_1.default.update(id, req.body);
        // If isClaimed is being set to false, reset any approved claims for this field
        // This ensures the field can be claimed again
        if (req.body.isClaimed === false && field.isClaimed === true) {
            console.log(`📝 Field ${id} marked as unclaimed. Resetting approved claims...`);
            try {
                // Update any APPROVED claims to REVOKED status
                const revokedClaims = await database_1.default.fieldClaim.updateMany({
                    where: {
                        fieldId: id,
                        status: 'APPROVED'
                    },
                    data: {
                        status: 'REVOKED',
                        reviewNotes: 'Claim revoked - Field marked as unclaimed by admin'
                    }
                });
                console.log(`📝 Revoked ${revokedClaims.count} approved claim(s) for field ${id}`);
            }
            catch (claimError) {
                console.error('Failed to revoke approved claims:', claimError);
                // Don't fail the update, just log the error
            }
        }
        // Enrich field with full amenity objects
        const enrichedField = await (0, amenity_utils_1.enrichFieldWithAmenities)(updatedField);
        if (shouldNotifyAdmin) {
            console.log('═══════════════════════════════════════════════════════════════');
            console.log('🔔 FIELD ADDRESS CHANGE DETECTED - INITIATING ADMIN NOTIFICATION');
            console.log('═══════════════════════════════════════════════════════════════');
            console.log('📋 Field ID:', updatedField.id);
            console.log('📋 Field Name:', updatedField.name || 'N/A');
            console.log('📍 Previous Address:', previousAddressSnapshot || 'Not provided');
            console.log('📍 New Address:', formatAddress(updatedField.address, updatedField.city, updatedField.state, updatedField.zipCode));
            console.log('───────────────────────────────────────────────────────────────');
            try {
                const { emailService } = await Promise.resolve().then(() => __importStar(require('../services/email.service')));
                const settings = await database_1.default.systemSettings.findFirst({
                    select: { adminEmail: true, supportEmail: true },
                });
                console.log('🔍 Settings Retrieved:');
                console.log('   - Admin Email from settings:', settings?.adminEmail || 'NOT SET');
                console.log('   - Support Email from settings:', settings?.supportEmail || 'NOT SET');
                console.log('   - SMTP_USER from env:', process.env.SMTP_USER || 'NOT SET');
                // Use adminEmail from settings, fallback to supportEmail, then SMTP_USER
                const adminEmail = settings?.adminEmail || settings?.supportEmail || process.env.SMTP_USER;
                console.log('📧 Final Admin Email Selected:', adminEmail || 'NONE AVAILABLE');
                if (adminEmail) {
                    console.log('🚀 Sending email notification to admin...');
                    const emailResult = await emailService.sendFieldAddressChangeNotification({
                        adminEmail,
                        fieldName: updatedField.name || 'Field',
                        fieldId: updatedField.id,
                        ownerName: updatedField.owner?.name || field.owner?.name || null,
                        ownerEmail: updatedField.owner?.email || field.owner?.email || null,
                        previousAddress: previousAddressSnapshot || 'Not provided',
                        newAddress: formatAddress(updatedField.address, updatedField.city, updatedField.state, updatedField.zipCode),
                        changeDate: new Date(),
                    });
                    console.log('📧 Email notification result:', emailResult ? 'SUCCESS' : 'FAILED');
                }
                else {
                    console.warn('⚠️ Admin email not configured in settings; skipping field address change notification.');
                    console.warn('   To enable notifications, set Admin Email in Admin Settings > General');
                }
            }
            catch (notificationError) {
                console.error('❌ Failed to send field address change notification:', notificationError);
            }
            // Send in-app notification to all admins
            try {
                const { NotificationService } = await Promise.resolve().then(() => __importStar(require('../services/notification.service')));
                const ownerName = updatedField.owner?.name || field.owner?.name || 'Field Owner';
                const newAddress = formatAddress(updatedField.address, updatedField.city, updatedField.state, updatedField.zipCode);
                await NotificationService.notifyAdmins('Field Address Updated', `${ownerName} has updated the address for field "${updatedField.name || 'Field'}". Previous: ${previousAddressSnapshot}. New: ${newAddress}`, {
                    fieldId: updatedField.id,
                    fieldName: updatedField.name,
                    ownerId: field.ownerId,
                    ownerName: ownerName,
                    previousAddress: previousAddressSnapshot,
                    newAddress: newAddress,
                    changeDate: new Date()
                });
            }
            catch (notificationError) {
                console.error('Failed to send admin notification for field address change:', notificationError);
            }
        }
        res.json({
            success: true,
            message: 'Field updated successfully',
            data: enrichedField,
        });
    });
    // Delete field
    deleteField = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { id } = req.params;
        const userId = req.user.id;
        const userRole = req.user.role;
        // Check ownership
        const field = await field_model_1.default.findById(id);
        if (!field) {
            throw new AppError_1.AppError('Field not found', 404);
        }
        if (field.ownerId !== userId && userRole !== 'ADMIN') {
            throw new AppError_1.AppError('You can only delete your own fields', 403);
        }
        await field_model_1.default.delete(id);
        res.status(204).json({
            success: true,
            message: 'Field deleted successfully',
        });
    });
    // Toggle field active status
    toggleFieldStatus = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { id } = req.params;
        const userId = req.user.id;
        const userRole = req.user.role;
        // Check ownership
        const field = await field_model_1.default.findById(id);
        if (!field) {
            throw new AppError_1.AppError('Field not found', 404);
        }
        if (field.ownerId !== userId && userRole !== 'ADMIN') {
            throw new AppError_1.AppError('You can only toggle your own fields', 403);
        }
        const updatedField = await field_model_1.default.toggleActive(id);
        // Enrich field with full amenity objects
        const enrichedField = await (0, amenity_utils_1.enrichFieldWithAmenities)(updatedField);
        res.json({
            success: true,
            message: `Field ${updatedField.isActive ? 'activated' : 'deactivated'} successfully`,
            data: enrichedField,
        });
    });
    // Toggle field blocked status (admin only)
    toggleFieldBlocked = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { id } = req.params;
        const userRole = req.user.role;
        // Only admin can block/unblock fields
        if (userRole !== 'ADMIN') {
            throw new AppError_1.AppError('Only admin can block or unblock fields', 403);
        }
        // Check if field exists
        const field = await field_model_1.default.findById(id);
        if (!field) {
            throw new AppError_1.AppError('Field not found', 404);
        }
        const updatedField = await field_model_1.default.toggleBlocked(id);
        // Enrich field with full amenity objects
        const enrichedField = await (0, amenity_utils_1.enrichFieldWithAmenities)(updatedField);
        res.json({
            success: true,
            message: `Field ${updatedField.isBlocked ? 'blocked' : 'unblocked'} successfully`,
            data: enrichedField,
        });
    });
    // Toggle field approved status (admin only)
    toggleFieldApproved = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { id } = req.params;
        const adminId = req.user.id;
        const userRole = req.user.role;
        // Only admin can approve/unapprove fields
        if (userRole !== 'ADMIN') {
            throw new AppError_1.AppError('Only admin can approve or unapprove fields', 403);
        }
        // Check if field exists
        const field = await database_1.default.field.findUnique({
            where: { id },
            include: { owner: true }
        });
        if (!field) {
            throw new AppError_1.AppError('Field not found', 404);
        }
        // Only allow approving fields that have been submitted
        if (!field.isSubmitted && !field.isApproved) {
            throw new AppError_1.AppError('Cannot approve a field that has not been submitted for review', 400);
        }
        const newApprovedStatus = !field.isApproved;
        // Update the field
        const updatedField = await database_1.default.field.update({
            where: { id },
            data: {
                isApproved: newApprovedStatus,
                isActive: newApprovedStatus ? field.isActive : false // Deactivate if unapproved
            }
        });
        // Create notification for field owner
        await database_1.default.notification.create({
            data: {
                userId: field.ownerId,
                type: newApprovedStatus ? 'field_approved' : 'field_unapproved',
                title: newApprovedStatus ? 'Field Approved!' : 'Field Approval Revoked',
                message: newApprovedStatus
                    ? `Your field "${field.name}" has been approved and is now live on Fieldsy.`
                    : `Your field "${field.name}" approval has been revoked and is no longer visible on Fieldsy.`,
                data: {
                    fieldId: field.id,
                    fieldName: field.name
                }
            }
        });
        // Send email notification if approved
        if (newApprovedStatus) {
            try {
                const { emailService } = await Promise.resolve().then(() => __importStar(require('../services/email.service')));
                let fieldAddress = '';
                if (field.location && typeof field.location === 'object') {
                    const loc = field.location;
                    fieldAddress = loc.formatted_address || loc.streetAddress || field.address || '';
                }
                else {
                    fieldAddress = field.address || '';
                }
                await emailService.sendFieldApprovalEmail({
                    email: field.owner.email,
                    ownerName: field.owner.name || field.owner.email,
                    fieldName: field.name || 'Your Field',
                    fieldAddress: fieldAddress
                });
            }
            catch (emailError) {
                console.error('Failed to send approval email:', emailError);
            }
        }
        // Enrich field with full amenity objects
        const enrichedField = await (0, amenity_utils_1.enrichFieldWithAmenities)(updatedField);
        res.json({
            success: true,
            message: `Field ${newApprovedStatus ? 'approved' : 'unapproved'} successfully`,
            data: enrichedField,
        });
    });
    // Search fields by location
    searchByLocation = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { lat, lng, radius = 10 } = req.query;
        if (!lat || !lng) {
            throw new AppError_1.AppError('Latitude and longitude are required', 400);
        }
        const fields = await field_model_1.default.searchByLocation(Number(lat), Number(lng), Number(radius));
        // Enrich fields with full amenity objects
        const enrichedFields = await (0, amenity_utils_1.enrichFieldsWithAmenities)(fields);
        res.json({
            success: true,
            data: enrichedFields,
            total: enrichedFields.length,
        });
    });
    // Get nearby fields based on lat/lng
    getNearbyFields = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { lat, lng, radius = 10, page = 1, limit = 9, sortBy, sortOrder } = req.query;
        // Validate required parameters
        if (!lat || !lng) {
            throw new AppError_1.AppError('Latitude and longitude are required', 400);
        }
        // Validate lat/lng values
        const latitude = Number(lat);
        const longitude = Number(lng);
        if (isNaN(latitude) || isNaN(longitude)) {
            throw new AppError_1.AppError('Invalid latitude or longitude values', 400);
        }
        if (latitude < -90 || latitude > 90) {
            throw new AppError_1.AppError('Latitude must be between -90 and 90', 400);
        }
        if (longitude < -180 || longitude > 180) {
            throw new AppError_1.AppError('Longitude must be between -180 and 180', 400);
        }
        const radiusNum = Number(radius);
        const pageNum = Number(page);
        const limitNum = Number(limit);
        const skip = (pageNum - 1) * limitNum;
        // Get all active fields with distance calculated
        const allFieldsWithDistance = await field_model_1.default.searchByLocation(latitude, longitude, 999999 // Very large radius to get all fields
        );
        // Split into nearby and remaining fields
        const nearbyFields = allFieldsWithDistance.filter((field) => field.distanceMiles <= radiusNum);
        const remainingFields = allFieldsWithDistance.filter((field) => field.distanceMiles > radiusNum);
        // Combine: nearby fields first, then remaining fields
        let combinedFields = [...nearbyFields, ...remainingFields];
        // Apply sorting if specified
        if (sortBy && typeof sortBy === 'string') {
            const sortFields = sortBy.split(',');
            const sortOrders = (sortOrder && typeof sortOrder === 'string')
                ? sortOrder.split(',')
                : sortFields.map(() => 'desc');
            combinedFields.sort((a, b) => {
                for (let i = 0; i < sortFields.length; i++) {
                    const field = sortFields[i].trim();
                    const order = sortOrders[i]?.trim() || 'desc';
                    let aValue, bValue;
                    if (field === 'rating') {
                        aValue = a.averageRating || 0;
                        bValue = b.averageRating || 0;
                    }
                    else if (field === 'price') {
                        aValue = a.price || 0;
                        bValue = b.price || 0;
                    }
                    else {
                        continue; // Skip unknown sort fields
                    }
                    if (aValue !== bValue) {
                        return order === 'asc' ? aValue - bValue : bValue - aValue;
                    }
                }
                return 0;
            });
        }
        // Apply pagination to combined results
        const total = combinedFields.length;
        const paginatedFields = combinedFields.slice(skip, skip + limitNum);
        const totalPages = Math.ceil(total / limitNum);
        // Transform to optimized field card format
        const transformedFields = paginatedFields.map((field) => {
            // Handle both Prisma Json type and actual parsed object
            const locationData = typeof field.location === 'string'
                ? JSON.parse(field.location)
                : field.location;
            const fieldLat = locationData?.lat || field.latitude;
            const fieldLng = locationData?.lng || field.longitude;
            return {
                id: field.id,
                name: field.name,
                image: getFirstValidImage(field.images),
                price: field.price,
                price30min: field.price30min,
                price1hr: field.price1hr,
                duration: field.bookingDuration || 'hour',
                rating: field.averageRating || 0,
                reviewCount: field.totalReviews || 0,
                amenities: field.amenities?.slice(0, 4) || [],
                isClaimed: field.isClaimed,
                owner: field.ownerName || 'Field Owner',
                location: {
                    address: field.address,
                    city: field.city,
                    state: field.state,
                    zipCode: field.zipCode,
                    lat: fieldLat,
                    lng: fieldLng,
                },
                locationDisplay: [field.city, field.state].filter(Boolean).join(', '),
                distance: field.distanceMiles === Infinity ? null : field.distanceMiles,
                distanceDisplay: field.distanceMiles === Infinity
                    ? 'Location not available'
                    : field.distanceMiles < 1
                        ? `${(field.distanceMiles * 1760).toFixed(0)} yards`
                        : `${field.distanceMiles.toFixed(1)} miles`,
            };
        });
        // Enrich fields with amenity labels (string array only)
        const enrichedFields = await (0, amenity_utils_1.enrichFieldsWithAmenities)(transformedFields);
        // Get user's liked fields if authenticated
        const userId = req.user?.id;
        let userLikedFieldIds = new Set();
        if (userId) {
            const userFavorites = await database_1.default.favorite.findMany({
                where: { userId },
                select: { fieldId: true }
            });
            userLikedFieldIds = new Set(userFavorites.map(f => f.fieldId));
        }
        // Add isLiked to each field
        const fieldsWithLikeStatus = enrichedFields.map((field) => ({
            ...field,
            isLiked: userLikedFieldIds.has(field.id)
        }));
        res.json({
            success: true,
            data: fieldsWithLikeStatus,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages,
                hasNextPage: pageNum < totalPages,
                hasPrevPage: pageNum > 1,
            },
            metadata: {
                nearbyCount: nearbyFields.length,
                remainingCount: remainingFields.length,
                radius: radiusNum,
            },
        });
    });
    // Get popular fields based on highest rating and most bookings
    getPopularFields = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { page = 1, limit = 12, lat, lng } = req.query;
        const pageNum = Number(page);
        const limitNum = Number(limit);
        const skip = (pageNum - 1) * limitNum;
        const userLat = lat ? Number(lat) : null;
        const userLng = lng ? Number(lng) : null;
        // Get active fields with booking counts and ratings
        const fields = await database_1.default.field.findMany({
            where: {
                isActive: true,
                isSubmitted: true,
            },
            select: {
                id: true,
                name: true,
                city: true,
                state: true,
                address: true,
                price: true,
                price30min: true,
                price1hr: true,
                bookingDuration: true,
                averageRating: true,
                totalReviews: true,
                images: true,
                amenities: true,
                isClaimed: true,
                ownerName: true,
                latitude: true,
                longitude: true,
                location: true,
                _count: {
                    select: {
                        bookings: {
                            where: {
                                status: {
                                    in: ['CONFIRMED', 'COMPLETED']
                                }
                            }
                        },
                    },
                },
            },
        });
        // Calculate popularity score and distance
        const fieldsWithScore = fields.map((field) => {
            const bookingCount = field._count.bookings || 0;
            const rating = field.averageRating || 0;
            const reviewCount = field.totalReviews || 0;
            // Popularity score formula: (rating * 0.4) + (bookingCount * 0.4) + (reviewCount * 0.2)
            // Normalize booking count (assuming max 100 bookings gives full score)
            const normalizedBookings = Math.min(bookingCount / 100, 1) * 5;
            // Normalize review count (assuming 50 reviews gives full score)
            const normalizedReviews = Math.min(reviewCount / 50, 1) * 5;
            const popularityScore = (rating * 0.4) + (normalizedBookings * 0.4) + (normalizedReviews * 0.2);
            // Calculate distance if user location is provided
            let distanceMiles = undefined;
            if (userLat !== null && userLng !== null && field.latitude && field.longitude) {
                const R = 3959; // Earth's radius in miles
                const dLat = (field.latitude - userLat) * Math.PI / 180;
                const dLng = (field.longitude - userLng) * Math.PI / 180;
                const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                    Math.cos(userLat * Math.PI / 180) * Math.cos(field.latitude * Math.PI / 180) *
                        Math.sin(dLng / 2) * Math.sin(dLng / 2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                distanceMiles = Number((R * c).toFixed(1));
            }
            return {
                ...field,
                bookingCount,
                popularityScore,
                distanceMiles,
            };
        });
        // Sort by popularity score (highest first)
        fieldsWithScore.sort((a, b) => b.popularityScore - a.popularityScore);
        // Apply pagination
        const total = fieldsWithScore.length;
        const paginatedFields = fieldsWithScore.slice(skip, skip + limitNum);
        const totalPages = Math.ceil(total / limitNum);
        // Transform to optimized field card format
        const transformedFields = paginatedFields.map((field) => {
            // Handle both Prisma Json type and actual parsed object
            const locationData = typeof field.location === 'string'
                ? JSON.parse(field.location)
                : field.location;
            const fieldLat = locationData?.lat || field.latitude;
            const fieldLng = locationData?.lng || field.longitude;
            return {
                id: field.id,
                name: field.name,
                image: getFirstValidImage(field.images),
                price: field.price,
                price30min: field.price30min,
                price1hr: field.price1hr,
                duration: field.bookingDuration || 'hour',
                rating: field.averageRating || 0,
                reviewCount: field.totalReviews || 0,
                amenities: field.amenities?.slice(0, 4) || [],
                isClaimed: field.isClaimed,
                owner: field.ownerName || 'Field Owner',
                location: {
                    address: field.address,
                    city: field.city,
                    state: field.state,
                    zipCode: field.zipCode,
                    lat: fieldLat,
                    lng: fieldLng,
                },
                locationDisplay: [field.city, field.state].filter(Boolean).join(', '),
                distance: field.distanceMiles,
                distanceDisplay: field.distanceMiles
                    ? field.distanceMiles < 1
                        ? `${(field.distanceMiles * 1760).toFixed(0)} yards`
                        : `${field.distanceMiles.toFixed(1)} miles`
                    : undefined,
            };
        });
        // Enrich fields with full amenity objects
        const enrichedFields = await (0, amenity_utils_1.enrichFieldsWithAmenities)(transformedFields);
        // Get user's liked fields if authenticated
        const userId = req.user?.id;
        let userLikedFieldIds = new Set();
        if (userId) {
            const userFavorites = await database_1.default.favorite.findMany({
                where: { userId },
                select: { fieldId: true }
            });
            userLikedFieldIds = new Set(userFavorites.map(f => f.fieldId));
        }
        // Add isLiked to each field
        const fieldsWithLikeStatus = enrichedFields.map((field) => ({
            ...field,
            isLiked: userLikedFieldIds.has(field.id)
        }));
        res.json({
            success: true,
            data: fieldsWithLikeStatus,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages,
                hasNextPage: pageNum < totalPages,
                hasPrevPage: pageNum > 1,
            },
        });
    });
    // Get field owner's single field (since they can only have one)
    getOwnerField = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const ownerId = req.user.id;
        const field = await field_model_1.default.findOneByOwner(ownerId);
        if (!field) {
            // Return success with null field to indicate no field exists yet
            // This allows the frontend to show the add field form
            return res.status(200).json({
                success: true,
                message: 'No field found. Please add your field.',
                field: null,
                showAddForm: true
            });
        }
        // Enrich field with full amenity objects
        const enrichedField = await (0, amenity_utils_1.enrichFieldWithAmenities)(field);
        // Return the field with step completion status
        res.json({
            success: true,
            field: {
                ...enrichedField,
                stepStatus: {
                    fieldDetails: enrichedField.fieldDetailsCompleted || false,
                    uploadImages: enrichedField.uploadImagesCompleted || false,
                    pricingAvailability: enrichedField.pricingAvailabilityCompleted || false,
                    bookingRules: field.bookingRulesCompleted || false
                },
                allStepsCompleted: field.fieldDetailsCompleted &&
                    field.uploadImagesCompleted &&
                    field.pricingAvailabilityCompleted &&
                    field.bookingRulesCompleted
            }
        });
    });
    // Save field progress (auto-save functionality)
    saveFieldProgress = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const ownerId = req.user.id;
        const { step, data, fieldId: providedFieldId } = req.body;
        // Check if we're updating an existing field or creating a new one
        let fieldId;
        let isNewField = false;
        // If fieldId is provided, use it; otherwise find or create a field
        if (providedFieldId) {
            // Verify ownership
            const existingField = await field_model_1.default.findById(providedFieldId);
            if (!existingField || existingField.ownerId !== ownerId) {
                throw new AppError_1.AppError('Field not found or you do not have permission', 403);
            }
            fieldId = providedFieldId;
        }
        else {
            // No fieldId provided
            // For steps after field-details, try to find the most recent incomplete field
            // This handles cases where fieldId was lost due to page refresh or state issues
            if (step !== 'field-details') {
                const ownerFields = await field_model_1.default.findByOwner(ownerId);
                const incompleteField = ownerFields
                    .filter((f) => !f.isSubmitted)
                    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
                if (incompleteField) {
                    // Use the most recent incomplete field
                    fieldId = incompleteField.id;
                    console.log(`[SaveProgress] Using most recent incomplete field ${fieldId} for step ${step}`);
                }
                else {
                    // No incomplete fields found - create a new one
                    isNewField = true;
                    console.log(`[SaveProgress] No incomplete field found. Creating new field for step ${step}`);
                }
            }
            else {
                // For field-details step, always create a new field when no fieldId is provided
                isNewField = true;
                console.log(`[SaveProgress] Creating new field for field-details step`);
            }
            // Only create a new field if we didn't find an incomplete one
            if (isNewField) {
                // Prepare initial field data based on the step
                let initialFieldData = {
                    ownerId,
                    isActive: false,
                    fieldDetailsCompleted: false,
                    uploadImagesCompleted: false,
                    pricingAvailabilityCompleted: false,
                    bookingRulesCompleted: false,
                };
                // If the first step is field-details, include that data
                if (step === 'field-details') {
                    // Validate minimum operating hours
                    if (data.startTime && data.endTime) {
                        const settings = await database_1.default.systemSettings.findFirst();
                        const minimumHours = settings?.minimumFieldOperatingHours || 4;
                        const timeToMinutes = (timeStr) => {
                            const [hours, minutes] = timeStr.split(':').map(Number);
                            return hours * 60 + (minutes || 0);
                        };
                        const openingMinutes = timeToMinutes(data.startTime);
                        const closingMinutes = timeToMinutes(data.endTime);
                        const diffHours = (closingMinutes - openingMinutes) / 60;
                        if (diffHours < 0) {
                            throw new AppError_1.AppError('Closing time must be after opening time', 400);
                        }
                        if (diffHours < minimumHours) {
                            throw new AppError_1.AppError(`Field must be open for at least ${minimumHours} hours`, 400);
                        }
                    }
                    // Convert amenity IDs to names
                    const amenityIds = data.amenities && Array.isArray(data.amenities)
                        ? data.amenities
                        : (typeof data.amenities === 'object'
                            ? Object.keys(data.amenities || {}).filter(key => data.amenities[key])
                            : []);
                    const amenityNames = amenityIds.length > 0 ? await (0, amenity_converter_1.convertAmenityIdsToNames)(amenityIds) : [];
                    initialFieldData = {
                        ...initialFieldData,
                        name: data.fieldName,
                        size: data.fieldSize,
                        customFieldSize: data.customFieldSize || null, // Store custom field size if provided
                        terrainType: data.terrainType,
                        fenceType: data.fenceType,
                        fenceSize: data.fenceSize,
                        surfaceType: data.surfaceType,
                        type: 'PRIVATE',
                        description: data.description,
                        maxDogs: parseInt(data.maxDogs) || 10,
                        openingTime: data.startTime,
                        closingTime: data.endTime,
                        operatingDays: data.openingDays ? [data.openingDays] : [],
                        amenities: amenityNames,
                        // Store location object if provided
                        location: data.location || null,
                        // Also store legacy fields for backward compatibility
                        address: data.streetAddress,
                        // apartment field removed - doesn't exist in schema
                        city: data.city,
                        state: data.county,
                        zipCode: data.postalCode,
                        // Extract lat/lng from location object if available
                        latitude: data.location?.lat || null,
                        longitude: data.location?.lng || null,
                        fieldDetailsCompleted: true
                    };
                }
                // Create the new field
                const newField = await field_model_1.default.create(initialFieldData);
                fieldId = newField.id;
                // If we've already processed the data in field creation, we're done
                if (step === 'field-details') {
                    return res.json({
                        success: true,
                        message: 'Field created and progress saved',
                        fieldId: newField.id,
                        stepCompleted: true,
                        allStepsCompleted: false,
                        isActive: false,
                        isNewField: true
                    });
                }
            }
        }
        let updateData = {};
        // Update based on which step is being saved
        switch (step) {
            case 'field-details':
                // Validate minimum operating hours
                if (data.startTime && data.endTime) {
                    const settings = await database_1.default.systemSettings.findFirst();
                    const minimumHours = settings?.minimumFieldOperatingHours || 4;
                    const timeToMinutes = (timeStr) => {
                        const [hours, minutes] = timeStr.split(':').map(Number);
                        return hours * 60 + (minutes || 0);
                    };
                    const openingMinutes = timeToMinutes(data.startTime);
                    const closingMinutes = timeToMinutes(data.endTime);
                    const diffHours = (closingMinutes - openingMinutes) / 60;
                    if (diffHours < 0) {
                        throw new AppError_1.AppError('Closing time must be after opening time', 400);
                    }
                    if (diffHours < minimumHours) {
                        throw new AppError_1.AppError(`Field must be open for at least ${minimumHours} hours`, 400);
                    }
                }
                // Convert amenity IDs to names
                const amenityIdsUpdate = data.amenities && Array.isArray(data.amenities)
                    ? data.amenities
                    : (typeof data.amenities === 'object'
                        ? Object.keys(data.amenities || {}).filter(key => data.amenities[key])
                        : []);
                const amenityNamesUpdate = amenityIdsUpdate.length > 0 ? await (0, amenity_converter_1.convertAmenityIdsToNames)(amenityIdsUpdate) : [];
                updateData = {
                    name: data.fieldName,
                    size: data.fieldSize,
                    customFieldSize: data.customFieldSize || null, // Store custom field size if provided
                    terrainType: data.terrainType, // This is terrain type, not field type
                    fenceType: data.fenceType,
                    fenceSize: data.fenceSize,
                    surfaceType: data.surfaceType,
                    type: 'PRIVATE', // Default field type - you can add a field type selector in the form if needed
                    description: data.description,
                    maxDogs: parseInt(data.maxDogs) || 10,
                    openingTime: data.startTime,
                    closingTime: data.endTime,
                    operatingDays: data.openingDays ? [data.openingDays] : [],
                    amenities: amenityNamesUpdate,
                    // Store location object if provided
                    location: data.location || null,
                    // Also store legacy fields for backward compatibility
                    address: data.streetAddress,
                    // apartment field removed - doesn't exist in schema
                    city: data.city,
                    state: data.county,
                    zipCode: data.postalCode,
                    // Extract lat/lng from location object if available
                    latitude: data.location?.lat || null,
                    longitude: data.location?.lng || null,
                    fieldDetailsCompleted: true
                };
                break;
            case 'upload-images':
                // Get existing field to compare images
                let oldImages = [];
                if (!isNewField) {
                    const existingField = await field_model_1.default.findById(fieldId);
                    oldImages = existingField?.images || [];
                }
                const newImages = data.images || [];
                // Find images that were removed (exist in old but not in new)
                const imagesToDelete = oldImages.filter(oldUrl => !newImages.includes(oldUrl));
                // Delete removed images from S3
                if (imagesToDelete.length > 0) {
                    console.log(`[SaveProgress] Deleting ${imagesToDelete.length} removed images`);
                    for (const imageUrl of imagesToDelete) {
                        try {
                            // Extract key from URL
                            let fileKey = '';
                            const urlParts = imageUrl.split('.amazonaws.com/');
                            if (urlParts.length > 1) {
                                fileKey = urlParts[1];
                            }
                            else {
                                const altParts = imageUrl.split(`/${process.env.AWS_S3_BUCKET}/`);
                                if (altParts.length > 1) {
                                    fileKey = altParts[1];
                                }
                            }
                            if (fileKey) {
                                const command = new client_s3_1.DeleteObjectCommand({
                                    Bucket: process.env.AWS_S3_BUCKET,
                                    Key: fileKey,
                                });
                                await s3Client.send(command);
                                console.log(`[SaveProgress] Deleted image: ${fileKey}`);
                            }
                        }
                        catch (error) {
                            console.error(`[SaveProgress] Error deleting image ${imageUrl}:`, error);
                            // Continue with other deletions even if one fails
                        }
                    }
                }
                // If this is a new field created from a non-field-details step,
                // we need to ensure basic field info exists
                if (isNewField) {
                    updateData = {
                        name: 'Untitled Field',
                        type: 'PRIVATE',
                        images: newImages,
                        uploadImagesCompleted: true
                    };
                }
                else {
                    updateData = {
                        images: newImages,
                        uploadImagesCompleted: true
                    };
                }
                break;
            case 'pricing-availability':
                if (isNewField) {
                    updateData = {
                        name: 'Untitled Field',
                        type: 'PRIVATE',
                        price: parseFloat(data.price || data.pricePerHour) || 0, // Legacy field
                        price30min: parseFloat(data.price30min) || 0,
                        price1hr: parseFloat(data.price1hr) || 0,
                        bookingDuration: data.bookingDuration || '30min', // Legacy field
                        instantBooking: data.instantBooking || false,
                        pricingAvailabilityCompleted: true
                    };
                }
                else {
                    updateData = {
                        price: parseFloat(data.price || data.pricePerHour) || 0, // Legacy field
                        price30min: parseFloat(data.price30min) || 0,
                        price1hr: parseFloat(data.price1hr) || 0,
                        bookingDuration: data.bookingDuration || '30min', // Legacy field
                        instantBooking: data.instantBooking || false,
                        pricingAvailabilityCompleted: true
                    };
                }
                break;
            case 'booking-rules':
                if (isNewField) {
                    updateData = {
                        name: 'Untitled Field',
                        type: 'PRIVATE',
                        rules: data.rules ? [data.rules] : [],
                        cancellationPolicy: data.policies || '',
                        bookingRulesCompleted: true
                    };
                }
                else {
                    updateData = {
                        rules: data.rules ? [data.rules] : [],
                        cancellationPolicy: data.policies || '',
                        bookingRulesCompleted: true
                    };
                }
                break;
            default:
                throw new AppError_1.AppError('Invalid step', 400);
        }
        // Update field
        const field = await field_model_1.default.update(fieldId, updateData);
        // Check if all steps are completed
        const allStepsCompleted = field.fieldDetailsCompleted &&
            field.uploadImagesCompleted &&
            field.pricingAvailabilityCompleted &&
            field.bookingRulesCompleted;
        // Note: Field should only become active after submission via submitFieldForReview
        // Do not auto-activate when steps are completed
        res.json({
            success: true,
            message: isNewField ? 'Field created and progress saved' : 'Progress saved',
            fieldId: field.id,
            stepCompleted: true,
            allStepsCompleted,
            isActive: field.isActive, // Return actual isActive status
            isNewField
        });
    });
    // Submit field for review
    submitFieldForReview = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const ownerId = req.user.id;
        const { fieldId } = req.body;
        // Get the field - use fieldId if provided, otherwise get first field
        let field;
        if (fieldId) {
            field = await field_model_1.default.findById(fieldId);
            // Verify ownership
            if (field && field.ownerId !== ownerId) {
                throw new AppError_1.AppError('You can only submit your own fields', 403);
            }
        }
        else {
            field = await field_model_1.default.findOneByOwner(ownerId);
        }
        if (!field) {
            throw new AppError_1.AppError('No field found for this owner', 404);
        }
        // Check if all steps are completed
        if (!field.fieldDetailsCompleted ||
            !field.uploadImagesCompleted ||
            !field.pricingAvailabilityCompleted ||
            !field.bookingRulesCompleted) {
            throw new AppError_1.AppError('Please complete all steps before submitting', 400);
        }
        // Submit the field
        const submittedField = await field_model_1.default.submitField(field.id);
        // Get field owner details for email and notification
        const fieldOwner = await database_1.default.user.findUnique({
            where: { id: ownerId },
            select: {
                id: true,
                name: true,
                email: true
            }
        });
        if (fieldOwner) {
            // Send email to field owner
            const { emailService } = await Promise.resolve().then(() => __importStar(require('../services/email.service')));
            try {
                await emailService.sendFieldSubmissionEmail({
                    email: fieldOwner.email,
                    ownerName: fieldOwner.name || 'Field Owner',
                    fieldName: submittedField.name || 'Your Field',
                    fieldAddress: `${submittedField.address || ''}, ${submittedField.city || ''}, ${submittedField.state || ''}`.trim(),
                    submittedAt: submittedField.submittedAt || new Date()
                });
            }
            catch (emailError) {
                console.error('Failed to send field submission email:', emailError);
                // Don't throw error - email failure shouldn't stop the submission
            }
            // Create notification for field owner
            const { NotificationService } = await Promise.resolve().then(() => __importStar(require('../services/notification.service')));
            try {
                await NotificationService.createNotification({
                    userId: fieldOwner.id,
                    type: 'field_submitted',
                    title: 'Field Submitted Successfully',
                    message: `Your field "${submittedField.name}" has been successfully submitted.`,
                    data: {
                        fieldId: submittedField.id,
                        fieldName: submittedField.name,
                        submittedAt: submittedField.submittedAt
                    }
                }, false); // Don't notify admin for user's own notification
            }
            catch (notificationError) {
                console.error('Failed to create field owner notification:', notificationError);
            }
            // Create notification for all admins
            try {
                await NotificationService.notifyAdmins('New Field Submission', `Field owner ${fieldOwner.name} has submitted a new field: "${submittedField.name}" at ${submittedField.address}, ${submittedField.city}`, {
                    fieldId: submittedField.id,
                    fieldName: submittedField.name,
                    ownerId: fieldOwner.id,
                    ownerName: fieldOwner.name,
                    submittedAt: submittedField.submittedAt
                });
            }
            catch (adminNotificationError) {
                console.error('Failed to create admin notification:', adminNotificationError);
            }
        }
        res.json({
            success: true,
            message: 'Field submitted successfully!',
            data: submittedField
        });
    });
    // Get bookings for field owner's field
    getFieldBookings = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const ownerId = req.user.id;
        const { status = 'all', page = 1, limit = 10 } = req.query;
        try {
            // First get all owner's fields
            const fields = await field_model_1.default.findByOwner(ownerId);
            if (!fields || fields.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'No field found for this owner',
                    bookings: [],
                    stats: {
                        todayBookings: 0,
                        totalBookings: 0,
                        totalEarnings: 0
                    }
                });
            }
            // Get all field IDs for this owner
            const fieldIds = fields.map((field) => field.id);
            // Get bookings from database
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            let bookingFilter = { fieldId: { in: fieldIds } };
            // Filter based on status
            if (status === 'today') {
                bookingFilter.date = {
                    gte: today,
                    lt: tomorrow
                };
            }
            else if (status === 'upcoming') {
                bookingFilter.date = {
                    gte: tomorrow
                };
            }
            else if (status === 'previous') {
                bookingFilter.date = {
                    lt: today
                };
            }
            const pageNum = Number(page);
            const limitNum = Number(limit);
            const skip = (pageNum - 1) * limitNum;
            // Fetch bookings with user details and count
            const [bookings, totalFilteredBookings] = await Promise.all([
                database_1.default.booking.findMany({
                    where: bookingFilter,
                    include: {
                        user: true
                    },
                    orderBy: {
                        date: status === 'previous' ? 'desc' : 'asc'
                    },
                    skip,
                    take: limitNum
                }),
                database_1.default.booking.count({ where: bookingFilter })
            ]);
            // Get overall stats across all fields
            const totalBookings = await database_1.default.booking.count({
                where: { fieldId: { in: fieldIds } }
            });
            const todayBookings = await database_1.default.booking.count({
                where: {
                    fieldId: { in: fieldIds },
                    date: {
                        gte: today,
                        lt: tomorrow
                    }
                }
            });
            const totalEarnings = await database_1.default.booking.aggregate({
                where: {
                    fieldId: { in: fieldIds },
                    status: 'COMPLETED'
                },
                _sum: {
                    fieldOwnerAmount: true
                }
            });
            // Format bookings for frontend
            const formattedBookings = bookings.map((booking) => ({
                id: booking.id,
                userName: booking.user.name,
                userAvatar: booking.user.image || booking.user.googleImage || null,
                time: `${booking.startTime} - ${booking.endTime}`,
                orderId: generateOrderId(booking.id),
                status: booking.status.toLowerCase(),
                frequency: formatRecurringFrequency(booking.repeatBooking),
                dogs: booking.numberOfDogs,
                amount: booking.totalPrice,
                date: booking.date
            }));
            res.json({
                success: true,
                bookings: formattedBookings,
                stats: {
                    todayBookings,
                    totalBookings,
                    totalEarnings: totalEarnings._sum.fieldOwnerAmount || 0
                },
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: totalFilteredBookings,
                    totalPages: Math.ceil(totalFilteredBookings / limitNum),
                    hasNextPage: pageNum < Math.ceil(totalFilteredBookings / limitNum),
                    hasPrevPage: pageNum > 1
                }
            });
        }
        catch (error) {
            console.error('Error fetching bookings:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch bookings',
                bookings: [],
                stats: {
                    todayBookings: 0,
                    totalBookings: 0,
                    totalEarnings: 0
                }
            });
        }
    });
    // Get today's bookings for field owner
    getTodayBookings = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const ownerId = req.user.id;
        const { page = 1, limit = 12 } = req.query;
        try {
            // Get default platform commission rate and check for custom commission for this field owner
            const [systemSettings, ownerUser] = await Promise.all([
                database_1.default.systemSettings.findFirst(),
                database_1.default.user.findUnique({
                    where: { id: ownerId },
                    select: { commissionRate: true }
                })
            ]);
            const defaultCommissionRate = systemSettings?.defaultCommissionRate || 20;
            // Check if admin has set a custom commission for this field owner
            const hasCustomCommission = ownerUser?.commissionRate !== null && ownerUser?.commissionRate !== undefined;
            // Use custom rate if set, otherwise use default platform rate
            const effectiveCommissionRate = hasCustomCommission ? ownerUser.commissionRate : defaultCommissionRate;
            // First get all owner's fields
            const fields = await field_model_1.default.findByOwner(ownerId);
            if (!fields || fields.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'No field found for this owner',
                    bookings: [],
                    stats: {
                        todayBookings: 0,
                        totalBookings: 0,
                        totalEarnings: 0
                    }
                });
            }
            // Get all field IDs for this owner
            const fieldIds = fields.map((field) => field.id);
            // Get today's date range
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const bookingFilter = {
                fieldId: { in: fieldIds },
                date: {
                    gte: today,
                    lt: tomorrow
                }
            };
            const pageNum = Number(page);
            const limitNum = Number(limit);
            const skip = (pageNum - 1) * limitNum;
            // Fetch bookings with user details, field details, and count
            const [bookings, totalFilteredBookings] = await Promise.all([
                database_1.default.booking.findMany({
                    where: bookingFilter,
                    include: {
                        user: true,
                        field: true
                    },
                    orderBy: {
                        date: 'asc'
                    },
                    skip,
                    take: limitNum
                }),
                database_1.default.booking.count({ where: bookingFilter })
            ]);
            // Get overall stats across all fields
            const [totalBookings, totalEarnings] = await Promise.all([
                database_1.default.booking.count({ where: { fieldId: { in: fieldIds } } }),
                database_1.default.booking.aggregate({
                    where: {
                        fieldId: { in: fieldIds },
                        status: 'COMPLETED'
                    },
                    _sum: {
                        fieldOwnerAmount: true
                    }
                })
            ]);
            // Format bookings for frontend with fee breakdown
            const formattedBookings = bookings.map((booking) => {
                // Calculate Stripe fee (1.5% + 20p)
                const stripeFee = booking.totalPrice > 0 ? Math.round(((booking.totalPrice * 0.015) + 0.20) * 100) / 100 : 0;
                const amountAfterStripeFee = Math.round((booking.totalPrice - stripeFee) * 100) / 100;
                // Determine platform fee logic
                // Use stored value if booking is completed OR cancellation window has passed
                // Use dynamic value if booking is pending/confirmed AND within cancellation window
                const cancelWindowHours = systemSettings?.cancellationWindowHours || 24;
                const cancelWindowMs = cancelWindowHours * 60 * 60 * 1000;
                const bookingTime = new Date(booking.date).getTime();
                const now = new Date().getTime();
                // Time until booking starts
                const timeUntilBooking = bookingTime - now;
                // Window passed means we are closer to booking start than the cancellation window allows
                // OR the booking is in the past.
                const isPastCancellationWindow = timeUntilBooking < cancelWindowMs;
                const isLocked = booking.status === 'COMPLETED' || isPastCancellationWindow;
                let platformFee = 0;
                let usedCommissionRate = effectiveCommissionRate;
                // Note: booking.platformCommission is the amount, not rate.
                if (isLocked && booking.platformCommission !== null && booking.platformCommission !== undefined) {
                    platformFee = booking.platformCommission;
                    // Calculate effective rate for display based on GROSS booking amount (totalPrice)
                    if (booking.totalPrice > 0) {
                        usedCommissionRate = (platformFee / booking.totalPrice) * 100;
                        usedCommissionRate = Math.round(usedCommissionRate * 100) / 100;
                    }
                    else {
                        usedCommissionRate = 0;
                    }
                }
                else {
                    // Use dynamic/current rate applied to GROSS booking amount (if not stored)
                    platformFee = Math.round((booking.totalPrice * effectiveCommissionRate) / 100 * 100) / 100;
                    usedCommissionRate = effectiveCommissionRate;
                }
                // Field owner earnings - remainder after platform fees
                // Note: Platform commission covers Stripe fees; owner pays commission only.
                let fieldOwnerEarnings = 0;
                if (isLocked && booking.fieldOwnerAmount !== null && booking.fieldOwnerAmount !== undefined) {
                    fieldOwnerEarnings = booking.fieldOwnerAmount;
                }
                else {
                    fieldOwnerEarnings = Math.round((booking.totalPrice - platformFee) * 100) / 100;
                }
                return {
                    id: booking.id,
                    userId: booking.user.id,
                    userName: booking.user.name,
                    userAvatar: booking.user.image || booking.user.googleImage || null,
                    userEmail: booking.user.email,
                    userPhone: booking.user.phone,
                    time: `${booking.startTime} - ${booking.endTime}`,
                    orderId: generateOrderId(booking.id),
                    status: booking.status.toLowerCase(),
                    frequency: formatRecurringFrequency(booking.repeatBooking),
                    dogs: booking.numberOfDogs || 1,
                    amount: booking.totalPrice,
                    date: booking.date.toISOString(),
                    fieldName: booking.field.name,
                    fieldId: booking.field.id,
                    fieldAddress: `${booking.field.address}, ${booking.field.city}`,
                    notes: booking.notes || null,
                    rescheduleCount: booking.rescheduleCount || 0,
                    // Fee breakdown
                    platformCommissionRate: usedCommissionRate,
                    isCustomCommission: hasCustomCommission,
                    defaultCommissionRate,
                    stripeFee,
                    amountAfterStripeFee,
                    fieldOwnerEarnings,
                    platformFee
                };
            });
            res.status(200).json({
                success: true,
                bookings: formattedBookings,
                stats: {
                    todayBookings: totalFilteredBookings,
                    totalBookings,
                    totalEarnings: totalEarnings._sum.fieldOwnerAmount || 0
                },
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: totalFilteredBookings,
                    totalPages: Math.ceil(totalFilteredBookings / limitNum),
                    hasNextPage: pageNum < Math.ceil(totalFilteredBookings / limitNum),
                    hasPrevPage: pageNum > 1
                }
            });
        }
        catch (error) {
            console.error('Error fetching today bookings:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch today bookings',
                bookings: [],
                stats: {
                    todayBookings: 0,
                    totalBookings: 0,
                    totalEarnings: 0
                }
            });
        }
    });
    // Get upcoming bookings for field owner
    getUpcomingBookings = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const ownerId = req.user.id;
        const { page = 1, limit = 12 } = req.query;
        try {
            // Get default platform commission rate and check for custom commission for this field owner
            const [systemSettings, ownerUser] = await Promise.all([
                database_1.default.systemSettings.findFirst(),
                database_1.default.user.findUnique({
                    where: { id: ownerId },
                    select: { commissionRate: true }
                })
            ]);
            const defaultCommissionRate = systemSettings?.defaultCommissionRate || 20;
            // Check if admin has set a custom commission for this field owner
            const hasCustomCommission = ownerUser?.commissionRate !== null && ownerUser?.commissionRate !== undefined;
            // Use custom rate if set, otherwise use default platform rate
            const effectiveCommissionRate = hasCustomCommission ? ownerUser.commissionRate : defaultCommissionRate;
            // First get all owner's fields
            const fields = await field_model_1.default.findByOwner(ownerId);
            if (!fields || fields.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'No field found for this owner',
                    bookings: [],
                    stats: {
                        todayBookings: 0,
                        totalBookings: 0,
                        totalEarnings: 0
                    }
                });
            }
            // Get all field IDs for this owner
            const fieldIds = fields.map((field) => field.id);
            // Get tomorrow and beyond
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const bookingFilter = {
                fieldId: { in: fieldIds },
                date: {
                    gte: tomorrow
                },
                status: {
                    not: 'CANCELLED'
                }
            };
            const pageNum = Number(page);
            const limitNum = Number(limit);
            const skip = (pageNum - 1) * limitNum;
            // Fetch bookings with user and field details and count
            const [bookings, totalFilteredBookings] = await Promise.all([
                database_1.default.booking.findMany({
                    where: bookingFilter,
                    include: {
                        user: true,
                        field: true
                    },
                    orderBy: {
                        date: 'asc'
                    },
                    skip,
                    take: limitNum
                }),
                database_1.default.booking.count({ where: bookingFilter })
            ]);
            // Get overall stats across all fields
            const [totalBookings, todayBookings, totalEarnings] = await Promise.all([
                database_1.default.booking.count({ where: { fieldId: { in: fieldIds } } }),
                database_1.default.booking.count({
                    where: {
                        fieldId: { in: fieldIds },
                        date: {
                            gte: today,
                            lt: tomorrow
                        }
                    }
                }),
                database_1.default.booking.aggregate({
                    where: {
                        fieldId: { in: fieldIds },
                        status: 'COMPLETED'
                    },
                    _sum: {
                        fieldOwnerAmount: true
                    }
                })
            ]);
            // Format bookings for frontend with fee breakdown
            const formattedBookings = bookings.map((booking) => {
                // Calculate Stripe fee (1.5% + 20p)
                const stripeFee = booking.totalPrice > 0 ? Math.round(((booking.totalPrice * 0.015) + 0.20) * 100) / 100 : 0;
                const amountAfterStripeFee = Math.round((booking.totalPrice - stripeFee) * 100) / 100;
                // Determine platform fee logic
                // Use stored value if booking is completed OR cancellation window has passed
                // Use dynamic value if booking is pending/confirmed AND within cancellation window
                const cancelWindowHours = systemSettings?.cancellationWindowHours || 24;
                const cancelWindowMs = cancelWindowHours * 60 * 60 * 1000;
                const bookingTime = new Date(booking.date).getTime();
                const now = new Date().getTime();
                // Time until booking starts
                const timeUntilBooking = bookingTime - now;
                // Window passed means we are closer to booking start than the cancellation window allows
                // OR the booking is in the past.
                const isPastCancellationWindow = timeUntilBooking < cancelWindowMs;
                const isLocked = booking.status === 'COMPLETED' || isPastCancellationWindow;
                let platformFee = 0;
                let usedCommissionRate = effectiveCommissionRate;
                // Note: booking.platformCommission is the amount, not rate.
                if (isLocked && booking.platformCommission !== null && booking.platformCommission !== undefined) {
                    platformFee = booking.platformCommission;
                    // Calculate effective rate for display based on GROSS booking amount (totalPrice)
                    if (booking.totalPrice > 0) {
                        usedCommissionRate = (platformFee / booking.totalPrice) * 100;
                        usedCommissionRate = Math.round(usedCommissionRate * 100) / 100;
                    }
                    else {
                        usedCommissionRate = 0;
                    }
                }
                else {
                    // Use dynamic/current rate applied to GROSS booking amount (if not stored)
                    platformFee = Math.round((booking.totalPrice * effectiveCommissionRate) / 100 * 100) / 100;
                    usedCommissionRate = effectiveCommissionRate;
                }
                // Field owner earnings - remainder after platform fees
                // Note: Platform commission covers Stripe fees; owner pays commission only.
                let fieldOwnerEarnings = 0;
                if (isLocked && booking.fieldOwnerAmount !== null && booking.fieldOwnerAmount !== undefined) {
                    fieldOwnerEarnings = booking.fieldOwnerAmount;
                }
                else {
                    fieldOwnerEarnings = Math.round((booking.totalPrice - platformFee) * 100) / 100;
                }
                return {
                    id: booking.id,
                    userId: booking.user.id,
                    userName: booking.user.name,
                    userAvatar: booking.user.image || booking.user.googleImage || null,
                    userEmail: booking.user.email,
                    userPhone: booking.user.phone,
                    time: `${booking.startTime} - ${booking.endTime}`,
                    orderId: generateOrderId(booking.id),
                    status: booking.status.toLowerCase(),
                    frequency: formatRecurringFrequency(booking.repeatBooking),
                    dogs: booking.numberOfDogs || 1,
                    amount: booking.totalPrice,
                    date: booking.date.toISOString(),
                    fieldName: booking.field.name,
                    fieldId: booking.field.id,
                    fieldAddress: `${booking.field.address}, ${booking.field.city}`,
                    notes: booking.notes || null,
                    rescheduleCount: booking.rescheduleCount || 0,
                    // Fee breakdown
                    platformCommissionRate: usedCommissionRate,
                    isCustomCommission: hasCustomCommission,
                    defaultCommissionRate,
                    stripeFee,
                    amountAfterStripeFee,
                    fieldOwnerEarnings,
                    platformFee
                };
            });
            res.status(200).json({
                success: true,
                bookings: formattedBookings,
                stats: {
                    todayBookings,
                    totalBookings,
                    totalEarnings: totalEarnings._sum.fieldOwnerAmount || 0
                },
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: totalFilteredBookings,
                    totalPages: Math.ceil(totalFilteredBookings / limitNum),
                    hasNextPage: pageNum < Math.ceil(totalFilteredBookings / limitNum),
                    hasPrevPage: pageNum > 1
                }
            });
        }
        catch (error) {
            console.error('Error fetching upcoming bookings:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch upcoming bookings',
                bookings: [],
                stats: {
                    todayBookings: 0,
                    totalBookings: 0,
                    totalEarnings: 0
                }
            });
        }
    });
    // Get completed bookings for field owner (only COMPLETED status)
    getCompletedBookings = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const ownerId = req.user.id;
        const { page = 1, limit = 12 } = req.query;
        try {
            // Get default platform commission rate and check for custom commission for this field owner
            const [systemSettings, ownerUser] = await Promise.all([
                database_1.default.systemSettings.findFirst(),
                database_1.default.user.findUnique({
                    where: { id: ownerId },
                    select: { commissionRate: true }
                })
            ]);
            const defaultCommissionRate = systemSettings?.defaultCommissionRate || 20;
            // Check if admin has set a custom commission for this field owner
            const hasCustomCommission = ownerUser?.commissionRate !== null && ownerUser?.commissionRate !== undefined;
            // Use custom rate if set, otherwise use default platform rate
            const effectiveCommissionRate = hasCustomCommission ? ownerUser.commissionRate : defaultCommissionRate;
            // First get all owner's fields
            const fields = await field_model_1.default.findByOwner(ownerId);
            if (!fields || fields.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'No field found for this owner',
                    bookings: [],
                    stats: {
                        todayBookings: 0,
                        totalBookings: 0,
                        totalEarnings: 0
                    }
                });
            }
            // Get all field IDs for this owner
            const fieldIds = fields.map((field) => field.id);
            // Get completed bookings only (status = COMPLETED)
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const bookingFilter = {
                fieldId: { in: fieldIds },
                status: 'COMPLETED' // Only completed bookings
            };
            const pageNum = Number(page);
            const limitNum = Number(limit);
            const skip = (pageNum - 1) * limitNum;
            // Fetch bookings with user and field details and count
            const [bookings, totalFilteredBookings] = await Promise.all([
                database_1.default.booking.findMany({
                    where: bookingFilter,
                    include: {
                        user: true,
                        field: true
                    },
                    orderBy: {
                        date: 'desc'
                    },
                    skip,
                    take: limitNum
                }),
                database_1.default.booking.count({ where: bookingFilter })
            ]);
            // Get overall stats across all fields
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const [totalBookings, todayBookings, totalEarnings] = await Promise.all([
                database_1.default.booking.count({ where: { fieldId: { in: fieldIds } } }),
                database_1.default.booking.count({
                    where: {
                        fieldId: { in: fieldIds },
                        date: {
                            gte: today,
                            lt: tomorrow
                        }
                    }
                }),
                database_1.default.booking.aggregate({
                    where: {
                        fieldId: { in: fieldIds },
                        status: 'COMPLETED'
                    },
                    _sum: {
                        fieldOwnerAmount: true
                    }
                })
            ]);
            // Format bookings for frontend with fee breakdown
            const formattedBookings = bookings.map((booking) => {
                // Calculate Stripe fee (1.5% + 20p) - Informational, covered by platform commission
                const stripeFee = booking.totalPrice > 0 ? Math.round(((booking.totalPrice * 0.015) + 0.20) * 100) / 100 : 0;
                const amountAfterStripeFee = Math.round((booking.totalPrice - stripeFee) * 100) / 100;
                let platformFee = 0;
                let usedCommissionRate = effectiveCommissionRate;
                // Note: booking.platformCommission is the amount, not rate.
                if (booking.platformCommission !== null && booking.platformCommission !== undefined) {
                    platformFee = booking.platformCommission;
                    // Calculate effective rate for display based on GROSS booking amount (totalPrice)
                    if (booking.totalPrice > 0) {
                        usedCommissionRate = (platformFee / booking.totalPrice) * 100;
                        usedCommissionRate = Math.round(usedCommissionRate * 100) / 100;
                    }
                    else {
                        usedCommissionRate = 0;
                    }
                }
                else {
                    // Use dynamic/current rate applied to GROSS booking amount (if not stored)
                    platformFee = Math.round((booking.totalPrice * effectiveCommissionRate) / 100 * 100) / 100;
                    usedCommissionRate = effectiveCommissionRate;
                }
                // Field owner earnings - remainder after platform fees
                // Note: Platform commission covers Stripe fees; owner pays commission only.
                let fieldOwnerEarnings = 0;
                if (booking.fieldOwnerAmount !== null && booking.fieldOwnerAmount !== undefined) {
                    fieldOwnerEarnings = booking.fieldOwnerAmount;
                }
                else {
                    fieldOwnerEarnings = Math.round((booking.totalPrice - platformFee) * 100) / 100;
                }
                return {
                    id: booking.id,
                    userId: booking.user.id,
                    userName: booking.user.name,
                    userAvatar: booking.user.image || booking.user.googleImage || null,
                    userEmail: booking.user.email,
                    userPhone: booking.user.phone,
                    time: `${booking.startTime} - ${booking.endTime}`,
                    orderId: generateOrderId(booking.id),
                    status: booking.status.toLowerCase(),
                    frequency: formatRecurringFrequency(booking.repeatBooking),
                    dogs: booking.numberOfDogs || 1,
                    amount: booking.totalPrice,
                    date: booking.date.toISOString(),
                    fieldName: booking.field.name,
                    fieldId: booking.field.id,
                    fieldAddress: `${booking.field.address}, ${booking.field.city}`,
                    notes: booking.notes || null,
                    rescheduleCount: booking.rescheduleCount || 0,
                    // Fee breakdown
                    platformCommissionRate: usedCommissionRate,
                    isCustomCommission: hasCustomCommission,
                    defaultCommissionRate,
                    stripeFee,
                    amountAfterStripeFee,
                    fieldOwnerEarnings,
                    platformFee
                };
            });
            res.status(200).json({
                success: true,
                bookings: formattedBookings,
                stats: {
                    todayBookings,
                    totalBookings,
                    totalEarnings: totalEarnings._sum.fieldOwnerAmount || 0
                },
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    total: totalFilteredBookings,
                    totalPages: Math.ceil(totalFilteredBookings / limitNum),
                    hasNextPage: pageNum < Math.ceil(totalFilteredBookings / limitNum),
                    hasPrevPage: pageNum > 1
                }
            });
        }
        catch (error) {
            console.error('Error fetching completed bookings:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch completed bookings',
                bookings: [],
                stats: {
                    todayBookings: 0,
                    totalBookings: 0,
                    totalEarnings: 0
                }
            });
        }
    });
    // Get recent bookings for field owner
    getRecentBookings = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const ownerId = req.user.id;
        const { limit = 5 } = req.query;
        const limitNum = Number(limit);
        try {
            // First get the owner's field
            const fields = await field_model_1.default.findByOwner(ownerId);
            if (!fields || fields.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'No field found for this owner',
                    bookings: []
                });
            }
            const fieldId = fields[0].id;
            // Get recent bookings
            const bookings = await database_1.default.booking.findMany({
                where: {
                    fieldId,
                    status: {
                        in: ['CONFIRMED', 'COMPLETED']
                    }
                },
                orderBy: {
                    createdAt: 'desc'
                },
                take: limitNum,
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            phone: true,
                            image: true
                        }
                    }
                }
            });
            // Format bookings
            const formattedBookings = bookings.map(booking => ({
                id: booking.id,
                date: booking.date,
                startTime: booking.startTime,
                endTime: booking.endTime,
                numberOfDogs: booking.numberOfDogs,
                totalPrice: booking.totalPrice,
                status: booking.status,
                createdAt: booking.createdAt,
                rescheduleCount: booking.rescheduleCount || 0,
                user: {
                    id: booking.user.id,
                    name: booking.user.name || 'Unknown',
                    email: booking.user.email,
                    phone: booking.user.phone,
                    profilePicture: booking.user.image
                }
            }));
            res.status(200).json({
                success: true,
                bookings: formattedBookings
            });
        }
        catch (error) {
            console.error('Error fetching recent bookings:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch recent bookings',
                bookings: []
            });
        }
    });
    // Get fields available for claiming
    getFieldForClaim = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
        const fields = await database_1.default.field.findMany({
            where: {
                isClaimed: false,
                isActive: true
            },
            select: {
                id: true,
                name: true,
                address: true,
                city: true,
                state: true,
                zipCode: true,
                images: true,
                size: true,
                price: true,
                bookingDuration: true
            }
        });
        res.status(200).json({
            success: true,
            data: fields
        });
    });
    // Claim a field
    claimField = (0, asyncHandler_1.asyncHandler)(async (req, res) => {
        const { fieldId } = req.body;
        const userId = req.user.id;
        if (!fieldId) {
            return res.status(400).json({
                success: false,
                message: 'Field ID is required'
            });
        }
        // Check if field exists and is not already claimed
        const field = await database_1.default.field.findUnique({
            where: { id: fieldId }
        });
        if (!field) {
            return res.status(404).json({
                success: false,
                message: 'Field not found'
            });
        }
        if (field.isClaimed) {
            return res.status(400).json({
                success: false,
                message: 'This field has already been claimed'
            });
        }
        // Update field with owner information
        const updatedField = await database_1.default.field.update({
            where: { id: fieldId },
            data: {
                isClaimed: true,
                ownerId: userId,
                ownerName: req.user.name || req.user.email,
                joinedOn: new Date()
            }
        });
        res.status(200).json({
            success: true,
            message: 'Field claimed successfully',
            data: updatedField
        });
    });
    // Approve field (Admin only)
    approveField = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { fieldId } = req.params;
        const adminId = req.user.id;
        const userRole = req.user.role;
        // Only admins can approve fields
        if (userRole !== 'ADMIN') {
            throw new AppError_1.AppError('Only admins can approve fields', 403);
        }
        // Get field details
        const field = await database_1.default.field.findUnique({
            where: { id: fieldId },
            include: {
                owner: true
            }
        });
        if (!field) {
            throw new AppError_1.AppError('Field not found', 404);
        }
        // Check if field is already approved
        if (field.isApproved) {
            throw new AppError_1.AppError('Field is already approved', 400);
        }
        // Update field approval status
        const approvedField = await database_1.default.field.update({
            where: { id: fieldId },
            data: {
                isApproved: true,
                isActive: true // Make field active when approved
            }
        });
        // Create notification for field owner
        await database_1.default.notification.create({
            data: {
                userId: field.ownerId,
                type: 'field_approved',
                title: 'Field Approved!',
                message: `Your field "${field.name}" has been approved and is now live on Fieldsy.`,
                data: {
                    fieldId: field.id,
                    fieldName: field.name
                }
            }
        });
        // Send approval email to field owner
        try {
            const { emailService } = await Promise.resolve().then(() => __importStar(require('../services/email.service')));
            // Get field address
            let fieldAddress = '';
            if (field.location && typeof field.location === 'object') {
                const loc = field.location;
                fieldAddress = loc.formatted_address || loc.streetAddress || field.address || '';
            }
            else {
                fieldAddress = field.address || '';
            }
            await emailService.sendFieldApprovalEmail({
                email: field.owner.email,
                ownerName: field.owner.name || field.owner.email,
                fieldName: field.name || 'Your Field',
                fieldAddress: fieldAddress
            });
        }
        catch (emailError) {
            console.error('Failed to send approval email:', emailError);
            // Don't fail the approval if email fails
        }
        res.status(200).json({
            success: true,
            message: 'Field approved successfully and owner notified',
            data: approvedField
        });
    });
    // Reject field (Admin only)
    rejectField = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { fieldId } = req.params;
        const { rejectionReason } = req.body;
        const adminId = req.user.id;
        const userRole = req.user.role;
        // Only admins can reject fields
        if (userRole !== 'ADMIN') {
            throw new AppError_1.AppError('Only admins can reject fields', 403);
        }
        // Get field details
        const field = await database_1.default.field.findUnique({
            where: { id: fieldId },
            include: {
                owner: true
            }
        });
        if (!field) {
            throw new AppError_1.AppError('Field not found', 404);
        }
        // Update field rejection status
        const rejectedField = await database_1.default.field.update({
            where: { id: fieldId },
            data: {
                isApproved: false,
                rejectionReason: rejectionReason || 'Field did not meet our approval criteria',
                isActive: false // Deactivate rejected fields
            }
        });
        // Create notification for field owner
        await database_1.default.notification.create({
            data: {
                userId: field.ownerId,
                type: 'field_rejected',
                title: 'Field Submission Update',
                message: `Your field "${field.name}" submission requires attention. ${rejectionReason || 'Please check the details and resubmit.'}`,
                data: {
                    fieldId: field.id,
                    fieldName: field.name,
                    rejectionReason: rejectionReason
                }
            }
        });
        res.status(200).json({
            success: true,
            message: 'Field rejected and owner notified',
            data: rejectedField
        });
    });
    // Get fields pending approval (Admin only)
    getPendingFields = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const userRole = req.user.role;
        const { page = 1, limit = 10 } = req.query;
        // Only admins can view pending fields
        if (userRole !== 'ADMIN') {
            throw new AppError_1.AppError('Only admins can view pending fields', 403);
        }
        const pageNum = Number(page);
        const limitNum = Number(limit);
        const skip = (pageNum - 1) * limitNum;
        const [fields, total] = await Promise.all([
            database_1.default.field.findMany({
                where: {
                    isSubmitted: true,
                    isApproved: false
                },
                include: {
                    owner: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            phone: true
                        }
                    }
                },
                skip,
                take: limitNum,
                orderBy: {
                    submittedAt: 'desc'
                }
            }),
            database_1.default.field.count({
                where: {
                    isSubmitted: true,
                    isApproved: false
                }
            })
        ]);
        res.status(200).json({
            success: true,
            data: fields,
            pagination: {
                currentPage: pageNum,
                totalPages: Math.ceil(total / limitNum),
                totalItems: total,
                itemsPerPage: limitNum
            }
        });
    });
    // Get price range (min and max) of all active fields
    getPriceRange = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        // Get all approved and active fields with prices
        const fields = await database_1.default.field.findMany({
            where: {
                isSubmitted: true,
                isActive: true,
                isClaimed: true,
                price: { not: null }
            },
            select: {
                price: true
            }
        });
        // Calculate min and max from the results
        let minPrice = 0;
        let maxPrice = 100;
        if (fields.length > 0) {
            const prices = fields.map(f => f.price).filter((p) => p !== null);
            if (prices.length > 0) {
                minPrice = Math.min(...prices);
                maxPrice = Math.max(...prices);
            }
        }
        res.status(200).json({
            success: true,
            status: 'success',
            data: {
                minPrice,
                maxPrice
            }
        });
    });
    // Get field details for admin with all necessary data
    getFieldDetailsForAdmin = (0, asyncHandler_1.asyncHandler)(async (req, res, next) => {
        const { id } = req.params;
        // Get field with owner and booking details
        const field = await database_1.default.field.findUnique({
            where: { id },
            include: {
                owner: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        phone: true,
                        image: true,
                        isBlocked: true,
                        createdAt: true,
                    }
                },
                bookings: {
                    where: {
                        status: {
                            in: ['CONFIRMED', 'COMPLETED']
                        }
                    },
                    orderBy: {
                        createdAt: 'desc'
                    },
                    take: 10,
                    include: {
                        user: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                            }
                        },
                        payment: true
                    }
                }
            }
        });
        if (!field) {
            throw new AppError_1.AppError('Field not found', 404);
        }
        // Calculate total earnings from successful payouts for this specific field
        const stripeAccount = await database_1.default.stripeAccount.findUnique({
            where: { userId: field.ownerId }
        });
        let totalOwnerEarnings = 0;
        let totalEarnings = 0;
        if (stripeAccount) {
            // Get all bookings for THIS specific field
            const fieldBookings = await database_1.default.booking.findMany({
                where: {
                    fieldId: id,
                    paymentStatus: 'PAID'
                },
                select: { id: true, totalPrice: true }
            });
            const fieldBookingIds = fieldBookings.map(b => b.id);
            if (fieldBookingIds.length > 0) {
                // Get payouts that include bookings from THIS field
                const payouts = await database_1.default.payout.findMany({
                    where: {
                        stripeAccountId: stripeAccount.id,
                        status: 'paid',
                        bookingIds: {
                            hasSome: fieldBookingIds
                        }
                    }
                });
                // Calculate the portion of each payout that belongs to this field
                totalOwnerEarnings = payouts.reduce((sum, payout) => {
                    // Count how many bookings in this payout belong to this field
                    const payoutFieldBookings = payout.bookingIds.filter(id => fieldBookingIds.includes(id));
                    // Calculate proportional amount
                    const proportion = payout.bookingIds.length > 0
                        ? payoutFieldBookings.length / payout.bookingIds.length
                        : 0;
                    return sum + (payout.amount * proportion);
                }, 0);
                // Calculate total revenue (customer payments) for this field
                totalEarnings = fieldBookings.reduce((sum, b) => sum + (b.totalPrice || 0), 0);
            }
        }
        const normalizePriceValue = (value) => {
            if (value === null || value === undefined)
                return null;
            const numericValue = typeof value === 'number' ? value : Number(value);
            return Number.isFinite(numericValue) ? numericValue : null;
        };
        let legacyHourlyPrice = null;
        if ((field.price === null || field.price === undefined) && mongodb_1.ObjectId.isValid(id)) {
            try {
                const rawResult = await database_1.default.$runCommandRaw({
                    find: 'fields',
                    filter: { _id: new mongodb_1.ObjectId(id) },
                    projection: { pricePerHour: 1 },
                });
                const rawField = rawResult?.cursor?.firstBatch?.[0];
                if (rawField && rawField.pricePerHour !== undefined && rawField.pricePerHour !== null) {
                    legacyHourlyPrice = normalizePriceValue(rawField.pricePerHour);
                }
            }
            catch (legacyPriceError) {
                console.warn(`Failed to fetch legacy pricePerHour for field ${id}:`, legacyPriceError?.message || legacyPriceError);
            }
        }
        const normalizedHourlyPrice = normalizePriceValue(field.price ?? legacyHourlyPrice);
        const normalizedDailyPrice = normalizePriceValue(field.pricePerDay);
        // Transform amenities to objects with icons
        const amenityObjects = await (0, amenity_utils_1.transformAmenitiesToObjects)(field.amenities || []);
        const amenitiesWithIcons = amenityObjects.map((amenity) => ({
            id: amenity.id,
            label: amenity.label,
            value: amenity.value,
            iconUrl: amenity.iconUrl ?? null,
        }));
        // Parse and format booking policies from cancellationPolicy field or use defaults
        let bookingPolicies = [];
        if (field.cancellationPolicy) {
            // If cancellationPolicy is a string, try to parse it
            if (typeof field.cancellationPolicy === 'string') {
                try {
                    // Try parsing as JSON first
                    const parsed = JSON.parse(field.cancellationPolicy);
                    if (Array.isArray(parsed)) {
                        bookingPolicies = parsed.filter(p => p && p.trim().length > 0);
                    }
                    else if (typeof parsed === 'string') {
                        // Split by newlines or periods
                        bookingPolicies = parsed.split(/[\n.]/).map(p => p.trim()).filter(p => p.length > 0);
                    }
                }
                catch {
                    // If not JSON, split by newlines or periods
                    bookingPolicies = field.cancellationPolicy.split(/[\n.]/).map(p => p.trim()).filter(p => p.length > 0);
                }
            }
            else if (Array.isArray(field.cancellationPolicy)) {
                bookingPolicies = field.cancellationPolicy.filter(p => p && p.trim && p.trim().length > 0);
            }
        }
        // Use defaults if no policies found
        if (bookingPolicies.length === 0) {
            bookingPolicies = [
                'All bookings must be made at least 24 hours in advance',
                'The minimum booking slot is 1 hour',
                'Free cancellation up to 12 hours before the scheduled start time',
                'Users arriving late will not receive a time extension',
                'If the client does not arrive within 15 minutes of the booking start time, the booking will be marked as non-show and charged in full',
                'Bookings may be subject to blackout list booking nights'
            ];
        }
        // Parse and format safety rules from rules field
        let safetyRules = [];
        if (field.rules && Array.isArray(field.rules) && field.rules.length > 0) {
            if (field.rules.length === 1 && typeof field.rules[0] === 'string') {
                // Single string with multiple rules - split by periods or newlines
                const rulesString = field.rules[0];
                safetyRules = rulesString
                    .split(/[.\n]/)
                    .map((rule) => rule.trim())
                    .filter((rule) => rule.length > 0);
            }
            else {
                // Already an array of rules
                safetyRules = field.rules.filter((rule) => rule && typeof rule === 'string' && rule.trim().length > 0);
            }
        }
        // Enrich response with formatted data
        const enrichedField = {
            ...field,
            price: normalizedHourlyPrice,
            pricePerDay: normalizedDailyPrice,
            amenities: amenitiesWithIcons,
            policies: bookingPolicies,
            safetyRules: safetyRules,
            recentBookings: field.bookings || [],
            totalEarnings,
            totalOwnerEarnings,
            joinedOn: field.owner?.createdAt ? new Date(field.owner.createdAt).toLocaleDateString('en-GB', {
                day: '2-digit',
                month: 'short',
                year: 'numeric'
            }) : 'N/A',
        };
        res.json({
            success: true,
            data: enrichedField,
        });
    });
}
exports.default = new FieldController();
