/**
 * Import Dog Walking Fields from fields-data.json into MongoDB
 *
 * Usage:
 *   cd backend && npx ts-node scripts/import-dog-walking-fields.ts [--dry-run]
 *
 * This script:
 *  1. Reads dogWalkingFields from fields-data.json
 *  2. Finds or creates the "imported@fieldsy.com" system owner
 *  3. For each field: skip if already exists (name + postcode), otherwise create
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.MONGODB_URI },
  },
});

interface DogWalkingField {
  name: string;
  tag: string;
  address: string | null;
  postcode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  lat: number | null;
  lng: number | null;
  description: string | null;
  size: string | null;
  sizeAcres: string | null;
  fenceSize: string | null;
  fenceType: string | null;
  price: string | null;
  price30min: number | null;
  price1hr: number | null;
  maxDogs: number | null;
  parking: string | null;
  buggyAccessible: boolean | null;
  reactiveDogFriendly: boolean | null;
  bufferBetweenCustomers: string | null;
  fieldType: string | null;
  amenities: string[];
  operatingHours: string | null;
  onlineBooking: boolean;
  discountsAvailable: boolean;
  acceptsExemptDogs: string | null;
  lighting: string | null;
  livestockNearby: string | null;
  images: string[];
}

function mapSizeLabel(size: string | null): string | null {
  if (!size) return null;
  switch (size) {
    case 'small': return 'small';
    case 'medium': return 'medium';
    case 'large': return 'large';
    case 'extra-large': return 'extra-large';
    default: return size;
  }
}

function buildLocation(field: DogWalkingField) {
  const parts = (field.address || '').split(',').map(p => p.trim()).filter(Boolean);
  const city = parts.length > 1 ? parts[parts.length - 1] : parts[0] || '';
  const streetAddress = parts.length > 1 ? parts.slice(0, -1).join(', ') : parts[0] || '';

  return {
    location: {
      streetAddress,
      city,
      county: '',
      postalCode: field.postcode || '',
      country: 'United Kingdom',
      lat: field.lat,
      lng: field.lng,
      formatted_address: field.address || '',
    },
    address: streetAddress,
    city,
    state: '',
    zipCode: field.postcode || '',
  };
}

function buildFieldFeatures(field: DogWalkingField): Record<string, any> {
  const features: Record<string, any> = { tag: field.tag };

  if (field.website) features.website = field.website;
  if (field.parking) features.parking = field.parking;
  if (field.buggyAccessible !== null) features.buggyAccessible = field.buggyAccessible;
  if (field.reactiveDogFriendly !== null) features.reactiveDogFriendly = field.reactiveDogFriendly;
  if (field.bufferBetweenCustomers) features.bufferBetweenCustomers = field.bufferBetweenCustomers;
  if (field.fieldType) features.fieldType = field.fieldType;
  if (field.onlineBooking) features.onlineBooking = true;
  if (field.discountsAvailable) features.discountsAvailable = true;
  if (field.acceptsExemptDogs) features.acceptsExemptDogs = field.acceptsExemptDogs;
  if (field.lighting) features.lighting = field.lighting;
  if (field.livestockNearby) features.livestockNearby = field.livestockNearby;
  if (field.sizeAcres) features.sizeAcres = field.sizeAcres;
  if (field.fenceType) features.fenceType = field.fenceType;
  if (field.operatingHours) features.operatingHours = field.operatingHours;
  if (field.price) features.rawPrice = field.price;

  return features;
}

function parsePrice(priceStr: string | null): { price30min: number | null; price1hr: number | null } {
  if (!priceStr) return { price30min: null, price1hr: null };

  const match = priceStr.match(/[£$€]?([\d.]+)/);
  if (!match) return { price30min: null, price1hr: null };

  const price = parseFloat(match[1]);
  const lower = priceStr.toLowerCase();

  if (lower.includes('30') && lower.includes('min')) {
    return { price30min: price, price1hr: Math.round(price * 2 * 100) / 100 };
  }
  if (lower.includes('hour') || lower.includes('1hr') || lower.includes('60')) {
    return { price1hr: price, price30min: Math.round((price / 2) * 100) / 100 };
  }
  // Default: assume per session (~30min)
  return { price30min: price, price1hr: Math.round(price * 2 * 100) / 100 };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('=== Dog Walking Fields Import Script ===');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  // 1. Load fields-data.json
  const fieldsData = require(path.resolve(__dirname, 'fields-data.json'));
  const dogWalkingFields: DogWalkingField[] = fieldsData.dogWalkingFields;

  console.log(`Total Dog Walking Fields to process: ${dogWalkingFields.length}\n`);

  // 2. Find or create system owner
  let systemOwner = await prisma.user.findFirst({
    where: { email: 'imported@fieldsy.com', role: 'FIELD_OWNER' },
  });

  if (!systemOwner) {
    if (dryRun) {
      console.log('[DRY RUN] Would create system owner: imported@fieldsy.com');
    } else {
      const counter = await prisma.counter.upsert({
        where: { name: 'user' },
        update: { value: { increment: 1 } },
        create: { name: 'user', value: 8000 },
      });
      systemOwner = await prisma.user.create({
        data: {
          userId: String(counter.value),
          email: 'imported@fieldsy.com',
          name: 'Imported Fields',
          role: 'FIELD_OWNER',
          provider: 'general',
          hasField: true,
          emailVerified: new Date(),
          isBlocked: false,
          isReported: false,
        },
      });
      console.log(`Created system owner: ${systemOwner.id}`);
    }
  } else {
    console.log(`Using existing system owner: ${systemOwner.email} (${systemOwner.id})`);
  }

  const ownerId = systemOwner?.id || 'dry-run-id';

  // 3. Get existing field count for fieldId generation
  const fieldCounter = await prisma.counter.upsert({
    where: { name: 'field' },
    update: {},
    create: { name: 'field', value: 3000 },
  });
  let nextFieldNum = fieldCounter.value;

  // 4. Process fields in batches
  const BATCH_SIZE = 50;
  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < dogWalkingFields.length; i += BATCH_SIZE) {
    const batch = dogWalkingFields.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(dogWalkingFields.length / BATCH_SIZE);

    console.log(`\n--- Batch ${batchNum}/${totalBatches} (fields ${i + 1}-${Math.min(i + BATCH_SIZE, dogWalkingFields.length)}) ---`);

    for (const field of batch) {
      try {
        // Check if field already exists
        const existing = await prisma.field.findFirst({
          where: {
            name: field.name,
            ...(field.postcode ? { zipCode: field.postcode } : {}),
          },
        });

        if (existing) {
          skipped++;
          continue;
        }

        const loc = buildLocation(field);
        const features = buildFieldFeatures(field);
        const prices = field.price30min && field.price1hr
          ? { price30min: field.price30min, price1hr: field.price1hr }
          : parsePrice(field.price);

        nextFieldNum++;
        const fieldId = `F${nextFieldNum}`;

        const createData = {
          fieldId,
          name: field.name,
          description: field.description || undefined,
          address: loc.address,
          city: loc.city,
          state: loc.state,
          zipCode: loc.zipCode,
          location: loc.location,
          latitude: field.lat || undefined,
          longitude: field.lng || undefined,
          ownerId,
          type: 'PRIVATE' as const,
          size: mapSizeLabel(field.size),
          fenceSize: field.fenceSize || undefined,
          fenceType: field.fenceType || undefined,
          amenities: field.amenities || [],
          images: field.images || [],
          fieldFeatures: features,
          maxDogs: field.maxDogs || 6,
          price30min: prices.price30min || undefined,
          price1hr: prices.price1hr || undefined,
          isActive: true,
          isSubmitted: true,
          isApproved: true,
          isClaimed: false,
          fieldDetailsCompleted: true,
          uploadImagesCompleted: field.images && field.images.length > 0,
          pricingAvailabilityCompleted: !!(prices.price30min || prices.price1hr),
          bookingRulesCompleted: true,
          instantBooking: false,
          submittedAt: new Date(),
          ownerName: 'Imported Fields',
          joinedOn: 'January 2026',
        };

        if (dryRun) {
          created++;
        } else {
          await prisma.field.create({ data: createData as any });
          created++;
        }
      } catch (error: any) {
        console.error(`  Error: ${field.name} — ${error.message.slice(0, 100)}`);
        errors++;
      }
    }

    console.log(`  Progress: ${created} created, ${skipped} skipped, ${errors} errors`);
  }

  // Update field counter
  if (!dryRun && created > 0) {
    await prisma.counter.update({
      where: { name: 'field' },
      data: { value: nextFieldNum },
    });
  }

  console.log('\n=== Import Summary ===');
  console.log(`Total processed: ${dogWalkingFields.length}`);
  console.log(`Created: ${created}`);
  console.log(`Skipped (already exist): ${skipped}`);
  console.log(`Errors: ${errors}`);
  if (dryRun) console.log('\n[DRY RUN] No changes were made to the database.');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('Fatal error:', e);
  await prisma.$disconnect();
  process.exit(1);
});
