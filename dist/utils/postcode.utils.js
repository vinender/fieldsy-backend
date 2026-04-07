//@ts-nocheck
/**
 * UK Postcode validation and formatting utilities
 */ /**
 * UK postcode regex patterns
 * Supports formats like: SW1A 1AA, SW1A1AA, W1A 0AX, M1 1AE, B33 8TH, CR2 6XH
 */ "use strict";
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
    get formatUKPostcode () {
        return formatUKPostcode;
    },
    get generatePostcodeSearchPatterns () {
        return generatePostcodeSearchPatterns;
    },
    get getPostcodeArea () {
        return getPostcodeArea;
    },
    get getPostcodeDistrict () {
        return getPostcodeDistrict;
    },
    get getPostcodeOutwardCode () {
        return getPostcodeOutwardCode;
    },
    get isPartialPostcode () {
        return isPartialPostcode;
    },
    get isValidUKPostcode () {
        return isValidUKPostcode;
    },
    get postcodeMatches () {
        return postcodeMatches;
    }
});
const UK_POSTCODE_REGEX = /^([A-Z]{1,2}[0-9][0-9A-Z]?)\s?([0-9][A-Z]{2})$/i;
const UK_POSTCODE_AREA_REGEX = /^[A-Z]{1,2}[0-9][0-9A-Z]?$/i;
function isValidUKPostcode(postcode) {
    if (!postcode) return false;
    const cleaned = postcode.trim().toUpperCase();
    return UK_POSTCODE_REGEX.test(cleaned);
}
function formatUKPostcode(postcode) {
    if (!postcode) return null;
    const cleaned = postcode.trim().toUpperCase().replace(/\s+/g, '');
    const match = cleaned.match(/^([A-Z]{1,2}[0-9][0-9A-Z]?)([0-9][A-Z]{2})$/);
    if (match) {
        return `${match[1]} ${match[2]}`;
    }
    return null;
}
function getPostcodeOutwardCode(postcode) {
    const formatted = formatUKPostcode(postcode);
    if (!formatted) return null;
    const parts = formatted.split(' ');
    return parts[0];
}
function getPostcodeDistrict(postcode) {
    const outwardCode = getPostcodeOutwardCode(postcode);
    if (!outwardCode) return null;
    // Extract letters and first number(s)
    const match = outwardCode.match(/^([A-Z]{1,2}[0-9]{1,2})/);
    return match ? match[1] : null;
}
function getPostcodeArea(postcode) {
    const outwardCode = getPostcodeOutwardCode(postcode);
    if (!outwardCode) return null;
    // Extract just the letters
    const match = outwardCode.match(/^([A-Z]{1,2})/);
    return match ? match[1] : null;
}
function isPartialPostcode(postcode) {
    if (!postcode) return false;
    const cleaned = postcode.trim().toUpperCase();
    return UK_POSTCODE_AREA_REGEX.test(cleaned);
}
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
function postcodeMatches(fieldPostcode, searchPostcode) {
    if (!fieldPostcode || !searchPostcode) return false;
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

//# sourceMappingURL=postcode.utils.js.map