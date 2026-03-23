import mongoose from 'mongoose';
import { AboutPage } from './src/models/about-page.model';
import dotenv from 'dotenv';

dotenv.config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/fieldsy');

async function seedAboutPage() {
  try {
    // Check if about page already exists
    const existingPage = await AboutPage.findOne();
    
    if (existingPage) {
      console.log('About page content already exists. Updating...');
    }

    const aboutPageData = {
      heroSection: {
        sectionTitle: 'About Us',
        mainTitle: 'Safe, Private Fields Where Every Dog Can Run Free',
        description: 'Fieldsy is the UK\'s marketplace for private dog walking fields. We connect dog owners who need secure, enclosed spaces with landowners who have the land to offer. Whether your dog is reactive, in training, or simply loves to sprint -- Fieldsy makes it easy to find, book, and enjoy a peaceful off-lead session near you.',
        buttonText: 'Download the App',
        image: 'https://fieldsy-s3.s3.eu-west-2.amazonaws.com/defaults/about/dog2.webp',
        stats: [
          { value: '500+', label: 'Dog Owners Signed Up', order: 1 },
          { value: '200+', label: 'Private Fields Listed', order: 2 },
          { value: '50+', label: 'Towns & Cities Across the UK', order: 3 },
          { value: '100%', label: 'Secure, Fenced Spaces', order: 4 }
        ]
      },
      missionSection: {
        title: 'Our Mission',
        description: 'At Fieldsy, we are on a mission to give every dog the freedom to explore off-lead -- safely. We connect dog owners with private, fully enclosed fields across the UK, making it simple to find, book, and enjoy peaceful walks away from busy parks, unpredictable dogs, and crowded spaces. Because every dog deserves room to run, and every owner deserves peace of mind.',
        buttonText: 'Join Our Community',
        image: 'https://fieldsy-s3.s3.eu-west-2.amazonaws.com/defaults/about/dog2.webp'
      },
      whoWeAreSection: {
        title: 'Who We Are',
        description: 'We are a small, passionate team of dog lovers, developers, and outdoor enthusiasts based in the UK. We built Fieldsy because we know first-hand how hard it can be to find a safe, enclosed space for reactive, nervous, or high-energy dogs. Our combined love for technology and animals drives everything we do -- and we will not stop until every dog owner in the UK has a private field within easy reach.',
        features: [
          {
            icon: 'Heart',
            title: 'Dog Lovers',
            description: 'Founded by dog owners who understand the importance of safe spaces',
            order: 1
          },
          {
            icon: 'Shield',
            title: 'Safety First',
            description: 'Committed to providing secure, fully-fenced fields',
            order: 2
          },
          {
            icon: 'Users',
            title: 'Community Driven',
            description: 'Building a community of responsible dog owners',
            order: 3
          }
        ]
      },
      whatWeDoSection: {
        title: 'What We Do',
        subtitle: '',
        description: 'Fieldsy brings dog owners and landowners together on one simple platform. Dog owners browse and book secure, private fields. Landowners list their land and earn income. Everyone benefits -- especially the dogs.',
        image: 'https://fieldsy-s3.s3.eu-west-2.amazonaws.com/defaults/about/dog2.webp',
        features: [
          {
            title: 'Browse Fields Near You',
            description: 'Explore a growing network of private, secure dog walking fields across the UK. Filter by size, amenities, and distance.',
            order: 1
          },
          {
            title: 'Book Instantly',
            description: 'Reserve your time slot in a few taps -- no waiting, no back-and-forth with the host.',
            order: 2
          },
          {
            title: 'Enjoy Peace of Mind',
            description: 'Let your dog run free in a fully enclosed, verified space. No unexpected dogs, no distractions.',
            order: 3
          },
          {
            title: 'List Your Land',
            description: 'Turn unused or underused land into a steady source of income by hosting dog owners.',
            order: 4
          },
          {
            title: 'Set Your Own Schedule',
            description: 'Control exactly when your field is available. Block dates, set opening hours, adjust as you go.',
            order: 5
          },
          {
            title: 'Get Paid Automatically',
            description: 'Receive secure payouts directly to your bank account after each completed booking. Powered by Stripe.',
            order: 6
          }
        ]
      },
      whyFieldsySection: {
        title: 'Why Fieldsy?',
        subtitle: 'Choosing Fieldsy means choosing peace of mind for you and real freedom for your dog.',
        features: [
          {
            icon: 'CheckCircle',
            title: 'Secure & Private',
            description: 'Every field is enclosed and verified. You and your dog have the space entirely to yourselves during your booking.',
            order: 1
          },
          {
            icon: 'MapPin',
            title: 'Local & Convenient',
            description: 'Find fields close to home with postcode or GPS search. No long drives -- just easy access to safe spaces nearby.',
            order: 2
          },
          {
            icon: 'Calendar',
            title: 'Flexible Booking',
            description: 'Book by the hour, at a time that suits you. Cancel within the window if plans change -- no penalty.',
            order: 3
          },
          {
            icon: 'Shield',
            title: 'Trusted Community',
            description: 'Verified hosts, real reviews, and responsive support. We take safety and trust seriously.',
            order: 4
          }
        ]
      }
    };

    let result;
    if (existingPage) {
      result = await AboutPage.findByIdAndUpdate(
        existingPage._id,
        aboutPageData,
        { new: true }
      );
      console.log('About page content updated successfully!');
    } else {
      result = await AboutPage.create(aboutPageData);
      console.log('About page content created successfully!');
    }
    
    if (result) {
      console.log('About page ID:', result._id);
    }
    
  } catch (error) {
    console.error('Error seeding about page:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
}

seedAboutPage();