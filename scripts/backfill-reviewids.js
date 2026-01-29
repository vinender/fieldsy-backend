/**
 * Backfill human-readable reviewId for all field reviews that are missing one.
 * Uses the Counter collection (atomic upsert) to generate sequential IDs
 * starting from 1001, consistent with generateReviewId() in review.controller.ts.
 *
 * Usage:
 *   cd backend
 *   node scripts/backfill-reviewids.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 1. Find all reviews missing a reviewId
  // MongoDB: field not existing (isSet: false), null, or empty string
  const missing = await prisma.fieldReview.findMany({
    where: {
      OR: [
        { reviewId: { isSet: false } },
        { reviewId: null },
        { reviewId: '' }
      ]
    },
    select: { id: true, createdAt: true },
    orderBy: { createdAt: 'asc' }  // oldest first so IDs are chronological
  });

  console.log(`Found ${missing.length} reviews without a reviewId\n`);

  if (missing.length === 0) {
    console.log('Nothing to do.');
    await prisma.$disconnect();
    return;
  }

  let updated = 0;
  let errors = 0;

  for (const review of missing) {
    try {
      // Atomically increment counter (same logic as generateReviewId)
      const counter = await prisma.counter.upsert({
        where: { name: 'review' },
        update: { value: { increment: 1 } },
        create: { name: 'review', value: 1001 }  // Start from 1001 for reviews
      });

      const reviewId = counter.value.toString();

      await prisma.fieldReview.update({
        where: { id: review.id },
        data: { reviewId }
      });

      updated++;
      console.log(`[${updated}/${missing.length}] ${review.id} → reviewId: ${reviewId}`);
    } catch (err) {
      console.error(`  ERROR: ${review.id}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Errors: ${errors}`);

  // Verify
  const stillMissing = await prisma.fieldReview.count({
    where: {
      OR: [
        { reviewId: null },
        { reviewId: '' }
      ]
    }
  });
  console.log(`Still missing reviewId: ${stillMissing}`);

  await prisma.$disconnect();
}

main().catch(console.error);
