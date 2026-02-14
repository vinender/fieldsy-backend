/**
 * Update Field Stats with Combined Reviews
 * Updates field averageRating and totalReviews to include both Fieldsy and Google reviews
 *
 * Usage: node scripts/update-field-stats.js [fieldId]
 * Example: node scripts/update-field-stats.js F1916
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function updateFieldStats(fieldIdOrObjectId) {
  try {
    console.log('\n🔄 Updating field stats...\n');

    let field;

    if (fieldIdOrObjectId) {
      // Update specific field
      const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(fieldIdOrObjectId);
      field = await prisma.field.findFirst({
        where: isValidObjectId
          ? {
              OR: [
                { id: fieldIdOrObjectId },
                { fieldId: fieldIdOrObjectId }
              ]
            }
          : { fieldId: fieldIdOrObjectId },
        select: { id: true, name: true, fieldId: true }
      });

      if (!field) {
        console.error(`❌ Field with ID ${fieldIdOrObjectId} not found`);
        return;
      }

      console.log(`✅ Found field: ${field.name} (ID: ${field.fieldId || field.id})\n`);
      await updateSingleField(field.id, field.name);
    } else {
      // Update all fields
      const fields = await prisma.field.findMany({
        select: { id: true, name: true, fieldId: true }
      });

      console.log(`📋 Updating stats for ${fields.length} fields...\n`);

      for (const field of fields) {
        await updateSingleField(field.id, field.name);
      }
    }

    console.log('\n✅ Field stats updated successfully!\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

async function updateSingleField(fieldId, fieldName) {
  // Get Fieldsy reviews stats
  const fieldsyStats = await prisma.fieldReview.aggregate({
    where: { fieldId },
    _avg: { rating: true },
    _count: { rating: true },
    _sum: { rating: true },
  });

  // Get Google reviews stats
  const googleStats = await prisma.googleReview.aggregate({
    where: { fieldId },
    _avg: { rating: true },
    _count: { rating: true },
    _sum: { rating: true },
  });

  const fieldsyCount = fieldsyStats._count.rating || 0;
  const googleCount = googleStats._count.rating || 0;
  const totalCount = fieldsyCount + googleCount;

  const fieldsySum = fieldsyStats._sum.rating || 0;
  const googleSum = googleStats._sum.rating || 0;
  const totalSum = fieldsySum + googleSum;

  const averageRating = totalCount > 0 ? totalSum / totalCount : 0;

  // Update field
  await prisma.field.update({
    where: { id: fieldId },
    data: {
      averageRating,
      totalReviews: totalCount,
    },
  });

  console.log(`✓ ${fieldName}`);
  console.log(`  Fieldsy Reviews: ${fieldsyCount} (avg: ${fieldsyStats._avg.rating?.toFixed(1) || 0})`);
  console.log(`  Google Reviews: ${googleCount} (avg: ${googleStats._avg.rating?.toFixed(1) || 0})`);
  console.log(`  Combined: ${totalCount} reviews, ${averageRating.toFixed(1)} avg rating\n`);
}

// Parse command line arguments
const args = process.argv.slice(2);
const fieldId = args[0] || null;

if (fieldId) {
  console.log(`Updating stats for field: ${fieldId}`);
  updateFieldStats(fieldId);
} else {
  console.log('No field ID provided - updating all fields');
  updateFieldStats(null);
}
