/**
 * Fix booking 6979c80e1238cb628036e34c which has bookingId: null.
 * Generates a new sequential bookingId using the Counter collection.
 *
 * Usage:
 *   cd backend
 *   node scripts/fix-null-bookingid.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const bookingId = '6979c80e1238cb628036e34c';

  // Check current state
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, bookingId: true, status: true, paymentStatus: true }
  });

  if (!booking) {
    console.log('Booking not found.');
    await prisma.$disconnect();
    return;
  }

  console.log('Current booking:', booking);

  if (booking.bookingId) {
    console.log(`Booking already has bookingId: ${booking.bookingId}. No fix needed.`);
    await prisma.$disconnect();
    return;
  }

  // Generate new bookingId using the Counter collection (same logic as BookingModel)
  const counter = await prisma.counter.upsert({
    where: { name: 'booking' },
    update: { value: { increment: 1 } },
    create: { name: 'booking', value: 1111 },
  });
  const newBookingId = counter.value.toString();

  // Update the booking
  await prisma.booking.update({
    where: { id: bookingId },
    data: { bookingId: newBookingId }
  });

  console.log(`Updated booking ${bookingId} with bookingId: ${newBookingId}`);

  // Verify
  const updated = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, bookingId: true }
  });
  console.log('Verified:', updated);

  await prisma.$disconnect();
}

main().catch(console.error);
