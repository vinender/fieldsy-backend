/**
 * Script to bulk approve imported fields
 *
 * Usage:
 *   npx ts-node scripts/approve-imported-fields.ts [--all | --owner-email <email>]
 *
 * Examples:
 *   npx ts-node scripts/approve-imported-fields.ts --all
 *   npx ts-node scripts/approve-imported-fields.ts --owner-email imported-fields@fieldsy.com
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function approveFields(allFields: boolean, ownerEmail?: string) {
  console.log('Starting field approval...\n');

  // Build where clause
  const whereClause: any = {
    isApproved: false,
    isSubmitted: true,
  };

  if (!allFields && ownerEmail) {
    const owner = await prisma.user.findFirst({
      where: { email: ownerEmail }
    });

    if (!owner) {
      console.error(`Owner not found: ${ownerEmail}`);
      process.exit(1);
    }

    whereClause.ownerId = owner.id;
    console.log(`Approving fields for owner: ${ownerEmail}`);
  } else if (allFields) {
    console.log('Approving ALL unapproved submitted fields');
  } else {
    // Default to imported fields owner
    const importedOwner = await prisma.user.findFirst({
      where: { email: 'imported-fields@fieldsy.com' }
    });

    if (importedOwner) {
      whereClause.ownerId = importedOwner.id;
      console.log('Approving fields for: imported-fields@fieldsy.com');
    }
  }

  // Count fields to approve
  const count = await prisma.field.count({ where: whereClause });
  console.log(`Found ${count} fields to approve\n`);

  if (count === 0) {
    console.log('No fields to approve.');
    return;
  }

  // Approve fields
  const result = await prisma.field.updateMany({
    where: whereClause,
    data: {
      isApproved: true,
      isActive: true,
    }
  });

  console.log(`Successfully approved ${result.count} fields!`);
}

// Parse arguments
const args = process.argv.slice(2);
let allFields = false;
let ownerEmail: string | undefined;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--all') {
    allFields = true;
  } else if (args[i] === '--owner-email' && args[i + 1]) {
    ownerEmail = args[i + 1];
    i++;
  }
}

approveFields(allFields, ownerEmail)
  .then(() => {
    console.log('\nApproval completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Approval failed:', error);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
