/**
 * Re-scrape images from britishdogfields.com for fields with broken images.
 * Targets the slider class: citadela-block-articles-wrap citadelaFancyboxGallery swiper-wrapper
 *
 * Usage:
 *   cd backend
 *   PATH="/usr/local/bin:/usr/local/Cellar/node/24.9.0/bin:$PATH" node scripts/rescrape-britishdogfields-images.js
 */
const { PrismaClient } = require('@prisma/client');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const cheerio = require('cheerio');
const https = require('https');
const http = require('http');
const prisma = new PrismaClient();

// S3 config
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'eu-west-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const S3_BUCKET = process.env.AWS_S3_BUCKET || 'fieldsy-s3';
const S3_FOLDER = 'field-images';

// Fields with broken britishdogfields.com images
// Some have custom slug overrides where the auto-generated slug doesn't match the site
const fieldsToRescrape = [
  { id: '695cfec61ee544eced64325d', name: 'Slade Park Secure Dog Walking Field, Bodmin' },
  { id: '695cfec61ee544eced64325e', name: 'The Dog Walking Field, Tamworth/Lichfield', slug: 'the-dog-walking-field-tamworth-lichfield' },
  { id: '695cfec61ee544eced64325f', name: "Monty's Meadow, Stratton-on-the-Fosse" },
  { id: '695cfec61ee544eced643260', name: 'Paw Paddock, North Waltham' },
  { id: '695cfec71ee544eced643266', name: 'The Deben Dog Hub, Woodbridge', slug: 'the-deben-dog-hub-dog-field-woodbridge' },
  { id: '695cfec91ee544eced64326d', name: 'The Oak Leaf Dog Park, Peckleton' },
  { id: '695cfec91ee544eced643271', name: 'Pool Dog Park, Wharfedale', slug: 'pool-dog-park-otley' },
  { id: '695cfeca1ee544eced643278', name: 'The Dog Meadow, Magheralin', slug: 'the-dog-meadow-craigavon' },
  { id: '695cfecb1ee544eced643279', name: 'Stash Stables Dog Park, Dudley', slug: 'stash-dog-park-dudley' },
  { id: '695cfecb1ee544eced64327a', name: "Callander K9's Adventure Playground, Callander" },
  { id: '695cfecb1ee544eced64327b', name: 'Thornborough Paws, Thornborough', slug: 'thornborough-paws-secure-dog-field-near-milton-keynes' },
  { id: '695cfec61ee544eced643261', name: 'Secure Paws Dog Field, Chipping Norton' },
  { id: '695cfec81ee544eced64326b', name: 'Hounds & Bounds, Little London' },
  { id: '695cfec91ee544eced64326f', name: 'Four Acres Dog Field, Hilperton', slug: 'four-acres-dog-field-trowbridge' },
  { id: '695cfec81ee544eced64326a', name: 'Peddars Paws Field, Bridgham' },
  { id: '695cfec91ee544eced64326e', name: 'Unleashed Dog Adventure Park, Moira' },
];

// Convert field name to URL slug
function nameToSlug(name) {
  return name
    .toLowerCase()
    .replace(/[''"]/g, '')           // Remove apostrophes and quotes
    .replace(/&/g, '')               // Remove ampersand
    .replace(/[,.:;!?]/g, '')        // Remove punctuation
    .replace(/\s+/g, '-')            // Replace spaces with dashes
    .replace(/--+/g, '-')            // Replace multiple dashes with single
    .replace(/^-|-$/g, '');          // Remove leading/trailing dashes
}

// Fetch URL content
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    };

    protocol.get(url, options, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return fetchUrl(response.headers.location).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => resolve(data));
      response.on('error', reject);
    }).on('error', reject);
  });
}

// Fetch image as buffer
function fetchImageBuffer(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'image/*,*/*;q=0.8',
      }
    };

    protocol.get(url, options, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return fetchImageBuffer(response.headers.location).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

// Upload image to S3
async function uploadToS3(buffer, fieldId, index) {
  // Convert to WebP
  const webpBuffer = await sharp(buffer)
    .webp({ quality: 80 })
    .toBuffer();

  const key = `${S3_FOLDER}/${fieldId}-rescrape-${index}-${Date.now()}.webp`;

  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: webpBuffer,
    ContentType: 'image/webp',
  }));

  return `https://${S3_BUCKET}.s3.eu-west-2.amazonaws.com/${key}`;
}

// Extract images from the page
function extractImages(html, baseUrl, fieldName) {
  const $ = cheerio.load(html);
  const images = [];

  // Extract key words from field name for matching
  const fieldWords = fieldName.toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3);

  // Target lazy-loaded images (data-lazy-src is the real source)
  $('img').each((i, el) => {
    // Prefer data-lazy-src, then data-src, then src
    let src = $(el).attr('data-lazy-src') || $(el).attr('data-src') || $(el).attr('src');

    if (!src) return;

    // Skip data: URIs
    if (src.startsWith('data:')) return;

    // Make absolute URL if relative
    if (src.startsWith('//')) {
      src = 'https:' + src;
    } else if (src.startsWith('/')) {
      src = 'https://britishdogfields.com' + src;
    }

    // Skip icons, logos, UI elements
    if (src.includes('map.png') ||
        src.includes('search.png') ||
        src.includes('icon') ||
        src.includes('logo') ||
        src.includes('checklist') ||
        src.includes('placeholder')) {
      return;
    }

    // Only include images that seem related to this field
    // Check if image URL contains any field name words
    const srcLower = src.toLowerCase();
    const isFieldImage = fieldWords.some(word => srcLower.includes(word)) ||
                         srcLower.includes('/uploads/202') || // Date-based uploads
                         srcLower.includes('/uploads/2024') ||
                         srcLower.includes('/uploads/2025');

    // For swiper/gallery images, be more lenient
    const isInGallery = $(el).closest('.swiper-slide, .citadelaFancyboxGallery, .gallery').length > 0;

    if (isFieldImage || isInGallery) {
      images.push(src);
    }
  });

  // Also check fancybox links for full-size images
  $('a[data-fancybox], a.fancybox, a[href*=".jpg"], a[href*=".jpeg"], a[href*=".png"]').each((i, el) => {
    let href = $(el).attr('href');
    if (!href) return;
    if (href.startsWith('data:')) return;

    if (href.startsWith('/')) {
      href = 'https://britishdogfields.com' + href;
    }

    // Check if it's a gallery image
    const hrefLower = href.toLowerCase();
    if ((hrefLower.endsWith('.jpg') || hrefLower.endsWith('.jpeg') || hrefLower.endsWith('.png') || hrefLower.endsWith('.webp')) &&
        !hrefLower.includes('icon') && !hrefLower.includes('logo')) {
      // Prefer full-size over thumbnail
      const fullSize = href.replace(/-\d+x\d+\./, '.');
      images.push(fullSize);
    }
  });

  // Deduplicate and filter to reasonable count
  const unique = [...new Set(images)];

  // Prioritize images that match field name
  const sorted = unique.sort((a, b) => {
    const aMatch = fieldWords.some(w => a.toLowerCase().includes(w)) ? 0 : 1;
    const bMatch = fieldWords.some(w => b.toLowerCase().includes(w)) ? 0 : 1;
    return aMatch - bMatch;
  });

  return sorted.slice(0, 10); // Limit to 10 images
}

// Delay helper
const delay = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('=== Re-scraping images from britishdogfields.com ===\n');

  let updated = 0;
  let failed = 0;

  for (const field of fieldsToRescrape) {
    // Skip if marked
    if (field.skip) {
      console.log(`\n─────────────────────────────────────────────`);
      console.log(`Field: ${field.name}`);
      console.log(`  ⏭ Skipped (page not found on site)`);
      continue;
    }

    // Use custom slug if provided, otherwise generate from name
    const slug = field.slug || nameToSlug(field.name);
    const url = `https://britishdogfields.com/item/${slug}/`;

    console.log(`\n─────────────────────────────────────────────`);
    console.log(`Field: ${field.name}`);
    console.log(`URL: ${url}`);

    try {
      // Fetch the page
      const html = await fetchUrl(url);
      console.log(`  ✓ Page fetched`);

      // Extract images
      const imageUrls = extractImages(html, url, field.name);
      console.log(`  Found ${imageUrls.length} images`);

      if (imageUrls.length === 0) {
        console.log(`  ⚠ No images found, skipping`);
        failed++;
        continue;
      }

      // Download and upload each image to S3
      const s3Urls = [];
      for (let i = 0; i < imageUrls.length; i++) {
        const imgUrl = imageUrls[i];
        try {
          console.log(`    [${i + 1}/${imageUrls.length}] Downloading: ${imgUrl.substring(0, 60)}...`);
          const buffer = await fetchImageBuffer(imgUrl);

          if (buffer.length < 1000) {
            console.log(`      ⚠ Too small, skipping`);
            continue;
          }

          const s3Url = await uploadToS3(buffer, field.id, i);
          s3Urls.push(s3Url);
          console.log(`      ✓ Uploaded to S3`);

          await delay(300); // Rate limit
        } catch (err) {
          console.log(`      ✗ Failed: ${err.message}`);
        }
      }

      if (s3Urls.length === 0) {
        console.log(`  ⚠ No images uploaded, skipping DB update`);
        failed++;
        continue;
      }

      // Update field in database
      await prisma.field.update({
        where: { id: field.id },
        data: { images: s3Urls }
      });

      console.log(`  ✓ Updated field with ${s3Urls.length} new images`);
      updated++;

      await delay(1000); // Rate limit between pages

    } catch (err) {
      console.log(`  ✗ Failed: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n\n=== DONE ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Failed: ${failed}`);

  await prisma.$disconnect();
}

main().catch(console.error);
