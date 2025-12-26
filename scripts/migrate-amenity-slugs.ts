/**
 * Migration script to add slug field to existing amenities
 *
 * Usage:
 *   npx ts-node scripts/migrate-amenity-slugs.ts
 *
 * This script:
 * 1. Fetches all existing amenities
 * 2. For each amenity, uses the name as the slug (since names are already in slug format)
 * 3. Updates the document with the slug field
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Convert name to slug format (lowercase, replace spaces with hyphens)
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
}

async function migrateAmenitySlugs() {
  console.log('\n========================================');
  console.log('  Amenity Slug Migration');
  console.log('========================================\n');

  try {
    // Fetch all amenities
    const amenities = await prisma.amenity.findMany();
    console.log(`Found ${amenities.length} amenities to process\n`);

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const amenity of amenities) {
      try {
        // Skip if slug already exists
        if (amenity.slug) {
          console.log(`  ⏭️  Skipped (has slug): ${amenity.name} -> ${amenity.slug}`);
          skipped++;
          continue;
        }

        // Generate slug from name
        const slug = generateSlug(amenity.name);

        // Update the amenity with the slug
        await prisma.amenity.update({
          where: { id: amenity.id },
          data: { slug }
        });

        console.log(`  ✓ Updated: ${amenity.name} -> ${slug}`);
        updated++;
      } catch (error: any) {
        console.log(`  ✗ Error: ${amenity.name} - ${error.message}`);
        errors++;
      }
    }

    console.log('\n========================================');
    console.log('  Migration Summary');
    console.log('========================================');
    console.log(`  Total amenities: ${amenities.length}`);
    console.log(`  Updated: ${updated}`);
    console.log(`  Skipped (already had slug): ${skipped}`);
    console.log(`  Errors: ${errors}`);
    console.log('\n');

  } catch (error: any) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

migrateAmenitySlugs();
