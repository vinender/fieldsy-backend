/**
 * Backfill human-readable bookingId for all bookings that are missing one.
 * Uses the Counter collection (atomic upsert) to generate sequential IDs
 * starting from 1111, consistent with BookingModel.generateBookingId().
 *
 * Usage:
 *   cd backend
 *   PATH="/usr/local/bin:/usr/local/Cellar/node/24.9.0/bin:$PATH" node scripts/backfill-bookingids.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // 1. Find all bookings missing a bookingId
  // MongoDB: field not existing (isSet: false), null, or empty string
  const missing = await prisma.booking.findMany({
    where: {
      OR: [
        { bookingId: { isSet: false } },
        { bookingId: null },
        { bookingId: '' }
      ]
    },
    select: { id: true, createdAt: true },
    orderBy: { createdAt: 'asc' }  // oldest first so IDs are chronological
  });

  console.log(`Found ${missing.length} bookings without a bookingId\n`);

  if (missing.length === 0) {
    console.log('Nothing to do.');
    await prisma.$disconnect();
    return;
  }

  let updated = 0;
  let errors = 0;

  for (const booking of missing) {
    try {
      // Atomically increment counter (same logic as BookingModel.generateBookingId)
      const counter = await prisma.counter.upsert({
        where: { name: 'booking' },
        update: { value: { increment: 1 } },
        create: { name: 'booking', value: 1111 }
      });

      const bookingId = counter.value.toString();

      await prisma.booking.update({
        where: { id: booking.id },
        data: { bookingId }
      });

      updated++;
      console.log(`[${updated}/${missing.length}] ${booking.id} → bookingId: ${bookingId}`);
    } catch (err) {
      console.error(`  ERROR: ${booking.id}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Errors: ${errors}`);

  // Verify
  const stillMissing = await prisma.booking.count({
    where: {
      OR: [
        { bookingId: null },
        { bookingId: '' }
      ]
    }
  });
  console.log(`Still missing bookingId: ${stillMissing}`);

  await prisma.$disconnect();
}

main().catch(console.error);
