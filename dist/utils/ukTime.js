"use strict";
/**
 * UK Timezone Utilities
 * All time comparisons and displays should use Europe/London timezone.
 * This handles both GMT (winter) and BST (summer) automatically.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.UK_TIMEZONE = void 0;
exports.getNowUK = getNowUK;
exports.getUKTimestamp = getUKTimestamp;
exports.getUKDateParts = getUKDateParts;
exports.toUKDate = toUKDate;
const UK_TIMEZONE = 'Europe/London';
exports.UK_TIMEZONE = UK_TIMEZONE;
/**
 * Get the current date/time in UK timezone
 */
function getNowUK() {
    const nowStr = new Date().toLocaleString('en-GB', { timeZone: UK_TIMEZONE });
    const [datePart, timePart] = nowStr.split(', ');
    const [day, month, year] = datePart.split('/').map(Number);
    const [hours, minutes, seconds] = timePart.split(':').map(Number);
    return new Date(year, month - 1, day, hours, minutes, seconds);
}
/**
 * Get current UK timestamp in milliseconds
 */
function getUKTimestamp() {
    return getNowUK().getTime();
}
/**
 * Get date components in UK timezone
 */
function getUKDateParts(date) {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(dateObj.getTime()))
        return null;
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: UK_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
    const parts = formatter.formatToParts(dateObj);
    const get = (type) => parts.find(p => p.type === type)?.value || '0';
    return {
        year: parseInt(get('year')),
        month: parseInt(get('month')),
        day: parseInt(get('day')),
        hours: parseInt(get('hour')),
        minutes: parseInt(get('minute')),
        seconds: parseInt(get('second')),
    };
}
/**
 * Convert a date to UK timezone Date object
 */
function toUKDate(date) {
    const parts = getUKDateParts(date);
    if (!parts)
        return new Date(NaN);
    return new Date(parts.year, parts.month - 1, parts.day, parts.hours, parts.minutes, parts.seconds);
}
