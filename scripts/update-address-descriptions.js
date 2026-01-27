/**
 * Update fields that have one-line address as description
 * with proper scraped descriptions.
 *
 * Only updates fields where current description is a one-line address.
 *
 * Usage:
 *   cd backend
 *   PATH="/usr/local/bin:/usr/local/Cellar/node/24.9.0/bin:$PATH" node scripts/update-address-descriptions.js
 */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

/**
 * Check if description is a one-line address (not a real description)
 */
function isOneLineAddress(desc) {
  if (!desc || desc.trim() === '') return false;
  const d = desc.trim();

  // Must be short (one-line address is typically under 120 chars)
  if (d.length > 150) return false;

  // UK postcode pattern
  const hasPostcode = /[A-Z]{1,2}\d{1,2}\s*\d[A-Z]{2}/i.test(d);

  // GPS coordinates pattern
  const hasGPS = /\d{2}\.\d{4,},?\s*-?\d+\.\d{4,}/.test(d);

  // Address road keywords
  const hasRoadKeyword = /\b(Farm|Lane|Road|Street|Close|Drive|Avenue|Way|Crescent|Terrace|Place|Court|Gardens|Mews|Row|Hill|Estate|Rd|Ave|St)\b/i.test(d);

  // If it has a postcode AND is short, it's an address
  if (hasPostcode) return true;

  // If it has GPS coords, it's address data
  if (hasGPS) return true;

  // Short text with road keyword + comma (typical address format)
  // e.g. "Monument Road, Wellington" or "Ridding Lane, Whalley, Clitheroe"
  if (d.length < 120 && hasRoadKeyword) {
    const commas = (d.match(/,/g) || []).length;
    if (commas >= 1) return true;
  }

  return false;
}

async function main() {
  // Load scraped descriptions
  const scrapedFile = path.join(__dirname, 'scraped-descriptions.json');
  const scrapedData = JSON.parse(fs.readFileSync(scrapedFile, 'utf8'));
  console.log('Scraped descriptions loaded:', scrapedData.length);

  // Build lookup map
  const scrapedMap = {};
  scrapedData.forEach(d => { scrapedMap[d.fieldId] = d; });

  // Get all fields from DB that have scraped data
  const fieldIds = scrapedData.map(d => d.fieldId);
  const dbFields = await prisma.field.findMany({
    where: { id: { in: fieldIds } },
    select: { id: true, name: true, description: true }
  });

  console.log('DB fields matched:', dbFields.length);

  // Filter: only fields where current description IS a one-line address
  const toUpdate = [];
  const skipped = [];

  for (const field of dbFields) {
    const scraped = scrapedMap[field.id];
    if (!scraped) continue;

    if (isOneLineAddress(field.description)) {
      toUpdate.push({
        id: field.id,
        name: field.name,
        currentDesc: (field.description || '').trim(),
        newDesc: scraped.description
      });
    } else {
      skipped.push({
        id: field.id,
        name: field.name,
        desc: (field.description || '').substring(0, 100),
        reason: 'not_a_one_line_address'
      });
    }
  }

  console.log('\n=== FILTER RESULTS ===');
  console.log(`Fields with one-line address description: ${toUpdate.length} (will update)`);
  console.log(`Fields skipped (not one-line address): ${skipped.length}`);

  // Show what will be updated
  console.log('\n=== FIELDS TO UPDATE ===');
  toUpdate.forEach((f, i) => {
    console.log(`[${i + 1}] ${f.name}`);
    console.log(`    OLD: ${f.currentDesc}`);
    console.log(`    NEW: ${f.newDesc.substring(0, 120)}...`);
  });

  // Perform updates
  console.log('\n=== UPDATING DATABASE ===');
  let updated = 0;
  let errors = 0;

  for (const field of toUpdate) {
    try {
      await prisma.field.update({
        where: { id: field.id },
        data: { description: field.newDesc }
      });
      updated++;
    } catch (err) {
      console.error(`  Error updating ${field.name}:`, err.message);
      errors++;
    }
  }

  console.log(`\nUpdated: ${updated}`);
  console.log(`Errors: ${errors}`);

  // Save update log
  const logFile = path.join(__dirname, 'description-update-log.json');
  fs.writeFileSync(logFile, JSON.stringify({
    summary: {
      totalScraped: scrapedData.length,
      matchedInDB: dbFields.length,
      updatedCount: updated,
      skippedCount: skipped.length,
      errorCount: errors,
      updatedAt: new Date().toISOString()
    },
    updated: toUpdate.map(f => ({
      id: f.id,
      name: f.name,
      oldDescription: f.currentDesc,
      newDescription: f.newDesc
    })),
    skipped
  }, null, 2));

  console.log(`\nUpdate log saved to: ${logFile}`);
  await prisma.$disconnect();
}

main().catch(console.error);
