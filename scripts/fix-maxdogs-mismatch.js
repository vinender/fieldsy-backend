/**
 * Fix "Maximum dogs" mismatch between description text and DB maxDogs value.
 * The DB maxDogs field is the source of truth (shown in Field Specifications).
 * This script updates description text to match the DB value.
 *
 * Usage:
 *   cd backend
 *   PATH="/usr/local/bin:/usr/local/Cellar/node/24.9.0/bin:$PATH" node scripts/fix-maxdogs-mismatch.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const allFields = await prisma.field.findMany({
    select: { id: true, name: true, description: true, maxDogs: true },
    orderBy: { createdAt: 'asc' }
  });

  const mismatches = [];

  for (const f of allFields) {
    if (!f.description) continue;
    const match = f.description.match(/Maximum dogs:\s*(\d+)/i);
    if (!match) continue;

    const descMaxDogs = parseInt(match[1], 10);
    const dbMaxDogs = f.maxDogs;

    if (descMaxDogs !== dbMaxDogs) {
      mismatches.push(f);
    }
  }

  console.log(`Found ${mismatches.length} fields with mismatched Maximum dogs\n`);

  let updated = 0;
  let errors = 0;

  for (const field of mismatches) {
    const oldDesc = field.description;
    const newDesc = oldDesc.replace(
      /Maximum dogs:\s*\d+/i,
      `Maximum dogs: ${field.maxDogs}`
    );

    if (oldDesc === newDesc) {
      console.log(`  SKIP: ${field.name} - no change after replace`);
      continue;
    }

    try {
      await prisma.field.update({
        where: { id: field.id },
        data: { description: newDesc }
      });
      updated++;

      // Show first few for verification
      if (updated <= 5) {
        const oldMatch = oldDesc.match(/Maximum dogs:\s*\d+/i);
        const newMatch = newDesc.match(/Maximum dogs:\s*\d+/i);
        console.log(`[${updated}] ${field.name}`);
        console.log(`    ${oldMatch[0]} → ${newMatch[0]}`);
      }
    } catch (err) {
      console.error(`  ERROR: ${field.name}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Errors: ${errors}`);

  // Verify
  const verify = await prisma.field.findMany({
    select: { id: true, name: true, description: true, maxDogs: true },
    orderBy: { createdAt: 'asc' }
  });

  let stillMismatched = 0;
  for (const f of verify) {
    if (!f.description) continue;
    const match = f.description.match(/Maximum dogs:\s*(\d+)/i);
    if (!match) continue;
    if (parseInt(match[1], 10) !== f.maxDogs) stillMismatched++;
  }
  console.log(`Still mismatched after update: ${stillMismatched}`);

  await prisma.$disconnect();
}

main().catch(console.error);
