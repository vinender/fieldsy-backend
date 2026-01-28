/**
 * Migrate scraped field images from external URLs to S3.
 *
 * Downloads each unique external image, converts to WebP via sharp,
 * uploads to S3, and updates the field's images[] array in the database.
 *
 * Features:
 *   - Deduplicates: same remote URL is only downloaded/uploaded once
 *   - Converts to WebP (quality 80) matching existing upload pattern
 *   - Skips images that are already on S3
 *   - Supports --dry-run to preview without making changes
 *   - Rate-limited to avoid overwhelming remote servers
 *
 * Usage:
 *   cd backend
 *   node scripts/migrate-images-to-s3.js              # full run
 *   node scripts/migrate-images-to-s3.js --dry-run    # preview only
 */
require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const https = require('https');
const http = require('http');

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');
const CONCURRENCY = 3; // parallel uploads at a time
const DOWNLOAD_TIMEOUT = 30000; // 30s per image download
const DELAY_BETWEEN_DOWNLOADS = 500; // ms between downloads to be polite

const S3_BUCKET = process.env.AWS_S3_BUCKET || 'fieldsy-s3';
const S3_REGION = process.env.AWS_REGION || 'eu-west-2';
const S3_FOLDER = 'field-images';

const s3Client = new S3Client({
  region: S3_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// ── Helpers ──────────────────────────────────────────────────────────

function isS3Url(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower.includes('fieldsy-s3.s3') ||
         lower.includes('fieldsy.s3') ||
         lower.includes('s3.amazonaws.com') ||
         lower.includes('s3.eu-west-2.amazonaws.com');
}

function isExternalImageUrl(url) {
  if (!url) return false;
  if (!url.startsWith('http')) return false;
  if (isS3Url(url)) return false;
  return true;
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Download an image from a URL, returning a Buffer.
 */
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      timeout: DOWNLOAD_TIMEOUT,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/*,*/*',
      }
    }, (res) => {
      // Follow redirects (up to 3)
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        downloadImage(res.headers.location).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }

      const contentType = res.headers['content-type'] || '';
      if (!contentType.startsWith('image/')) {
        reject(new Error(`Not an image (${contentType}) for ${url}`));
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout downloading ${url}`));
    });
  });
}

/**
 * Convert image buffer to WebP using sharp.
 */
async function convertToWebp(buffer) {
  return sharp(buffer)
    .webp({ quality: 80 })
    .toBuffer();
}

/**
 * Upload a buffer to S3 and return the public URL.
 */
async function uploadToS3(buffer, originalUrl) {
  const fileName = `${uuidv4()}.webp`;
  const key = `${S3_FOLDER}/${fileName}`;

  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: 'image/webp',
    ACL: 'public-read',
  });

  await s3Client.send(command);

  return `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Migrate Scraped Images to S3 ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`);
  console.log(`S3 Bucket: ${S3_BUCKET} (${S3_REGION})`);
  console.log(`Folder: ${S3_FOLDER}/\n`);

  // 1. Find all fields with external (non-S3) images
  const allFields = await prisma.field.findMany({
    select: { id: true, name: true, images: true },
  });

  const fieldsWithExternal = [];
  const allExternalUrls = new Set();

  for (const field of allFields) {
    const externalImages = (field.images || []).filter(isExternalImageUrl);
    if (externalImages.length > 0) {
      fieldsWithExternal.push({ ...field, externalImages });
      externalImages.forEach(url => allExternalUrls.add(url));
    }
  }

  console.log(`Total fields: ${allFields.length}`);
  console.log(`Fields with external images: ${fieldsWithExternal.length}`);
  console.log(`Unique external image URLs: ${allExternalUrls.size}\n`);

  if (fieldsWithExternal.length === 0) {
    console.log('No external images to migrate. Done.');
    await prisma.$disconnect();
    return;
  }

  if (DRY_RUN) {
    // Show sample of what would be migrated
    console.log('Sample fields that would be migrated:');
    fieldsWithExternal.slice(0, 10).forEach((f, i) => {
      console.log(`  [${i + 1}] ${f.name} — ${f.externalImages.length} image(s)`);
      f.externalImages.forEach(url => console.log(`      ${url}`));
    });
    console.log(`\n... and ${Math.max(0, fieldsWithExternal.length - 10)} more fields.`);
    console.log('\nRun without --dry-run to execute migration.');
    await prisma.$disconnect();
    return;
  }

  // 2. Download, convert, and upload each unique URL (with cache)
  const urlToS3 = new Map(); // remote URL → S3 URL
  const failed = new Map();  // remote URL → error message
  const uniqueUrls = [...allExternalUrls];

  console.log(`Downloading and uploading ${uniqueUrls.length} unique images...\n`);

  let completed = 0;
  let errors = 0;

  // Process in batches of CONCURRENCY
  for (let i = 0; i < uniqueUrls.length; i += CONCURRENCY) {
    const batch = uniqueUrls.slice(i, i + CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map(async (url) => {
        try {
          // Download
          const imageBuffer = await downloadImage(url);

          if (imageBuffer.length < 100) {
            throw new Error(`Image too small (${imageBuffer.length} bytes)`);
          }

          // Convert to WebP
          const webpBuffer = await convertToWebp(imageBuffer);

          // Upload to S3
          const s3Url = await uploadToS3(webpBuffer, url);

          urlToS3.set(url, s3Url);
          completed++;

          const progress = Math.round(((completed + errors) / uniqueUrls.length) * 100);
          console.log(`  [${progress}%] ✓ ${url.substring(0, 80)}...`);
          console.log(`         → ${s3Url}`);

          return s3Url;
        } catch (err) {
          failed.set(url, err.message);
          errors++;

          const progress = Math.round(((completed + errors) / uniqueUrls.length) * 100);
          console.log(`  [${progress}%] ✗ ${url.substring(0, 80)}...`);
          console.log(`         Error: ${err.message}`);

          return null;
        }
      })
    );

    // Polite delay between batches
    if (i + CONCURRENCY < uniqueUrls.length) {
      await delay(DELAY_BETWEEN_DOWNLOADS);
    }
  }

  console.log(`\n=== Upload Summary ===`);
  console.log(`Uploaded: ${completed}`);
  console.log(`Failed: ${errors}\n`);

  // 3. Update fields in the database
  console.log(`Updating ${fieldsWithExternal.length} fields in the database...\n`);

  let fieldsUpdated = 0;
  let fieldsSkipped = 0;
  let imagesReplaced = 0;

  for (const field of fieldsWithExternal) {
    const newImages = (field.images || []).map(url => {
      if (urlToS3.has(url)) {
        imagesReplaced++;
        return urlToS3.get(url);
      }
      return url; // Keep original if upload failed or already S3
    });

    // Check if anything actually changed
    const changed = newImages.some((url, idx) => url !== field.images[idx]);

    if (!changed) {
      fieldsSkipped++;
      continue;
    }

    try {
      await prisma.field.update({
        where: { id: field.id },
        data: { images: newImages },
      });
      fieldsUpdated++;

      if (fieldsUpdated <= 5) {
        console.log(`  ✓ ${field.name} — ${field.externalImages.length} image(s) replaced`);
      }
    } catch (err) {
      console.error(`  ✗ Error updating ${field.name}: ${err.message}`);
    }
  }

  if (fieldsUpdated > 5) {
    console.log(`  ... and ${fieldsUpdated - 5} more fields updated.`);
  }

  // 4. Final summary
  console.log(`\n=== MIGRATION COMPLETE ===`);
  console.log(`Images uploaded to S3:  ${completed}`);
  console.log(`Images failed:          ${errors}`);
  console.log(`Fields updated in DB:   ${fieldsUpdated}`);
  console.log(`Fields skipped (no change): ${fieldsSkipped}`);
  console.log(`Total image URLs replaced:  ${imagesReplaced}`);

  if (failed.size > 0) {
    console.log(`\n=== Failed URLs ===`);
    for (const [url, err] of failed) {
      console.log(`  ${url}`);
      console.log(`    → ${err}`);
    }
  }
  // 5. Verify — count remaining external URLs
  const verifyFields = await prisma.field.findMany({
    select: { images: true },
  });

  let remainingExternal = 0;
  for (const f of verifyFields) {
    remainingExternal += (f.images || []).filter(isExternalImageUrl).length;
  }
  console.log(`\nRemaining external image URLs after migration: ${remainingExternal}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  prisma.$disconnect();
  process.exit(1);
});
