/**
 * Clean stale data from MongoDB after switching to a new Stripe account.
 *
 * Deletes old bookings, payments, transactions, notifications, conversations,
 * messages, favorites, slot locks, device tokens, and leftover payment methods.
 *
 * KEEPS: users, fields, field claims, system settings, FAQs, terms, amenities,
 * field properties, counters, contact queries, google reviews, field reviews,
 * user reports, about page.
 *
 * Run: npx ts-node scripts/clean-stale-data.ts
 */

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function cleanStaleData() {
  console.log('=== Cleaning Stale Data ===\n');

  // Delete in correct order (children before parents due to relations)

  // 1. Transactions (child of Booking)
  const txResult = await prisma.transaction.deleteMany({});
  console.log(`✓ Deleted ${txResult.count} transactions`);

  // 2. Payments (child of Booking)
  const payResult = await prisma.payment.deleteMany({});
  console.log(`✓ Deleted ${payResult.count} payments`);

  // 3. Reviews (child of Booking)
  const reviewResult = await prisma.review.deleteMany({});
  console.log(`✓ Deleted ${reviewResult.count} reviews`);

  // 4. Field Reviews (child of Booking)
  const fieldReviewResult = await prisma.fieldReview.deleteMany({});
  console.log(`✓ Deleted ${fieldReviewResult.count} field reviews`);

  // 5. Bookings (now safe to delete - children removed above)
  const bookingResult = await prisma.booking.deleteMany({});
  console.log(`✓ Deleted ${bookingResult.count} bookings`);

  // 6. Notifications
  const notifResult = await prisma.notification.deleteMany({});
  console.log(`✓ Deleted ${notifResult.count} notifications`);

  // 7. Messages (child of Conversation)
  const msgResult = await prisma.message.deleteMany({});
  console.log(`✓ Deleted ${msgResult.count} messages`);

  // 8. Conversations (now safe to delete)
  const convResult = await prisma.conversation.deleteMany({});
  console.log(`✓ Deleted ${convResult.count} conversations`);

  // 9. Favorites
  const favResult = await prisma.favorite.deleteMany({});
  console.log(`✓ Deleted ${favResult.count} favorites`);

  // 10. Slot locks
  const slotResult = await prisma.slotLock.deleteMany({});
  console.log(`✓ Deleted ${slotResult.count} slot locks`);

  // 11. Device tokens
  const deviceResult = await prisma.deviceToken.deleteMany({});
  console.log(`✓ Deleted ${deviceResult.count} device tokens`);

  // 12. Leftover payment methods
  const pmResult = await prisma.paymentMethod.deleteMany({});
  console.log(`✓ Deleted ${pmResult.count} payment methods`);

  console.log('\n=== Done! Stale data cleaned. ===');
  console.log('\nKept: users, fields, field claims, system settings, FAQs, terms,');
  console.log('amenities, field properties, counters, contact queries, google reviews,');
  console.log('user reports, about page.');
}

cleanStaleData()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
