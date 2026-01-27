/**
 * Targeted scraper for fields that still have address-as-description.
 *
 * Tries multiple search strategies:
 * 1. Full name search
 * 2. Simplified name (remove suffixes like "Dog Field", "Secure", etc.)
 * 3. Core name only (first 2-3 distinctive words)
 * 4. Direct URL slug guess
 *
 * Usage:
 *   cd backend
 *   PATH="/usr/local/bin:/usr/local/Cellar/node/24.9.0/bin:$PATH" node scripts/scrape-remaining-addresses.js
 */
const puppeteer = require('puppeteer');
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();
const OUTPUT_FILE = path.join(__dirname, 'remaining-scraped-descriptions.json');
const TRACKING_FILE = path.join(__dirname, 'remaining-address-tracking.json');
const DELAY_BETWEEN_REQUESTS = 2500;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Check if description is a one-line address (not a real description)
 */
function isOneLineAddress(desc) {
  if (!desc || desc.trim() === '') return false;
  const d = desc.trim();
  if (d.length > 150) return false;
  const hasPostcode = /[A-Z]{1,2}\d{1,2}\s*\d[A-Z]{2}/i.test(d);
  const hasGPS = /\d{2}\.\d{4,},?\s*-?\d+\.\d{4,}/.test(d);
  const hasRoadKeyword = /\b(Farm|Lane|Road|Street|Close|Drive|Avenue|Way|Crescent|Terrace|Place|Court|Gardens|Mews|Row|Hill|Estate|Rd|Ave|St)\b/i.test(d);
  if (hasPostcode) return true;
  if (hasGPS) return true;
  if (d.length < 120 && hasRoadKeyword) {
    const commas = (d.match(/,/g) || []).length;
    if (commas >= 1) return true;
  }
  return false;
}

/**
 * Generate multiple search queries from a field name, from most specific to broadest
 */
function getSearchQueries(name) {
  if (!name) return [];
  const queries = [];

  // Clean base name
  const clean = name
    .replace(/\[REVIEW\]/gi, '')
    .replace(/REVIEW:/gi, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\s*[\-–]\s*/g, ' ')
    .trim();

  // Strategy 1: Full cleaned name
  queries.push(clean);

  // Strategy 2: Remove common dog field suffixes
  const simplified = clean
    .replace(/secure\s+dog\s+(walking\s+)?field/gi, '')
    .replace(/dog\s+(walking\s+)?field/gi, '')
    .replace(/dog\s+fields?/gi, '')
    .replace(/enclosed\s+paddock/gi, '')
    .replace(/dog\s+park/gi, '')
    .replace(/dog\s+exercise\s+field/gi, '')
    .replace(/dog\s+meadow/gi, '')
    .replace(/private\s+hire/gi, '')
    .replace(/dog\s+arena/gi, '')
    .replace(/dog\s+run/gi, '')
    .replace(/secure\s+field/gi, '')
    .replace(/,\s*$/, '')
    .trim();

  if (simplified !== clean && simplified.length >= 3) {
    queries.push(simplified);
  }

  // Strategy 3: Core name - first distinctive words (before "Dog", "Secure", etc.)
  const coreMatch = clean.match(/^([\w'']+(?:\s+[\w'']+)?)/);
  if (coreMatch && coreMatch[1].length >= 3 && coreMatch[1] !== simplified) {
    queries.push(coreMatch[1]);
  }

  // Strategy 4: Try possessive name only (e.g. "Barker's" from "Barker's Unleashed")
  const possessiveMatch = clean.match(/([\w]+['']s)\b/i);
  if (possessiveMatch) {
    queries.push(possessiveMatch[1]);
  }

  // Deduplicate
  const seen = new Set();
  return queries.filter(q => {
    const key = q.toLowerCase().trim();
    if (seen.has(key) || key.length < 3) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Generate URL slug guesses from a field name
 */
function getUrlSlugs(name) {
  if (!name) return [];
  const slugs = [];

  const clean = name
    .replace(/\[REVIEW\]/gi, '')
    .replace(/\(.*?\)/g, '')
    .trim();

  // Full name slug
  const fullSlug = clean.toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  slugs.push(fullSlug);

  // Simplified slug (without "dog field" etc.)
  const simpleSlug = clean.toLowerCase()
    .replace(/secure\s+dog\s+(walking\s+)?field/gi, '')
    .replace(/dog\s+(walking\s+)?field/gi, '')
    .replace(/dog\s+fields?/gi, '')
    .replace(/dog\s+park/gi, '')
    .replace(/dog\s+arena/gi, '')
    .replace(/['']/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .trim();

  if (simpleSlug && simpleSlug !== fullSlug) {
    slugs.push(simpleSlug);
  }

  return slugs.filter(s => s.length >= 3);
}

/**
 * Search for a field on britishdogfields.com
 */
async function searchField(page, searchQuery) {
  const searchUrl = `https://britishdogfields.com/?s=${encodeURIComponent(searchQuery)}&post_type=citadela-item`;

  try {
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await delay(1500);

    const results = await page.evaluate(() => {
      const links = [];
      const seen = new Set();
      document.querySelectorAll('article, .citadela-item, .search-results-item').forEach(article => {
        const heading = article.querySelector('h2, h3, .entry-title');
        const link = article.querySelector('a[href*="/item/"]');
        if (heading && link && link.href && !seen.has(link.href)) {
          seen.add(link.href);
          links.push({ href: link.href, title: heading.textContent.trim() });
        }
      });
      document.querySelectorAll('a[href*="/item/"]').forEach(a => {
        const href = a.href;
        if (href && href.includes('britishdogfields.com/item/') && !seen.has(href)) {
          seen.add(href);
          let title = '';
          const h2 = a.querySelector('h2, h3');
          if (h2) title = h2.textContent.trim();
          if (!title || title === 'View more') {
            const match = href.match(/\/item\/([^/]+)/);
            if (match) title = match[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
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
    console.error(`    Search error for "${searchQuery}":`, err.message);
    return [];
  }
}

/**
 * Try to directly access a URL slug on britishdogfields.com
 */
async function tryDirectUrl(page, slug) {
  const url = `https://britishdogfields.com/item/${slug}/`;
  try {
    const response = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    if (response && response.status() === 200) {
      const title = await page.evaluate(() => {
        const h1 = document.querySelector('h1');
        return h1 ? h1.textContent.trim() : '';
      });
      if (title && !title.includes('Page not found') && !title.includes('404')) {
        return { href: url, title };
      }
    }
    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Extract structured field details from a field page
 */
async function scrapeFieldPage(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await delay(1500);

    const data = await page.evaluate(() => {
      const result = { title: '', details: {}, address: '', aboutText: '' };

      const h1 = document.querySelector('h1');
      result.title = h1 ? h1.textContent.trim() : '';

      const bodyText = document.body.innerText;
      const fieldDetailsStart = bodyText.indexOf('Field Details');
      const aboutStart = bodyText.indexOf('About This Field');

      // Try to get "About This Field" text first - this is the actual description
      if (aboutStart !== -1) {
        const afterAbout = bodyText.substring(aboutStart + 'About This Field'.length).trim();
        // Get text until next section
        const nextSection = afterAbout.search(/\n\s*(Field Details|ADDRESS|GPS|TELEPHONE|EMAIL|WEB|Contact|Share|XL-Bullies)\b/i);
        if (nextSection !== -1) {
          result.aboutText = afterAbout.substring(0, nextSection).trim();
        } else {
          // Take first 500 chars
          result.aboutText = afterAbout.substring(0, 500).trim();
        }
        // Clean up: remove lines that are just navigation/button text
        result.aboutText = result.aboutText
          .split('\n')
          .filter(l => l.trim().length > 0 && !l.trim().match(/^(View more|Read more|Book now|Share|Print)$/i))
          .join(' ')
          .trim();
      }

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
            if (currentLabel) {
              result.details[currentLabel] = '';
            }
            currentLabel = line.replace(/\s*\*\s*$/, '').trim();
          } else if (currentLabel) {
            result.details[currentLabel] = line;
            currentLabel = null;
          }
        }
        if (currentLabel) {
          result.details[currentLabel] = '';
        }
      }

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
 * Compose a description from structured field details
 */
function composeDescription(details, title, aboutText) {
  const parts = [];
  const d = details;

  // If we have "About This Field" text and it's meaningful, use it directly
  if (aboutText && aboutText.length > 50) {
    // Check it's not just an address
    const hasPostcode = /[A-Z]{1,2}\d{1,2}\s*\d[A-Z]{2}/i.test(aboutText);
    const isShort = aboutText.length < 100;
    if (!(hasPostcode && isShort)) {
      return aboutText;
    }
  }

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

  if (a === b) return 1.0;
  if (a.includes(b) || b.includes(a)) return 0.9;

  const wordsA = new Set(a.split(' ').filter(w => w.length > 2));
  const wordsB = new Set(b.split(' ').filter(w => w.length > 2));
  const commonWords = [...wordsA].filter(w => wordsB.has(w));
  const totalWords = new Set([...wordsA, ...wordsB]).size;

  if (totalWords === 0) return 0;
  return commonWords.length / totalWords;
}

async function main() {
  console.log('=== Targeted Scraper for Remaining Address-Description Fields ===\n');

  // Step 1: Find all fields with address-as-description
  console.log('Step 1: Finding fields with address descriptions...');
  const allFields = await prisma.field.findMany({
    select: { id: true, name: true, description: true },
    orderBy: { createdAt: 'asc' }
  });

  const addressFields = allFields.filter(f => isOneLineAddress(f.description));
  console.log(`Found ${addressFields.length} fields with address-as-description\n`);

  if (addressFields.length === 0) {
    console.log('No fields to scrape!');
    await prisma.$disconnect();
    return;
  }

  // Step 2: Launch browser
  console.log('Step 2: Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  await page.setViewport({ width: 1920, height: 1080 });

  const results = [];
  const notFound = [];
  const scraped = [];

  console.log(`\nStep 3: Scraping ${addressFields.length} fields with multiple strategies...\n`);

  for (let i = 0; i < addressFields.length; i++) {
    const field = addressFields[i];
    console.log(`\n[${i + 1}/${addressFields.length}] "${field.name}"`);
    console.log(`  Current desc: ${(field.description || '').substring(0, 80)}`);

    let found = false;
    let fieldData = null;
    let matchUrl = null;
    let matchTitle = null;
    let matchStrategy = null;

    // Try search queries (multiple strategies)
    const queries = getSearchQueries(field.name);
    console.log(`  Search queries: ${queries.map(q => '"' + q + '"').join(', ')}`);

    for (let q = 0; q < queries.length && !found; q++) {
      const query = queries[q];
      console.log(`  Strategy ${q + 1}: Searching "${query}"`);

      const searchResults = await searchField(page, query);
      await delay(DELAY_BETWEEN_REQUESTS);

      if (searchResults.length > 0) {
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

        // Accept lower threshold for later strategies
        const threshold = q === 0 ? 0.2 : 0.15;

        if (bestMatch && bestScore >= threshold) {
          console.log(`  → Match: "${bestMatch.title}" (score: ${bestScore.toFixed(2)})`);

          // Scrape the page
          fieldData = await scrapeFieldPage(page, bestMatch.href);
          await delay(DELAY_BETWEEN_REQUESTS);

          if (fieldData && (Object.keys(fieldData.details).length > 0 || (fieldData.aboutText && fieldData.aboutText.length > 50))) {
            matchUrl = bestMatch.href;
            matchTitle = bestMatch.title;
            matchStrategy = `search_q${q + 1}`;
            found = true;
          } else {
            console.log(`  → Page found but no useful details`);
          }
        } else {
          console.log(`  → No good match (best: ${bestScore.toFixed(2)} for "${bestMatch ? bestMatch.title : 'none'}")`);
        }
      } else {
        console.log(`  → No results`);
      }
    }

    // Try direct URL slugs if search failed
    if (!found) {
      const slugs = getUrlSlugs(field.name);
      for (let s = 0; s < slugs.length && !found; s++) {
        const slug = slugs[s];
        console.log(`  Strategy URL-${s + 1}: Trying /${slug}/`);

        const directResult = await tryDirectUrl(page, slug);
        await delay(DELAY_BETWEEN_REQUESTS);

        if (directResult) {
          console.log(`  → Direct URL hit: "${directResult.title}"`);

          fieldData = await scrapeFieldPage(page, directResult.href);
          await delay(DELAY_BETWEEN_REQUESTS);

          if (fieldData && (Object.keys(fieldData.details).length > 0 || (fieldData.aboutText && fieldData.aboutText.length > 50))) {
            matchUrl = directResult.href;
            matchTitle = directResult.title;
            matchStrategy = `direct_url_${s + 1}`;
            found = true;
          }
        }
      }
    }

    if (found && fieldData) {
      const description = composeDescription(fieldData.details, fieldData.title, fieldData.aboutText);

      if (description && description.length > 50) {
        console.log(`  ✓ Description: ${description.substring(0, 120)}...`);

        const entry = {
          fieldId: field.id,
          fieldName: field.name,
          currentDescription: (field.description || '').trim(),
          newDescription: description,
          matchedName: matchTitle,
          sourceUrl: matchUrl,
          strategy: matchStrategy,
          hasAboutText: !!(fieldData.aboutText && fieldData.aboutText.length > 50),
          detailsCount: Object.keys(fieldData.details).length
        };
        scraped.push(entry);
      } else {
        console.log(`  ✗ Description too short or null`);
        notFound.push({
          id: field.id,
          name: field.name,
          currentDescription: (field.description || '').trim(),
          reason: 'description_too_short',
          matchedUrl: matchUrl
        });
      }
    } else {
      console.log(`  ✗ Not found on website`);
      notFound.push({
        id: field.id,
        name: field.name,
        currentDescription: (field.description || '').trim(),
        reason: 'not_found_on_website'
      });
    }
  }

  await browser.close();

  // Save results
  console.log('\n\n=== SCRAPING COMPLETE ===');
  console.log(`Successfully scraped: ${scraped.length}`);
  console.log(`Not found: ${notFound.length}`);

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(scraped, null, 2));
  console.log(`\nScraped data saved to: ${OUTPUT_FILE}`);

  // Save tracking file
  const tracking = {
    summary: {
      totalAddressFields: addressFields.length,
      successfullyScrape: scraped.length,
      notFound: notFound.length,
      scrapedAt: new Date().toISOString()
    },
    scraped: scraped.map(s => ({
      id: s.fieldId,
      name: s.fieldName,
      currentDesc: s.currentDescription.substring(0, 80),
      newDesc: s.newDescription.substring(0, 120) + '...',
      strategy: s.strategy,
      url: s.sourceUrl
    })),
    notFound
  };
  fs.writeFileSync(TRACKING_FILE, JSON.stringify(tracking, null, 2));
  console.log(`Tracking file saved to: ${TRACKING_FILE}`);

  // Show scraped results
  console.log('\n=== SUCCESSFULLY SCRAPED ===');
  scraped.forEach((s, i) => {
    console.log(`[${i + 1}] ${s.fieldName}`);
    console.log(`    OLD: ${s.currentDescription.substring(0, 80)}`);
    console.log(`    NEW: ${s.newDescription.substring(0, 120)}...`);
    console.log(`    Strategy: ${s.strategy} | URL: ${s.sourceUrl}`);
  });

  console.log('\n=== NOT FOUND ===');
  notFound.forEach((f, i) => {
    console.log(`[${i + 1}] ${f.name} | ${f.reason} | ${f.currentDescription.substring(0, 60)}`);
  });

  // Step 4: Update DB with scraped descriptions
  if (scraped.length > 0) {
    console.log('\n\n=== UPDATING DATABASE ===');
    let updated = 0;
    let errors = 0;

    for (const entry of scraped) {
      try {
        await prisma.field.update({
          where: { id: entry.fieldId },
          data: { description: entry.newDescription }
        });
        updated++;
        console.log(`  ✓ Updated: ${entry.fieldName}`);
      } catch (err) {
        console.error(`  ✗ Error updating ${entry.fieldName}:`, err.message);
        errors++;
      }
    }

    console.log(`\nUpdated: ${updated}`);
    console.log(`Errors: ${errors}`);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
