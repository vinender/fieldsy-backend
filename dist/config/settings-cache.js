"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSystemSettings = getSystemSettings;
exports.invalidateSettingsCache = invalidateSettingsCache;
//@ts-nocheck
const database_1 = __importDefault(require("./database"));
let cachedSettings = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
/**
 * Returns system settings from cache (5-min TTL) or DB.
 * Drop-in replacement for prisma.systemSettings.findFirst()
 */
async function getSystemSettings(select) {
    const now = Date.now();
    if (cachedSettings && now < cacheExpiry) {
        // If caller wants specific fields, pick from cache
        if (select) {
            const result = { id: cachedSettings.id };
            for (const key of Object.keys(select)) {
                if (select[key])
                    result[key] = cachedSettings[key];
            }
            return result;
        }
        return cachedSettings;
    }
    // Fetch fresh from DB (no select — cache the full record)
    const settings = await database_1.default.systemSettings.findFirst();
    if (settings) {
        cachedSettings = settings;
        cacheExpiry = now + CACHE_TTL_MS;
    }
    if (select && settings) {
        const result = { id: settings.id };
        for (const key of Object.keys(select)) {
            if (select[key])
                result[key] = settings[key];
        }
        return result;
    }
    return settings;
}
/** Invalidate cache — call after admin updates settings */
function invalidateSettingsCache() {
    cachedSettings = null;
    cacheExpiry = 0;
}
