/**
 * Re-scrape the correctly matched boilerplate fields.
 * These fields were found on britishdogfields.com but the "About This Field"
 * section only had copyright boilerplate. This script re-visits those pages
 * and composes descriptions from structured Field Details ONLY (ignoring aboutText).
 *
 * Usage:
 *   cd backend
 *   PATH="/usr/local/bin:/usr/local/Cellar/node/24.9.0/bin:$PATH" node scripts/rescrape-boilerplate-fields.js
 */
const puppeteer = require('puppeteer');
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const DELAY = 2500;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Load previous results to find correctly matched boilerplate fields
const remaining = JSON.parse(fs.readFileSync(path.join(__dirname, 'remaining-scraped-descriptions.json'), 'utf8'));

// These are the wrong matches we identified - exclude them
const wrongMatchFieldNames = [
  'The Rambles Dog Walking Field',
  "Dog's Country Club Dog Fields (Field 4)",
  "Dog's Country Club Dog Fields (Field 2)",
  'Preston Dog Field',
  "Padlock's Paddock Freedom Dog Field",
  "Bark 'N' Go Dog Field",
  "Chester's Dog Walking Field",
  "Eva's Green Dog Walking Field",
  'Out n Safe Dog Field',
  // Also wrong matches that ended up in boilerplate category
  "Let's Play Dog Walking Field",    // matched "Lets Walk" - different field
  'The Dog Run, Dog Field',          // matched "My Dog Run" - different field
  "Pooch's Paddock Dog Field",       // matched "Padstow Pooch Paddock" - different field
];

// Fields that were correctly matched but had boilerplate descriptions
const boilerplateFields = remaining.filter(entry => {
  const desc = entry.newDescription;
  const isCopyright = /^(All media is the copyright|Media ©|Photos ©|Photos:|Photos\s*©|Official British Dog Fields|Field 2 details Photos|\*\*Listing Coming Soon\*\*|To book)/i.test(desc.trim());
  const isWrongMatch = wrongMatchFieldNames.includes(entry.fieldName);
  return isCopyright && !isWrongMatch;
});

console.log(`Found ${boilerplateFields.length} correctly matched boilerplate fields to re-scrape\n`);
boilerplateFields.forEach((f, i) => {
  console.log(`  [${i + 1}] ${f.fieldName} → ${f.sourceUrl}`);
});

async function scrapeFieldDetails(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await delay(1500);

    const data = await page.evaluate(() => {
      const result = { title: '', details: {} };

      const h1 = document.querySelector('h1');
      result.title = h1 ? h1.textContent.trim() : '';

      const bodyText = document.body.innerText;
      const fieldDetailsStart = bodyText.indexOf('Field Details');
      const aboutStart = bodyText.indexOf('About This Field');

      if (fieldDetailsStart !== -1) {
        const endPos = aboutStart !== -1 ? aboutStart : bodyText.length;
        const sectionText = bodyText.substring(fieldDetailsStart + 'Field Details'.length, endPos).trim();
        const lines = sectionText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        const knownLabels = [
          'REACTIVE DOG FRIENDLY', 'FENCING', 'FENCING NOTES', 'PARKING',
          'PARKING ARRANGEMENTS', 'SIZE', 'SECURE ONLINE BOOKING',
          'BUFFER BETWEEN CUSTOMERS', 'FRESH WATER', 'PRICE',
          'MAX NUMBER DOGS', 'TYPE', 'WHAT3WORDS', 'NUMBER OF FIELDS',
          'LIGHTING', 'TREATS', 'AGILITY EQUIPMENT', 'ENRICHMENT EQUIPMENT',
          'DOG WASH', 'TOILET FACILITIES', 'SHELTER', 'SEATING',
          'ON LEAD AREA', 'POO BAGS PROVIDED', 'SHOP', 'CAFÉ', 'CAFE',
          'SEPARATE SMALL DOG AREA', 'ACCESSIBILITY', 'NOTES',
          'NUMBER OF PADDOCKS', 'SURFACE TYPE', 'TERRAIN',
          'ACTIVITIES', 'BOOKING TYPE', 'WATER', 'DOUBLE FENCING',
          'COVERED AREA', 'SEPARATE PADDOCK', 'FIELD SURFACE',
          'BDF REVIEWED', 'BUGGY ACCESSIBLE', 'WHEELCHAIR ACCESSIBLE',
          'DISABLED ACCESS', 'DOG AGILITY', 'REFRESHMENTS'
        ];

        const isKnownLabel = (text) => {
          const upper = text.toUpperCase().replace(/\s*\*\s*$/, '').trim();
          return knownLabels.some(l => upper === l || upper === l + ' *');
        };

        let currentLabel = null;
        for (const line of lines) {
          if (line.startsWith('XL-Bullies')) break;
          if (isKnownLabel(line)) {
            if (currentLabel) result.details[currentLabel] = '';
            currentLabel = line.replace(/\s*\*\s*$/, '').trim();
          } else if (currentLabel) {
            result.details[currentLabel] = line;
            currentLabel = null;
          }
        }
        if (currentLabel) result.details[currentLabel] = '';
      }

      return result;
    });

    return data;
  } catch (err) {
    console.error(`  Error scraping ${url}:`, err.message);
    return null;
  }
}

function composeDescription(details, title) {
  const parts = [];
  const d = details;

  const get = (...keys) => {
    for (const k of keys) {
      if (d[k] !== undefined && d[k] !== null && d[k].trim() !== '') return d[k].trim();
    }
    return null;
  };

  const isMeaningful = (val) => {
    if (!val) return false;
    const lower = val.toLowerCase().trim();
    return lower !== 'tbc' && lower !== 'n/a' && lower !== 'none' && lower.length > 0;
  };

  let type = get('TYPE', 'Type');
  const size = get('SIZE', 'Size');
  if (type) {
    type = type.replace(/([a-z])([A-Z])/g, '$1 $2');
    const typeWords = type.split(/\s+/);
    const validTypes = ['paddock', 'meadow', 'field', 'woodland', 'arena', 'park', 'beach', 'forest', 'indoor'];
    const mainType = typeWords.filter(w => validTypes.includes(w.toLowerCase()));
    type = mainType.length > 0 ? mainType.join(' / ') : typeWords[0];
  }

  if (type && size) {
    parts.push(`A ${type.toLowerCase()} type secure dog field, ${size.toLowerCase()} in size.`);
  } else if (type) {
    parts.push(`A ${type.toLowerCase()} type secure dog field.`);
  } else if (size) {
    parts.push(`A secure dog field, ${size.toLowerCase()} in size.`);
  } else {
    parts.push('A secure dog field.');
  }

  const fencing = get('FENCING', 'Fencing');
  const fencingNotes = get('FENCING NOTES', 'Fencing Notes');
  if (isMeaningful(fencing)) {
    let fenceText = `The field is enclosed with ${fencing} fencing`;
    if (isMeaningful(fencingNotes)) fenceText += ` (${fencingNotes})`;
    fenceText += '.';
    parts.push(fenceText);
  }

  const surface = get('SURFACE TYPE', 'Surface Type', 'TERRAIN', 'Terrain', 'FIELD SURFACE');
  if (isMeaningful(surface)) parts.push(`Surface type: ${surface}.`);

  const parking = get('PARKING', 'Parking');
  const parkingArr = get('PARKING ARRANGEMENTS', 'Parking Arrangements');
  if (isMeaningful(parking)) parts.push(`Parking: ${parking}.`);
  else if (isMeaningful(parkingArr)) parts.push(`Parking: ${parkingArr}.`);

  const numFields = get('NUMBER OF FIELDS', 'Number of Fields', 'NUMBER OF PADDOCKS');
  if (isMeaningful(numFields)) parts.push(`Number of paddocks/fields: ${numFields}.`);

  const amenityChecks = [
    ['FRESH WATER', 'fresh water'], ['SHELTER', 'shelter'], ['SEATING', 'seating'],
    ['LIGHTING', 'lighting'], ['AGILITY EQUIPMENT', 'agility equipment'],
    ['ENRICHMENT EQUIPMENT', 'enrichment equipment'], ['DOG WASH', 'dog wash'],
    ['TOILET FACILITIES', 'toilet facilities'], ['ON LEAD AREA', 'on-lead area'],
    ['SEPARATE SMALL DOG AREA', 'separate small dog area'], ['COVERED AREA', 'covered area'],
    ['SECURE ONLINE BOOKING', 'secure online booking'], ['BUGGY ACCESSIBLE', 'buggy accessible'],
  ];

  const amenities = [];
  for (const [key, label] of amenityChecks) {
    if (d[key] !== undefined) amenities.push(label);
  }
  if (amenities.length > 0) parts.push(`Facilities include: ${amenities.join(', ')}.`);

  const price = get('PRICE', 'Price');
  if (isMeaningful(price)) parts.push(`Pricing: ${price}.`);

  const maxDogs = get('MAX NUMBER DOGS', 'Max Number Dogs');
  if (isMeaningful(maxDogs)) parts.push(`Maximum dogs: ${maxDogs}.`);

  const buffer = get('BUFFER BETWEEN CUSTOMERS', 'Buffer between customers');
  if (isMeaningful(buffer)) parts.push(`Buffer between bookings: ${buffer}.`);

  const reactive = get('REACTIVE DOG FRIENDLY', 'Reactive Dog Friendly');
  if (isMeaningful(reactive)) parts.push(`Reactive dog friendly: ${reactive}.`);

  // Notes from Field Notes
  const notes = get('NOTES', 'Notes');
  if (isMeaningful(notes) && notes.length > 20) parts.push(notes);

  // If we only have the generic opening and nothing else, return null
  if (parts.length <= 1 && parts[0] === 'A secure dog field.') return null;

  return parts.join(' ');
}

async function main() {
  if (boilerplateFields.length === 0) {
    console.log('No boilerplate fields to re-scrape.');
    await prisma.$disconnect();
    return;
  }

  console.log('\nLaunching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1920, height: 1080 });

  const updated = [];
  const noDetails = [];

  for (let i = 0; i < boilerplateFields.length; i++) {
    const field = boilerplateFields[i];
    console.log(`\n[${i + 1}/${boilerplateFields.length}] ${field.fieldName}`);
    console.log(`  URL: ${field.sourceUrl}`);

    const data = await scrapeFieldDetails(page, field.sourceUrl);
    await delay(DELAY);

    if (data && Object.keys(data.details).length > 0) {
      console.log(`  Details found: ${Object.keys(data.details).join(', ')}`);

      const description = composeDescription(data.details, data.title);

      if (description && description.length > 50 && description !== 'A secure dog field.') {
        console.log(`  ✓ Description: ${description.substring(0, 120)}...`);
        updated.push({
          fieldId: field.fieldId,
          fieldName: field.fieldName,
          currentDescription: field.currentDescription,
          newDescription: description,
          sourceUrl: field.sourceUrl,
          detailKeys: Object.keys(data.details)
        });
      } else {
        console.log(`  ✗ Composed description too generic or short`);
        noDetails.push({
          id: field.fieldId,
          name: field.fieldName,
          currentDescription: field.currentDescription,
          reason: 'generic_description',
          details: data.details
        });
      }
    } else {
      console.log(`  ✗ No Field Details section found on page`);
      noDetails.push({
        id: field.fieldId,
        name: field.fieldName,
        currentDescription: field.currentDescription,
        reason: 'no_field_details'
      });
    }
  }

  await browser.close();

  console.log('\n\n=== RESULTS ===');
  console.log(`Composed descriptions: ${updated.length}`);
  console.log(`No usable details: ${noDetails.length}`);

  // Update DB
  if (updated.length > 0) {
    console.log('\n=== UPDATING DATABASE ===');
    let dbUpdated = 0;
    for (const entry of updated) {
      try {
        await prisma.field.update({
          where: { id: entry.fieldId },
          data: { description: entry.newDescription }
        });
        dbUpdated++;
        console.log(`  ✓ Updated: ${entry.fieldName}`);
      } catch (err) {
        console.error(`  ✗ Error: ${entry.fieldName}:`, err.message);
      }
    }
    console.log(`\nDB updated: ${dbUpdated}`);
  }

  // Show fields that still have address descriptions (no fix available)
  console.log('\n=== FIELDS STILL WITH ADDRESS DESCRIPTIONS (no data available) ===');
  noDetails.forEach((f, i) => {
    console.log(`[${i + 1}] ${f.name} | ${f.currentDescription.substring(0, 60)} | ${f.reason}`);
  });

  // Save final tracking
  const trackingFile = path.join(__dirname, 'final-address-tracking.json');
  fs.writeFileSync(trackingFile, JSON.stringify({
    summary: {
      boilerplateFieldsProcessed: boilerplateFields.length,
      updatedWithStructuredData: updated.length,
      noUsableDetails: noDetails.length,
      processedAt: new Date().toISOString()
    },
    updated: updated.map(u => ({
      id: u.fieldId,
      name: u.fieldName,
      oldDesc: u.currentDescription,
      newDesc: u.newDescription,
      url: u.sourceUrl
    })),
    noDetails
  }, null, 2));
  console.log(`\nTracking saved to: ${trackingFile}`);

  await prisma.$disconnect();
}

main().catch(console.error);
