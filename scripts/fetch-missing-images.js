const https = require('https');
const http = require('http');
const { MongoClient, ObjectId } = require('mongodb');

const MONGO_URI = 'mongodb+srv://veninderindiit:veninderindiit@fieldsy-cluster.6xni4zm.mongodb.net/fieldsy?retryWrites=true&w=majority';

// Helper to fetch a URL and return HTML
function fetchUrl(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    const req = protocol.get(url, {
      timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      }
    }, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
          const urlObj = new URL(url);
          redirectUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
        }
        return fetchUrl(redirectUrl, timeout).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

// Extract images from HTML
function extractImages(html, baseUrl) {
  const images = [];

  // Parse base URL for relative paths
  let urlBase = '';
  try {
    const urlObj = new URL(baseUrl);
    urlBase = `${urlObj.protocol}//${urlObj.host}`;
  } catch (e) {}

  // Common patterns for field/dog park images
  const patterns = [
    // WordPress featured images
    /<img[^>]+class="[^"]*(?:wp-post-image|attachment-full|featured)[^"]*"[^>]+src="([^"]+)"/gi,
    // Gallery images
    /<img[^>]+class="[^"]*(?:gallery|slider|carousel)[^"]*"[^>]+src="([^"]+)"/gi,
    // Background images in style
    /style="[^"]*background(?:-image)?:\s*url\(['"]?([^'")\s]+)['"]?\)/gi,
    // Open Graph images
    /<meta[^>]+property="og:image"[^>]+content="([^"]+)"/gi,
    // Twitter images
    /<meta[^>]+name="twitter:image"[^>]+content="([^"]+)"/gi,
    // General large images (likely main content)
    /<img[^>]+src="([^"]+)"[^>]*(?:width|height)=["']?(?:[4-9]\d{2}|[1-9]\d{3})/gi,
    // Images with alt containing field/dog/park
    /<img[^>]+alt="[^"]*(?:field|dog|park|paddock|secure)[^"]*"[^>]+src="([^"]+)"/gi,
    /<img[^>]+src="([^"]+)"[^>]+alt="[^"]*(?:field|dog|park|paddock|secure)[^"]*"/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      let imgUrl = match[1];

      // Skip small images, icons, logos
      if (imgUrl.includes('logo') ||
          imgUrl.includes('icon') ||
          imgUrl.includes('favicon') ||
          imgUrl.includes('avatar') ||
          imgUrl.includes('gravatar') ||
          imgUrl.includes('placeholder') ||
          imgUrl.includes('spinner') ||
          imgUrl.includes('loading') ||
          imgUrl.includes('1x1') ||
          imgUrl.includes('pixel') ||
          imgUrl.match(/\d+x\d+/) && imgUrl.match(/(\d+)x(\d+)/) &&
            (parseInt(RegExp.$1) < 200 || parseInt(RegExp.$2) < 200)) {
        continue;
      }

      // Make absolute URL
      if (imgUrl.startsWith('//')) {
        imgUrl = 'https:' + imgUrl;
      } else if (imgUrl.startsWith('/')) {
        imgUrl = urlBase + imgUrl;
      } else if (!imgUrl.startsWith('http')) {
        imgUrl = urlBase + '/' + imgUrl;
      }

      // Validate URL format
      try {
        new URL(imgUrl);
        if (!images.includes(imgUrl)) {
          images.push(imgUrl);
        }
      } catch (e) {}
    }
  }

  // Also try to find images in JSON-LD structured data
  const jsonLdMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  if (jsonLdMatch) {
    for (const script of jsonLdMatch) {
      try {
        const jsonContent = script.replace(/<script[^>]*>|<\/script>/gi, '');
        const data = JSON.parse(jsonContent);
        if (data.image) {
          const img = Array.isArray(data.image) ? data.image[0] : data.image;
          if (typeof img === 'string' && img.startsWith('http') && !images.includes(img)) {
            images.push(img);
          }
        }
      } catch (e) {}
    }
  }

  return images;
}

// Fetch images for dogwalkingfields.co.uk pages specifically
async function fetchDogWalkingFieldsImages(url) {
  try {
    const html = await fetchUrl(url);
    const images = [];

    // Look for gallery images specifically on dogwalkingfields.co.uk
    const galleryPattern = /<div[^>]+class="[^"]*gallery[^"]*"[\s\S]*?<\/div>/gi;
    const imgPattern = /src="([^"]+)"/gi;

    // Main field image
    const mainImgMatch = html.match(/<img[^>]+class="[^"]*(?:field-image|main-image|featured)[^"]*"[^>]+src="([^"]+)"/i);
    if (mainImgMatch) {
      images.push(mainImgMatch[1]);
    }

    // All images from page
    const allImages = extractImages(html, url);

    // Filter for likely field images (jpg/png, not too small)
    const fieldImages = allImages.filter(img => {
      const lower = img.toLowerCase();
      return (lower.includes('.jpg') || lower.includes('.jpeg') || lower.includes('.png') || lower.includes('.webp')) &&
             !lower.includes('logo') &&
             !lower.includes('icon') &&
             !lower.includes('thumb') &&
             !lower.includes('-150x') &&
             !lower.includes('-100x') &&
             !lower.includes('wp-content/plugins');
    });

    return fieldImages.slice(0, 5); // Max 5 images
  } catch (error) {
    console.log(`  Error fetching ${url}: ${error.message}`);
    return [];
  }
}

// Main function
async function main() {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db('fieldsy');
    const fieldsCollection = db.collection('fields');

    // Get all fields without valid images
    const fieldsWithoutImages = await fieldsCollection.find({
      $or: [
        { images: { $exists: false } },
        { images: { $size: 0 } },
        { images: null }
      ]
    }).toArray();

    console.log(`Found ${fieldsWithoutImages.length} fields without images\n`);

    let updated = 0;
    let failed = 0;

    for (let i = 0; i < fieldsWithoutImages.length; i++) {
      const field = fieldsWithoutImages[i];
      const bookingLink = field.fieldFeatures?.bookingLink || field.website;

      console.log(`[${i + 1}/${fieldsWithoutImages.length}] ${field.name}`);

      if (!bookingLink || !bookingLink.startsWith('http')) {
        console.log('  No valid booking link, skipping');
        failed++;
        continue;
      }

      console.log(`  Fetching: ${bookingLink}`);

      try {
        const images = await fetchDogWalkingFieldsImages(bookingLink);

        if (images.length > 0) {
          console.log(`  Found ${images.length} images`);
          images.forEach((img, idx) => console.log(`    ${idx + 1}. ${img.substring(0, 80)}...`));

          // Update the field
          await fieldsCollection.updateOne(
            { _id: field._id },
            {
              $set: {
                images: images,
                image: images[0],
                updatedAt: new Date()
              }
            }
          );
          updated++;
          console.log('  ✓ Updated successfully');
        } else {
          console.log('  No images found');
          failed++;
        }
      } catch (error) {
        console.log(`  Error: ${error.message}`);
        failed++;
      }

      // Small delay to be polite to servers
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('\n=== SUMMARY ===');
    console.log(`Updated: ${updated}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total: ${fieldsWithoutImages.length}`);

  } finally {
    await client.close();
  }
}

main().catch(console.error);
