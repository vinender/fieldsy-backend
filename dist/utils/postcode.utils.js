"use strict";
//@ts-nocheck
/**
 * UK Postcode validation and formatting utilities
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidUKPostcode = isValidUKPostcode;
exports.formatUKPostcode = formatUKPostcode;
exports.getPostcodeOutwardCode = getPostcodeOutwardCode;
exports.getPostcodeDistrict = getPostcodeDistrict;
exports.getPostcodeArea = getPostcodeArea;
exports.isPartialPostcode = isPartialPostcode;
exports.generatePostcodeSearchPatterns = generatePostcodeSearchPatterns;
exports.postcodeMatches = postcodeMatches;
/**
 * UK postcode regex patterns
 * Supports formats like: SW1A 1AA, SW1A1AA, W1A 0AX, M1 1AE, B33 8TH, CR2 6XH
 */
const UK_POSTCODE_REGEX = /^([A-Z]{1,2}[0-9][0-9A-Z]?)\s?([0-9][A-Z]{2})$/i;
const UK_POSTCODE_AREA_REGEX = /^[A-Z]{1,2}[0-9][0-9A-Z]?$/i;
/**
 * Validates if a string is a valid UK postcode
 */
function isValidUKPostcode(postcode) {
    if (!postcode)
        return false;
    const cleaned = postcode.trim().toUpperCase();
    return UK_POSTCODE_REGEX.test(cleaned);
}
/**
 * Formats a UK postcode to standard format (with space)
 * e.g., "sw1a1aa" -> "SW1A 1AA"
 */
function formatUKPostcode(postcode) {
    if (!postcode)
        return null;
    const cleaned = postcode.trim().toUpperCase().replace(/\s+/g, '');
    const match = cleaned.match(/^([A-Z]{1,2}[0-9][0-9A-Z]?)([0-9][A-Z]{2})$/);
    if (match) {
        return `${match[1]} ${match[2]}`;
    }
    return null;
}
/**
 * Extracts the outward code (area) from a UK postcode
 * e.g., "SW1A 1AA" -> "SW1A"
 */
function getPostcodeOutwardCode(postcode) {
    const formatted = formatUKPostcode(postcode);
    if (!formatted)
        return null;
    const parts = formatted.split(' ');
    return parts[0];
}
/**
 * Extracts the district from a UK postcode
 * e.g., "SW1A 1AA" -> "SW1"
 */
function getPostcodeDistrict(postcode) {
    const outwardCode = getPostcodeOutwardCode(postcode);
    if (!outwardCode)
        return null;
    // Extract letters and first number(s)
    const match = outwardCode.match(/^([A-Z]{1,2}[0-9]{1,2})/);
    return match ? match[1] : null;
}
/**
 * Extracts the area from a UK postcode
 * e.g., "SW1A 1AA" -> "SW"
 */
function getPostcodeArea(postcode) {
    const outwardCode = getPostcodeOutwardCode(postcode);
    if (!outwardCode)
        return null;
    // Extract just the letters
    const match = outwardCode.match(/^([A-Z]{1,2})/);
    return match ? match[1] : null;
}
/**
 * Checks if a postcode string might be a partial postcode
 * (just the outward code or district)
 */
function isPartialPostcode(postcode) {
    if (!postcode)
        return false;
    const cleaned = postcode.trim().toUpperCase();
    return UK_POSTCODE_AREA_REGEX.test(cleaned);
}
/**
 * Generates search patterns for postcode-based queries
 * Returns an array of patterns to match against
 */
function generatePostcodeSearchPatterns(input) {
    const patterns = [];
    const cleaned = input.trim().toUpperCase();
    // Full postcode format
    const formatted = formatUKPostcode(cleaned);
    if (formatted) {
        patterns.push(formatted);
        patterns.push(formatted.replace(' ', '')); // Without space
    }
    // Outward code (e.g., "SW1A")
    const outwardCode = getPostcodeOutwardCode(cleaned);
    if (outwardCode) {
        patterns.push(outwardCode);
    }
    // District (e.g., "SW1")
    const district = getPostcodeDistrict(cleaned);
    if (district && district !== outwardCode) {
        patterns.push(district);
    }
    // Area (e.g., "SW")
    const area = getPostcodeArea(cleaned);
    if (area && area !== district && area !== outwardCode) {
        patterns.push(area);
    }
    // If it's a partial postcode, add it as is
    if (isPartialPostcode(cleaned) && !patterns.includes(cleaned)) {
        patterns.push(cleaned);
    }
    return Array.from(new Set(patterns)); // Remove duplicates
}
/**
 * Determines if a field's postcode matches a search postcode
 * Supports partial matching (e.g., "SW1" matches "SW1A 1AA")
 */
function postcodeMatches(fieldPostcode, searchPostcode) {
    if (!fieldPostcode || !searchPostcode)
        return false;
    const fieldFormatted = formatUKPostcode(fieldPostcode);
    const searchFormatted = formatUKPostcode(searchPostcode);
    // Exact match
    if (fieldFormatted && searchFormatted && fieldFormatted === searchFormatted) {
        return true;
    }
    // Check if search is a partial postcode
    if (isPartialPostcode(searchPostcode)) {
        const searchCleaned = searchPostcode.trim().toUpperCase();
        const fieldCleaned = fieldPostcode.trim().toUpperCase();
        // Check if field postcode starts with the partial search
        if (fieldCleaned.startsWith(searchCleaned)) {
            return true;
        }
        // Check against field's outward code
        const fieldOutward = getPostcodeOutwardCode(fieldPostcode);
        if (fieldOutward && fieldOutward.startsWith(searchCleaned)) {
            return true;
        }
        // Check against field's district
        const fieldDistrict = getPostcodeDistrict(fieldPostcode);
        if (fieldDistrict && fieldDistrict === searchCleaned) {
            return true;
        }
        // Check against field's area
        const fieldArea = getPostcodeArea(fieldPostcode);
        if (fieldArea && fieldArea === searchCleaned) {
            return true;
        }
    }
    return false;
}
