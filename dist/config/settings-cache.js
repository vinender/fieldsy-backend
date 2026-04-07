//@ts-nocheck
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
    get getSystemSettings () {
        return getSystemSettings;
    },
    get invalidateSettingsCache () {
        return invalidateSettingsCache;
    }
});
const _database = /*#__PURE__*/ _interop_require_default(require("./database"));
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
let cachedSettings = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
async function getSystemSettings(select) {
    const now = Date.now();
    if (cachedSettings && now < cacheExpiry) {
        // If caller wants specific fields, pick from cache
        if (select) {
            const result = {
                id: cachedSettings.id
            };
            for (const key of Object.keys(select)){
                if (select[key]) result[key] = cachedSettings[key];
            }
            return result;
        }
        return cachedSettings;
    }
    // Fetch fresh from DB (no select — cache the full record)
    const settings = await _database.default.systemSettings.findFirst();
    if (settings) {
        cachedSettings = settings;
        cacheExpiry = now + CACHE_TTL_MS;
    }
    if (select && settings) {
        const result = {
            id: settings.id
        };
        for (const key of Object.keys(select)){
            if (select[key]) result[key] = settings[key];
        }
        return result;
    }
    return settings;
}
function invalidateSettingsCache() {
    cachedSettings = null;
    cacheExpiry = 0;
}

//# sourceMappingURL=settings-cache.js.map