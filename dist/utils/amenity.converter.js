"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertAmenityIdsToNames = convertAmenityIdsToNames;
exports.convertAmenityNamesToIds = convertAmenityNamesToIds;
exports.cleanAmenityIds = cleanAmenityIds;
const database_1 = __importDefault(require("../config/database"));
/**
 * Convert amenity IDs to amenity names for storage
 * @param amenityIds - Array of amenity IDs
 * @returns Array of amenity names
 */
async function convertAmenityIdsToNames(amenityIds) {
    if (!amenityIds || amenityIds.length === 0) {
        return [];
    }
    try {
        // Filter out any non-valid MongoDB ObjectIds (like "0", "1", "2", etc.)
        const validIds = amenityIds.filter((id) => {
            // MongoDB ObjectId is 24 characters hex string
            return /^[0-9a-fA-F]{24}$/.test(id);
        });
        if (validIds.length === 0) {
            return [];
        }
        // Fetch amenities from database
        const amenities = await database_1.default.amenity.findMany({
            where: {
                id: {
                    in: validIds,
                },
            },
            select: {
                name: true,
            },
        });
        // Return array of names
        return amenities.map((amenity) => amenity.name);
    }
    catch (error) {
        console.error('Error converting amenity IDs to names:', error);
        return [];
    }
}
/**
 * Convert amenity names to amenity IDs
 * @param amenityNames - Array of amenity names
 * @returns Array of amenity IDs
 */
async function convertAmenityNamesToIds(amenityNames) {
    if (!amenityNames || amenityNames.length === 0) {
        return [];
    }
    try {
        // Fetch amenities from database
        const amenities = await database_1.default.amenity.findMany({
            where: {
                name: {
                    in: amenityNames,
                },
            },
            select: {
                id: true,
            },
        });
        // Return array of IDs
        return amenities.map((amenity) => amenity.id);
    }
    catch (error) {
        console.error('Error converting amenity names to IDs:', error);
        return [];
    }
}
/**
 * Validate and clean amenity IDs array
 * Some amenity arrays may contain invalid IDs like "0", "1", "2", etc.
 * This function validates and returns only valid MongoDB ObjectIds
 * @param amenityIds - Array of amenity IDs (may contain invalid ones)
 * @returns Array of valid MongoDB ObjectIds
 */
function cleanAmenityIds(amenityIds) {
    if (!amenityIds || amenityIds.length === 0) {
        return [];
    }
    // Filter out any non-valid MongoDB ObjectIds
    return amenityIds.filter((id) => {
        // MongoDB ObjectId is 24 characters hex string
        return /^[0-9a-fA-F]{24}$/.test(id);
    });
}
