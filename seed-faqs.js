const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const faqs = [
  // ==========================================
  // 4.1 Booking (4 questions)
  // ==========================================
  {
    question: "How do I book a dog walking field?",
    answer: "Search for fields near you by entering your postcode or using GPS. Browse the results, pick a field you like, choose an available time slot, and complete your booking with a secure online payment. You will receive instant confirmation by email and in the app.",
    category: "booking",
    order: 1,
    isActive: true
  },
  {
    question: "Can I book more than one session at a time?",
    answer: "Yes. You can book multiple sessions across different fields or multiple slots at the same field, subject to availability. There is a maximum of 10 active bookings per account to ensure fair access for everyone.",
    category: "booking",
    order: 2,
    isActive: true
  },
  {
    question: "How far in advance can I book?",
    answer: "You can book up to 30 days in advance. Availability depends on the host's schedule, so popular fields may fill up quickly -- especially at weekends.",
    category: "booking",
    order: 3,
    isActive: true
  },
  {
    question: "Can I book on behalf of someone else?",
    answer: "Bookings are tied to your account for safety and accountability. If a friend or family member wants to use a field, they should create their own Fieldsy account and book directly.",
    category: "booking",
    order: 4,
    isActive: true
  },

  // ==========================================
  // 4.2 Cancellations & Refunds (4 questions)
  // ==========================================
  {
    question: "What is the cancellation policy?",
    answer: "You can cancel free of charge up to 12 hours before your booking start time. Cancellations made within the 12-hour window are non-refundable, as the host has reserved the field exclusively for you.",
    category: "cancellations-refunds",
    order: 1,
    isActive: true
  },
  {
    question: "How do I cancel a booking?",
    answer: "Open the app, go to your bookings, select the session you want to cancel, and tap \"Cancel Booking\". If you are within the free cancellation window, your refund will be processed automatically.",
    category: "cancellations-refunds",
    order: 2,
    isActive: true
  },
  {
    question: "How long does a refund take?",
    answer: "Refunds are processed within 5-10 business days and returned to your original payment method. You will receive an email confirmation when the refund is issued.",
    category: "cancellations-refunds",
    order: 3,
    isActive: true
  },
  {
    question: "What happens if the host cancels?",
    answer: "If a host cancels your booking, you will receive a full refund automatically, regardless of how close to the session it is. We will also notify you immediately so you can rebook elsewhere.",
    category: "cancellations-refunds",
    order: 4,
    isActive: true
  },

  // ==========================================
  // 4.3 Safety & Security (4 questions)
  // ==========================================
  {
    question: "Are the fields safe for my dog?",
    answer: "Every field on Fieldsy is verified before it goes live. We check that the field is fully enclosed with secure fencing, has a safe entry/exit system (such as double gates), and meets our listing standards. Hosts are required to maintain their fields to these standards.",
    category: "safety-security",
    order: 1,
    isActive: true
  },
  {
    question: "Will there be other dogs in the field during my booking?",
    answer: "No. When you book a time slot, the field is reserved exclusively for you. No other bookings overlap with yours, so you and your dog have complete privacy.",
    category: "safety-security",
    order: 2,
    isActive: true
  },
  {
    question: "What if something goes wrong during my visit?",
    answer: "Contact our support team through the app or by emailing info@fieldsy.co.uk. If there is a safety concern with a field, we will investigate promptly and take action, which may include suspending the listing.",
    category: "safety-security",
    order: 3,
    isActive: true
  },
  {
    question: "Is my payment information secure?",
    answer: "Yes. All payments are processed through Stripe, a PCI-compliant payment provider. Fieldsy never stores your card details.",
    category: "safety-security",
    order: 4,
    isActive: true
  },

  // ==========================================
  // 4.4 Field Access (4 questions)
  // ==========================================
  {
    question: "How do I access the field when I arrive?",
    answer: "Each host provides access instructions in the booking confirmation. This typically includes a gate code, key safe location, or on-site directions. You will receive these details once your booking is confirmed.",
    category: "field-access",
    order: 1,
    isActive: true
  },
  {
    question: "What if I cannot find the field or get in?",
    answer: "Check the access instructions in your booking confirmation first. If you are still unable to get in, contact the host directly through the app. If they are unresponsive, reach out to our support team and we will help resolve the issue.",
    category: "field-access",
    order: 2,
    isActive: true
  },
  {
    question: "Is there parking at the field?",
    answer: "Most fields have parking available, and each listing specifies whether parking is on-site, on-road, or nearby. Check the field details page before booking to confirm.",
    category: "field-access",
    order: 3,
    isActive: true
  },
  {
    question: "Can I arrive early or stay late?",
    answer: "Please arrive at your booked time and leave promptly when your session ends. Another dog owner may have booked the slot immediately after yours, and punctuality ensures a smooth experience for everyone.",
    category: "field-access",
    order: 4,
    isActive: true
  },

  // ==========================================
  // 4.5 Dogs & Suitability (4 questions)
  // ==========================================
  {
    question: "Is Fieldsy suitable for reactive dogs?",
    answer: "Absolutely. Fieldsy was built with reactive dogs in mind. Every field is fully enclosed and privately booked, so there are no surprise encounters with other dogs or people. It is a controlled, calm environment where reactive dogs can decompress and enjoy off-lead time safely.",
    category: "dogs-suitability",
    order: 1,
    isActive: true
  },
  {
    question: "How many dogs can I bring?",
    answer: "Each field listing specifies the maximum number of dogs allowed per booking. Most fields accommodate 1-3 dogs. Check the field details before booking. If you plan to bring dogs from separate households, ensure the field's policy permits it.",
    category: "dogs-suitability",
    order: 2,
    isActive: true
  },
  {
    question: "Are there fields suitable for puppies?",
    answer: "Yes. Many fields are suitable for puppies, and hosts often note whether their field is puppy-friendly in the listing. Look for fields with secure, low fencing and minimal hazards.",
    category: "dogs-suitability",
    order: 3,
    isActive: true
  },
  {
    question: "What if my dog damages something at the field?",
    answer: "Dog owners are responsible for their dogs during their visit. If your dog causes damage to the field or its facilities, the host may raise a claim. We encourage all parties to communicate through the platform to resolve any issues.",
    category: "dogs-suitability",
    order: 4,
    isActive: true
  },

  // ==========================================
  // 4.6 For Hosts / Landowners (4 questions)
  // ==========================================
  {
    question: "How do I list my land on Fieldsy?",
    answer: "Sign up for a free host account, add your field details (size, fencing, amenities, photos), set your pricing and availability, and submit for review. Once verified, your field will go live and start appearing in search results.",
    category: "field-owners",
    order: 1,
    isActive: true
  },
  {
    question: "What does Fieldsy charge hosts?",
    answer: "Fieldsy takes a commission on each completed booking. The current rate is displayed in your host dashboard. There are no upfront fees, no monthly subscriptions, and no listing charges.",
    category: "field-owners",
    order: 2,
    isActive: true
  },
  {
    question: "How do I get paid?",
    answer: "Payouts are sent directly to your bank account via Stripe after the cancellation window for each booking has passed. You can track all earnings and upcoming payouts in your host dashboard.",
    category: "field-owners",
    order: 3,
    isActive: true
  },
  {
    question: "What are the requirements for listing a field?",
    answer: "Your field must be fully enclosed with secure fencing, have a safe entry/exit point, and be free of hazards. You will need to provide accurate photos and details during the listing process. Our team reviews every submission before it goes live.",
    category: "field-owners",
    order: 4,
    isActive: true
  },

  // ==========================================
  // 4.7 Payments (4 questions)
  // ==========================================
  {
    question: "What payment methods do you accept?",
    answer: "We accept all major debit and credit cards (Visa, Mastercard, American Express) through our payment provider, Stripe. Apple Pay and Google Pay are also supported on compatible devices.",
    category: "payments",
    order: 1,
    isActive: true
  },
  {
    question: "When am I charged?",
    answer: "You are charged at the time of booking. The full amount is taken when you confirm and pay.",
    category: "payments",
    order: 2,
    isActive: true
  },
  {
    question: "Do you offer gift vouchers or credit?",
    answer: "Not at the moment, but this is something we are exploring. Follow us on social media or subscribe to our newsletter for updates.",
    category: "payments",
    order: 3,
    isActive: true
  },
  {
    question: "Can I get a VAT receipt?",
    answer: "Booking confirmations include a payment summary. If you require a formal VAT receipt, contact info@fieldsy.co.uk with your booking reference.",
    category: "payments",
    order: 4,
    isActive: true
  },

  // ==========================================
  // 4.8 Support (4 questions)
  // ==========================================
  {
    question: "How do I contact Fieldsy support?",
    answer: "You can reach us through the in-app support chat, or by emailing info@fieldsy.co.uk. We aim to respond within 24 hours on working days.",
    category: "support",
    order: 1,
    isActive: true
  },
  {
    question: "I have a suggestion or feature request. Where do I send it?",
    answer: "We genuinely want to hear from you. Email us at info@fieldsy.co.uk or use the feedback option in the app. Many of our best features started as user suggestions.",
    category: "support",
    order: 2,
    isActive: true
  },
  {
    question: "How do I report a problem with a field?",
    answer: "If you experience an issue during or after your visit -- whether it is a safety concern, inaccurate listing, or access problem -- report it through the app or email info@fieldsy.co.uk. We investigate every report and take appropriate action.",
    category: "support",
    order: 3,
    isActive: true
  },
  {
    question: "Is there a phone number I can call?",
    answer: "We are currently an email and in-app support team. This allows us to respond thoroughly and keep a clear record of every conversation. If your issue is urgent, mark your email as urgent and we will prioritise it.",
    category: "support",
    order: 4,
    isActive: true
  }
];

async function seedFAQs() {
  try {
    console.log('Starting FAQ seeding...');
    console.log(`Total FAQs to seed: ${faqs.length}`);

    // Delete all existing FAQs
    const deleted = await prisma.fAQ.deleteMany();
    console.log(`Deleted ${deleted.count} existing FAQs`);

    // Insert all FAQs
    for (const faq of faqs) {
      await prisma.fAQ.create({ data: faq });
    }

    console.log(`Successfully inserted ${faqs.length} FAQs`);

    // Display summary by category
    const summary = await prisma.fAQ.groupBy({
      by: ['category'],
      _count: true,
      orderBy: { category: 'asc' }
    });

    console.log('\nFAQ Summary by Category:');
    summary.forEach(cat => {
      console.log(`  ${cat.category}: ${cat._count} FAQs`);
    });

    const total = await prisma.fAQ.count();
    console.log(`\nTotal FAQs in database: ${total}`);

  } catch (error) {
    console.error('Error seeding FAQs:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

seedFAQs();
