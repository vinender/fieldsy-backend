const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const faqs = [
  {
    question: "How do I book a field?",
    answer: "Simply search by postcode or use your location, choose a field and time slot, and confirm your booking through our secure checkout. You'll receive instant confirmation via email and in the app.",
    category: "booking",
    order: 1,
    isActive: true
  },
  {
    question: "How do I know what amenities are available?",
    answer: "Each field listing includes detailed information about available amenities such as water access, parking, shelter, agility equipment, and more. You can view all amenities in the field details section before booking.",
    category: "general",
    order: 2,
    isActive: true
  },
  {
    question: "Can I cancel or reschedule my booking?",
    answer: "Yes, you can cancel your booking up to the cancellation window (default 24 hours) before your scheduled time for a full refund. Rescheduling is allowed up to 3 times per booking, within the same cancellation window. For recurring bookings, rescheduling is not available once any booking in the subscription has been completed, and the recurring interval cannot be changed.",
    category: "booking",
    order: 3,
    isActive: true
  },
  {
    question: "Is it safe for all dog breeds?",
    answer: "All our fields are fully fenced and secure, making them safe for dogs of all breeds and sizes. Field listings include fence height and type information to help you choose the most suitable space for your dog.",
    category: "general",
    order: 4,
    isActive: true
  },
  {
    question: "What is your refund policy?",
    answer: "Full refunds are available for cancellations made at least 24 hours before your booking. Cancellations within 24 hours may receive a partial refund or credit for future bookings, depending on circumstances.",
    category: "payment",
    order: 5,
    isActive: true
  },
  {
    question: "How do I access the field after booking?",
    answer: "After booking, you'll receive detailed access instructions including the exact location, gate codes (if applicable), and any specific entry instructions. This information is also available in your booking confirmation within the app.",
    category: "booking",
    order: 6,
    isActive: true
  },
  {
    question: "Can I leave a review after my visit?",
    answer: "Yes! We encourage all users to leave reviews after their visits. You can rate your experience and leave feedback through the app or website within 7 days of your visit. Your reviews help other dog owners and field owners improve their services.",
    category: "general",
    order: 7,
    isActive: true
  },
  {
    question: "Are all fields fully fenced and secure?",
    answer: "Yes, all fields listed on Fieldsy are required to be fully enclosed with secure fencing. We verify fencing details during the onboarding process, and field owners must maintain these safety standards.",
    category: "field-owners",
    order: 8,
    isActive: true
  },
  {
    question: "Can I bring more than one dog?",
    answer: "Yes, you can bring multiple dogs to most fields. The maximum number of dogs allowed varies by field and is clearly stated in each listing. Some fields may charge an additional fee for extra dogs.",
    category: "dog-owners",
    order: 9,
    isActive: true
  },
  // Additional FAQs for field owners
  {
    question: "How do I list my field on Fieldsy?",
    answer: "To list your field, sign up as a field owner, complete your profile, and add your field details including location, size, amenities, and photos. Our team will review your submission within 24-48 hours.",
    category: "field-owners",
    order: 10,
    isActive: true
  },
  {
    question: "What commission does Fieldsy charge?",
    answer: "Fieldsy charges a standard commission rate on successful bookings. The exact rate may vary based on your agreement. You can view your commission rate in your field owner dashboard.",
    category: "field-owners",
    order: 11,
    isActive: true
  },
  {
    question: "When do I receive payment for bookings?",
    answer: "Payments are processed automatically after the booking is completed. Funds are typically transferred to your bank account within 3-5 business days.",
    category: "payment",
    order: 12,
    isActive: true
  },
  // Additional FAQs for dog owners
  {
    question: "Do I need to clean up after my dog?",
    answer: "Yes, all dog owners are expected to clean up after their pets. Most fields provide waste bags and bins, but we recommend bringing your own supplies as well.",
    category: "dog-owners",
    order: 13,
    isActive: true
  },
  {
    question: "What happens if my dog damages the field?",
    answer: "Dog owners are responsible for any damage caused by their pets. We recommend having pet insurance that covers third-party liability. Report any damage immediately to the field owner.",
    category: "dog-owners",
    order: 14,
    isActive: true
  },
  {
    question: "Can I book recurring sessions?",
    answer: "Yes, you can set up recurring bookings for the same field and time slot. This is perfect for regular training sessions or routine exercise schedules.",
    category: "booking",
    order: 15,
    isActive: true
  }
];

async function seedFAQs() {
  try {
    console.log('🌱 Starting FAQ seeding...');
    
    // Clear existing FAQs (optional - comment out if you want to keep existing)
    // await prisma.fAQ.deleteMany();
    // console.log('✅ Cleared existing FAQs');
    
    // Check for existing FAQs
    const existingCount = await prisma.fAQ.count();
    
    if (existingCount > 0) {
      console.log(`⚠️  Found ${existingCount} existing FAQs. Skipping seed to avoid duplicates.`);
      console.log('💡 To replace existing FAQs, uncomment the deleteMany line in the script.');
      return;
    }
    
    // Create FAQs
    for (const faq of faqs) {
      await prisma.fAQ.create({
        data: faq
      });
      console.log(`✅ Created FAQ: "${faq.question}"`);
    }
    
    console.log(`\n🎉 Successfully seeded ${faqs.length} FAQs!`);
    
    // Display summary
    const summary = await prisma.fAQ.groupBy({
      by: ['category'],
      _count: true,
      orderBy: {
        category: 'asc'
      }
    });
    
    console.log('\n📊 FAQ Summary by Category:');
    summary.forEach(cat => {
      console.log(`   ${cat.category}: ${cat._count} FAQs`);
    });
    
  } catch (error) {
    console.error('❌ Error seeding FAQs:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

seedFAQs();