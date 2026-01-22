//@ts-nocheck
import prisma from '../config/database';
import {
  isValidUKPostcode,
  formatUKPostcode,
  isPartialPostcode,
  getPostcodeOutwardCode,
  getPostcodeDistrict,
  getPostcodeArea
} from '../utils/postcode.utils';

// Helper function to check if an image URL is valid (not placeholder, not empty)
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

export interface CreateFieldInput {
  name?: string;
  description?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  latitude?: number;
  longitude?: number;
  ownerId: string;
  type?: 'PRIVATE' | 'PUBLIC' | 'TRAINING';
  size?: string;
  customFieldSize?: string;
  terrainType?: string;
  price?: number; // Legacy field - kept for backward compatibility
  price30min?: number; // Price for 30 minute booking slot
  price1hr?: number; // Price for 1 hour booking slot
  bookingDuration?: string; // Legacy field - kept for backward compatibility
  amenities?: string[];
  rules?: string[];
  images?: string[];
  maxDogs?: number;
  numberOfDogs?: number;
  openingTime?: string;
  closingTime?: string;
  operatingDays?: string[];
  instantBooking?: boolean;
  cancellationPolicy?: string;
  fieldFeatures?: any;
  fieldDetailsCompleted?: boolean;
  uploadImagesCompleted?: boolean;
  pricingAvailabilityCompleted?: boolean;
  bookingRulesCompleted?: boolean;
  isSubmitted?: boolean;
  submittedAt?: Date;
  isClaimed?: boolean;
  ownerName?: string;
  joinedOn?: string;
  entryCode?: string;
}

class FieldModel {
  // Helper to translate fieldId (human or ObjectID) to internal ObjectID
  async resolveId(id: string): Promise<string> {
    if (!id) return id;

    // Check if it's already an ObjectID
    const isObjectId = id.length === 24 && /^[0-9a-fA-F]+$/.test(id);
    if (isObjectId) return id;

    // Look up by human-readable fieldId
    const field = await prisma.field.findUnique({
      where: { fieldId: id },
      select: { id: true }
    });

    return field ? field.id : id;
  }

  // Helper to generate public field ID
  async generateFieldId(): Promise<string> {
    const counter = await prisma.counter.upsert({
      where: { name: 'field' },
      update: { value: { increment: 1 } },
      create: { name: 'field', value: 1111 },
    });
    return `F${counter.value}`;
  }

  // Create a new field
  async create(data: CreateFieldInput) {
    // Get owner details if not provided
    let ownerName = data.ownerName;
    let joinedOn = data.joinedOn;

    if ((!ownerName || !joinedOn) && data.ownerId) {
      const owner = await prisma.user.findUnique({
        where: { id: data.ownerId },
        select: { name: true, createdAt: true },
      });

      if (owner) {
        ownerName = ownerName || owner.name || undefined;
        // Format joinedOn as "Month Year" if not provided
        if (!joinedOn && owner.createdAt) {
          const date = new Date(owner.createdAt);
          const month = date.toLocaleDateString('en-US', { month: 'long' });
          const year = date.getFullYear();
          joinedOn = `${month} ${year}`;
        }
      }
    }

    // Remove apartment field as it doesn't exist in the schema
    const { apartment, ...cleanedData } = data as any;

    // Generate human-friendly field ID
    const fieldId = await this.generateFieldId();

    return prisma.field.create({
      data: {
        ...cleanedData,
        fieldId,
        ownerName,
        joinedOn,
        type: cleanedData.type || 'PRIVATE',
        maxDogs: cleanedData.maxDogs || 10,
        instantBooking: cleanedData.instantBooking || false,
      },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }

  // Find field by ID
  async findById(id: string) {
    try {
      const isObjectId = id.length === 24 && /^[0-9a-fA-F]+$/.test(id);
      const where = isObjectId ? { id } : { fieldId: id };

      // First, try to fetch with owner relation
      return await prisma.field.findUnique({
        where,
        include: {
          owner: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
          reviews: {
            include: {
              user: {
                select: {
                  name: true,
                  image: true,
                },
              },
            },
          },
          _count: {
            select: {
              bookings: true,
              reviews: true,
              favorites: true,
            },
          },
        },
      });
    } catch (error) {
      // If owner relation fails (orphaned field), fetch without owner
      console.warn(`Field ${id} has invalid owner reference or retrieval error, fetching without owner relation`);

      const isObjectId = id.length === 24 && /^[0-9a-fA-F]+$/.test(id);
      const where = isObjectId ? { id } : { fieldId: id };

      const field = await prisma.field.findUnique({
        where,
        include: {
          reviews: {
            include: {
              user: {
                select: {
                  name: true,
                  image: true,
                },
              },
            },
          },
          _count: {
            select: {
              bookings: true,
              reviews: true,
              favorites: true,
            },
          },
        },
      });

      if (!field) return null;

      // Return field with null owner (using denormalized ownerName instead)
      return {
        ...field,
        owner: null,
      };
    }
  }

  // Find field by ID with minimal data (optimized for SSG/ISR builds)
  async findByIdMinimal(id: string) {
    try {
      const isObjectId = id.length === 24 && /^[0-9a-fA-F]+$/.test(id);
      const where = isObjectId ? { id } : { fieldId: id };

      return await prisma.field.findUnique({
        where,
        select: {
          id: true,
          fieldId: true,
          name: true,
          description: true,
          location: true,
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
          bookingDuration: true,
          images: true,
          size: true,
          customFieldSize: true,
          type: true,
          terrainType: true,
          surfaceType: true,
          fenceType: true,
          fenceSize: true,
          maxDogs: true,
          amenities: true,
          rules: true,
          cancellationPolicy: true,
          openingTime: true,
          closingTime: true,
          operatingDays: true,
          instantBooking: true,
          isActive: true,
          isClaimed: true,
          ownerName: true,
          joinedOn: true,
          ownerId: true,
          averageRating: true,
          totalReviews: true,
          isApproved: true,
          isSubmitted: true,
          createdAt: true,
          updatedAt: true,
          owner: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
          _count: {
            select: {
              reviews: true,
            },
          },
        },
      });
    } catch (error) {
      // If owner relation fails, fetch without owner
      console.warn(`Field ${id} has invalid owner reference or retrieval error, fetching without owner relation`);

      const isObjectId = id.length === 24 && /^[0-9a-fA-F]+$/.test(id);
      const where = isObjectId ? { id } : { fieldId: id };

      return await prisma.field.findUnique({
        where,
        select: {
          id: true,
          fieldId: true,
          name: true,
          description: true,
          location: true,
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
          bookingDuration: true,
          images: true,
          size: true,
          customFieldSize: true,
          type: true,
          terrainType: true,
          surfaceType: true,
          fenceType: true,
          fenceSize: true,
          maxDogs: true,
          amenities: true,
          rules: true,
          cancellationPolicy: true,
          openingTime: true,
          closingTime: true,
          operatingDays: true,
          instantBooking: true,
          isActive: true,
          isClaimed: true,
          ownerName: true,
          joinedOn: true,
          ownerId: true,
          averageRating: true,
          totalReviews: true,
          isApproved: true,
          isSubmitted: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              reviews: true,
            },
          },
        },
      });
    }
  }

  // Find all fields with filters and pagination
  async findAll(filters: {
    search?: string;
    zipCode?: string;
    lat?: number;
    lng?: number;
    city?: string;
    state?: string;
    type?: string;
    minPrice?: number;
    maxPrice?: number;
    amenities?: string[];
    minRating?: number;
    maxDistance?: number;
    date?: Date;
    startTime?: string;
    endTime?: string;
    numberOfDogs?: number;
    size?: string;
    terrainType?: string;
    fenceType?: string;
    instantBooking?: boolean;
    availability?: string[]; // Morning, Afternoon, Evening
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    skip?: number;
    take?: number;
  }) {
    const { skip = 0, take = 10, sortBy = 'createdAt', sortOrder = 'desc', ...where } = filters;

    const whereClause: any = {
      isActive: true,
      isSubmitted: true,
      isApproved: true, // Field must be approved by admin
      isBlocked: false // Exclude blocked fields
    };

    // Exclude fields from blocked field owners
    try {
      const blockedOwners = await prisma.user.findMany({
        where: {
          role: 'FIELD_OWNER',
          isBlocked: true
        },
        select: { id: true }
      });

      if (blockedOwners.length > 0) {
        whereClause.ownerId = {
          notIn: blockedOwners.map(owner => owner.id)
        };
      }
    } catch (error: any) {
      // If query fails, log but continue without this filter
      console.warn('Warning: Could not fetch blocked field owners:', error.message);
    }

    // Handle comprehensive search (field name, address, city, state, zipCode)
    if (where.search) {
      // Check if search term might be a UK postcode
      const isPostcode = isValidUKPostcode(where.search) || isPartialPostcode(where.search);

      if (isPostcode) {
        // If it's a postcode, search for matching postcodes
        const formattedPostcode = formatUKPostcode(where.search);
        const searchConditions: any[] = [];

        // Search for exact match (formatted)
        if (formattedPostcode) {
          searchConditions.push({ zipCode: formattedPostcode });
          searchConditions.push({ zipCode: formattedPostcode.replace(' ', '') });
        }

        // Search for partial matches (outward code, district, area)
        if (isPartialPostcode(where.search)) {
          const searchUpper = where.search.toUpperCase().trim();

          // Starts with partial postcode
          searchConditions.push({
            zipCode: {
              startsWith: searchUpper,
              mode: 'insensitive'
            }
          });

          // Contains partial postcode (for formatted postcodes with space)
          searchConditions.push({
            zipCode: {
              contains: searchUpper,
              mode: 'insensitive'
            }
          });
        }

        whereClause.OR = searchConditions;
      } else {
        // Regular search for non-postcode terms
        whereClause.OR = [
          { name: { contains: where.search, mode: 'insensitive' } },
          { description: { contains: where.search, mode: 'insensitive' } },
          { address: { contains: where.search, mode: 'insensitive' } },
          { city: { contains: where.search, mode: 'insensitive' } },
          { state: { contains: where.search, mode: 'insensitive' } },
          { zipCode: { contains: where.search, mode: 'insensitive' } },
        ];
      }
    }

    // Handle specific postal code search
    if (where.zipCode) {
      // Check if it's a UK postcode format
      const isUKPostcode = isValidUKPostcode(where.zipCode) || isPartialPostcode(where.zipCode);

      if (isUKPostcode) {
        const formattedPostcode = formatUKPostcode(where.zipCode);

        if (formattedPostcode) {
          // Search for exact match (both with and without space)
          whereClause.OR = [
            { zipCode: formattedPostcode },
            { zipCode: formattedPostcode.replace(' ', '') }
          ];
        } else if (isPartialPostcode(where.zipCode)) {
          // For partial postcodes, search for fields that start with this pattern
          const searchUpper = where.zipCode.toUpperCase().trim();
          whereClause.zipCode = {
            startsWith: searchUpper,
            mode: 'insensitive'
          };
        }
      } else {
        // Regular zipCode search for non-UK formats
        whereClause.zipCode = where.zipCode;
      }
    }

    // Note: We don't filter by lat/lng in the database query.
    // Instead, we fetch ALL fields and calculate distance in the controller.
    // This ensures fields without coordinates are still returned (they just won't have distanceMiles).
    // The lat/lng parameters are used by the controller for distance calculation only.

    if (where.city) whereClause.city = where.city;
    if (where.state) whereClause.state = where.state;
    if (where.type) whereClause.type = where.type;

    // Price filter - check against price30min (the lower/starting price)
    // If price30min is not set, fall back to legacy price field
    if (where.minPrice || where.maxPrice) {
      whereClause.OR = [
        // Check price30min field
        ...(where.minPrice && where.maxPrice ? [{
          price30min: { gte: where.minPrice, lte: where.maxPrice }
        }] : where.minPrice ? [{
          price30min: { gte: where.minPrice }
        }] : [{
          price30min: { lte: where.maxPrice }
        }]),
        // Fall back to legacy price field if price30min is null
        ...(where.minPrice && where.maxPrice ? [{
          AND: [
            { price30min: null },
            { price: { gte: where.minPrice, lte: where.maxPrice } }
          ]
        }] : where.minPrice ? [{
          AND: [
            { price30min: null },
            { price: { gte: where.minPrice } }
          ]
        }] : [{
          AND: [
            { price30min: null },
            { price: { lte: where.maxPrice } }
          ]
        }])
      ];
    }

    // Amenities filter
    if (where.amenities && where.amenities.length > 0) {
      whereClause.amenities = {
        hasEvery: where.amenities,
      };
    }

    // Rating filter
    if (where.minRating) {
      whereClause.averageRating = {
        gte: where.minRating,
      };
    }

    // Number of dogs filter
    if (where.numberOfDogs) {
      whereClause.maxDogs = {
        gte: where.numberOfDogs,
      };
    }

    // Size filter - also include fields with custom sizes that match the category
    // Size categories: small (≤1 acre), medium (1-3 acres), large (3+ acres)
    // We'll handle this after the query to include custom field sizes
    const sizeFilter = where.size;

    // Terrain type filter
    if (where.terrainType) {
      whereClause.terrainType = where.terrainType;
    }

    // Fence type filter
    if (where.fenceType) {
      whereClause.fenceType = where.fenceType;
    }

    // Instant booking filter
    if (where.instantBooking !== undefined) {
      whereClause.instantBooking = where.instantBooking;
    }

    // Date and time availability filter
    // Step 1: Filter by operating day
    let fieldsWithAvailability: string[] | undefined = undefined;

    if (where.date) {
      const dayOfWeek = new Date(where.date).toLocaleDateString('en-US', { weekday: 'long' });

      // Don't add operating days to whereClause - we'll check ALL fields manually
      // This ensures we scan every field for availability

      // Step 2: Check which fields have available slots on this specific date
      // Get start and end of the selected date
      const selectedDate = new Date(where.date);
      // Normalize the date to start of day in UTC
      const startOfDay = new Date(Date.UTC(
        selectedDate.getUTCFullYear(),
        selectedDate.getUTCMonth(),
        selectedDate.getUTCDate(),
        0, 0, 0, 0
      ));
      const endOfDay = new Date(Date.UTC(
        selectedDate.getUTCFullYear(),
        selectedDate.getUTCMonth(),
        selectedDate.getUTCDate(),
        23, 59, 59, 999
      ));

      console.log('🔍 Date range for bookings:', { startOfDay, endOfDay });

      // Get ALL active approved fields (don't filter by operating days - we'll check that per field)
      const candidateFields = await prisma.field.findMany({
        where: {
          isActive: true,
          isSubmitted: true,
          isApproved: true,
          isBlocked: false,
        },
        select: {
          id: true,
          name: true,
          openingTime: true,
          closingTime: true,
          bookingDuration: true,
          operatingDays: true,
        },
      });


      // For each field, check if it operates on this day AND has at least one available slot
      fieldsWithAvailability = [];

      for (const field of candidateFields) {
        // First check if this field operates on the selected day
        // Need to expand "everyday", "weekdays", "weekends" to actual days
        const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
        const weekends = ['Saturday', 'Sunday'];

        let fieldOperatesOnThisDay = false;
        if (field.operatingDays) {
          for (const opDay of field.operatingDays) {
            if (opDay === 'everyday') {
              fieldOperatesOnThisDay = true;
              break;
            } else if (opDay === 'weekdays' && weekdays.includes(dayOfWeek)) {
              fieldOperatesOnThisDay = true;
              break;
            } else if (opDay === 'weekends' && weekends.includes(dayOfWeek)) {
              fieldOperatesOnThisDay = true;
              break;
            } else if (opDay === dayOfWeek) {
              // Direct day name match (in case individual days are stored)
              fieldOperatesOnThisDay = true;
              break;
            }
          }
        }

        if (!fieldOperatesOnThisDay) {
          continue;
        }

        // Get all CONFIRMED bookings for this field on this date
        const bookings = await prisma.booking.findMany({
          where: {
            fieldId: field.id,
            date: {
              gte: startOfDay,
              lte: endOfDay,
            },
            status: 'CONFIRMED',
          },
          select: {
            startTime: true,
            endTime: true,
          },
        });

        // Generate all possible time slots for this field
        const openTime = field.openingTime || '06:00';
        const closeTime = field.closingTime || '22:00';
        // Use 30 min slots as the base duration since all fields now support both 30min and 1hr bookings
        const slotDuration = 30;

        // Convert time string to minutes
        const timeToMinutes = (timeStr: string): number => {
          const [hours, minutes] = timeStr.split(':').map(Number);
          return hours * 60 + (minutes || 0);
        };

        const openMinutes = timeToMinutes(openTime);
        const closeMinutes = timeToMinutes(closeTime);

        // Generate all possible slots
        const allSlots: Array<{ start: number; end: number }> = [];
        for (let time = openMinutes; time < closeMinutes; time += slotDuration) {
          allSlots.push({
            start: time,
            end: time + slotDuration,
          });
        }

        // Check if any slot is available (not booked)
        const bookedSlots = bookings.map(booking => ({
          start: timeToMinutes(booking.startTime),
          end: timeToMinutes(booking.endTime),
        }));

        const hasAvailableSlot = allSlots.some(slot => {
          return !bookedSlots.some(booked =>
            (slot.start >= booked.start && slot.start < booked.end) ||
            (slot.end > booked.start && slot.end <= booked.end) ||
            (slot.start <= booked.start && slot.end >= booked.end)
          );
        });

        if (hasAvailableSlot) {
          fieldsWithAvailability.push(field.id);
        }
      }

      // If no fields have availability, return empty results
      if (fieldsWithAvailability.length === 0) {
        return { fields: [], total: 0 };
      }

      // Add to where clause
      if (whereClause.AND) {
        whereClause.AND.push({ id: { in: fieldsWithAvailability } });
      } else {
        whereClause.AND = [{ id: { in: fieldsWithAvailability } }];
      }
    }

    // Availability time filter (Morning, Afternoon, Evening)
    // When combined with date filter, further narrow down to specific time periods with available slots
    if (where.availability && where.availability.length > 0) {
      if (where.date && fieldsWithAvailability) {
        // If date is also specified, filter fields that have available slots in specific time periods
        const selectedDate = new Date(where.date);
        const startOfDay = new Date(Date.UTC(
          selectedDate.getFullYear(),
          selectedDate.getMonth(),
          selectedDate.getDate(),
          0, 0, 0, 0
        ));
        const endOfDay = new Date(Date.UTC(
          selectedDate.getFullYear(),
          selectedDate.getMonth(),
          selectedDate.getDate(),
          23, 59, 59, 999
        ));

        const fieldsWithTimeAvailability: string[] = [];

        // Define time ranges for availability slots (in minutes)
        const timeRanges: Record<string, { start: number; end: number }> = {
          morning: { start: 6 * 60, end: 12 * 60 }, // 6:00 AM - 12:00 PM
          afternoon: { start: 12 * 60, end: 17 * 60 }, // 12:00 PM - 5:00 PM
          evening: { start: 17 * 60, end: 22 * 60 }, // 5:00 PM - 10:00 PM
        };

        // Helper to convert time string to minutes
        const timeToMinutes = (timeStr: string): number => {
          const [hours, minutes] = timeStr.split(':').map(Number);
          return hours * 60 + (minutes || 0);
        };

        // Check each field for available slots in the requested time periods
        for (const fieldId of fieldsWithAvailability) {
          const field = await prisma.field.findUnique({
            where: { id: fieldId },
            select: {
              openingTime: true,
              closingTime: true,
              bookingDuration: true,
            },
          });

          if (!field) continue;

          // Get bookings for this field on this date
          const bookings = await prisma.booking.findMany({
            where: {
              fieldId,
              date: {
                gte: startOfDay,
                lte: endOfDay,
              },
              status: 'CONFIRMED',
            },
            select: {
              startTime: true,
              endTime: true,
            },
          });

          const openTime = field.openingTime || '06:00';
          const closeTime = field.closingTime || '22:00';
          // Use 30 min slots as the base duration since all fields now support both 30min and 1hr bookings
          const slotDuration = 30;

          const openMinutes = timeToMinutes(openTime);
          const closeMinutes = timeToMinutes(closeTime);

          // Generate all possible slots
          const allSlots: Array<{ start: number; end: number }> = [];
          for (let time = openMinutes; time < closeMinutes; time += slotDuration) {
            allSlots.push({
              start: time,
              end: time + slotDuration,
            });
          }

          const bookedSlots = bookings.map(booking => ({
            start: timeToMinutes(booking.startTime),
            end: timeToMinutes(booking.endTime),
          }));

          // Check if field has available slots in any of the requested time periods
          let hasAvailableInRequestedTime = false;

          for (const availabilitySlot of where.availability) {
            const slotKey = availabilitySlot.toLowerCase();
            if (!timeRanges[slotKey]) continue;

            const { start: periodStart, end: periodEnd } = timeRanges[slotKey];

            // Check if any slot in this time period is available
            const hasSlotInPeriod = allSlots.some(slot => {
              // Slot must overlap with the requested time period
              const overlapsPeriod = slot.start < periodEnd && slot.end > periodStart;
              if (!overlapsPeriod) return false;

              // Slot must not be booked
              const isBooked = bookedSlots.some(booked =>
                (slot.start >= booked.start && slot.start < booked.end) ||
                (slot.end > booked.start && slot.end <= booked.end) ||
                (slot.start <= booked.start && slot.end >= booked.end)
              );

              return !isBooked;
            });

            if (hasSlotInPeriod) {
              hasAvailableInRequestedTime = true;
              break;
            }
          }

          if (hasAvailableInRequestedTime) {
            fieldsWithTimeAvailability.push(fieldId);
          }
        }

        // Update the fields list to only include those with time-specific availability
        if (fieldsWithTimeAvailability.length === 0) {
          return { fields: [], total: 0 };
        }

        // Replace the fieldsWithAvailability constraint with the more specific one
        if (whereClause.AND) {
          whereClause.AND = whereClause.AND.filter((clause: any) => !clause.id?.in);
          whereClause.AND.push({ id: { in: fieldsWithTimeAvailability } });
        }
      } else {
        // No date specified, just filter by operating hours
        const availabilityConditions: any[] = [];

        for (const slot of where.availability) {
          if (slot.toLowerCase() === 'morning') {
            availabilityConditions.push({
              OR: [
                { openingTime: { lte: '12:00' } },
                { openingTime: null }
              ]
            });
          } else if (slot.toLowerCase() === 'afternoon') {
            availabilityConditions.push({
              AND: [
                {
                  OR: [
                    { openingTime: { lt: '17:00' } },
                    { openingTime: null }
                  ]
                },
                {
                  OR: [
                    { closingTime: { gt: '12:00' } },
                    { closingTime: null }
                  ]
                }
              ]
            });
          } else if (slot.toLowerCase() === 'evening') {
            availabilityConditions.push({
              OR: [
                { closingTime: { gte: '17:00' } },
                { closingTime: null }
              ]
            });
          }
        }

        if (availabilityConditions.length > 0) {
          if (whereClause.AND) {
            whereClause.AND.push({ OR: availabilityConditions });
          } else {
            whereClause.AND = [{ OR: availabilityConditions }];
          }
        }
      }
    }

    // Fetch ALL fields without pagination first, so we can sort by image quality
    // Then apply pagination after sorting
    const [allFields, total] = await Promise.all([
      prisma.field.findMany({
        where: whereClause,
        // No skip/take here - we'll apply pagination after sorting by image quality
        select: {
          id: true,
          fieldId: true, // Human-readable ID
          name: true,
          images: true, // First image for card thumbnail
          price: true, // Legacy field
          price30min: true, // New price field for 30 min slots
          price1hr: true, // New price field for 1 hour slots
          bookingDuration: true, // Legacy field
          averageRating: true,
          totalReviews: true,
          amenities: true, // For amenity icons
          isClaimed: true,
          ownerName: true, // Denormalized owner name
          size: true, // For size filtering
          customFieldSize: true, // For custom size filtering
          // Location fields for distance calculation
          latitude: true,
          longitude: true,
          location: true, // JSON location object with lat/lng
          // Address for display
          address: true,
          city: true,
          state: true,
          zipCode: true,
          // Count bookings for popularity
          _count: {
            select: {
              bookings: {
                where: {
                  status: { in: ['CONFIRMED', 'COMPLETED'] }
                }
              },
              reviews: true,
            },
          },
        },
        orderBy: this.buildOrderBy(sortBy, sortOrder),
      }),
      prisma.field.count({ where: whereClause }),
    ]);

    // Use allFields for processing
    let fields = allFields;

    // Post-query filter for size (including custom field sizes that match the category)
    // Size categories mapping:
    // - small: 1 acre or less (customFieldSize <= 1)
    // - medium: 1-3 acres (customFieldSize > 1 && customFieldSize <= 3)
    // - large: 3+ acres (customFieldSize > 3)
    let filteredFields = fields;
    if (sizeFilter) {
      // Normalize size filter to handle both DB values and display labels
      const sizeFilterLower = sizeFilter.toLowerCase();

      // Map display labels to normalized category
      let normalizedSize: 'small' | 'medium' | 'large' | 'extra-large' | null = null;
      if (sizeFilterLower === 'small' || sizeFilterLower.includes('under 1') || sizeFilterLower.includes('1 acre or less')) {
        normalizedSize = 'small';
      } else if (sizeFilterLower === 'medium' || sizeFilterLower.includes('1-3') || sizeFilterLower.includes('1–3')) {
        normalizedSize = 'medium';
      } else if (sizeFilterLower === 'large' || sizeFilterLower.includes('3+') || sizeFilterLower.includes('3 acres') || sizeFilterLower.includes('3+ acres')) {
        normalizedSize = 'large';
      } else if (sizeFilterLower === 'extra-large' || sizeFilterLower.includes('extra')) {
        normalizedSize = 'extra-large';
      }

      filteredFields = fields.filter((field: any) => {
        // If field has a matching preset size, include it
        const fieldSizeLower = (field.size || '').toLowerCase();
        if (fieldSizeLower === normalizedSize) {
          return true;
        }
        // Also check exact match for edge cases
        if (field.size === sizeFilter) {
          return true;
        }

        // If field has a custom size, check if it falls into the requested category
        if (field.customFieldSize) {
          const customSize = parseFloat(field.customFieldSize);
          if (isNaN(customSize)) return false;

          // Map normalized size to ranges
          if (normalizedSize === 'small') {
            return customSize <= 1;
          } else if (normalizedSize === 'medium') {
            return customSize > 1 && customSize <= 3;
          } else if (normalizedSize === 'large') {
            return customSize > 3 && customSize <= 6;
          } else if (normalizedSize === 'extra-large') {
            return customSize > 6;
          }
        }

        return false;
      });
    }

    // Sort fields by image quality:
    // 1. Fields with premium images (S3/CDN URLs) come first (score 2)
    // 2. Fields with WordPress URLs come next (score 1) - these are valid images
    // 3. Fields with no valid images come last (score 0)
    const getImageScore = (field: any): number => {
      if (!field.images || field.images.length === 0) return 0;

      // Check if any image is a premium URL (S3, CDN, not WordPress)
      const hasPremiumImage = field.images.some((img: string) => {
        if (!isValidImageUrl(img)) return false;
        return isPremiumImageUrl(img);
      });

      if (hasPremiumImage) return 2; // Premium images get highest priority

      // Check if any image is valid (including WordPress)
      const hasValidImage = field.images.some((img: string) => isValidImageUrl(img));

      if (hasValidImage) return 1; // WordPress/other valid images get medium priority
      return 0; // No valid images get lowest priority
    };

    filteredFields.sort((a: any, b: any) => {
      const aScore = getImageScore(a);
      const bScore = getImageScore(b);
      return bScore - aScore; // Higher scores come first
    });

    // Apply pagination AFTER sorting by image quality
    const totalAfterFilter = filteredFields.length;
    const paginatedFields = filteredFields.slice(skip, skip + take);

    return {
      fields: paginatedFields,
      total: totalAfterFilter,
      hasMore: skip + take < totalAfterFilter,
    };
  }

  // Find all fields with filters (legacy - for backward compatibility)
  async findAllLegacy(filters: {
    city?: string;
    state?: string;
    type?: string;
    minPrice?: number;
    maxPrice?: number;
    skip?: number;
    take?: number;
  }) {
    const { skip = 0, take = 10, ...where } = filters;

    const whereClause: any = {
      isActive: true,
    };

    if (where.city) whereClause.city = where.city;
    if (where.state) whereClause.state = where.state;
    if (where.type) whereClause.type = where.type;

    // Price filter - check against price30min (the lower/starting price)
    // If price30min is not set, fall back to legacy price field
    if (where.minPrice || where.maxPrice) {
      whereClause.OR = [
        // Check price30min field
        ...(where.minPrice && where.maxPrice ? [{
          price30min: { gte: where.minPrice, lte: where.maxPrice }
        }] : where.minPrice ? [{
          price30min: { gte: where.minPrice }
        }] : [{
          price30min: { lte: where.maxPrice }
        }]),
        // Fall back to legacy price field if price30min is null
        ...(where.minPrice && where.maxPrice ? [{
          AND: [
            { price30min: null },
            { price: { gte: where.minPrice, lte: where.maxPrice } }
          ]
        }] : where.minPrice ? [{
          AND: [
            { price30min: null },
            { price: { gte: where.minPrice } }
          ]
        }] : [{
          AND: [
            { price30min: null },
            { price: { lte: where.maxPrice } }
          ]
        }])
      ];
    }

    return prisma.field.findMany({
      where: whereClause,
      skip,
      take,
      include: {
        owner: {
          select: {
            name: true,
            image: true,
          },
        },
        _count: {
          select: {
            bookings: true,
            reviews: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }


  // Find fields by owner
  async findByOwner(ownerId: string) {
    return prisma.field.findMany({
      where: { ownerId },
      include: {
        _count: {
          select: {
            bookings: true,
            reviews: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // Find single field by owner (for field owners who have one field)
  async findOneByOwner(ownerId: string) {
    return prisma.field.findFirst({
      where: { ownerId },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        },
        _count: {
          select: {
            bookings: true,
            reviews: true,
          },
        },
      },
    });
  }

  // Update field
  async update(id: string, data: Partial<CreateFieldInput>) {
    // Remove apartment field as it doesn't exist in the schema
    const { apartment, ...dataWithoutApartment } = data as any;

    // Get existing field data to check if address has changed
    const existingField = await prisma.field.findUnique({
      where: { id },
      select: {
        address: true,
        city: true,
        state: true,
        zipCode: true,
        latitude: true,
        longitude: true,
      },
    });

    if (!existingField) {
      throw new Error('Field not found');
    }

    // If updating owner, also update owner name and joined date
    let updateData: any = { ...dataWithoutApartment };

    if (data.ownerId && (!data.ownerName || !data.joinedOn)) {
      const owner = await prisma.user.findUnique({
        where: { id: data.ownerId },
        select: { name: true, createdAt: true },
      });

      if (owner) {
        if (!data.ownerName) {
          updateData.ownerName = owner.name || undefined;
        }
        if (!data.joinedOn && owner.createdAt) {
          const date = new Date(owner.createdAt);
          const month = date.toLocaleDateString('en-US', { month: 'long' });
          const year = date.getFullYear();
          updateData.joinedOn = `${month} ${year}`;
        }
      }
    }

    // Check if address fields have changed
    const addressChanged =
      (data.address !== undefined && data.address !== existingField.address) ||
      (data.city !== undefined && data.city !== existingField.city) ||
      (data.state !== undefined && data.state !== existingField.state) ||
      (data.zipCode !== undefined && data.zipCode !== existingField.zipCode);

    // Preserve existing latitude and longitude if:
    // 1. Address hasn't changed
    // 2. New lat/lng values are not provided
    if (!addressChanged) {
      if (updateData.latitude === undefined || updateData.latitude === null) {
        updateData.latitude = existingField.latitude;
      }
      if (updateData.longitude === undefined || updateData.longitude === null) {
        updateData.longitude = existingField.longitude;
      }
    }

    // If address changed but no new coordinates provided, preserve existing ones
    // This prevents null values when address is updated without geocoding
    if (addressChanged && !data.latitude && !data.longitude && existingField.latitude && existingField.longitude) {
      updateData.latitude = existingField.latitude;
      updateData.longitude = existingField.longitude;
    }

    return prisma.field.update({
      where: { id },
      data: updateData,
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }

  // Update field step completion
  async updateStepCompletion(id: string, step: string, completed: boolean = true) {
    const stepField = `${step}Completed`;
    return prisma.field.update({
      where: { id },
      data: {
        [stepField]: completed,
      },
    });
  }

  // Submit field for review
  async submitField(id: string) {
    // Get the field to get the ownerId
    const field = await prisma.field.findUnique({
      where: { id },
      select: { ownerId: true }
    });

    if (!field) {
      throw new Error('Field not found');
    }

    // Update field and user in a transaction
    const [updatedField] = await prisma.$transaction([
      prisma.field.update({
        where: { id },
        data: {
          isSubmitted: true,
          submittedAt: new Date(),
          isActive: true, // Activate field on submission
        },
      }),
      // Set hasField to true for the field owner
      prisma.user.update({
        where: { id: field.ownerId },
        data: {
          hasField: true,
        },
      }),
    ]);

    return updatedField;
  }

  // Delete field
  async delete(id: string) {
    // Get the field to get the ownerId before deletion
    const field = await prisma.field.findUnique({
      where: { id },
      select: { ownerId: true }
    });

    if (!field) {
      throw new Error('Field not found');
    }

    // Delete the field
    const deletedField = await prisma.field.delete({
      where: { id },
    });

    // Check if the owner has any other submitted fields
    const remainingSubmittedFields = await prisma.field.count({
      where: {
        ownerId: field.ownerId,
        isSubmitted: true,
      },
    });

    // If no submitted fields remain, set hasField to false
    if (remainingSubmittedFields === 0) {
      await prisma.user.update({
        where: { id: field.ownerId },
        data: {
          hasField: false,
        },
      });
    }

    return deletedField;
  }

  // Toggle field active status
  async toggleActive(id: string) {
    const field = await prisma.field.findUnique({
      where: { id },
      select: { isActive: true },
    });

    return prisma.field.update({
      where: { id },
      data: { isActive: !field?.isActive },
    });
  }

  // Toggle field blocked status (admin only)
  async toggleBlocked(id: string) {
    const field = await prisma.field.findUnique({
      where: { id },
      select: { isBlocked: true },
    });

    return prisma.field.update({
      where: { id },
      data: { isBlocked: !field?.isBlocked },
    });
  }

  // Get field suggestions for autocomplete
  async getSuggestions(query: string) {
    const whereClause: any = {
      isActive: true,
      isSubmitted: true,
      isApproved: true // Field must be approved by admin
      // Note: isBlocked filter removed for production compatibility
      // Will be added back after DB migration
    };

    // Check if query might be a UK postcode
    const isPostcode = isValidUKPostcode(query) || isPartialPostcode(query);

    if (isPostcode) {
      // For postcode searches, look for matching postcodes
      const formattedPostcode = formatUKPostcode(query);
      const searchConditions: any[] = [];

      if (formattedPostcode) {
        searchConditions.push({ zipCode: formattedPostcode });
        searchConditions.push({ zipCode: formattedPostcode.replace(' ', '') });
      }

      if (isPartialPostcode(query)) {
        const searchUpper = query.toUpperCase().trim();
        searchConditions.push({
          zipCode: {
            startsWith: searchUpper,
            mode: 'insensitive'
          }
        });
      }

      whereClause.OR = searchConditions;
    } else {
      // Comprehensive search by field name, address, city, state, or postal code
      whereClause.OR = [
        { name: { contains: query, mode: 'insensitive' } },
        { address: { contains: query, mode: 'insensitive' } },
        { city: { contains: query, mode: 'insensitive' } },
        { state: { contains: query, mode: 'insensitive' } },
        { zipCode: { contains: query, mode: 'insensitive' } },
      ];
    }

    const fields = await prisma.field.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        city: true,
        state: true,
        zipCode: true,
        address: true,
        price: true,
        price30min: true,
        price1hr: true,
        bookingDuration: true,
        averageRating: true,
        totalReviews: true,
        images: true,
      },
      take: 6, // Limit to 6 suggestions
      orderBy: [
        { averageRating: 'desc' },
        { totalReviews: 'desc' },
      ],
    });

    return fields.map(field => ({
      id: field.id,
      name: field.name || 'Unnamed Field',
      address: field.address || '',
      location: `${field.city || ''}${field.city && field.state ? ', ' : ''}${field.state || ''} ${field.zipCode || ''}`.trim(),
      fullAddress: `${field.address || ''}${field.address && (field.city || field.state) ? ', ' : ''}${field.city || ''}${field.city && field.state ? ', ' : ''}${field.state || ''} ${field.zipCode || ''}`.trim(),
      price: field.price30min || field.price, // Use price30min as the starting price
      price30min: field.price30min,
      price1hr: field.price1hr,
      rating: field.averageRating,
      reviews: field.totalReviews,
      image: getFirstValidImage(field.images),
    }));
  }

  // Search fields by location using MongoDB geospatial query
  async searchByLocation(lat: number, lng: number, radius: number = 10) {
    // Convert radius from miles to meters (MongoDB uses meters for $near)
    const radiusInMeters = radius * 1609.34;

    try {
      // Use findRaw to leverage MongoDB's geospatial operators
      // Note: This requires a 2dsphere index on the 'location' field
      const rawFields = await prisma.field.findRaw({
        filter: {
          isActive: true,
          isSubmitted: true,
          isApproved: true, // Field must be approved by admin
          // Note: isBlocked filter removed for production compatibility
          // Will be added back after DB migration: isBlocked: { $ne: true },
          location: {
            $near: {
              $geometry: {
                type: "Point",
                coordinates: [lng, lat]
              },
              $maxDistance: radiusInMeters
            }
          }
        }
      });

      // Map raw results to our application structure
      // findRaw returns BSON objects, so we need to be careful with ID mapping
      const fieldsWithDistance = (rawFields as any[]).map((field: any) => {
        // Calculate distance for display (since $near sorts by distance but doesn't return it)
        // We still calculate this for the UI display, but we're doing it on a much smaller subset
        const fieldLat = field.location?.coordinates?.[1] || field.latitude;
        const fieldLng = field.location?.coordinates?.[0] || field.longitude;

        let distanceMiles = 0;
        if (fieldLat && fieldLng) {
          const R = 3959; // Earth's radius in miles
          const dLat = (fieldLat - lat) * Math.PI / 180;
          const dLng = (fieldLng - lng) * Math.PI / 180;
          const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat * Math.PI / 180) * Math.cos(fieldLat * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          distanceMiles = R * c;
        }

        // Map _id object to string id if needed, or use existing id string
        const id = field._id?.$oid || field._id || field.id;

        return {
          id,
          fieldId: field.fieldId,
          name: field.name,
          city: field.city,
          state: field.state,
          address: field.address,
          zipCode: field.zipCode,
          latitude: fieldLat,
          longitude: fieldLng,
          location: field.location,
          price: field.price,
          price30min: field.price30min,
          price1hr: field.price1hr,
          bookingDuration: field.bookingDuration,
          averageRating: field.averageRating,
          totalReviews: field.totalReviews,
          images: field.images,
          amenities: field.amenities,
          isClaimed: field.isClaimed,
          ownerId: field.ownerId?.$oid || field.ownerId, // Handle ObjectId reference
          ownerName: field.ownerName,
          distanceMiles: Number(distanceMiles.toFixed(1)),
        };
      });

      return fieldsWithDistance;

    } catch (error) {
      console.error('Geospatial search error:', error);
      // Fallback to in-memory search if index is missing or query fails
      console.warn('Falling back to in-memory geospatial search');
      return this.searchByLocationInMemory(lat, lng, radius);
    }
  }

  // Fallback in-memory search (renamed from original searchByLocation)
  async searchByLocationInMemory(lat: number, lng: number, radius: number = 10) {
    // Get all active fields
    const allFields = await prisma.field.findMany({
      where: {
        isActive: true,
        isSubmitted: true,
        isApproved: true // Field must be approved by admin
        // Note: isBlocked filter removed for production compatibility
        // Will be added back after DB migration
      },
      select: {
        id: true,
        fieldId: true, // Human-readable ID
        name: true,
        city: true,
        state: true,
        address: true,
        zipCode: true,
        latitude: true,
        longitude: true,
        location: true,
        price: true, // Legacy field
        price30min: true, // New price field for 30 min slots
        price1hr: true, // New price field for 1 hour slots
        bookingDuration: true, // Legacy field
        averageRating: true,
        totalReviews: true,
        images: true,
        amenities: true,
        isClaimed: true,
        ownerId: true,
        ownerName: true,
        _count: {
          select: {
            bookings: true,
            reviews: true,
          },
        },
      },
    });

    const R = 3959; // Earth's radius in miles
    const fieldsWithDistance = allFields
      .map((field: any) => {
        if (field.latitude && field.longitude) {
          const dLat = (field.latitude - lat) * Math.PI / 180;
          const dLng = (field.longitude - lng) * Math.PI / 180;
          const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat * Math.PI / 180) * Math.cos(field.latitude * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          const distanceMiles = R * c;

          return {
            ...field,
            distanceMiles: Number(distanceMiles.toFixed(1))
          };
        }
        return {
          ...field,
          distanceMiles: Infinity
        };
      })
      .filter((field: any) => field.distanceMiles <= radius)
      .sort((a: any, b: any) => a.distanceMiles - b.distanceMiles);

    return fieldsWithDistance;
  }

  // Helper method to build orderBy clause
  // Supports multiple sort fields: sortBy="rating,price" sortOrder="desc,asc"
  private buildOrderBy(sortBy: string, sortOrder: 'asc' | 'desc' | string) {
    // Handle multiple sort fields (comma-separated)
    if (sortBy && sortBy.includes(',')) {
      const sortFields = sortBy.split(',').map(s => s.trim());
      const sortOrders = typeof sortOrder === 'string' && sortOrder.includes(',')
        ? sortOrder.split(',').map(s => s.trim() as 'asc' | 'desc')
        : sortFields.map(() => sortOrder as 'asc' | 'desc');

      const orderByOptions: Record<string, string> = {
        price: 'price30min', // Use price30min for sorting (the starting price)
        rating: 'averageRating',
        reviews: 'totalReviews',
        name: 'name',
        createdAt: 'createdAt',
        distance: 'createdAt', // Would need geospatial calculation
      };

      // Build array of orderBy objects
      const orderByArray = sortFields.map((field, index) => {
        const dbField = orderByOptions[field];
        const order = sortOrders[index] || 'desc';
        return dbField ? { [dbField]: order } : null;
      }).filter(Boolean);

      return orderByArray.length > 0 ? orderByArray : [{ createdAt: 'desc' }];
    }

    // Single sort field (backward compatible)
    const orderByOptions: Record<string, any> = {
      price: { price30min: sortOrder }, // Use price30min for sorting (the starting price)
      rating: { averageRating: sortOrder },
      reviews: { totalReviews: sortOrder },
      name: { name: sortOrder },
      createdAt: { createdAt: sortOrder },
      distance: { createdAt: sortOrder }, // Would need geospatial calculation
    };

    return orderByOptions[sortBy] || { createdAt: 'desc' };
  }
}

export default new FieldModel();
