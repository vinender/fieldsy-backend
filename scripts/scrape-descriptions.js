/**
 * Scrape Descriptions from britishdogfields.com
 *
 * This script:
 * 1. Gets field names from the database (fields needing descriptions)
 * 2. Searches each field on britishdogfields.com by name
 * 3. Extracts structured field details from the detail page
 * 4. Composes a description from the structured data
 * 5. Saves results as JSON with field_id + description
 *
 * Usage:
 *   cd backend
 *   PATH="/usr/local/bin:/usr/local/Cellar/node/24.9.0/bin:$PATH" node scripts/scrape-descriptions.js
 */

const puppeteer = require('puppeteer');
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const OUTPUT_FILE = path.join(__dirname, 'scraped-descriptions.json');
const PROGRESS_FILE = path.join(__dirname, 'scrape-descriptions-progress.json');
const DELAY_BETWEEN_REQUESTS = 2500; // 2.5 seconds between page loads

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Normalize a field name for matching:
 * - Remove common suffixes like "Secure Dog Field", "Dog Field", etc.
 * - Lowercase and trim
 */
function normalizeNameForSearch(name) {
  if (!name) return '';
  return name
    .replace(/\s*[\-–]\s*/g, ' ') // Replace dashes with spaces
    .replace(/\[REVIEW\]/gi, '')
    .replace(/REVIEW:/gi, '')
    .replace(/\(.*?\)/g, '') // Remove parenthetical content
    .trim();
}

/**
 * Generate a simplified search query from a field name
 * Removes common terms that would pollute search results
 */
function getSearchQuery(name) {
  if (!name) return '';
  let q = name
    .replace(/\[REVIEW\]/gi, '')
    .replace(/REVIEW:/gi, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\s*[\-–]\s*/g, ' ')
    .replace(/secure\s+dog\s+(walking\s+)?field/gi, '')
    .replace(/dog\s+(walking\s+)?field/gi, '')
    .replace(/enclosed\s+paddock/gi, '')
    .replace(/dog\s+park/gi, '')
    .replace(/dog\s+exercise\s+field/gi, '')
    .replace(/dog\s+meadow/gi, '')
    .replace(/private\s+hire/gi, '')
    .replace(/,\s*$/, '')
    .trim();
  // If we stripped too much, use the original
  if (q.length < 3) q = name.replace(/\[REVIEW\]/gi, '').trim();
  return q;
}

/**
 * Extract structured field details from a britishdogfields.com field page
 */
async function scrapeFieldPage(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await delay(1500);

    const data = await page.evaluate(() => {
      const result = { title: '', details: {}, address: '' };

      // Get title
      const h1 = document.querySelector('h1');
      result.title = h1 ? h1.textContent.trim() : '';

      // Parse body text for structured sections
      const bodyText = document.body.innerText;
      const fieldDetailsStart = bodyText.indexOf('Field Details');
      const aboutStart = bodyText.indexOf('About This Field');

      if (fieldDetailsStart !== -1) {
        const endPos = aboutStart !== -1 ? aboutStart : bodyText.length;
        const sectionText = bodyText.substring(fieldDetailsStart + 'Field Details'.length, endPos).trim();
        const lines = sectionText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        // Parse label-value pairs (labels are uppercase, values follow)
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
          // Skip the XL-Bullies disclaimer
          if (line.startsWith('XL-Bullies')) break;

          if (isKnownLabel(line)) {
            // If we had a previous label with no value, store it as empty (checkbox/boolean field)
            if (currentLabel) {
              result.details[currentLabel] = '';
            }
            currentLabel = line.replace(/\s*\*\s*$/, '').trim();
          } else if (currentLabel) {
            result.details[currentLabel] = line;
            currentLabel = null;
          }
        }
        // Handle last label with no value
        if (currentLabel) {
          result.details[currentLabel] = '';
        }
      }

      // Get address from contact section
      const contactStart = bodyText.indexOf('ADDRESS');
      if (contactStart !== -1) {
        const afterAddress = bodyText.substring(contactStart + 'ADDRESS'.length);
        const nextSection = afterAddress.search(/\n\s*(GPS|TELEPHONE|EMAIL|WEB)\s*\n/i);
        if (nextSection !== -1) {
          result.address = afterAddress.substring(0, nextSection).trim();
        } else {
          result.address = afterAddress.substring(0, 200).split('\n').filter(l => l.trim())[0] || '';
        }
      }

      return result;
    });

    return data;
  } catch (err) {
    console.error(`    Error scraping ${url}:`, err.message);
    return null;
  }
}

/**
 * Search for a field on britishdogfields.com and return matching URLs
 */
async function searchField(page, fieldName) {
  const searchQuery = getSearchQuery(fieldName);
  const searchUrl = `https://britishdogfields.com/?s=${encodeURIComponent(searchQuery)}&post_type=citadela-item`;

  try {
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await delay(1500);

    const results = await page.evaluate(() => {
      const links = [];
      const seen = new Set();
      // First collect all article/item links with proper titles
      document.querySelectorAll('article, .citadela-item, .search-results-item').forEach(article => {
        const heading = article.querySelector('h2, h3, .entry-title');
        const link = article.querySelector('a[href*="/item/"]');
        if (heading && link && link.href && !seen.has(link.href)) {
          seen.add(link.href);
          links.push({ href: link.href, title: heading.textContent.trim() });
        }
      });
      // Fallback: collect any /item/ links we missed
      document.querySelectorAll('a[href*="/item/"]').forEach(a => {
        const href = a.href;
        if (href && href.includes('britishdogfields.com/item/') && !seen.has(href)) {
          seen.add(href);
          let title = '';
          const h2 = a.querySelector('h2, h3');
          if (h2) title = h2.textContent.trim();
          if (!title || title === 'View more') {
            // Extract title from URL slug
            const match = href.match(/\/item\/([^/]+)/);
            if (match) {
              title = match[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            }
          }
          if (title && title !== 'View more') {
            links.push({ href, title });
          }
        }
      });
      return links;
    });

    return results;
  } catch (err) {
    console.error(`    Search error for "${fieldName}":`, err.message);
    return [];
  }
}

/**
 * Compose a human-readable description from structured field details
 */
function composeDescription(details, title) {
  const parts = [];
  const d = details;

  // Helper to get a detail value, checking multiple case variations
  const get = (...keys) => {
    for (const k of keys) {
      if (d[k] !== undefined && d[k] !== null && d[k].trim() !== '') return d[k].trim();
    }
    return null;
  };

  // Helper to check if value is meaningful (not TBC, N/A, or empty)
  const isMeaningful = (val) => {
    if (!val) return false;
    const lower = val.toLowerCase().trim();
    return lower !== 'tbc' && lower !== 'n/a' && lower !== 'none' && lower.length > 0;
  };

  // Opening line with type and size
  let type = get('TYPE', 'Type');
  const size = get('SIZE', 'Size');
  // Fix concatenated type values like "PaddockActivities" → "Paddock"
  // The website sometimes concatenates type and next label into one word
  if (type) {
    // Add space before uppercase letters preceded by lowercase (e.g. "PaddockActivities")
    type = type.replace(/([a-z])([A-Z])/g, '$1 $2');
    // Take only the first word as the type (rest may be a label that leaked in)
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

  // Fencing info
  const fencing = get('FENCING', 'Fencing');
  const fencingNotes = get('FENCING NOTES', 'Fencing Notes', 'FENCING notes');
  if (isMeaningful(fencing)) {
    let fenceText = `The field is enclosed with ${fencing} fencing`;
    if (isMeaningful(fencingNotes)) {
      fenceText += ` (${fencingNotes})`;
    }
    fenceText += '.';
    parts.push(fenceText);
  }

  // Surface/terrain
  const surface = get('SURFACE TYPE', 'Surface Type', 'TERRAIN', 'Terrain', 'FIELD SURFACE');
  if (isMeaningful(surface)) {
    parts.push(`Surface type: ${surface}.`);
  }

  // Parking
  const parking = get('PARKING', 'Parking');
  const parkingArr = get('PARKING ARRANGEMENTS', 'Parking Arrangements');
  if (isMeaningful(parking)) {
    parts.push(`Parking: ${parking}.`);
  } else if (isMeaningful(parkingArr)) {
    parts.push(`Parking: ${parkingArr}.`);
  }

  // Number of fields/paddocks
  const numFields = get('NUMBER OF FIELDS', 'Number of Fields', 'NUMBER OF PADDOCKS', 'Number of Paddocks');
  if (isMeaningful(numFields)) {
    parts.push(`Number of paddocks/fields: ${numFields}.`);
  }

  // Amenities - collect available ones (these may have empty values meaning "yes/available")
  const amenityChecks = [
    ['FRESH WATER', 'fresh water'],
    ['SHELTER', 'shelter'],
    ['SEATING', 'seating'],
    ['LIGHTING', 'lighting'],
    ['AGILITY EQUIPMENT', 'agility equipment'],
    ['ENRICHMENT EQUIPMENT', 'enrichment equipment'],
    ['DOG WASH', 'dog wash'],
    ['TOILET FACILITIES', 'toilet facilities'],
    ['ON LEAD AREA', 'on-lead area'],
    ['SEPARATE SMALL DOG AREA', 'separate small dog area'],
    ['COVERED AREA', 'covered area'],
    ['SECURE ONLINE BOOKING', 'secure online booking'],
    ['BUGGY ACCESSIBLE', 'buggy accessible'],
  ];

  const amenities = [];
  for (const [key, label] of amenityChecks) {
    // These are often boolean fields - present in details means available
    if (d[key] !== undefined) {
      amenities.push(label);
    }
  }

  if (amenities.length > 0) {
    parts.push(`Facilities include: ${amenities.join(', ')}.`);
  }

  // Price
  const price = get('PRICE', 'Price');
  if (isMeaningful(price)) {
    parts.push(`Pricing: ${price}.`);
  }

  // Max dogs
  const maxDogs = get('MAX NUMBER DOGS', 'Max Number Dogs');
  if (isMeaningful(maxDogs)) {
    parts.push(`Maximum dogs: ${maxDogs}.`);
  }

  // Buffer
  const buffer = get('BUFFER BETWEEN CUSTOMERS', 'Buffer between customers');
  if (isMeaningful(buffer)) {
    parts.push(`Buffer between bookings: ${buffer}.`);
  }

  // Reactive dog friendly
  const reactive = get('REACTIVE DOG FRIENDLY', 'Reactive Dog Friendly', 'REACTIVE DOG FRIENDLY *');
  if (isMeaningful(reactive)) {
    parts.push(`Reactive dog friendly: ${reactive}.`);
  }

  // If we only have the generic opening and nothing else, return null
  if (parts.length <= 1 && parts[0] === 'A secure dog field.') return null;

  return parts.join(' ');
}

/**
 * Fuzzy match field name to search result title
 */
function fuzzyMatch(dbName, resultTitle) {
  if (!dbName || !resultTitle) return 0;

  const normalize = (s) => s.toLowerCase()
    .replace(/\s*[\-–]\s*/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const a = normalize(dbName);
  const b = normalize(resultTitle);

  // Exact match
  if (a === b) return 1.0;

  // One contains the other
  if (a.includes(b) || b.includes(a)) return 0.9;

  // Check word overlap
  const wordsA = new Set(a.split(' ').filter(w => w.length > 2));
  const wordsB = new Set(b.split(' ').filter(w => w.length > 2));

  const commonWords = [...wordsA].filter(w => wordsB.has(w));
  const totalWords = new Set([...wordsA, ...wordsB]).size;

  if (totalWords === 0) return 0;
  return commonWords.length / totalWords;
}

/**
 * Main scraping function
 */
async function main() {
  console.log('=== Description Scraper for Fieldsy ===\n');

  // Step 1: Get fields needing descriptions from DB
  console.log('Step 1: Loading fields from database...');
  const allFields = await prisma.field.findMany({
    select: { id: true, name: true, description: true },
    orderBy: { createdAt: 'asc' }
  });

  const postcodeRegex = /[A-Z]{1,2}\d{1,2}\s*\d[A-Z]{2}/i;
  const gpsRegex = /\d+\.\d+,\s*-?\d+\.\d+/;

  const fieldsNeedingDesc = allFields.filter(f => {
    if (!f.description || f.description.trim() === '') return true;
    const desc = f.description.trim();
    if (desc.length < 200 && postcodeRegex.test(desc)) return true;
    if (gpsRegex.test(desc.substring(0, 50))) return true;
    if (desc.length < 100 && (desc.includes('Farm') || desc.includes('Lane') || desc.includes('Road'))) return true;
    return false;
  }).filter(f => f.name && f.name.trim()); // Only fields with names

  console.log(`Total fields: ${allFields.length}`);
  console.log(`Fields needing descriptions: ${fieldsNeedingDesc.length}\n`);

  // Load previous progress if exists
  let progress = { completed: {}, failed: [], lastIndex: 0 };
  if (fs.existsSync(PROGRESS_FILE)) {
    try {
      progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
      console.log(`Resuming from previous progress: ${Object.keys(progress.completed).length} already done\n`);
    } catch (e) {
      console.log('Could not load progress file, starting fresh\n');
    }
  }

  // Step 2: Launch browser and scrape
  console.log('Step 2: Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1920, height: 1080 });

  const results = { ...progress.completed };
  const failed = [...progress.failed];
  let scraped = 0;
  let matched = 0;
  let skipped = 0;

  console.log(`\nStep 3: Scraping descriptions for ${fieldsNeedingDesc.length} fields...\n`);

  for (let i = 0; i < fieldsNeedingDesc.length; i++) {
    const field = fieldsNeedingDesc[i];

    // Skip if already done
    if (results[field.id]) {
      skipped++;
      continue;
    }

    console.log(`[${i + 1}/${fieldsNeedingDesc.length}] Searching: "${field.name}"`);

    try {
      // Search for field
      const searchResults = await searchField(page, field.name);
      await delay(DELAY_BETWEEN_REQUESTS);

      if (searchResults.length === 0) {
        console.log(`  → No results found`);
        failed.push({ id: field.id, name: field.name, reason: 'no_search_results' });
        continue;
      }

      // Find best match
      let bestMatch = null;
      let bestScore = 0;

      for (const result of searchResults) {
        const score = fuzzyMatch(field.name, result.title);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = result;
        }
      }

      // Also try matching just the first result if score is too low
      if (bestScore < 0.3 && searchResults.length > 0) {
        bestMatch = searchResults[0];
        bestScore = 0.25; // Give it a minimum score so we try it
      }

      if (!bestMatch || bestScore < 0.2) {
        console.log(`  → No good match (best score: ${bestScore.toFixed(2)})`);
        failed.push({ id: field.id, name: field.name, reason: 'no_match', bestScore });
        continue;
      }

      console.log(`  → Match: "${bestMatch.title}" (score: ${bestScore.toFixed(2)})`);
      console.log(`  → URL: ${bestMatch.href}`);

      // Scrape the field page
      const fieldData = await scrapeFieldPage(page, bestMatch.href);
      await delay(DELAY_BETWEEN_REQUESTS);

      if (!fieldData || Object.keys(fieldData.details).length === 0) {
        console.log(`  → No field details found on page`);
        failed.push({ id: field.id, name: field.name, reason: 'no_details', url: bestMatch.href });
        continue;
      }

      // Compose description
      const description = composeDescription(fieldData.details, fieldData.title);

      if (!description) {
        console.log(`  → Could not compose description`);
        failed.push({ id: field.id, name: field.name, reason: 'empty_description', details: fieldData.details });
        continue;
      }

      console.log(`  ✓ Description: ${description.substring(0, 100)}...`);

      results[field.id] = {
        fieldId: field.id,
        fieldName: field.name,
        matchedName: fieldData.title,
        matchScore: bestScore,
        sourceUrl: bestMatch.href,
        description: description,
        rawDetails: fieldData.details,
        scrapedAt: new Date().toISOString()
      };

      matched++;
      scraped++;

    } catch (err) {
      console.error(`  → Error: ${err.message}`);
      failed.push({ id: field.id, name: field.name, reason: 'error', error: err.message });
    }

    // Save progress every 5 fields
    if ((i + 1) % 5 === 0) {
      progress = { completed: results, failed, lastIndex: i };
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(Object.values(results), null, 2));
      console.log(`  [Progress saved: ${Object.keys(results).length} scraped, ${failed.length} failed]\n`);
    }
  }

  // Final save
  await browser.close();
  await prisma.$disconnect();

  const finalResults = Object.values(results);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalResults, null, 2));

  progress = { completed: results, failed, lastIndex: fieldsNeedingDesc.length - 1 };
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));

  // Summary
  console.log('\n=== SCRAPING COMPLETE ===');
  console.log(`Total fields processed: ${fieldsNeedingDesc.length}`);
  console.log(`Skipped (already done): ${skipped}`);
  console.log(`Successfully scraped: ${Object.keys(results).length}`);
  console.log(`Failed: ${failed.length}`);
  console.log(`\nResults saved to: ${OUTPUT_FILE}`);
  console.log(`Progress saved to: ${PROGRESS_FILE}`);

  // Failed summary
  if (failed.length > 0) {
    console.log('\n=== FAILED FIELDS ===');
    const failReasons = {};
    failed.forEach(f => {
      failReasons[f.reason] = (failReasons[f.reason] || 0) + 1;
    });
    Object.entries(failReasons).forEach(([reason, count]) => {
      console.log(`  ${reason}: ${count}`);
    });
  }
}

main().catch(console.error);
