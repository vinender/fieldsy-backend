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
        mainTitle: 'Find Safe, Private Dog\nWalking Fields Near You',
        description: 'At Fieldsy, we believe every dog deserves the freedom to run, sniff, and play safely. Born out of love for dogs and a need for secure, off-lead spaces, Fieldsy helps you find and book private dog walking fields across the UK—quickly and effortlessly.',
        buttonText: 'Download App',
        image: 'https://fieldsy-s3.s3.eu-west-2.amazonaws.com/defaults/about/dog2.webp',
        stats: [
          { value: '500+', label: 'Early Access Signups', order: 1 },
          { value: '200+', label: 'Private Fields Being Onboarded', order: 2 },
          { value: '50+', label: 'Cities Covered Across the UK', order: 3 },
          { value: '100%', label: 'Safe, Secure & Fenced Spaces', order: 4 }
        ]
      },
      missionSection: {
        title: 'Our Mission',
        description: 'To provide dog owners with easy access to safe, secure, and private fields where their dogs can exercise, play, and socialize freely without the worry of other dogs, livestock, or traffic.',
        buttonText: 'Join Our Community',
        image: 'https://fieldsy-s3.s3.eu-west-2.amazonaws.com/defaults/about/dog2.webp'
      },
      whoWeAreSection: {
        title: 'Who We Are',
        description: 'We are a team of passionate dog lovers and tech enthusiasts committed to improving the lives of dogs and their owners across the UK.',
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
        subtitle: 'Making dog walking safer and more enjoyable',
        description: 'We connect dog owners with private field owners, creating a marketplace for safe, bookable dog exercise spaces.',
        image: 'https://fieldsy-s3.s3.eu-west-2.amazonaws.com/defaults/about/dog2.webp',
        features: [
          {
            title: 'Vetted Fields',
            description: 'Every field is inspected to ensure it meets our safety standards',
            order: 1
          },
          {
            title: 'Easy Booking',
            description: 'Simple online booking with instant confirmation',
            order: 2
          },
          {
            title: 'Secure Payments',
            description: 'Safe and secure payment processing',
            order: 3
          }
        ]
      },
      whyFieldsySection: {
        title: 'Why Choose Fieldsy',
        subtitle: 'The benefits of using our platform',
        features: [
          {
            icon: 'CheckCircle',
            title: 'Private & Exclusive',
            description: 'Your booked time slot is exclusively yours',
            order: 1
          },
          {
            icon: 'MapPin',
            title: 'Convenient Locations',
            description: 'Fields available across the UK',
            order: 2
          },
          {
            icon: 'Clock',
            title: 'Flexible Booking',
            description: 'Book by the hour at times that suit you',
            order: 3
          },
          {
            icon: 'Star',
            title: 'Quality Assured',
            description: 'All fields meet our high standards',
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