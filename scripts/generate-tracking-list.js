/**
 * Generate final tracking list of all fields with address-like descriptions.
 * Cross-references with scraped descriptions.
 * Outputs a clean JSON list for review and update.
 */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

/**
 * Check if a description string is an address rather than a real description.
 * This is conservative: only flags strings that are CLEARLY addresses.
 */
function isAddressDescription(desc) {
  if (!desc || desc.trim() === '') return true; // Empty = needs description
  const d = desc.trim();

  // UK postcode pattern
  const postcodeRegex = /[A-Z]{1,2}\d{1,2}\s*\d[A-Z]{2}/i;
  // GPS coordinates
  const gpsRegex = /^\d{2}\.\d+,?\s*-?\d+\.\d+/;

  // Starts with GPS coordinates
  if (gpsRegex.test(d)) return true;

  // Just a postcode or very short with postcode
  if (d.length < 100 && postcodeRegex.test(d)) {
    // But NOT if it starts with "A " or contains descriptive phrases
    if (/^(A |The |Our |This |Welcome|Secure|Enclosed|Private|Fully)/i.test(d)) return false;
    return true;
  }

  // Short text that's mostly an address (road/farm + location + postcode)
  const addressPattern = /^[A-Z0-9][\w\s',.-]*(Farm|Lane|Road|Street|Close|Drive|Avenue|Way|Crescent|Terrace|Place|Court|Mews|Row|Hill|Estate)\b/i;
  if (d.length < 150 && addressPattern.test(d) && postcodeRegex.test(d)) return true;

  // Very short text with address keywords and commas (e.g. "Monument Road, Wellington, TA21 9PW")
  if (d.length < 120 && postcodeRegex.test(d)) {
    const commas = (d.match(/,/g) || []).length;
    if (commas >= 1) return true;
  }

  // Contains "Farm" or "Lane" etc at start + comma + location + postcode
  if (d.length < 150 && /^[\w\s'.-]+(Farm|Lane|Road|Street),/i.test(d)) return true;

  // Short address without postcode (e.g. "Borderland fields" is NOT an address)
  // Only flag if it looks like a proper street address
  if (d.length < 80 && /^\d+\s+\w+\s+(Road|Street|Lane|Avenue|Drive|Close)/i.test(d)) return true;

  return false;
}

/**
 * Check if a composed description is valid (not just generic filler)
 */
function isValidComposedDescription(desc) {
  if (!desc || desc.trim() === '') return false;
  // Must have more than just "A secure dog field."
  if (desc.trim() === 'A secure dog field.') return false;
  // Must be longer than 50 chars to be useful
  if (desc.trim().length < 50) return false;
  return true;
}

async function main() {
  // Step 1: Get all fields from DB
  const allFields = await prisma.field.findMany({
    select: { id: true, name: true, description: true },
    orderBy: { createdAt: 'asc' }
  });

  console.log('Total fields in DB:', allFields.length);

  // Step 2: Find fields with address-like descriptions
  const addressFields = allFields.filter(f => isAddressDescription(f.description));
  console.log('Fields with address/empty descriptions:', addressFields.length);

  // Step 3: Load scraped descriptions
  const scrapedFile = path.join(__dirname, 'scraped-descriptions.json');
  let scrapedData = [];
  if (fs.existsSync(scrapedFile)) {
    scrapedData = JSON.parse(fs.readFileSync(scrapedFile, 'utf8'));
  }
  const scrapedMap = {};
  scrapedData.forEach(d => { scrapedMap[d.fieldId] = d; });

  // Step 4: Categorize
  const readyToUpdate = [];
  const noScrapedData = [];

  for (const field of addressFields) {
    const scraped = scrapedMap[field.id];
    if (scraped && isValidComposedDescription(scraped.description)) {
      readyToUpdate.push({
        id: field.id,
        name: field.name || 'unnamed',
        currentDescription: (field.description || '').substring(0, 120),
        newDescription: scraped.description,
        matchScore: scraped.matchScore,
        matchedName: scraped.matchedName,
        sourceUrl: scraped.sourceUrl
      });
    } else {
      noScrapedData.push({
        id: field.id,
        name: field.name || 'unnamed',
        currentDescription: (field.description || '').substring(0, 120),
        reason: !scraped ? 'not_found_on_website' : 'scraped_desc_too_short'
      });
    }
  }

  console.log('\n=== RESULTS ===');
  console.log(`Ready to update with proper descriptions: ${readyToUpdate.length}`);
  console.log(`No scraped data available: ${noScrapedData.length}`);

  // Save tracking lists
  const trackingFile = path.join(__dirname, 'description-update-list.json');
  const tracking = {
    summary: {
      totalFieldsInDB: allFields.length,
      fieldsWithAddressDescriptions: addressFields.length,
      readyToUpdate: readyToUpdate.length,
      noScrapedData: noScrapedData.length,
      generatedAt: new Date().toISOString()
    },
    readyToUpdate,
    noScrapedData
  };
  fs.writeFileSync(trackingFile, JSON.stringify(tracking, null, 2));
  console.log(`\nTracking list saved to: ${trackingFile}`);

  // Print summary of ready-to-update
  console.log('\n=== READY TO UPDATE (first 20) ===');
  readyToUpdate.slice(0, 20).forEach((f, i) => {
    console.log(`[${i + 1}] ${f.name}`);
    console.log(`    Current: ${f.currentDescription}`);
    console.log(`    New: ${f.newDescription.substring(0, 120)}...`);
    console.log(`    Score: ${f.matchScore}`);
  });

  // Print not-found summary
  console.log(`\n=== NO SCRAPED DATA (${noScrapedData.length}) ===`);
  noScrapedData.forEach((f, i) => {
    console.log(`[${i + 1}] ${f.name} | ${f.currentDescription.substring(0, 80)} | ${f.reason}`);
  });

  await prisma.$disconnect();
}

main().catch(console.error);
