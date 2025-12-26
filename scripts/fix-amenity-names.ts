/**
 * Script to fix amenity names - convert slug format to proper display names
 *
 * Usage:
 *   npx ts-node scripts/fix-amenity-names.ts
 *
 * This script:
 * 1. Fetches all existing amenities
 * 2. Converts slug-formatted names to proper display names (e.g., "secure-fencing-180cm" -> "Secure Fencing 180cm")
 * 3. Keeps the slug field as-is (already in correct format)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Convert slug to proper display name
function slugToDisplayName(slug: string): string {
  return slug
    .split('-')
    .map(word => {
      // Keep numbers and special measurements as-is
      if (/^\d+/.test(word)) {
        return word;
      }
      // Capitalize first letter of each word
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

async function fixAmenityNames() {
  console.log('\n========================================');
  console.log('  Fix Amenity Names');
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
        // Check if name looks like a slug (contains hyphens and is lowercase)
        const isSlugFormat = amenity.name.includes('-') || amenity.name === amenity.name.toLowerCase();

        if (!isSlugFormat) {
          console.log(`  ⏭️  Skipped (already proper name): ${amenity.name}`);
          skipped++;
          continue;
        }

        // Convert slug-formatted name to proper display name
        const displayName = slugToDisplayName(amenity.name);

        // Update the amenity with proper name (keep slug as-is)
        await prisma.amenity.update({
          where: { id: amenity.id },
          data: {
            name: displayName,
            // Ensure slug is set (use original name if slug is missing)
            slug: amenity.slug || amenity.name
          }
        });

        console.log(`  ✓ Updated: "${amenity.name}" -> "${displayName}" (slug: ${amenity.slug || amenity.name})`);
        updated++;
      } catch (error: any) {
        console.log(`  ✗ Error: ${amenity.name} - ${error.message}`);
        errors++;
      }
    }

    console.log('\n========================================');
    console.log('  Fix Summary');
    console.log('========================================');
    console.log(`  Total amenities: ${amenities.length}`);
    console.log(`  Updated: ${updated}`);
    console.log(`  Skipped (already proper): ${skipped}`);
    console.log(`  Errors: ${errors}`);
    console.log('\n');

  } catch (error: any) {
    console.error('\n❌ Fix failed:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

fixAmenityNames();
