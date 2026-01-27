//@ts-nocheck
import prisma from '../config/database';

/**
 * Resolve a field by either MongoDB ObjectID or human-readable fieldId (e.g. "F1153").
 * Use this instead of prisma.field.findUnique({ where: { id } }) when the ID
 * may come from request params/body and could be a human-readable fieldId.
 */
export async function resolveField(fieldId: string, includeOptions?: any) {
  const isObjectId = fieldId.length === 24 && /^[0-9a-fA-F]+$/.test(fieldId);
  if (isObjectId) {
    return prisma.field.findUnique({ where: { id: fieldId }, ...(includeOptions || {}) });
  }
  return prisma.field.findFirst({ where: { fieldId: fieldId }, ...(includeOptions || {}) });
}
