/**
 * Google Reviews Scraper
 * Scrapes Google Maps reviews and saves them to the database
 *
 * Usage:
 *   node scripts/scrape-google-reviews.js <fieldId> <googleMapsUrl>
 *
 * Example:
 *   node scripts/scrape-google-reviews.js 68e8d3458371de66da4bed51 "https://www.google.com/maps/place/Field+Day+Dog+Field/@52.0183678,-1.3740883,18z/..."
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function scrapeGoogleReviews(fieldIdOrFieldId, googleMapsUrl) {
  try {
    console.log(`\n🔍 Scraping Google reviews for field: ${fieldIdOrFieldId}`);
    console.log(`📍 URL: ${googleMapsUrl}\n`);

    // Find the field by either ObjectId or human-readable fieldId
    console.log('🔎 Looking up field in database...');

    // Check if it's a valid MongoDB ObjectId (24 hex characters)
    const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(fieldIdOrFieldId);

    const field = await prisma.field.findFirst({
      where: isValidObjectId
        ? {
            OR: [
              { id: fieldIdOrFieldId },
              { fieldId: fieldIdOrFieldId }
            ]
          }
        : {
            fieldId: fieldIdOrFieldId  // Only search by fieldId if not a valid ObjectId
          },
      select: {
        id: true,
        fieldId: true,
        name: true
      }
    });

    if (!field) {
      console.error(`❌ Field with ID ${fieldIdOrFieldId} not found`);
      console.log('💡 Tip: Use either the MongoDB ObjectId or the human-readable field ID (e.g., F1916)');
      return;
    }

    console.log(`✅ Found field: ${field.name} (ID: ${field.fieldId || field.id})\n`);

    // Use puppeteer for scraping
    let browser;
    try {
      const puppeteer = require('puppeteer');

      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const page = await browser.newPage();

      // Set viewport and user agent
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      // Helper function for delays (compatible with all Puppeteer versions)
      const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

      console.log('⏳ Loading Google Maps page...');
      await page.goto(googleMapsUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      // Wait for reviews to load
      await delay(3000);

      // Try to find and click "Reviews" tab if it exists
      try {
        const reviewsTab = await page.$('button[aria-label*="Reviews"]');
        if (reviewsTab) {
          console.log('📋 Clicking Reviews tab...');
          await reviewsTab.click();
          await delay(2000);
        }
      } catch (e) {
        console.log('ℹ️  No Reviews tab found, proceeding...');
      }

      // Scroll to load more reviews
      console.log('📜 Scrolling to load reviews...');
      const reviewsContainer = await page.$('.m6QErb.DxyBCb.kA9KIf.dS8AEf');
      if (reviewsContainer) {
        for (let i = 0; i < 3; i++) {
          await page.evaluate((selector) => {
            const element = document.querySelector(selector);
            if (element) {
              element.scrollTop = element.scrollHeight;
            }
          }, '.m6QErb.DxyBCb.kA9KIf.dS8AEf');
          await delay(1500);
        }
      }

      // Extract reviews using the target class
      console.log('🔎 Extracting reviews...');
      const reviews = await page.evaluate(() => {
        const reviewElements = document.querySelectorAll('.jftiEf');
        const extractedReviews = [];

        reviewElements.forEach((element) => {
          try {
            // Author name
            const authorElement = element.querySelector('.d4r55');
            const authorName = authorElement ? authorElement.textContent.trim() : 'Anonymous';

            // Author photo
            const photoElement = element.querySelector('.NBa7we');
            const authorPhoto = photoElement ? photoElement.src : null;

            // Rating
            const ratingElement = element.querySelector('.kvMYJc');
            const ratingText = ratingElement ? ratingElement.getAttribute('aria-label') : '0';
            const ratingMatch = ratingText.match(/(\d+)/);
            const rating = ratingMatch ? parseInt(ratingMatch[1]) : 0;

            // Review text
            const textElement = element.querySelector('.wiI7pd');
            const text = textElement ? textElement.textContent.trim() : '';

            // Review time
            const timeElement = element.querySelector('.rsqaWe');
            const reviewTime = timeElement ? timeElement.textContent.trim() : '';

            if (authorName && rating > 0) {
              extractedReviews.push({
                authorName,
                authorPhoto,
                rating,
                text,
                reviewTime
              });
            }
          } catch (err) {
            console.error('Error extracting review:', err);
          }
        });

        return extractedReviews;
      });

      await browser.close();

      console.log(`✅ Found ${reviews.length} reviews\n`);

      if (reviews.length === 0) {
        console.log('⚠️  No reviews found. Possible reasons:');
        console.log('   - The page structure has changed');
        console.log('   - Reviews are not visible');
        console.log('   - The URL is incorrect');
        return;
      }

      // Delete existing Google reviews for this field
      await prisma.googleReview.deleteMany({
        where: { fieldId: field.id }
      });

      console.log('💾 Saving reviews to database...');

      // Save reviews to database
      let savedCount = 0;
      for (const review of reviews) {
        try {
          await prisma.googleReview.create({
            data: {
              fieldId: field.id,
              authorName: review.authorName,
              authorPhoto: review.authorPhoto,
              rating: review.rating,
              text: review.text || '',
              reviewTime: review.reviewTime
            }
          });
          savedCount++;
        } catch (err) {
          console.error(`Error saving review from ${review.authorName}:`, err.message);
        }
      }

      console.log(`\n✅ Successfully saved ${savedCount}/${reviews.length} reviews`);
      console.log(`\n📊 Summary:`);
      reviews.forEach((review, i) => {
        console.log(`   ${i + 1}. ${review.authorName} - ${'⭐'.repeat(review.rating)} (${review.rating}/5)`);
        if (review.text) {
          console.log(`      "${review.text.substring(0, 80)}${review.text.length > 80 ? '...' : ''}"`);
        }
      });

    } catch (error) {
      if (browser) await browser.close();
      throw error;
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('\n💡 Tips:');
    console.error('   - Make sure puppeteer is installed: npm install puppeteer');
    console.error('   - Check if the Google Maps URL is correct');
    console.error('   - Ensure the field ID exists in the database');
  } finally {
    await prisma.$disconnect();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: node scripts/scrape-google-reviews.js <fieldId> <googleMapsUrl>');
  console.error('');
  console.error('Examples:');
  console.error('  Using human-readable ID: node scripts/scrape-google-reviews.js F1916 "https://www.google.com/maps/place/..."');
  console.error('  Using MongoDB ObjectId:  node scripts/scrape-google-reviews.js 68e8d3458371de66da4bed51 "https://www.google.com/maps/place/..."');
  process.exit(1);
}

const [fieldIdOrFieldId, googleMapsUrl] = args;
scrapeGoogleReviews(fieldIdOrFieldId, googleMapsUrl);
