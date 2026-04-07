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
    get cleanAmenityIds () {
        return cleanAmenityIds;
    },
    get convertAmenityIdsToNames () {
        return convertAmenityIdsToNames;
    },
    get convertAmenityNamesToIds () {
        return convertAmenityNamesToIds;
    }
});
const _database = /*#__PURE__*/ _interop_require_default(require("../config/database"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
async function convertAmenityIdsToNames(amenityIds) {
    if (!amenityIds || amenityIds.length === 0) {
        return [];
    }
    try {
        // Filter out any non-valid MongoDB ObjectIds (like "0", "1", "2", etc.)
        const validIds = amenityIds.filter((id)=>{
            // MongoDB ObjectId is 24 characters hex string
            return /^[0-9a-fA-F]{24}$/.test(id);
        });
        if (validIds.length === 0) {
            return [];
        }
        // Fetch amenities from database
        const amenities = await _database.default.amenity.findMany({
            where: {
                id: {
                    in: validIds
                }
            },
            select: {
                name: true
            }
        });
        // Return array of names
        return amenities.map((amenity)=>amenity.name);
    } catch (error) {
        console.error('Error converting amenity IDs to names:', error);
        return [];
    }
}
async function convertAmenityNamesToIds(amenityNames) {
    if (!amenityNames || amenityNames.length === 0) {
        return [];
    }
    try {
        // Fetch amenities from database
        const amenities = await _database.default.amenity.findMany({
            where: {
                name: {
                    in: amenityNames
                }
            },
            select: {
                id: true
            }
        });
        // Return array of IDs
        return amenities.map((amenity)=>amenity.id);
    } catch (error) {
        console.error('Error converting amenity names to IDs:', error);
        return [];
    }
}
function cleanAmenityIds(amenityIds) {
    if (!amenityIds || amenityIds.length === 0) {
        return [];
    }
    // Filter out any non-valid MongoDB ObjectIds
    return amenityIds.filter((id)=>{
        // MongoDB ObjectId is 24 characters hex string
        return /^[0-9a-fA-F]{24}$/.test(id);
    });
}

//# sourceMappingURL=amenity.converter.js.map