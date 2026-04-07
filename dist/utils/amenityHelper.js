"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get fetchAmenitiesByIds () {
        return fetchAmenitiesByIds;
    },
    get fetchAndTransformAmenities () {
        return fetchAndTransformAmenities;
    },
    get transformAmenities () {
        return transformAmenities;
    }
});
const _database = /*#__PURE__*/ _interop_require_default(require("../config/database"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
/**
 * Normalize amenity name for comparison
 * Converts to lowercase and removes spaces/special chars
 */ function normalizeAmenityName(name) {
    return name.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
}
async function fetchAndTransformAmenities(amenitySlugs) {
    if (!Array.isArray(amenitySlugs) || amenitySlugs.length === 0) {
        return [];
    }
    try {
        // Fetch all active amenities from database
        const dbAmenities = await _database.default.amenity.findMany({
            where: {
                isActive: true
            },
            select: {
                name: true,
                icon: true
            }
        });
        // Create a map for faster lookup
        const amenityMap = new Map();
        dbAmenities.forEach((amenity)=>{
            const normalizedName = normalizeAmenityName(amenity.name);
            amenityMap.set(normalizedName, amenity);
        });
        // Match field amenities with database amenities
        const transformedAmenities = [];
        for (const slug of amenitySlugs){
            const normalizedSlug = normalizeAmenityName(slug);
            const dbAmenity = amenityMap.get(normalizedSlug);
            if (dbAmenity) {
                // Found match in database
                transformedAmenities.push({
                    label: dbAmenity.name,
                    iconUrl: dbAmenity.icon || '/field-details/shield.svg'
                });
            } else {
                // No match found - use fallback formatting
                transformedAmenities.push({
                    label: formatAmenityLabel(slug),
                    iconUrl: '/field-details/shield.svg'
                });
            }
        }
        return transformedAmenities;
    } catch (error) {
        console.error('Error fetching amenities:', error);
        // Fallback: return formatted amenities without icons
        return amenitySlugs.map((slug)=>({
                label: formatAmenityLabel(slug),
                iconUrl: '/field-details/shield.svg'
            }));
    }
}
/**
 * Format amenity slug to readable label (fallback)
 */ function formatAmenityLabel(slug) {
    if (!slug) return '';
    return slug// Split camelCase
    .replace(/([a-z])([A-Z])/g, '$1 $2')// Replace hyphens and underscores with spaces
    .replace(/[-_]/g, ' ')// Capitalize first letter of each word
    .replace(/\b\w/g, (char)=>char.toUpperCase()).trim();
}
async function fetchAmenitiesByIds(amenityIds) {
    if (!Array.isArray(amenityIds) || amenityIds.length === 0) {
        return [];
    }
    try {
        const amenities = await _database.default.amenity.findMany({
            where: {
                id: {
                    in: amenityIds
                },
                isActive: true
            },
            select: {
                name: true,
                icon: true
            },
            orderBy: {
                order: 'asc'
            }
        });
        return amenities.map((amenity)=>({
                label: amenity.name,
                iconUrl: amenity.icon || '/field-details/shield.svg'
            }));
    } catch (error) {
        console.error('Error fetching amenities by IDs:', error);
        return [];
    }
}
/**
 * Check if value is a valid ObjectId
 */ function isObjectId(value) {
    return /^[0-9a-fA-F]{24}$/.test(value);
}
async function transformAmenities(amenities) {
    if (!Array.isArray(amenities) || amenities.length === 0) {
        return [];
    }
    // Check if first item is an ObjectId
    const firstItem = amenities[0];
    if (isObjectId(firstItem)) {
        // Amenities are stored as ObjectIds
        return fetchAmenitiesByIds(amenities);
    } else {
        // Amenities are stored as slugs/names
        return fetchAndTransformAmenities(amenities);
    }
}

//# sourceMappingURL=amenityHelper.js.map