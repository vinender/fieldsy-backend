/**
 * Migration script to add price30min and price1hr fields to all existing Field documents
 *
 * This script:
 * 1. Copies the existing 'price' value to 'price30min' (as the base price)
 * 2. Sets 'price1hr' to 1.5x the price (or 2x for a more standard hourly rate)
 *
 * Run with: npx ts-node scripts/migrate-price-fields.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting price fields migration...\n');

  // Get all fields
  const fields = await prisma.field.findMany({
    select: {
      id: true,
      name: true,
      price: true,
      price30min: true,
      price1hr: true,
    }
  });

  console.log(`Found ${fields.length} fields to process\n`);

  let updated = 0;
  let skipped = 0;

  for (const field of fields) {
    // Skip if both new fields are already set
    if (field.price30min !== null && field.price1hr !== null) {
      console.log(`⏭️  Skipping "${field.name}" - already has price30min and price1hr`);
      skipped++;
      continue;
    }

    const existingPrice = field.price || 0;

    // Calculate new prices
    // price30min = existing price (assumed to be per 30 min or base price)
    // price1hr = 1.5x the 30min price (giving a small discount for longer sessions)
    const price30min = field.price30min ?? existingPrice;
    const price1hr = field.price1hr ?? Math.round(existingPrice * 1.5);

    await prisma.field.update({
      where: { id: field.id },
      data: {
        price30min,
        price1hr,
      }
    });

    console.log(`✅ Updated "${field.name}": price30min=£${price30min}, price1hr=£${price1hr} (from price=£${existingPrice})`);
    updated++;
  }

  console.log('\n--- Migration Summary ---');
  console.log(`Total fields: ${fields.length}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log('\nMigration completed successfully!');
}

main()
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
