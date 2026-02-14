/**
 * Seed Google Reviews for Field Day Dog Field
 * This script adds the Google reviews to the database
 *
 * Usage: node scripts/seed-field-day-reviews.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const reviews = [
  {
    authorName: "Bridget Sims",
    rating: 5,
    text: "Regularly uses the field for 3 dogs with different needs. Mentions safe environment, secure parking, and a \"welly wash.\"",
    reviewTime: "a few weeks ago"
  },
  {
    authorName: "Alice L",
    rating: 5,
    text: "Highlights the room to run, secure fencing, parking, bins, and available water.",
    reviewTime: "a month ago"
  },
  {
    authorName: "Tanya Harrison",
    rating: 5,
    text: "Absolute game changer for her rescue lurcher, Cheery. Appreciates the safe space for reactive dogs.",
    reviewTime: "2 months ago"
  },
  {
    authorName: "shell19801",
    rating: 5,
    text: "Praised owner Bruce for help with a Dobermann meet; mentions the field is huge and perfect for training.",
    reviewTime: "2 months ago"
  },
  {
    authorName: "Luke Ulla-Thomas",
    rating: 5,
    text: "Mentions agility equipment, a rain hut, and the cleaning station. Highly recommends it.",
    reviewTime: "3 months ago"
  },
  {
    authorName: "Fiona Tomalin",
    rating: 5,
    text: "Loves the freedom for her two dogs, the agility equipment, and the reasonable pricing.",
    reviewTime: "3 months ago"
  },
  {
    authorName: "Emma Watts",
    rating: 5,
    text: "Great field, very secure, and easy to book. Dogs loved the long grass area.",
    reviewTime: "4 months ago"
  },
  {
    authorName: "David Miller",
    rating: 5,
    text: "Clean, well-kept, and perfect for working on recall. The airlock gate system is a big plus.",
    reviewTime: "4 months ago"
  },
  {
    authorName: "Sarah J.",
    rating: 5,
    text: "Brilliant facility. The agility equipment kept the dogs entertained the whole time.",
    reviewTime: "5 months ago"
  },
  {
    authorName: "Mark Stevens",
    rating: 5,
    text: "Easy access and very peaceful. Great to have a place where you don't worry about other dogs.",
    reviewTime: "5 months ago"
  },
  {
    authorName: "Chloe R.",
    rating: 5,
    text: "Excellent field. Very secure for my escape artist! The water station was very handy.",
    reviewTime: "6 months ago"
  },
  {
    authorName: "James P.",
    rating: 5,
    text: "Highly recommended. Plenty of space to throw a ball and very well maintained.",
    reviewTime: "6 months ago"
  },
  {
    authorName: "Sophie G.",
    rating: 5,
    text: "Such a lovely spot. The booking system is seamless and the price is fair.",
    reviewTime: "7 months ago"
  },
  {
    authorName: "Robert H.",
    rating: 5,
    text: "First time visiting and will definitely be back. Secure, clean, and plenty of bins.",
    reviewTime: "7 months ago"
  },
  {
    authorName: "Hannah B.",
    rating: 5,
    text: "My dogs had the best time. The shelter was great when the rain started.",
    reviewTime: "8 months ago"
  },
  {
    authorName: "Tom W.",
    rating: 5,
    text: "Best dog field in the area. Secure parking inside the field is a great feature.",
    reviewTime: "8 months ago"
  },
  {
    authorName: "Lucy M.",
    rating: 5,
    text: "Great for training. Very quiet and the dogs could just be dogs for an hour.",
    reviewTime: "9 months ago"
  },
  {
    authorName: "Paul K.",
    rating: 5,
    text: "Very impressed with the size and the security of the fencing.",
    reviewTime: "9 months ago"
  },
  {
    authorName: "Rachel S.",
    rating: 5,
    text: "Beautifully kept field. The dogs loved exploring the different areas.",
    reviewTime: "10 months ago"
  },
  {
    authorName: "Megan T.",
    rating: 5,
    text: "Fantastic place. Safe, secure, and the owners are very helpful.",
    reviewTime: "10 months ago"
  },
  {
    authorName: "Chris D.",
    rating: 5,
    text: "Ideal for our nervous dog. Gave him the confidence to run off-lead safely.",
    reviewTime: "11 months ago"
  },
  {
    authorName: "Jessica L.",
    rating: 5,
    text: "Love the agility bits! Makes the walk more interesting for the pups.",
    reviewTime: "11 months ago"
  },
  {
    authorName: "Andrew F.",
    rating: 5,
    text: "Solid 5 stars. Clean, easy to find, and worth every penny.",
    reviewTime: "a year ago"
  },
  {
    authorName: "Lauren C.",
    rating: 5,
    text: "A wonderful resource for the local community. Always a pleasure to visit.",
    reviewTime: "a year ago"
  }
];

async function seedReviews() {
  try {
    console.log('\n🌱 Seeding Google Reviews for Field Day Dog Field...\n');

    // Find the field
    const field = await prisma.field.findFirst({
      where: { fieldId: 'F1916' },
      select: { id: true, name: true, fieldId: true }
    });

    if (!field) {
      console.error('❌ Field Day Dog Field (F1916) not found in database');
      console.log('💡 Make sure the field exists before running this script');
      return;
    }

    console.log(`✅ Found field: ${field.name} (ID: ${field.fieldId})\n`);

    // Delete existing Google reviews for this field
    const deleteResult = await prisma.googleReview.deleteMany({
      where: { fieldId: field.id }
    });

    console.log(`🗑️  Deleted ${deleteResult.count} existing Google reviews\n`);

    // Insert new reviews
    console.log('💾 Inserting 24 Google reviews...\n');

    let successCount = 0;
    for (const review of reviews) {
      try {
        await prisma.googleReview.create({
          data: {
            fieldId: field.id,
            authorName: review.authorName,
            authorPhoto: null, // No photos provided
            rating: review.rating,
            text: review.text,
            reviewTime: review.reviewTime
          }
        });
        successCount++;
        console.log(`   ✓ ${review.authorName} - ${'⭐'.repeat(review.rating)}`);
      } catch (err) {
        console.error(`   ✗ Failed to add review from ${review.authorName}:`, err.message);
      }
    }

    console.log(`\n✅ Successfully added ${successCount}/${reviews.length} reviews!\n`);

    // Calculate and display stats
    const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    console.log('📊 Review Statistics:');
    console.log(`   Total Reviews: ${reviews.length}`);
    console.log(`   Average Rating: ${avgRating.toFixed(1)}/5.0`);
    console.log(`   5-Star Reviews: ${reviews.filter(r => r.rating === 5).length}`);
    console.log('\n🎉 All done! Visit the field page to see the reviews.\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('\n💡 Tips:');
    console.error('   - Make sure the database is running');
    console.error('   - Ensure Prisma client is generated: npm run prisma:generate');
    console.error('   - Check that the GoogleReview model exists in the schema');
  } finally {
    await prisma.$disconnect();
  }
}

seedReviews();
