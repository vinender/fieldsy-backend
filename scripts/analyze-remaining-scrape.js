/**
 * Analyze the remaining scrape results to identify:
 * 1. Wrong matches (scraped a different field entirely)
 * 2. Copyright boilerplate (no real description)
 * 3. Good updates (correct match with real description)
 *
 * Then revert the bad ones back to original address description.
 */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function main() {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'remaining-scraped-descriptions.json'), 'utf8'));

  const stopWords = ['dog', 'field', 'fields', 'secure', 'walking', 'park', 'the', 'and', 'for'];

  const wrongMatches = [];
  const copyrightBoilerplate = [];
  const goodUpdates = [];

  for (const entry of data) {
    const desc = entry.newDescription;
    const name = entry.fieldName;
    const matchedName = entry.matchedName || '';

    // Extract core distinctive words from field name
    const nameCore = name.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.includes(w));

    const matchCore = matchedName.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.includes(w));

    const overlap = nameCore.filter(w => matchCore.includes(w));
    const isWrongMatch = overlap.length === 0 && nameCore.length > 0;

    // Check if description is copyright boilerplate or listing-coming-soon
    const isCopyright = /^(All media is the copyright|Media ©|Photos ©|Photos:|Photos\s*©|Official British Dog Fields|Field 2 details Photos|\*\*Listing Coming Soon\*\*|To book)/i.test(desc.trim());

    if (isWrongMatch) {
      wrongMatches.push(entry);
    } else if (isCopyright) {
      copyrightBoilerplate.push(entry);
    } else {
      goodUpdates.push(entry);
    }
  }

  console.log('=== ANALYSIS ===');
  console.log(`Total scraped: ${data.length}`);
  console.log(`Wrong matches (different field): ${wrongMatches.length}`);
  console.log(`Copyright boilerplate: ${copyrightBoilerplate.length}`);
  console.log(`Good updates: ${goodUpdates.length}`);

  console.log('\n--- WRONG MATCHES (will revert) ---');
  wrongMatches.forEach((w, i) => {
    console.log(`[${i + 1}] ${w.fieldName}`);
    console.log(`    Matched: ${w.matchedName}`);
    console.log(`    Original: ${w.currentDescription.substring(0, 80)}`);
  });

  console.log('\n--- COPYRIGHT BOILERPLATE (will revert) ---');
  copyrightBoilerplate.forEach((c, i) => {
    console.log(`[${i + 1}] ${c.fieldName} → ${c.matchedName}`);
    console.log(`    Desc: ${c.newDescription.substring(0, 80)}`);
    console.log(`    Original: ${c.currentDescription.substring(0, 80)}`);
  });

  console.log('\n--- GOOD UPDATES (will keep) ---');
  goodUpdates.forEach((g, i) => {
    console.log(`[${i + 1}] ${g.fieldName}`);
    console.log(`    Desc: ${g.newDescription.substring(0, 120)}`);
  });

  // Revert wrong matches and boilerplate back to original description
  const toRevert = [...wrongMatches, ...copyrightBoilerplate];
  console.log(`\n\n=== REVERTING ${toRevert.length} BAD UPDATES ===`);

  let reverted = 0;
  let errors = 0;

  for (const entry of toRevert) {
    try {
      await prisma.field.update({
        where: { id: entry.fieldId },
        data: { description: entry.currentDescription }
      });
      reverted++;
      console.log(`  ✓ Reverted: ${entry.fieldName} → "${entry.currentDescription.substring(0, 60)}"`);
    } catch (err) {
      console.error(`  ✗ Error reverting ${entry.fieldName}:`, err.message);
      errors++;
    }
  }

  console.log(`\nReverted: ${reverted}`);
  console.log(`Errors: ${errors}`);
  console.log(`Kept good updates: ${goodUpdates.length}`);

  // Save analysis
  const analysisFile = path.join(__dirname, 'remaining-scrape-analysis.json');
  fs.writeFileSync(analysisFile, JSON.stringify({
    summary: {
      total: data.length,
      wrongMatches: wrongMatches.length,
      copyrightBoilerplate: copyrightBoilerplate.length,
      goodUpdates: goodUpdates.length,
      reverted: reverted,
      analyzedAt: new Date().toISOString()
    },
    goodUpdates: goodUpdates.map(g => ({
      id: g.fieldId,
      name: g.fieldName,
      description: g.newDescription.substring(0, 200)
    })),
    wrongMatches: wrongMatches.map(w => ({
      id: w.fieldId,
      name: w.fieldName,
      matchedName: w.matchedName,
      revertedTo: w.currentDescription
    })),
    copyrightBoilerplate: copyrightBoilerplate.map(c => ({
      id: c.fieldId,
      name: c.fieldName,
      matchedName: c.matchedName,
      revertedTo: c.currentDescription
    }))
  }, null, 2));
  console.log(`\nAnalysis saved to: ${analysisFile}`);

  await prisma.$disconnect();
}

main().catch(console.error);
