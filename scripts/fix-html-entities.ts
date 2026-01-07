import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// HTML entities to fix
const htmlEntities: Record<string, string> = {
  '&#8217;': "'",  // Right single quotation mark (apostrophe)
  '&#8216;': "'",  // Left single quotation mark
  '&#8211;': "–",  // En dash (or use regular hyphen "-")
  '&#8212;': "—",  // Em dash
  '&#8220;': '"',  // Left double quotation mark
  '&#8221;': '"',  // Right double quotation mark
  '&#038;': '&',   // Ampersand (numeric)
  '&#38;': '&',    // Ampersand
  '&#39;': "'",    // Apostrophe
  '&amp;': '&',    // Ampersand
  '&quot;': '"',   // Double quote
  '&apos;': "'",   // Apostrophe
  '&ndash;': '–',  // En dash
  '&mdash;': '—',  // Em dash
  '&lsquo;': "'",  // Left single quote
  '&rsquo;': "'",  // Right single quote
  '&ldquo;': '"',  // Left double quote
  '&rdquo;': '"',  // Right double quote
};

function decodeHtmlEntities(text: string): string {
  let decoded = text;
  for (const [entity, replacement] of Object.entries(htmlEntities)) {
    decoded = decoded.split(entity).join(replacement);
  }
  return decoded;
}

async function fixHtmlEntities() {
  console.log('Starting HTML entity fix script...\n');

  try {
    // Get all fields
    const fields = await prisma.field.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        address: true,
      },
    });

    console.log(`Found ${fields.length} fields to check.\n`);

    let updatedCount = 0;

    for (const field of fields) {
      const updates: any = {};
      let needsUpdate = false;

      // Check and fix name
      if (field.name) {
        const fixedName = decodeHtmlEntities(field.name);
        if (fixedName !== field.name) {
          updates.name = fixedName;
          needsUpdate = true;
          console.log(`Name: "${field.name}" -> "${fixedName}"`);
        }
      }

      // Check and fix description
      if (field.description) {
        const fixedDescription = decodeHtmlEntities(field.description);
        if (fixedDescription !== field.description) {
          updates.description = fixedDescription;
          needsUpdate = true;
          console.log(`Description updated for field: ${field.name || field.id}`);
        }
      }

      // Check and fix address
      if (field.address) {
        const fixedAddress = decodeHtmlEntities(field.address);
        if (fixedAddress !== field.address) {
          updates.address = fixedAddress;
          needsUpdate = true;
          console.log(`Address: "${field.address}" -> "${fixedAddress}"`);
        }
      }

      // Update if needed
      if (needsUpdate) {
        await prisma.field.update({
          where: { id: field.id },
          data: updates,
        });
        updatedCount++;
      }
    }

    console.log(`\n✅ Fixed HTML entities in ${updatedCount} fields.`);

  } catch (error) {
    console.error('Error fixing HTML entities:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixHtmlEntities();
