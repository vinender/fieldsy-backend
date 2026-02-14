/**
 * Check Google Reviews in Database
 * Verifies that Google reviews exist for Field Day Dog Field
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkReviews() {
  try {
    console.log('\n🔍 Checking Google Reviews in Database...\n');

    // Find the field
    const field = await prisma.field.findFirst({
      where: { fieldId: 'F1916' },
      select: { id: true, name: true, fieldId: true }
    });

    if (!field) {
      console.error('❌ Field Day Dog Field (F1916) not found');
      return;
    }

    console.log(`✅ Found field: ${field.name} (ID: ${field.fieldId})`);
    console.log(`📋 MongoDB ObjectId: ${field.id}\n`);

    // Count reviews
    const count = await prisma.googleReview.count({
      where: { fieldId: field.id }
    });

    console.log(`📊 Total Google Reviews: ${count}\n`);

    if (count === 0) {
      console.log('⚠️  No reviews found in database!');
      console.log('💡 The reviews may not have been saved correctly.');
      return;
    }

    // Fetch reviews
    const reviews = await prisma.googleReview.findMany({
      where: { fieldId: field.id },
      orderBy: { createdAt: 'desc' },
      take: 5 // Show first 5
    });

    console.log('📝 Sample Reviews (first 5):');
    console.log('─────────────────────────────────────────────────\n');

    reviews.forEach((review, i) => {
      console.log(`${i + 1}. ${review.authorName} - ${'⭐'.repeat(review.rating)}`);
      console.log(`   "${review.text.substring(0, 80)}${review.text.length > 80 ? '...' : ''}"`);
      console.log(`   Time: ${review.reviewTime}`);
      console.log(`   Created: ${review.createdAt}\n`);
    });

    console.log('─────────────────────────────────────────────────');
    console.log(`\n✅ Reviews are in the database!`);
    console.log(`📱 Visit: http://localhost:3000/fields/F1916`);
    console.log(`🔗 API endpoint: http://localhost:5000/api/fields/F1916/google-reviews\n`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkReviews();
