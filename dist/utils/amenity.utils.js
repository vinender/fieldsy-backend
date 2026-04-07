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
    get enrichFieldWithAmenities () {
        return enrichFieldWithAmenities;
    },
    get enrichFieldsWithAmenities () {
        return enrichFieldsWithAmenities;
    },
    get transformAmenitiesToObjects () {
        return transformAmenitiesToObjects;
    }
});
const _database = /*#__PURE__*/ _interop_require_default(require("../config/database"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
// Cache for amenities to avoid repeated DB calls
let amenityObjectsCache = null;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour in milliseconds
async function transformAmenitiesToObjects(amenityNames) {
    if (!amenityNames || amenityNames.length === 0) {
        return [];
    }
    try {
        // Normalize function for case-insensitive matching
        const normalizeKey = (str)=>str.toLowerCase().replace(/[^a-z0-9]/g, '');
        let amenityMap;
        // Check if cache is valid and use it
        if (amenityObjectsCache && Date.now() - amenityObjectsCache.timestamp < CACHE_TTL) {
            amenityMap = amenityObjectsCache.data;
        } else {
            // Fetch ALL amenities from database and cache them
            const amenities = await _database.default.amenity.findMany({
                select: {
                    id: true,
                    name: true,
                    icon: true
                }
            });
            // Create a normalized map for case-insensitive matching
            amenityMap = new Map(amenities.map((amenity)=>[
                    normalizeKey(amenity.name),
                    amenity
                ]));
            // Update cache
            amenityObjectsCache = {
                data: amenityMap,
                timestamp: Date.now()
            };
        }
        // Transform the amenity names to objects, maintaining order - id, label, value, and iconUrl
        const transformedAmenities = amenityNames.map((name)=>{
            const normalizedName = normalizeKey(name);
            const amenity = amenityMap.get(normalizedName);
            if (amenity) {
                return {
                    id: amenity.id,
                    label: amenity.name,
                    value: name,
                    iconUrl: amenity.icon || undefined
                };
            }
            // If amenity not found in database, return a default object with empty id
            return {
                id: '',
                label: formatAmenityLabel(name),
                value: name,
                iconUrl: undefined
            };
        });
        return transformedAmenities;
    } catch (error) {
        console.error('Error transforming amenities:', error);
        // Return empty array on error to prevent API breakage
        return [];
    }
}
/**
 * Format camelCase amenity names to readable labels
 * @param name - Amenity name in camelCase (e.g., "dogAgility")
 * @returns Formatted label (e.g., "Dog Agility")
 */ function formatAmenityLabel(name) {
    // Handle special cases
    const specialCases = {
        toilet: 'Toilet',
        dogAgility: 'Dog Agility',
        waterBowls: 'Water Bowls',
        parkingSpace: 'Parking Space'
    };
    if (specialCases[name]) {
        return specialCases[name];
    }
    // Convert camelCase to Title Case
    return name.replace(/([A-Z])/g, ' $1').replace(/^./, (str)=>str.toUpperCase()).trim();
}
async function enrichFieldWithAmenities(field) {
    if (!field) return field;
    const amenities = field.amenities || [];
    // Transform to objects first, then extract only labels
    const transformedAmenities = await transformAmenitiesToObjects(amenities);
    const amenityLabels = transformedAmenities.map((amenity)=>amenity.label);
    return {
        ...field,
        amenities: amenityLabels
    };
}
/**
 * Transform multiple field objects to include amenities as string array (labels only)
 * @param fields - Array of field objects with amenities as string arrays
 * @returns Array of field objects with amenity labels as string arrays
 */ // Module-level cache for enrichFieldsWithAmenities (persists between calls)
let enrichAmenityCache = null;
const ENRICH_CACHE_TTL = 60 * 60 * 1000; // 1 hour
async function enrichFieldsWithAmenities(fields) {
    if (!fields || fields.length === 0) return fields;
    // Normalize function for case-insensitive matching
    const normalizeKey = (str)=>str.toLowerCase().replace(/[^a-z0-9]/g, '');
    // Check if cache is valid
    if (enrichAmenityCache && Date.now() - enrichAmenityCache.timestamp < ENRICH_CACHE_TTL) {
        // Use cached data
        const amenityMap = enrichAmenityCache.data;
        // Transform all fields using cache
        return fields.map((field)=>{
            if (!field.amenities || !Array.isArray(field.amenities)) {
                return {
                    ...field,
                    amenities: []
                };
            }
            const amenityLabels = field.amenities.map((name)=>{
                const normalizedName = normalizeKey(name);
                return amenityMap.get(normalizedName);
            }).filter((label)=>label !== undefined);
            return {
                ...field,
                amenities: amenityLabels
            };
        });
    }
    // Fetch ALL amenities at once for better performance
    const amenities = await _database.default.amenity.findMany({
        select: {
            id: true,
            name: true,
            icon: true
        }
    });
    // Create a normalized map for case-insensitive lookup (store only label/name)
    const amenityMap = new Map(amenities.map((amenity)=>[
            normalizeKey(amenity.name),
            amenity.name
        ]));
    // Update module-level cache
    enrichAmenityCache = {
        data: amenityMap,
        timestamp: Date.now()
    };
    // Transform all fields
    return fields.map((field)=>{
        if (!field.amenities || !Array.isArray(field.amenities)) {
            return {
                ...field,
                amenities: []
            };
        }
        const amenityLabels = field.amenities.map((name)=>{
            const normalizedName = normalizeKey(name);
            return amenityMap.get(normalizedName);
        }).filter((label)=>label !== undefined);
        return {
            ...field,
            amenities: amenityLabels
        };
    });
}

//# sourceMappingURL=amenity.utils.js.map