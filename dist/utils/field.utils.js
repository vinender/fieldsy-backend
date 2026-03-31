"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveField = resolveField;
//@ts-nocheck
const database_1 = __importDefault(require("../config/database"));
/**
 * Resolve a field by either MongoDB ObjectID or human-readable fieldId (e.g. "F1153").
 * Use this instead of prisma.field.findUnique({ where: { id } }) when the ID
 * may come from request params/body and could be a human-readable fieldId.
 */
async function resolveField(fieldId, includeOptions) {
    const isObjectId = fieldId.length === 24 && /^[0-9a-fA-F]+$/.test(fieldId);
    if (isObjectId) {
        return database_1.default.field.findUnique({ where: { id: fieldId }, ...(includeOptions || {}) });
    }
    return database_1.default.field.findFirst({ where: { fieldId: fieldId }, ...(includeOptions || {}) });
}
