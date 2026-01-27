/**
 * Revert fields that were updated with data from wrong matched pages.
 * Uses fieldIds from the remaining-scraped-descriptions.json data.
 */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

// Load the scraped data to get fieldIds
const scraped = JSON.parse(fs.readFileSync(path.join(__dirname, 'remaining-scraped-descriptions.json'), 'utf8'));

// Wrong match URLs that don't correspond to the actual field
const wrongMatchUrls = {
  'the-dog-walking-field-leiston': true,
  'lets-walk-private-secure-dog-field-cleland': true,
  'padstow-pooch-paddock-padstow': true,
  'nosey-barker-dog-field-harlow': true,
};

async function main() {
  let reverted = 0;

  for (const entry of scraped) {
    const url = entry.sourceUrl || '';
    const slug = url.match(/\/item\/([^/]+)/);
    if (!slug) continue;

    if (wrongMatchUrls[slug[1]]) {
      console.log(`Reverting: ${entry.fieldName}`);
      console.log(`  Wrong URL: ${url}`);
      console.log(`  Restoring: ${entry.currentDescription.substring(0, 80)}`);

      try {
        await prisma.field.update({
          where: { id: entry.fieldId },
          data: { description: entry.currentDescription }
        });
        console.log('  ✓ Reverted\n');
        reverted++;
      } catch (err) {
        console.error(`  ✗ Error: ${err.message}\n`);
      }
    }
  }

  console.log(`\nTotal reverted: ${reverted}`);
  await prisma.$disconnect();
}

main().catch(console.error);
