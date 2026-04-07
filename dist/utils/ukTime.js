/**
 * UK Timezone Utilities
 * All time comparisons and displays should use Europe/London timezone.
 * This handles both GMT (winter) and BST (summer) automatically.
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
    get UK_TIMEZONE () {
        return UK_TIMEZONE;
    },
    get getNowUK () {
        return getNowUK;
    },
    get getUKDateParts () {
        return getUKDateParts;
    },
    get getUKTimestamp () {
        return getUKTimestamp;
    },
    get toUKDate () {
        return toUKDate;
    }
});
const UK_TIMEZONE = 'Europe/London';
function getNowUK() {
    const nowStr = new Date().toLocaleString('en-GB', {
        timeZone: UK_TIMEZONE
    });
    const [datePart, timePart] = nowStr.split(', ');
    const [day, month, year] = datePart.split('/').map(Number);
    const [hours, minutes, seconds] = timePart.split(':').map(Number);
    return new Date(year, month - 1, day, hours, minutes, seconds);
}
function getUKTimestamp() {
    return getNowUK().getTime();
}
function getUKDateParts(date) {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(dateObj.getTime())) return null;
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: UK_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    const parts = formatter.formatToParts(dateObj);
    const get = (type)=>parts.find((p)=>p.type === type)?.value || '0';
    return {
        year: parseInt(get('year')),
        month: parseInt(get('month')),
        day: parseInt(get('day')),
        hours: parseInt(get('hour')),
        minutes: parseInt(get('minute')),
        seconds: parseInt(get('second'))
    };
}
function toUKDate(date) {
    const parts = getUKDateParts(date);
    if (!parts) return new Date(NaN);
    return new Date(parts.year, parts.month - 1, parts.day, parts.hours, parts.minutes, parts.seconds);
}

//# sourceMappingURL=ukTime.js.map