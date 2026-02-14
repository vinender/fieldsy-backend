//@ts-nocheck
import { Request, Response, NextFunction } from 'express';
import { ObjectId } from 'mongodb';
import FieldModel from '../models/field.model';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import prisma from '../config/database';
import { enrichFieldWithAmenities, enrichFieldsWithAmenities, transformAmenitiesToObjects } from '../utils/amenity.utils';
import { convertAmenityIdsToNames } from '../utils/amenity.converter';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

// Initialize S3 client for image deletion
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'eu-west-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

// Helper function to check if an image URL is valid (not placeholder, not empty, not map image)
const isValidImageUrl = (img: string | null | undefined): boolean => {
  if (!img) return false;
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

  // Filter out Google Maps images
  if (lowerImg.includes('maps.google') ||
    lowerImg.includes('google.com/maps') ||
    lowerImg.includes('maps.googleapis.com') ||
    lowerImg.includes('staticmap') ||
    lowerImg.includes('street_view') ||
    lowerImg.includes('streetview')) {
    return false;
  }

  // Filter out other map service images
  if (lowerImg.includes('openstreetmap') ||
    lowerImg.includes('mapbox') ||
    lowerImg.includes('tile.openstreetmap') ||
    lowerImg.includes('api.mapbox')) {
    return false;
  }

  return true;
};

// Helper function to check if an image is a premium URL (S3, CDN, etc. - not WordPress)
const isPremiumImageUrl = (img: string): boolean => {
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
const getFirstValidImage = (images: string[] | null | undefined): string | null => {
  if (!images || images.length === 0) return null;

  // First, try to find a premium image (S3, CDN, etc.)
  const premiumImage = images.find((img: string) => {
    if (!isValidImageUrl(img)) return false;
    return isPremiumImageUrl(img);
  });

  if (premiumImage) return premiumImage;

  // Fall back to any valid image (including WordPress)
  const anyValidImage = images.find((img: string) => isValidImageUrl(img));

  return anyValidImage || null;
};

// Helper function to get location display string
// Tries multiple sources: legacy city/state, location JSON object, legacy address
const getLocationDisplay = (field: any): string => {
  // 1. First try legacy city/state fields
  const cityState = [field.city, field.state].filter(Boolean).join(', ');
  if (cityState) return cityState;

  // 2. Try location JSON object (used by scraped fields)
  if (field.location && typeof field.location === 'object') {
    const loc = field.location;

    // Try city/county from location object
    const locCityState = [loc.city, loc.county || loc.state].filter(Boolean).join(', ');
    if (locCityState) return locCityState;

    // Try formatted_address (often contains full address)
    if (loc.formatted_address) {
      return loc.formatted_address;
    }
  }

  // 3. Try legacy address field (contains full address for scraped fields)
  if (field.address) {
    return field.address;
  }

  return 'Location not available';
};

const formatRecurringFrequency = (repeatBooking?: string | null) => {
  if (!repeatBooking) return 'NA';

  const normalized = repeatBooking.trim().toLowerCase();
  if (!normalized || normalized === 'none' || normalized === 'na' || normalized === 'no') {
    return 'NA';
  }

  const labelMap: Record<string, string> = {
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
 * Generate a unique orderId
 */
const generateOrderId = (booking: any): string => {
  // If we already have the new human-readable bookingId, use it
  if (booking.bookingId) {
    return `#${booking.bookingId}`;
  }

  const id = booking.id || booking._id;
  if (!id || id.length < 6) {
    return `#${id?.toUpperCase() || 'UNKNOWN'}`;
  }
  // Use last 6 characters of the ObjectId for legacy records
  return `#${id.slice(-6).toUpperCase()}`;
};

class FieldController {
  // Create new field
  createField = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const ownerId = (req as any).user.id;
    const userRole = (req as any).user.role;

    // Only field owners can create fields
    if (userRole !== 'FIELD_OWNER' && userRole !== 'ADMIN') {
      throw new AppError('Only field owners can create fields', 403);
    }

    // Validate times are provided and different (no minimum hours requirement)
    if (req.body.openingTime && req.body.closingTime) {
      if (req.body.openingTime === req.body.closingTime) {
        throw new AppError('Opening and closing times must be different', 400);
      }
      // Note: We allow overnight operation (e.g., 10pm to 6am), so no "closing after opening" check
    }

    // Convert amenity IDs to names if amenities are provided
    let amenityNames = req.body.amenities || [];
    if (amenityNames && amenityNames.length > 0) {
      amenityNames = await convertAmenityIdsToNames(amenityNames);
    }

    // Handle price fields - explicitly set to null if empty/0
    if (req.body.price30min !== undefined) {
      req.body.price30min = req.body.price30min === '' || req.body.price30min === null || parseFloat(req.body.price30min) === 0
        ? null
        : parseFloat(req.body.price30min);
    }
    if (req.body.price1hr !== undefined) {
      req.body.price1hr = req.body.price1hr === '' || req.body.price1hr === null || parseFloat(req.body.price1hr) === 0
        ? null
        : parseFloat(req.body.price1hr);
    }

    const fieldData = {
      ...req.body,
      amenities: amenityNames,
      ownerId,
    };

    const field = await FieldModel.create(fieldData);

    // Enrich field with full amenity objects
    const enrichedField = await enrichFieldWithAmenities(field);

    res.status(201).json({
      success: true,
      message: 'Field created successfully',
      data: enrichedField,
    });
  });

  // Get all fields with filters and pagination (admin - includes all fields)
  getAllFields = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const {
      search,
      zipCode,
      lat,
      lng,
      city,
      state,
      type,
      minPrice,
      maxPrice,
      amenities,
      minRating,
      maxDistance,
      date,
      startTime,
      endTime,
      numberOfDogs,
      size,
      terrainType,
      fenceType,
      instantBooking,
      availability,
      sortBy,
      sortOrder,
      page = 1,
      limit = 10,
    } = req.query;

    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;

    // Parse amenities if it's a comma-separated string
    const amenitiesArray = amenities
      ? (amenities as string).split(',').map(a => a.trim())
      : undefined;

    // Parse availability if it's a comma-separated string (e.g., "Morning,Afternoon")
    const availabilityArray = availability
      ? (availability as string).split(',').map(a => a.trim())
      : undefined;

    const result = await FieldModel.findAll({
      search: search as string,
      zipCode: zipCode as string,
      lat: lat ? Number(lat) : undefined,
      lng: lng ? Number(lng) : undefined,
      city: city as string,
      state: state as string,
      type: type as string,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
      amenities: amenitiesArray,
      minRating: minRating ? Number(minRating) : undefined,
      maxDistance: maxDistance ? Number(maxDistance) : undefined,
      date: date ? new Date(date as string) : undefined,
      startTime: startTime as string,
      endTime: endTime as string,
      numberOfDogs: numberOfDogs ? Number(numberOfDogs) : undefined,
      size: size as string,
      terrainType: terrainType as string,
      fenceType: fenceType as string,
      instantBooking: instantBooking === 'true' ? true : instantBooking === 'false' ? false : undefined,
      availability: availabilityArray,
      sortBy: sortBy as string,
      sortOrder: sortOrder as 'asc' | 'desc',
      skip,
      take: limitNum,
    });

    // Enrich fields with full amenity objects
    const enrichedFields = await enrichFieldsWithAmenities(result.fields);

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
  getActiveFields = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const {
      search,
      zipCode,
      lat,
      lng,
      city,
      state,
      type,
      minPrice,
      maxPrice,
      amenities,
      minRating,
      maxDistance,
      date,
      startTime,
      endTime,
      numberOfDogs,
      size,
      terrainType,
      fenceType,
      instantBooking,
      availability,
      sortBy,
      sortOrder,
      page = 1,
      limit = 10,
    } = req.query;

    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;

    // Parse amenities if it's a comma-separated string
    const amenitiesArray = amenities
      ? (amenities as string).split(',').map(a => a.trim())
      : undefined;

    // Parse availability if it's a comma-separated string (e.g., "Morning,Afternoon")
    const availabilityArray = availability
      ? (availability as string).split(',').map(a => a.trim())
      : undefined;

    // This method already filters by isActive: true and isSubmitted: true
    const result = await FieldModel.findAll({
      search: search as string,
      zipCode: zipCode as string,
      lat: lat ? Number(lat) : undefined,
      lng: lng ? Number(lng) : undefined,
      city: city as string,
      state: state as string,
      type: type as string,
      minPrice: minPrice ? Number(minPrice) : undefined,
      maxPrice: maxPrice ? Number(maxPrice) : undefined,
      amenities: amenitiesArray,
      minRating: minRating ? Number(minRating) : undefined,
      maxDistance: maxDistance ? Number(maxDistance) : undefined,
      date: date ? new Date(date as string) : undefined,
      startTime: startTime as string,
      endTime: endTime as string,
      numberOfDogs: numberOfDogs ? Number(numberOfDogs) : undefined,
      size: size as string,
      terrainType: terrainType as string,
      fenceType: fenceType as string,
      instantBooking: instantBooking === 'true' ? true : instantBooking === 'false' ? false : undefined,
      availability: availabilityArray,
      sortBy: sortBy as string,
      sortOrder: sortOrder as 'asc' | 'desc',
      skip,
      take: limitNum,
    });

    // Transform and calculate distance for each field if user location is provided
    const userLat = lat ? Number(lat) : null;
    const userLng = lng ? Number(lng) : null;

    const transformedFields = result.fields.map((field: any) => {
      // Get field coordinates from location JSON or legacy lat/lng fields
      // Handle both Prisma Json type and actual parsed object
      const locationData = typeof field.location === 'string'
        ? JSON.parse(field.location)
        : field.location;

      const fieldLat = locationData?.lat || field.latitude;
      const fieldLng = locationData?.lng || field.longitude;

      // Build optimized response with only necessary fields
      const optimizedField: any = {
        id: field.fieldId, // Use human-readable ID as primary ID for frontend
        _objectId: field.id, // Store ObjectID temporarily for liking logic
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
        locationDisplay: getLocationDisplay(field),
      };

      // Calculate distance if user location is provided and field has coordinates
      if (userLat && userLng && fieldLat && fieldLng) {
        // Haversine formula to calculate distance in miles
        const R = 3959; // Earth's radius in miles
        const dLat = (fieldLat - userLat) * Math.PI / 180;
        const dLng = (fieldLng - userLng) * Math.PI / 180;

        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
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
    const enrichedFields = await enrichFieldsWithAmenities(transformedFields);

    // Get user's liked fields if authenticated
    const userId = (req as any).user?.id;
    let userLikedFieldIds: Set<string> = new Set();

    if (userId) {
      const userFavorites = await prisma.favorite.findMany({
        where: { userId },
        select: { fieldId: true }
      });
      userLikedFieldIds = new Set(userFavorites.map(f => f.fieldId));
    }

    // Add isLiked to each field and remove internal ID
    const fieldsWithLikeStatus = enrichedFields.map((field: any) => {
      const { _objectId, ...fieldData } = field;
      return {
        ...fieldData,
        isLiked: userLikedFieldIds.has(_objectId)
      };
    });

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
  getFieldSuggestions = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { query } = req.query;

    if (!query || (query as string).length < 2) {
      return res.json({
        success: true,
        data: [],
      });
    }

    const suggestions = await FieldModel.getSuggestions(query as string);

    res.json({
      success: true,
      data: suggestions,
    });
  });

  // Get field by ID
  getField = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const { lat, lng } = req.query;

    const field = await FieldModel.findById(id);
    if (!field) {
      throw new AppError('Field not found', 404);
    }

    // Calculate distance if user location (lat/lng) is provided
    if (lat && lng && field.latitude && field.longitude) {
      const userLat = Number(lat);
      const userLng = Number(lng);

      // Haversine formula to calculate distance in miles
      const R = 3959; // Earth's radius in miles
      const dLat = (field.latitude - userLat) * Math.PI / 180;
      const dLng = (field.longitude - userLng) * Math.PI / 180;

      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(userLat * Math.PI / 180) * Math.cos(field.latitude * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);

      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distanceMiles = R * c;

      // Add distanceMiles to field response
      (field as any).distanceMiles = Number(distanceMiles.toFixed(1));
    }

    const amenityObjects = await transformAmenitiesToObjects(field.amenities || []);
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
  getFieldMinimal = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    const field = await FieldModel.findByIdMinimal(id);
    if (!field) {
      throw new AppError('Field not found', 404);
    }

    // Transform amenities to objects
    const amenityObjects = await transformAmenitiesToObjects(field.amenities || []);
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
  getMyFields = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const ownerId = (req as any).user.id;

    const fields = await FieldModel.findByOwner(ownerId);

    // Enrich fields with full amenity objects
    const enrichedFields = await enrichFieldsWithAmenities(fields);

    res.json({
      success: true,
      data: enrichedFields,
      total: enrichedFields.length,
    });
  });

  // Update field
  updateField = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;
    const formatAddress = (address?: string | null, city?: string | null, state?: string | null, zipCode?: string | null) => {
      return [address, city, state, zipCode]
        .map(part => (part && typeof part === 'string' ? part.trim() : part))
        .filter(Boolean)
        .join(', ') || 'Not provided';
    };

    // Check ownership
    const field = await FieldModel.findById(id);
    if (!field) {
      throw new AppError('Field not found', 404);
    }

    if (field.ownerId !== userId && userRole !== 'ADMIN') {
      throw new AppError('You can only update your own fields', 403);
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

    // Entry code change detection
    const entryCodeChanged = req.body.entryCode !== undefined && req.body.entryCode !== field.entryCode;
    const previousEntryCode = field.entryCode;

    console.log('───────────────────────────────────────────────────────────────');
    console.log('📊 Final Decision:');
    console.log('   - Address Updated:', addressUpdated);
    console.log('   - User is FIELD_OWNER:', userRole === 'FIELD_OWNER');
    console.log('   - Should Notify Admin:', shouldNotifyAdmin);
    console.log('   - Entry Code Changed:', entryCodeChanged);
    console.log('═══════════════════════════════════════════════════════════════');

    const previousAddressSnapshot = shouldNotifyAdmin
      ? formatAddress(field.address, field.city, field.state, field.zipCode)
      : null;

    // Convert amenity IDs to names if amenities are being updated
    if (req.body.amenities && req.body.amenities.length > 0) {
      req.body.amenities = await convertAmenityIdsToNames(req.body.amenities);
    }

    // Handle price fields - explicitly set to null if empty/0 to ensure proper removal
    if (req.body.price30min !== undefined) {
      req.body.price30min = req.body.price30min === '' || req.body.price30min === null || parseFloat(req.body.price30min) === 0
        ? null
        : parseFloat(req.body.price30min);
    }
    if (req.body.price1hr !== undefined) {
      req.body.price1hr = req.body.price1hr === '' || req.body.price1hr === null || parseFloat(req.body.price1hr) === 0
        ? null
        : parseFloat(req.body.price1hr);
    }

    // Validate times if being updated (no minimum hours requirement, allow flexible hours)
    if (req.body.openingTime || req.body.closingTime) {
      const openingTime = req.body.openingTime || field.openingTime;
      const closingTime = req.body.closingTime || field.closingTime;

      if (openingTime && closingTime && openingTime === closingTime) {
        throw new AppError('Opening and closing times must be different', 400);
      }
      // Note: We allow overnight operation (e.g., 10pm to 6am), so no "closing after opening" check
    }

    const updatedField = await FieldModel.update(id, req.body);

    // If isClaimed is being set to false, reset any approved claims for this field
    // This ensures the field can be claimed again
    if (req.body.isClaimed === false && field.isClaimed === true) {
      console.log(`📝 Field ${id} marked as unclaimed. Resetting approved claims...`);
      try {
        // Update any APPROVED claims to REVOKED status
        const revokedClaims = await prisma.fieldClaim.updateMany({
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
      } catch (claimError) {
        console.error('Failed to revoke approved claims:', claimError);
        // Don't fail the update, just log the error
      }
    }

    // Enrich field with full amenity objects
    const enrichedField = await enrichFieldWithAmenities(updatedField);

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
        const { emailService } = await import('../services/email.service');
        const settings = await prisma.systemSettings.findFirst({
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
        } else {
          console.warn('⚠️ Admin email not configured in settings; skipping field address change notification.');
          console.warn('   To enable notifications, set Admin Email in Admin Settings > General');
        }
      } catch (notificationError) {
        console.error('❌ Failed to send field address change notification:', notificationError);
      }

      // Send in-app notification to all admins
      try {
        const { NotificationService } = await import('../services/notification.service');
        const ownerName = updatedField.owner?.name || field.owner?.name || 'Field Owner';
        const newAddress = formatAddress(updatedField.address, updatedField.city, updatedField.state, updatedField.zipCode);

        await NotificationService.notifyAdmins(
          'Field Address Updated',
          `${ownerName} has updated the address for field "${updatedField.name || 'Field'}". Previous: ${previousAddressSnapshot}. New: ${newAddress}`,
          {
            fieldId: updatedField.id,
            fieldName: updatedField.name,
            ownerId: field.ownerId,
            ownerName: ownerName,
            previousAddress: previousAddressSnapshot,
            newAddress: newAddress,
            changeDate: new Date()
          }
        );
      } catch (notificationError) {
        console.error('Failed to send admin notification for field address change:', notificationError);
      }
    }

    // Notify dog owners with upcoming bookings if entry code changed
    if (entryCodeChanged && req.body.entryCode) {
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('🔐 ENTRY CODE CHANGE DETECTED - NOTIFYING BOOKED USERS');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('📋 Field ID:', updatedField.id);
      console.log('📋 Field Name:', updatedField.name || 'N/A');
      console.log('🔑 Previous Entry Code:', previousEntryCode || 'None');
      console.log('🔑 New Entry Code:', req.body.entryCode);
      console.log('───────────────────────────────────────────────────────────────');

      try {
        // Get all upcoming bookings for this field
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const upcomingBookings = await prisma.booking.findMany({
          where: {
            fieldId: updatedField.id,
            date: { gte: today },
            status: { in: ['CONFIRMED', 'PENDING'] }
          },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true
              }
            }
          }
        });

        // Get unique users who have upcoming bookings
        const usersToNotify = new Map<string, { email: string; name: string; bookingDates: Date[] }>();
        for (const booking of upcomingBookings) {
          if (booking.user?.email) {
            const existing = usersToNotify.get(booking.user.id);
            if (existing) {
              existing.bookingDates.push(booking.date);
            } else {
              usersToNotify.set(booking.user.id, {
                email: booking.user.email,
                name: booking.user.name || 'Valued Customer',
                bookingDates: [booking.date]
              });
            }
          }
        }

        console.log(`📧 Found ${usersToNotify.size} user(s) with upcoming bookings to notify`);

        // Send emails to all affected users
        const { emailService } = await import('../services/email.service');
        for (const [userId, userData] of usersToNotify) {
          try {
            await emailService.sendEntryCodeUpdateNotification({
              email: userData.email,
              userName: userData.name,
              fieldName: updatedField.name || 'the field',
              fieldAddress: updatedField.address || '',
              newEntryCode: req.body.entryCode,
              upcomingBookingDates: userData.bookingDates
            });
            console.log(`✅ Entry code notification sent to ${userData.email}`);
          } catch (emailError) {
            console.error(`❌ Failed to send entry code update email to ${userData.email}:`, emailError);
          }
        }

        console.log('═══════════════════════════════════════════════════════════════');
      } catch (notifyError) {
        console.error('Error notifying users about entry code change:', notifyError);
      }
    }

    res.json({
      success: true,
      message: 'Field updated successfully',
      data: enrichedField,
    });
  });

  // Delete field
  deleteField = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;

    // Check ownership
    const field = await FieldModel.findById(id);
    if (!field) {
      throw new AppError('Field not found', 404);
    }

    if (field.ownerId !== userId && userRole !== 'ADMIN') {
      throw new AppError('You can only delete your own fields', 403);
    }

    await FieldModel.delete(id);

    res.status(204).json({
      success: true,
      message: 'Field deleted successfully',
    });
  });

  // Toggle field active status
  toggleFieldStatus = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const userId = (req as any).user.id;
    const userRole = (req as any).user.role;

    // Check ownership
    const field = await FieldModel.findById(id);
    if (!field) {
      throw new AppError('Field not found', 404);
    }

    if (field.ownerId !== userId && userRole !== 'ADMIN') {
      throw new AppError('You can only toggle your own fields', 403);
    }

    const updatedField = await FieldModel.toggleActive(id);

    // Enrich field with full amenity objects
    const enrichedField = await enrichFieldWithAmenities(updatedField);

    res.json({
      success: true,
      message: `Field ${updatedField.isActive ? 'activated' : 'deactivated'} successfully`,
      data: enrichedField,
    });
  });

  // Toggle field blocked status (admin only)
  toggleFieldBlocked = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const userRole = (req as any).user.role;

    // Only admin can block/unblock fields
    if (userRole !== 'ADMIN') {
      throw new AppError('Only admin can block or unblock fields', 403);
    }

    // Check if field exists
    const field = await FieldModel.findById(id);
    if (!field) {
      throw new AppError('Field not found', 404);
    }

    const updatedField = await FieldModel.toggleBlocked(id);

    // Enrich field with full amenity objects
    const enrichedField = await enrichFieldWithAmenities(updatedField);

    res.json({
      success: true,
      message: `Field ${updatedField.isBlocked ? 'blocked' : 'unblocked'} successfully`,
      data: enrichedField,
    });
  });

  // Toggle field approved status (admin only)
  toggleFieldApproved = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const adminId = (req as any).user.id;
    const userRole = (req as any).user.role;

    // Only admin can approve/unapprove fields
    if (userRole !== 'ADMIN') {
      throw new AppError('Only admin can approve or unapprove fields', 403);
    }

    // Check if field exists
    const field = await prisma.field.findUnique({
      where: { id },
      include: { owner: true }
    });

    if (!field) {
      throw new AppError('Field not found', 404);
    }

    // Only allow approving fields that have been submitted
    if (!field.isSubmitted && !field.isApproved) {
      throw new AppError('Cannot approve a field that has not been submitted for review', 400);
    }

    const newApprovedStatus = !field.isApproved;

    // Update the field - only change isApproved (isActive is field-owner controlled)
    const updatedField = await prisma.field.update({
      where: { id },
      data: {
        isApproved: newApprovedStatus,
      }
    });

    // Create notification for field owner
    await prisma.notification.create({
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
        const { emailService } = await import('../services/email.service');

        let fieldAddress = '';
        if (field.location && typeof field.location === 'object') {
          const loc = field.location as any;
          fieldAddress = loc.formatted_address || loc.streetAddress || field.address || '';
        } else {
          fieldAddress = field.address || '';
        }

        await emailService.sendFieldApprovalEmail({
          email: field.owner.email,
          ownerName: field.owner.name || field.owner.email,
          fieldName: field.name || 'Your Field',
          fieldAddress: fieldAddress
        });
      } catch (emailError) {
        console.error('Failed to send approval email:', emailError);
      }
    }

    // Enrich field with full amenity objects
    const enrichedField = await enrichFieldWithAmenities(updatedField);

    res.json({
      success: true,
      message: `Field ${newApprovedStatus ? 'approved' : 'unapproved'} successfully`,
      data: enrichedField,
    });
  });

  // Search fields by location
  searchByLocation = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { lat, lng, radius = 10 } = req.query;

    if (!lat || !lng) {
      throw new AppError('Latitude and longitude are required', 400);
    }

    const fields = await FieldModel.searchByLocation(
      Number(lat),
      Number(lng),
      Number(radius)
    );

    // Enrich fields with full amenity objects
    const enrichedFields = await enrichFieldsWithAmenities(fields);

    res.json({
      success: true,
      data: enrichedFields,
      total: enrichedFields.length,
    });
  });

  // Get nearby fields based on lat/lng
  getNearbyFields = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { lat, lng, radius = 10, page = 1, limit = 9, sortBy, sortOrder } = req.query;

    // Validate required parameters
    if (!lat || !lng) {
      throw new AppError('Latitude and longitude are required', 400);
    }

    // Validate lat/lng values
    const latitude = Number(lat);
    const longitude = Number(lng);

    if (isNaN(latitude) || isNaN(longitude)) {
      throw new AppError('Invalid latitude or longitude values', 400);
    }

    if (latitude < -90 || latitude > 90) {
      throw new AppError('Latitude must be between -90 and 90', 400);
    }

    if (longitude < -180 || longitude > 180) {
      throw new AppError('Longitude must be between -180 and 180', 400);
    }

    const radiusNum = Number(radius);
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;

    // Get all active fields with distance calculated
    const allFieldsWithDistance = await FieldModel.searchByLocation(
      latitude,
      longitude,
      999999 // Very large radius to get all fields
    );

    // Split into nearby and remaining fields
    const nearbyFields = allFieldsWithDistance.filter(
      (field: any) => field.distanceMiles <= radiusNum
    );
    const remainingFields = allFieldsWithDistance.filter(
      (field: any) => field.distanceMiles > radiusNum
    );

    // Combine: nearby fields first, then remaining fields
    let combinedFields = [...nearbyFields, ...remainingFields];

    // Apply sorting if specified
    if (sortBy && typeof sortBy === 'string') {
      const sortFields = sortBy.split(',');
      const sortOrders = (sortOrder && typeof sortOrder === 'string')
        ? sortOrder.split(',')
        : sortFields.map(() => 'desc');

      combinedFields.sort((a: any, b: any) => {
        for (let i = 0; i < sortFields.length; i++) {
          const field = sortFields[i].trim();
          const order = sortOrders[i]?.trim() || 'desc';

          let aValue: number, bValue: number;

          if (field === 'rating') {
            aValue = a.averageRating || 0;
            bValue = b.averageRating || 0;
          } else if (field === 'price') {
            aValue = a.price || 0;
            bValue = b.price || 0;
          } else {
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
    const transformedFields = paginatedFields.map((field: any) => {
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
        locationDisplay: getLocationDisplay(field),
        distance: field.distanceMiles === Infinity ? null : field.distanceMiles,
        distanceDisplay: field.distanceMiles === Infinity
          ? 'Location not available'
          : field.distanceMiles < 1
            ? `${(field.distanceMiles * 1760).toFixed(0)} yards`
            : `${field.distanceMiles.toFixed(1)} miles`,
      };
    });

    // Enrich fields with amenity labels (string array only)
    const enrichedFields = await enrichFieldsWithAmenities(transformedFields);

    // Get user's liked fields if authenticated
    const userId = (req as any).user?.id;
    let userLikedFieldIds: Set<string> = new Set();

    if (userId) {
      const userFavorites = await prisma.favorite.findMany({
        where: { userId },
        select: { fieldId: true }
      });
      userLikedFieldIds = new Set(userFavorites.map(f => f.fieldId));
    }

    // Add isLiked to each field
    const fieldsWithLikeStatus = enrichedFields.map((field: any) => ({
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
  getPopularFields = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { page = 1, limit = 12, lat, lng } = req.query;

    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;
    const userLat = lat ? Number(lat) : null;
    const userLng = lng ? Number(lng) : null;

    // Get active fields with booking counts and ratings
    const fields = await prisma.field.findMany({
      where: {
        isActive: true,
        isSubmitted: true,
      },
      select: {
        id: true,
        fieldId: true, // Human-readable ID
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
    const fieldsWithScore = fields.map((field: any) => {
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

        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
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
    const transformedFields = paginatedFields.map((field: any) => {
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
        locationDisplay: getLocationDisplay(field),
        distance: field.distanceMiles,
        distanceDisplay: field.distanceMiles
          ? field.distanceMiles < 1
            ? `${(field.distanceMiles * 1760).toFixed(0)} yards`
            : `${field.distanceMiles.toFixed(1)} miles`
          : undefined,
      };
    });

    // Enrich fields with full amenity objects
    const enrichedFields = await enrichFieldsWithAmenities(transformedFields);

    // Get user's liked fields if authenticated
    const userId = (req as any).user?.id;
    let userLikedFieldIds: Set<string> = new Set();

    if (userId) {
      const userFavorites = await prisma.favorite.findMany({
        where: { userId },
        select: { fieldId: true }
      });
      userLikedFieldIds = new Set(userFavorites.map(f => f.fieldId));
    }

    // Add isLiked to each field
    const fieldsWithLikeStatus = enrichedFields.map((field: any) => ({
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
  getOwnerField = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const ownerId = (req as any).user.id;

    const field = await FieldModel.findOneByOwner(ownerId);

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
    const enrichedField = await enrichFieldWithAmenities(field);

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
  saveFieldProgress = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const ownerId = (req as any).user.id;
    const { step, data, fieldId: providedFieldId } = req.body;

    // Check if we're updating an existing field or creating a new one
    let fieldId: string;
    let isNewField = false;

    // If fieldId is provided, use it; otherwise find or create a field
    if (providedFieldId) {
      // Verify ownership
      const existingField = await FieldModel.findById(providedFieldId);
      if (!existingField || existingField.ownerId !== ownerId) {
        throw new AppError('Field not found or you do not have permission', 403);
      }
      fieldId = providedFieldId;
    } else {
      // No fieldId provided
      // For steps after field-details, try to find the most recent incomplete field
      // This handles cases where fieldId was lost due to page refresh or state issues
      if (step !== 'field-details') {
        const ownerFields = await FieldModel.findByOwner(ownerId);
        const incompleteField = ownerFields
          .filter((f: any) => !f.isSubmitted)
          .sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];

        if (incompleteField) {
          // Use the most recent incomplete field
          fieldId = incompleteField.id;
          console.log(`[SaveProgress] Using most recent incomplete field ${fieldId} for step ${step}`);
        } else {
          // No incomplete fields found - create a new one
          isNewField = true;
          console.log(`[SaveProgress] No incomplete field found. Creating new field for step ${step}`);
        }
      } else {
        // For field-details step, always create a new field when no fieldId is provided
        isNewField = true;
        console.log(`[SaveProgress] Creating new field for field-details step`);
      }

      // Only create a new field if we didn't find an incomplete one
      if (isNewField) {
        // Prepare initial field data based on the step
        let initialFieldData: any = {
          ownerId,
          isActive: false,
          fieldDetailsCompleted: false,
          uploadImagesCompleted: false,
          pricingAvailabilityCompleted: false,
          bookingRulesCompleted: false,
        };

        // If the first step is field-details, include that data
        if (step === 'field-details') {
          // Validate times are different (no minimum hours requirement)
          if (data.startTime && data.endTime && data.startTime === data.endTime) {
            throw new AppError('Opening and closing times must be different', 400);
          }

          // Convert amenity IDs to names
          const amenityIds = data.amenities && Array.isArray(data.amenities)
            ? data.amenities
            : (typeof data.amenities === 'object'
              ? Object.keys(data.amenities || {}).filter(key => data.amenities[key])
              : []);
          const amenityNames = amenityIds.length > 0 ? await convertAmenityIdsToNames(amenityIds) : [];

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
        const newField = await FieldModel.create(initialFieldData);
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

    let updateData: any = {};

    // Update based on which step is being saved
    switch (step) {
      case 'field-details':
        // Validate times are different (no minimum hours requirement)
        if (data.startTime && data.endTime && data.startTime === data.endTime) {
          throw new AppError('Opening and closing times must be different', 400);
        }

        // Convert amenity IDs to names
        const amenityIdsUpdate = data.amenities && Array.isArray(data.amenities)
          ? data.amenities
          : (typeof data.amenities === 'object'
            ? Object.keys(data.amenities || {}).filter(key => data.amenities[key])
            : []);
        const amenityNamesUpdate = amenityIdsUpdate.length > 0 ? await convertAmenityIdsToNames(amenityIdsUpdate) : [];

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
        let oldImages: string[] = [];
        if (!isNewField) {
          const existingField = await FieldModel.findById(fieldId);
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
              } else {
                const altParts = imageUrl.split(`/${process.env.AWS_S3_BUCKET}/`);
                if (altParts.length > 1) {
                  fileKey = altParts[1];
                }
              }

              if (fileKey) {
                const command = new DeleteObjectCommand({
                  Bucket: process.env.AWS_S3_BUCKET!,
                  Key: fileKey,
                });
                await s3Client.send(command);
                console.log(`[SaveProgress] Deleted image: ${fileKey}`);
              }
            } catch (error) {
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
        } else {
          updateData = {
            images: newImages,
            uploadImagesCompleted: true
          };
        }
        break;

      case 'pricing-availability':
        // Handle price fields - convert empty/null/0 to null
        const price30min = data.price30min === '' || data.price30min === null || data.price30min === undefined || parseFloat(data.price30min) === 0
          ? null
          : parseFloat(data.price30min);
        const price1hr = data.price1hr === '' || data.price1hr === null || data.price1hr === undefined || parseFloat(data.price1hr) === 0
          ? null
          : parseFloat(data.price1hr);

        if (isNewField) {
          updateData = {
            name: 'Untitled Field',
            type: 'PRIVATE',
            price: parseFloat(data.price || data.pricePerHour) || 0, // Legacy field
            price30min,
            price1hr,
            bookingDuration: data.bookingDuration || '30min', // Legacy field
            instantBooking: data.instantBooking || false,
            pricingAvailabilityCompleted: true
          };
        } else {
          updateData = {
            price: parseFloat(data.price || data.pricePerHour) || 0, // Legacy field
            price30min,
            price1hr,
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
        } else {
          updateData = {
            rules: data.rules ? [data.rules] : [],
            cancellationPolicy: data.policies || '',
            bookingRulesCompleted: true
          };
        }
        break;

      default:
        throw new AppError('Invalid step', 400);
    }

    // Update field
    const field = await FieldModel.update(fieldId, updateData);

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
  submitFieldForReview = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const ownerId = (req as any).user.id;
    const { fieldId } = req.body;

    // Get the field - use fieldId if provided, otherwise get first field
    let field;
    if (fieldId) {
      field = await FieldModel.findById(fieldId);
      // Verify ownership
      if (field && field.ownerId !== ownerId) {
        throw new AppError('You can only submit your own fields', 403);
      }
    } else {
      field = await FieldModel.findOneByOwner(ownerId);
    }

    if (!field) {
      throw new AppError('No field found for this owner', 404);
    }

    // Check if all steps are completed
    if (!field.fieldDetailsCompleted ||
      !field.uploadImagesCompleted ||
      !field.pricingAvailabilityCompleted ||
      !field.bookingRulesCompleted) {
      throw new AppError('Please complete all steps before submitting', 400);
    }

    // Submit the field
    const submittedField = await FieldModel.submitField(field.id);

    // Get field owner details for email and notification
    const fieldOwner = await prisma.user.findUnique({
      where: { id: ownerId },
      select: {
        id: true,
        name: true,
        email: true
      }
    });

    if (fieldOwner) {
      // Send email to field owner
      const { emailService } = await import('../services/email.service');
      try {
        await emailService.sendFieldSubmissionEmail({
          email: fieldOwner.email,
          ownerName: fieldOwner.name || 'Field Owner',
          fieldName: submittedField.name || 'Your Field',
          fieldAddress: `${submittedField.address || ''}, ${submittedField.city || ''}, ${submittedField.state || ''}`.trim(),
          submittedAt: submittedField.submittedAt || new Date()
        });
      } catch (emailError) {
        console.error('Failed to send field submission email:', emailError);
        // Don't throw error - email failure shouldn't stop the submission
      }

      // Create notification for field owner
      const { NotificationService } = await import('../services/notification.service');
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
      } catch (notificationError) {
        console.error('Failed to create field owner notification:', notificationError);
      }

      // Create notification for all admins
      try {
        await NotificationService.notifyAdmins(
          'New Field Submission',
          `Field owner ${fieldOwner.name} has submitted a new field: "${submittedField.name}" at ${submittedField.address}, ${submittedField.city}`,
          {
            fieldId: submittedField.id,
            fieldName: submittedField.name,
            ownerId: fieldOwner.id,
            ownerName: fieldOwner.name,
            submittedAt: submittedField.submittedAt
          }
        );
      } catch (adminNotificationError) {
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
  getFieldBookings = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const ownerId = (req as any).user.id;
    const { status = 'all', page = 1, limit = 10 } = req.query;

    try {
      // First get all owner's fields
      const fields = await FieldModel.findByOwner(ownerId);

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
      const fieldIds = fields.map((field: any) => field.id);

      // Get bookings from database
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      let bookingFilter: any = { fieldId: { in: fieldIds } };

      // Filter based on status
      if (status === 'today') {
        bookingFilter.date = {
          gte: today,
          lt: tomorrow
        };
      } else if (status === 'upcoming') {
        bookingFilter.date = {
          gte: tomorrow
        };
      } else if (status === 'previous') {
        bookingFilter.date = {
          lt: today
        };
      }

      const pageNum = Number(page);
      const limitNum = Number(limit);
      const skip = (pageNum - 1) * limitNum;

      // Fetch bookings with user details and count
      const [bookings, totalFilteredBookings] = await Promise.all([
        prisma.booking.findMany({
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
        prisma.booking.count({ where: bookingFilter })
      ]);

      // Calculate total earnings from successful payouts (PAID status only)
      const stripeAccount = await prisma.stripeAccount.findUnique({
        where: { userId: ownerId }
      });

      let totalPaidEarnings = 0;
      if (stripeAccount) {
        const payouts = await prisma.payout.aggregate({
          where: {
            stripeAccountId: stripeAccount.id,
            status: 'paid'
          },
          _sum: {
            amount: true
          }
        });
        totalPaidEarnings = payouts._sum.amount || 0;
      }

      // Get overall stats across all fields
      const totalBookings = await prisma.booking.count({
        where: { fieldId: { in: fieldIds } }
      });

      const todayBookings = await prisma.booking.count({
        where: {
          fieldId: { in: fieldIds },
          date: {
            gte: today,
            lt: tomorrow
          }
        }
      });

      // Format bookings for frontend
      const formattedBookings = bookings.map((booking: any) => ({
        id: booking.id,
        userName: booking.user.name,
        userAvatar: booking.user.image || booking.user.googleImage || null,
        time: `${booking.startTime} - ${booking.endTime}`,
        orderId: generateOrderId(booking),
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
          totalEarnings: totalPaidEarnings
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
    } catch (error) {
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
  getTodayBookings = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const ownerId = (req as any).user.id;
    const { page = 1, limit = 12 } = req.query;

    try {
      // Get default platform commission rate and check for custom commission for this field owner
      const [systemSettings, ownerUser] = await Promise.all([
        prisma.systemSettings.findFirst(),
        prisma.user.findUnique({
          where: { id: ownerId },
          select: { commissionRate: true }
        })
      ]);

      const defaultCommissionRate = systemSettings?.defaultCommissionRate || 20;
      // Check if admin has set a custom commission for this field owner
      const hasCustomCommission = ownerUser?.commissionRate !== null && ownerUser?.commissionRate !== undefined;
      // Use custom rate if set, otherwise use default platform rate
      const effectiveCommissionRate = hasCustomCommission ? ownerUser!.commissionRate! : defaultCommissionRate;

      // First get all owner's fields
      const fields = await FieldModel.findByOwner(ownerId);

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
      const fieldIds = fields.map((field: any) => field.id);

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
        prisma.booking.findMany({
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
        prisma.booking.count({ where: bookingFilter })
      ]);

      // Calculate total earnings from successful payouts (PAID status only)
      const stripeAccount = await prisma.stripeAccount.findUnique({
        where: { userId: ownerId }
      });

      let totalPaidEarnings = 0;
      if (stripeAccount) {
        const payouts = await prisma.payout.aggregate({
          where: {
            stripeAccountId: stripeAccount.id,
            status: 'paid'
          },
          _sum: {
            amount: true
          }
        });
        totalPaidEarnings = payouts._sum.amount || 0;
      }

      // Get overall stats across all fields
      const totalBookings = await prisma.booking.count({ where: { fieldId: { in: fieldIds } } });

      // Format bookings for frontend with fee breakdown
      const formattedBookings = bookings.map((booking: any) => {
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
          } else {
            usedCommissionRate = 0;
          }
        } else {
          // Use dynamic/current rate applied to GROSS booking amount (if not stored)
          platformFee = Math.floor((booking.totalPrice * effectiveCommissionRate) / 100 * 100) / 100;
          usedCommissionRate = effectiveCommissionRate;
        }

        // Field owner earnings - remainder after platform fees
        // Note: Platform commission covers Stripe fees; owner pays commission only.
        let fieldOwnerEarnings = 0;
        if (isLocked && booking.fieldOwnerAmount !== null && booking.fieldOwnerAmount !== undefined) {
          fieldOwnerEarnings = booking.fieldOwnerAmount;
        } else {
          fieldOwnerEarnings = Math.floor((booking.totalPrice - platformFee - stripeFee) * 100) / 100;
        }

        return {
          id: booking.id,
          userId: booking.user.id,
          userName: booking.user.name,
          userAvatar: booking.user.image || booking.user.googleImage || null,
          userEmail: booking.user.email,
          userPhone: booking.user.phone,
          time: `${booking.startTime} - ${booking.endTime}`,
          orderId: generateOrderId(booking),
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
          totalEarnings: totalPaidEarnings
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
    } catch (error) {
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
  getUpcomingBookings = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const ownerId = (req as any).user.id;
    const { page = 1, limit = 12 } = req.query;

    try {
      // Get default platform commission rate and check for custom commission for this field owner
      const [systemSettings, ownerUser] = await Promise.all([
        prisma.systemSettings.findFirst(),
        prisma.user.findUnique({
          where: { id: ownerId },
          select: { commissionRate: true }
        })
      ]);

      const defaultCommissionRate = systemSettings?.defaultCommissionRate || 20;
      // Check if admin has set a custom commission for this field owner
      const hasCustomCommission = ownerUser?.commissionRate !== null && ownerUser?.commissionRate !== undefined;
      // Use custom rate if set, otherwise use default platform rate
      const effectiveCommissionRate = hasCustomCommission ? ownerUser!.commissionRate! : defaultCommissionRate;

      // First get all owner's fields
      const fields = await FieldModel.findByOwner(ownerId);

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
      const fieldIds = fields.map((field: any) => field.id);

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
        prisma.booking.findMany({
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
        prisma.booking.count({ where: bookingFilter })
      ]);

      // Calculate total earnings from successful payouts (PAID status only)
      const stripeAccount = await prisma.stripeAccount.findUnique({
        where: { userId: ownerId }
      });

      let totalPaidEarnings = 0;
      if (stripeAccount) {
        const payouts = await prisma.payout.aggregate({
          where: {
            stripeAccountId: stripeAccount.id,
            status: 'paid'
          },
          _sum: {
            amount: true
          }
        });
        totalPaidEarnings = payouts._sum.amount || 0;
      }

      // Get overall stats across all fields
      const [totalBookings, todayBookings] = await Promise.all([
        prisma.booking.count({ where: { fieldId: { in: fieldIds } } }),
        prisma.booking.count({
          where: {
            fieldId: { in: fieldIds },
            date: {
              gte: today,
              lt: tomorrow
            }
          }
        })
      ]);

      // Format bookings for frontend with fee breakdown
      const formattedBookings = bookings.map((booking: any) => {
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
          } else {
            usedCommissionRate = 0;
          }
        } else {
          // Use dynamic/current rate applied to GROSS booking amount (if not stored)
          platformFee = Math.floor((booking.totalPrice * effectiveCommissionRate) / 100 * 100) / 100;
          usedCommissionRate = effectiveCommissionRate;
        }

        // Field owner earnings - remainder after platform fees
        // Note: Platform commission covers Stripe fees; owner pays commission only.
        let fieldOwnerEarnings = 0;
        if (isLocked && booking.fieldOwnerAmount !== null && booking.fieldOwnerAmount !== undefined) {
          fieldOwnerEarnings = booking.fieldOwnerAmount;
        } else {
          fieldOwnerEarnings = Math.floor((booking.totalPrice - platformFee) * 100) / 100;
        }

        return {
          id: booking.id,
          userId: booking.user.id,
          userName: booking.user.name,
          userAvatar: booking.user.image || booking.user.googleImage || null,
          userEmail: booking.user.email,
          userPhone: booking.user.phone,
          time: `${booking.startTime} - ${booking.endTime}`,
          orderId: generateOrderId(booking),
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
          totalEarnings: totalPaidEarnings
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
    } catch (error) {
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
  getCompletedBookings = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const ownerId = (req as any).user.id;
    const { page = 1, limit = 12 } = req.query;

    try {
      // Get default platform commission rate and check for custom commission for this field owner
      const [systemSettings, ownerUser] = await Promise.all([
        prisma.systemSettings.findFirst(),
        prisma.user.findUnique({
          where: { id: ownerId },
          select: { commissionRate: true }
        })
      ]);

      const defaultCommissionRate = systemSettings?.defaultCommissionRate || 20;
      // Check if admin has set a custom commission for this field owner
      const hasCustomCommission = ownerUser?.commissionRate !== null && ownerUser?.commissionRate !== undefined;
      // Use custom rate if set, otherwise use default platform rate
      const effectiveCommissionRate = hasCustomCommission ? ownerUser!.commissionRate! : defaultCommissionRate;

      // First get all owner's fields
      const fields = await FieldModel.findByOwner(ownerId);

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
      const fieldIds = fields.map((field: any) => field.id);

      // Get completed bookings only (status = COMPLETED)
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const bookingFilter = {
        fieldId: { in: fieldIds },
        status: 'COMPLETED' as const // Only completed bookings
      };

      const pageNum = Number(page);
      const limitNum = Number(limit);
      const skip = (pageNum - 1) * limitNum;

      // Fetch bookings with user and field details and count
      const [bookings, totalFilteredBookings] = await Promise.all([
        prisma.booking.findMany({
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
        prisma.booking.count({ where: bookingFilter })
      ]);

      // Calculate total earnings from successful payouts (PAID status only)
      const stripeAccount = await prisma.stripeAccount.findUnique({
        where: { userId: ownerId }
      });

      let totalPaidEarnings = 0;
      if (stripeAccount) {
        const payouts = await prisma.payout.aggregate({
          where: {
            stripeAccountId: stripeAccount.id,
            status: 'paid'
          },
          _sum: {
            amount: true
          }
        });
        totalPaidEarnings = payouts._sum.amount || 0;
      }

      // Get overall stats across all fields
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const [totalBookings, todayBookings] = await Promise.all([
        prisma.booking.count({ where: { fieldId: { in: fieldIds } } }),
        prisma.booking.count({
          where: {
            fieldId: { in: fieldIds },
            date: {
              gte: today,
              lt: tomorrow
            }
          }
        })
      ]);

      // Format bookings for frontend with fee breakdown
      const formattedBookings = bookings.map((booking: any) => {
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
          } else {
            usedCommissionRate = 0;
          }
        } else {
          // Use dynamic/current rate applied to GROSS booking amount (if not stored)
          platformFee = Math.floor((booking.totalPrice * effectiveCommissionRate) / 100 * 100) / 100;
          usedCommissionRate = effectiveCommissionRate;
        }

        // Field owner earnings - remainder after platform fees
        // Note: Platform commission covers Stripe fees; owner pays commission only.
        let fieldOwnerEarnings = 0;
        if (booking.fieldOwnerAmount !== null && booking.fieldOwnerAmount !== undefined) {
          fieldOwnerEarnings = booking.fieldOwnerAmount;
        } else {
          fieldOwnerEarnings = Math.floor((booking.totalPrice - platformFee) * 100) / 100;
        }

        return {
          id: booking.id,
          userId: booking.user.id,
          userName: booking.user.name,
          userAvatar: booking.user.image || booking.user.googleImage || null,
          userEmail: booking.user.email,
          userPhone: booking.user.phone,
          time: `${booking.startTime} - ${booking.endTime}`,
          orderId: generateOrderId(booking),
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
          totalEarnings: totalPaidEarnings
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
    } catch (error) {
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
  getRecentBookings = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const ownerId = (req as any).user.id;
    const { limit = 5 } = req.query;
    const limitNum = Number(limit);

    try {
      // First get the owner's field
      const fields = await FieldModel.findByOwner(ownerId);

      if (!fields || fields.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'No field found for this owner',
          bookings: []
        });
      }

      const fieldId = fields[0].id;

      // Get recent bookings
      const bookings = await prisma.booking.findMany({
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

    } catch (error) {
      console.error('Error fetching recent bookings:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch recent bookings',
        bookings: []
      });
    }
  });

  // Get fields available for claiming
  getFieldForClaim = asyncHandler(async (req: Request, res: Response) => {
    const fields = await prisma.field.findMany({
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
  claimField = asyncHandler(async (req: Request, res: Response) => {
    const { fieldId } = req.body;
    const userId = (req as any).user.id;

    if (!fieldId) {
      return res.status(400).json({
        success: false,
        message: 'Field ID is required'
      });
    }

    // Check if field exists and is not already claimed
    const field = await prisma.field.findUnique({
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
    const updatedField = await prisma.field.update({
      where: { id: fieldId },
      data: {
        isClaimed: true,
        ownerId: userId,
        ownerName: (req as any).user.name || (req as any).user.email,
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
  approveField = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { fieldId } = req.params;
    const adminId = (req as any).user.id;
    const userRole = (req as any).user.role;

    // Only admins can approve fields
    if (userRole !== 'ADMIN') {
      throw new AppError('Only admins can approve fields', 403);
    }

    // Get field details
    const field = await prisma.field.findUnique({
      where: { id: fieldId },
      include: {
        owner: true
      }
    });

    if (!field) {
      throw new AppError('Field not found', 404);
    }

    // Check if field is already approved
    if (field.isApproved) {
      throw new AppError('Field is already approved', 400);
    }

    // Update field approval status
    const approvedField = await prisma.field.update({
      where: { id: fieldId },
      data: {
        isApproved: true,
        isActive: true // Make field active when approved
      }
    });

    // Create notification for field owner
    await prisma.notification.create({
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
      const { emailService } = await import('../services/email.service');

      // Get field address
      let fieldAddress = '';
      if (field.location && typeof field.location === 'object') {
        const loc = field.location as any;
        fieldAddress = loc.formatted_address || loc.streetAddress || field.address || '';
      } else {
        fieldAddress = field.address || '';
      }

      await emailService.sendFieldApprovalEmail({
        email: field.owner.email,
        ownerName: field.owner.name || field.owner.email,
        fieldName: field.name || 'Your Field',
        fieldAddress: fieldAddress
      });
    } catch (emailError) {
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
  rejectField = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { fieldId } = req.params;
    const { rejectionReason } = req.body;
    const adminId = (req as any).user.id;
    const userRole = (req as any).user.role;

    // Only admins can reject fields
    if (userRole !== 'ADMIN') {
      throw new AppError('Only admins can reject fields', 403);
    }

    // Get field details
    const field = await prisma.field.findUnique({
      where: { id: fieldId },
      include: {
        owner: true
      }
    });

    if (!field) {
      throw new AppError('Field not found', 404);
    }

    // Update field rejection status - only change isApproved (isActive is field-owner controlled)
    const rejectedField = await prisma.field.update({
      where: { id: fieldId },
      data: {
        isApproved: false,
        rejectionReason: rejectionReason || 'Field did not meet our approval criteria',
      }
    });

    // Create notification for field owner
    await prisma.notification.create({
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
  getPendingFields = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const userRole = (req as any).user.role;
    const { page = 1, limit = 10 } = req.query;

    // Only admins can view pending fields
    if (userRole !== 'ADMIN') {
      throw new AppError('Only admins can view pending fields', 403);
    }

    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;

    const [fields, total] = await Promise.all([
      prisma.field.findMany({
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
      prisma.field.count({
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
  getPriceRange = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    // Get all approved and active fields with prices
    const fields = await prisma.field.findMany({
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
      const prices = fields.map(f => f.price).filter((p): p is number => p !== null);
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
  getFieldDetailsForAdmin = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    const isObjectId = id.length === 24 && /^[0-9a-fA-F]+$/.test(id);
    const where = isObjectId ? { id } : { fieldId: id };

    // Get field with owner and booking details
    const field = await prisma.field.findUnique({
      where,
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
      throw new AppError('Field not found', 404);
    }

    // Calculate total earnings from paid bookings for this specific field
    const fieldBookings = await prisma.booking.findMany({
      where: {
        fieldId: field.id,
        paymentStatus: 'PAID'
      },
      select: { id: true, totalPrice: true, fieldOwnerAmount: true, platformCommission: true }
    });

    // totalOwnerEarnings = sum of field owner's share from each paid booking
    const totalOwnerEarnings = Math.floor(fieldBookings.reduce((sum, b) => {
      if (b.fieldOwnerAmount) return sum + b.fieldOwnerAmount;
      // Fallback: totalPrice minus platform commission (default 20%)
      const commission = b.platformCommission || (b.totalPrice * 0.2);
      return sum + (b.totalPrice - commission);
    }, 0) * 100) / 100;

    // totalEarnings = sum of total booking revenue (gross amount paid by customers)
    const totalEarnings = Math.floor(fieldBookings.reduce((sum, b) => sum + (b.totalPrice || 0), 0) * 100) / 100;

    const normalizePriceValue = (value: any): number | null => {
      if (value === null || value === undefined) return null;
      const numericValue = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(numericValue) ? numericValue : null;
    };

    let legacyHourlyPrice: number | null = null;
    if ((field.price === null || field.price === undefined) && ObjectId.isValid(id)) {
      try {
        const rawResult: any = await prisma.$runCommandRaw({
          find: 'fields',
          filter: { _id: new ObjectId(id) },
          projection: { pricePerHour: 1 },
        });

        const rawField = rawResult?.cursor?.firstBatch?.[0];
        if (rawField && rawField.pricePerHour !== undefined && rawField.pricePerHour !== null) {
          legacyHourlyPrice = normalizePriceValue(rawField.pricePerHour);
        }
      } catch (legacyPriceError) {
        console.warn(`Failed to fetch legacy pricePerHour for field ${id}:`, legacyPriceError?.message || legacyPriceError);
      }
    }

    const normalizedHourlyPrice = normalizePriceValue(field.price ?? legacyHourlyPrice);
    const normalizedDailyPrice = normalizePriceValue(field.pricePerDay);

    // Transform amenities to objects with icons
    const amenityObjects = await transformAmenitiesToObjects(field.amenities || []);
    const amenitiesWithIcons = amenityObjects.map((amenity) => ({
      id: amenity.id,
      label: amenity.label,
      value: amenity.value,
      iconUrl: amenity.iconUrl ?? null,
    }));

    // Parse and format booking policies from cancellationPolicy field or use defaults
    let bookingPolicies: string[] = [];
    if (field.cancellationPolicy) {
      // If cancellationPolicy is a string, try to parse it
      if (typeof field.cancellationPolicy === 'string') {
        try {
          // Try parsing as JSON first
          const parsed = JSON.parse(field.cancellationPolicy);
          if (Array.isArray(parsed)) {
            bookingPolicies = parsed.filter(p => p && p.trim().length > 0);
          } else if (typeof parsed === 'string') {
            // Split by newlines or periods
            bookingPolicies = parsed.split(/[\n.]/).map(p => p.trim()).filter(p => p.length > 0);
          }
        } catch {
          // If not JSON, split by newlines or periods
          bookingPolicies = field.cancellationPolicy.split(/[\n.]/).map(p => p.trim()).filter(p => p.length > 0);
        }
      } else if (Array.isArray(field.cancellationPolicy)) {
        bookingPolicies = field.cancellationPolicy.filter(p => p && p.trim && p.trim().length > 0);
      }
    }

    // Use defaults if no policies found
    if (bookingPolicies.length === 0) {
      bookingPolicies = [
        // 'All bookings must be made at least 24 hours in advance',
        'The minimum booking slot is 1 hour',
        'Free cancellation up to 12 hours before the scheduled start time',
        'Users arriving late will not receive a time extension',
        'If the client does not arrive within 15 minutes of the booking start time, the booking will be marked as non-show and charged in full',
        'Bookings may be subject to blackout list booking nights'
      ];
    }

    // Parse and format safety rules from rules field
    let safetyRules: string[] = [];
    if (field.rules && Array.isArray(field.rules) && field.rules.length > 0) {
      if (field.rules.length === 1 && typeof field.rules[0] === 'string') {
        // Single string with multiple rules - split by periods or newlines
        const rulesString = field.rules[0];
        safetyRules = rulesString
          .split(/[.\n]/)
          .map((rule: string) => rule.trim())
          .filter((rule: string) => rule.length > 0);
      } else {
        // Already an array of rules
        safetyRules = field.rules.filter((rule: any) => rule && typeof rule === 'string' && rule.trim().length > 0);
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

  // Update entry code for a field (Field owner only)
  updateEntryCode = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { fieldId } = req.params;
    const { entryCode } = req.body;
    const userId = (req as any).user.id;

    if (!entryCode || typeof entryCode !== 'string') {
      throw new AppError('Entry code is required and must be a string', 400);
    }

    // Validate entry code format (alphanumeric, 4-10 characters)
    const trimmedCode = entryCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,10}$/.test(trimmedCode)) {
      throw new AppError('Entry code must be 4-10 alphanumeric characters', 400);
    }

    // Resolve field (support both ObjectID and human-readable fieldId)
    const isObjectId = fieldId.length === 24 && /^[0-9a-fA-F]+$/.test(fieldId);
    const where = isObjectId ? { id: fieldId } : { fieldId: fieldId };

    const field = await prisma.field.findUnique({
      where,
      select: {
        id: true,
        name: true,
        ownerId: true,
        entryCode: true,
        address: true
      }
    });

    if (!field) {
      throw new AppError('Field not found', 404);
    }

    // Verify ownership
    if (field.ownerId !== userId) {
      throw new AppError('You do not have permission to update this field', 403);
    }

    const previousCode = field.entryCode;

    // Update the entry code
    const updatedField = await prisma.field.update({
      where: { id: field.id },
      data: { entryCode: trimmedCode }
    });

    // If entry code actually changed, notify dog owners with upcoming bookings
    if (previousCode !== trimmedCode) {
      try {
        // Get all upcoming bookings for this field
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const upcomingBookings = await prisma.booking.findMany({
          where: {
            fieldId: field.id,
            date: { gte: today },
            status: { in: ['CONFIRMED', 'PENDING'] }
          },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true
              }
            }
          }
        });

        // Get unique users who have upcoming bookings
        const usersToNotify = new Map<string, { email: string; name: string; bookingDates: Date[] }>();
        for (const booking of upcomingBookings) {
          if (booking.user?.email) {
            const existing = usersToNotify.get(booking.user.id);
            if (existing) {
              existing.bookingDates.push(booking.date);
            } else {
              usersToNotify.set(booking.user.id, {
                email: booking.user.email,
                name: booking.user.name || 'Valued Customer',
                bookingDates: [booking.date]
              });
            }
          }
        }

        // Send emails to all affected users
        const { emailService } = await import('../services/email.service');
        for (const [, userData] of usersToNotify) {
          try {
            await emailService.sendEntryCodeUpdateNotification({
              email: userData.email,
              userName: userData.name,
              fieldName: field.name || 'the field',
              fieldAddress: field.address || '',
              newEntryCode: trimmedCode,
              upcomingBookingDates: userData.bookingDates
            });
          } catch (emailError) {
            console.error(`Failed to send entry code update email to ${userData.email}:`, emailError);
            // Continue with other users even if one fails
          }
        }

        console.log(`✅ Entry code updated for field ${field.id}. Notified ${usersToNotify.size} users with upcoming bookings.`);
      } catch (notifyError) {
        console.error('Error notifying users about entry code change:', notifyError);
        // Don't fail the update if notification fails
      }
    }

    res.status(200).json({
      success: true,
      message: 'Entry code updated successfully',
      data: {
        fieldId: field.id,
        entryCode: trimmedCode,
        previousCode: previousCode || null
      }
    });
  });

  /**
   * Get Google Reviews for a field
   * Fetches scraped Google reviews from the database
   */
  getGoogleReviews = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    // Get the field
    const field = await prisma.field.findFirst({
      where: {
        OR: [
          { id: id.length === 24 && /^[0-9a-fA-F]+$/.test(id) ? id : undefined },
          { fieldId: id }
        ].filter(Boolean)
      },
      select: {
        id: true,
        name: true
      }
    });

    if (!field) {
      throw new AppError('Field not found', 404);
    }

    try {
      // Fetch Google reviews from database
      const reviews = await prisma.googleReview.findMany({
        where: { fieldId: field.id },
        orderBy: { createdAt: 'desc' }
      });

      // Calculate average rating
      const totalReviews = reviews.length;
      const averageRating = totalReviews > 0
        ? reviews.reduce((sum, review) => sum + review.rating, 0) / totalReviews
        : 0;

      // Format reviews for frontend
      const formattedReviews = reviews.map(review => ({
        authorName: review.authorName,
        authorPhoto: review.authorPhoto,
        rating: review.rating,
        text: review.text,
        relativeTime: review.reviewTime
      }));

      res.status(200).json({
        success: true,
        data: {
          reviews: formattedReviews,
          averageRating: Math.round(averageRating * 10) / 10,
          totalReviews
        }
      });
    } catch (error) {
      console.error('Error fetching Google reviews:', error);
      res.status(200).json({
        success: true,
        data: {
          reviews: [],
          averageRating: 0,
          totalReviews: 0,
          message: 'Error fetching Google reviews'
        }
      });
    }
  });
}

export default new FieldController();
