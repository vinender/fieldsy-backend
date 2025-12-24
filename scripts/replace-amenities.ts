/**
 * Script to replace all amenities in the database with new ones
 * Run with: npx ts-node scripts/replace-amenities.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// New amenities with slugs (name field is the slug)
const newAmenities = [
  // Safety & Security
  { name: 'secure-fencing-180cm', label: 'Secure fencing (180cm)', order: 1 },
  { name: 'secure-car-park', label: 'Secure Car Park', order: 2 },
  { name: 'cctv', label: 'CCTV', order: 3 },

  // Water & Cleaning
  { name: 'fresh-water', label: 'Fresh Water', order: 4 },
  { name: 'hose-pipe-dog-washing', label: 'Hose pipe for dog washing', order: 5 },
  { name: 'boot-cleaner', label: 'Boot cleaner', order: 6 },
  { name: 'dog-poo-bins', label: 'Dog Poo Bins', order: 7 },

  // Activities & Features
  { name: 'agility-equipment', label: 'Agility Equipment', order: 8 },
  { name: 'contour-graded-terrain', label: 'Contour/graded terrain', order: 9 },
  { name: 'woodland', label: 'Woodland', order: 10 },
  { name: 'pond', label: 'Pond', order: 11 },
  { name: 'river', label: 'River', order: 12 },
  { name: 'field-shelter', label: 'Field Shelter - protection from rain or sun', order: 13 },
  { name: 'picnic-bench', label: 'Picnic bench', order: 14 },
  { name: 'benches-seating', label: 'Benches and seating', order: 15 },

  // Facilities
  { name: 'hot-drinks-machine', label: 'Hot drinks machine', order: 16 },
  { name: 'cafe', label: 'Cafe', order: 17 },
  { name: 'toilets', label: 'Toilets', order: 18 },
];

async function replaceAmenities() {
  console.log('Starting amenity replacement...\n');

  try {
    // Step 1: Get current amenities for reference
    const currentAmenities = await prisma.amenity.findMany();
    console.log(`Found ${currentAmenities.length} existing amenities:`);
    currentAmenities.forEach(a => console.log(`  - ${a.name} (${a.id})`));
    console.log('');

    // Step 2: Delete all existing amenities
    console.log('Deleting all existing amenities...');
    const deleteResult = await prisma.amenity.deleteMany({});
    console.log(`Deleted ${deleteResult.count} amenities.\n`);

    // Step 3: Insert new amenities
    console.log('Inserting new amenities...');
    for (const amenity of newAmenities) {
      const created = await prisma.amenity.create({
        data: {
          name: amenity.name,
          icon: null, // Icons can be added later via admin panel
          order: amenity.order,
          isActive: true,
        }
      });
      console.log(`  Created: ${amenity.label} (slug: ${amenity.name})`);
    }

    console.log(`\nSuccessfully created ${newAmenities.length} new amenities.`);

    // Step 4: Verify
    const finalAmenities = await prisma.amenity.findMany({
      orderBy: { order: 'asc' }
    });
    console.log('\nFinal amenities list:');
    finalAmenities.forEach(a => console.log(`  ${a.order}. ${a.name}`));

    console.log('\nAmenity replacement completed successfully!');
    console.log('\nNote: Fields with old amenity references will need to be updated.');
    console.log('The old amenity slugs stored in fields will no longer match the new ones.');

  } catch (error) {
    console.error('Error replacing amenities:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

replaceAmenities();
