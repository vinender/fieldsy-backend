/**
 * Find all fields with broken/failed image URLs.
 * These URLs returned 404, 403, 523, DNS errors, or other failures during migration.
 *
 * Usage:
 *   cd backend
 *   PATH="/usr/local/bin:/usr/local/Cellar/node/24.9.0/bin:$PATH" node scripts/find-broken-images.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// All failed URLs from the migration logs
const failedUrls = [
  // 404 errors
  'https://dogwalkingfields.co.uk/wp-content/uploads/2024/03/Yorkshire',
  'https://ohmydogfreedomfields.co.uk/wp-content/uploads/2021/11/Field-2-1-scaled.jpg',
  'https://bingleyview.co.uk/wp-content/uploads/2021/09/1631474270-gallery.jpg',
  'https://bingleyview.co.uk/wp-content/uploads/2021/09/1631474270-gallery-2.jpg',
  'https://bingleyview.co.uk/wp-content/uploads/2021/09/1631474270-DogPark1-1-1.jpg',
  'https://bingleyview.co.uk/wp-content/uploads/2021/09/Morton-Paws-Park-Rules-scaled.jpg',
  'https://bingleyview.co.uk/wp-content/uploads/2021/09/1631474270-DogPark1-4-1.jpg',
  'https://images.squarespace-cdn.com/content/v1/donkeydell/dog+jump.jpg',
  'https://images.squarespace-cdn.com/content/v1/donkeydell/field2.jpg',
  'https://images.squarespace-cdn.com/content/v1/donkeydell/IMG_1803-2.jpg',
  'https://images.squarespace-cdn.com/content/v1/5a9b0c7d9f07f50c21d89a0a/1520098870089-DSC_4896.jpg',
  'https://images.squarespace-cdn.com/content/v1/5a9b0c7d9f07f50c21d89a0a/abbey-boarding-kennels-gallery-5b.jpg',
  'https://images.squarespace-cdn.com/content/v1/5a9b0c7d9f07f50c21d89a0a/1520098870089-DSC_4865.jpg',
  'https://images.squarespace-cdn.com/content/v1/5a9b0c7d9f07f50c21d89a0a/abbey-boarding-kennels-gallery-6-768.jpg',
  'https://aberconwyequestrian.co.uk/wp-content/uploads/2019/07/JPEG-image-9D6D161FEB22-1-e1565948150398.jpeg',
  'https://britishdogfields.com/wp-content/uploads/2024/02/Slade-Park-Secure-Dog-Walking-Field-Bodmin-Cornwall-1.jpg',
  'https://britishdogfields.com/wp-content/uploads/2024/02/Slade-Park-Secure-Dog-Walking-Field-Bodmin-Cornwall-2.jpg',
  'https://britishdogfields.com/wp-content/uploads/2024/02/Slade-Park-Secure-Dog-Walking-Field-Bodmin-Cornwall-4.jpg',
  'https://britishdogfields.com/wp-content/uploads/2024/02/Slade-Park-Secure-Dog-Walking-Field-Bodmin-Cornwall-3.jpg',
  'https://britishdogfields.com/wp-content/uploads/2024/02/The-Dog-Walking-Field-Tamworth-Lichfield-1.jpg',
  'https://britishdogfields.com/wp-content/uploads/2024/02/The-Dog-Walking-Field-Tamworth-Lichfield-2.jpg',
  'https://britishdogfields.com/wp-content/uploads/2024/02/The-Dog-Walking-Field-Tamworth-Lichfield-5.jpg',
  'https://britishdogfields.com/wp-content/uploads/2024/02/The-Dog-Walking-Field-Tamworth-Lichfield-3.jpg',
  'https://britishdogfields.com/wp-content/uploads/2024/02/Montys-Meadow-Stratton-on-the-Fosse-Somerset-3.jpg',
  'https://britishdogfields.com/wp-content/uploads/2024/02/Montys-Meadow-Stratton-on-the-Fosse-Somerset-1.jpg',
  'https://britishdogfields.com/wp-content/uploads/2024/02/Montys-Meadow-Stratton-on-the-Fosse-Somerset-2.jpg',
  'https://britishdogfields.com/wp-content/uploads/2024/02/Montys-Meadow-Stratton-on-the-Fosse-Somerset-4.jpg',
  'https://britishdogfields.com/wp-content/uploads/2024/02/Paw-Paddock-North-Waltham-Hampshire-2.jpg',
  'https://britishdogfields.com/wp-content/uploads/2024/02/Paw-Paddock-North-Waltham-Hampshire-1.jpg',
  'https://britishdogfields.com/wp-content/uploads/2024/02/Paw-Paddock-North-Waltham-Hampshire-3.jpg',
  'https://britishdogfields.com/wp-content/uploads/2024/02/Paw-Paddock-North-Waltham-Hampshire-4.jpg',
  'https://britishdogfields.com/wp-content/uploads/2025/06/Secure_Paws_Dog_Field_Chipping_Norton_1.jpg',
  'https://britishdogfields.com/wp-content/uploads/2025/06/Secure_Paws_Dog_Field_Chipping_Norton_2.jpg',
  'https://britishdogfields.com/wp-content/uploads/2025/06/Secure_Paws_Dog_Field_Chipping_Norton_3.jpg',
  'https://britishdogfields.com/wp-content/uploads/2022/03/The_Deben_Dog_Hub_Woodbridge_1-scaled.jpeg',
  'https://britishdogfields.com/wp-content/uploads/2022/03/The_Deben_Dog_Hub_Woodbridge_2-scaled.jpeg',
  'https://britishdogfields.com/wp-content/uploads/2022/03/The_Deben_Dog_Hub_Woodbridge_3-scaled.jpeg',
  'https://britishdogfields.com/wp-content/uploads/2022/03/The_Deben_Dog_Hub_Woodbridge_4-scaled.jpeg',
  'https://britishdogfields.com/wp-content/uploads/2025/08/Peddars_Paws_Field_Bridgham_1.jpg',
  'https://britishdogfields.com/wp-content/uploads/2025/08/Hounds_Bounds_Little_London_2-scaled.jpeg',
  'https://britishdogfields.com/wp-content/uploads/2025/08/Hounds_Bounds_Little_London_1-scaled.jpeg',
  'https://britishdogfields.com/wp-content/uploads/2025/08/The_Oak_Leaf_Dog_Park_Peckleton_2-scaled.jpg',
  'https://britishdogfields.com/wp-content/uploads/2025/08/The_Oak_Leaf_Dog_Park_Peckleton_3-scaled.jpg',
  'https://britishdogfields.com/wp-content/uploads/2025/08/The_Oak_Leaf_Dog_Park_Peckleton_1-scaled.jpg',
  'https://britishdogfields.com/wp-content/uploads/2025/08/The_Oak_Leaf_Dog_Park_Peckleton_4-scaled.jpg',
  'https://britishdogfields.com/wp-content/uploads/2025/08/Unleashed_Dog_Adventure_Park_Moira_4-scaled.jpg',
  'https://britishdogfields.com/wp-content/uploads/2025/08/Four_Acres_Dog_Field_Hilperton_2-scaled.jpg',
  'https://britishdogfields.com/wp-content/uploads/2025/08/Four_Acres_Dog_Field_Hilperton_4-scaled.jpg',
  'https://britishdogfields.com/wp-content/uploads/2024/07/Pool_Dog_Park_Wharfedale_2.jpeg',
  'https://britishdogfields.com/wp-content/uploads/2024/07/Pool_Dog_Park_Wharfedale_4.jpeg',
  'https://britishdogfields.com/wp-content/uploads/2024/07/Pool_Dog_Park_Wharfedale_6.jpeg',
  'https://britishdogfields.com/wp-content/uploads/2024/07/Pool_Dog_Park_Wharfedale_1.jpeg',
  'https://britishdogfields.com/wp-content/uploads/2025/06/The_Dog_Meadow_Magheralin_5.jpg',
  'https://britishdogfields.com/wp-content/uploads/2025/06/The_Dog_Meadow_Magheralin_6.jpg',
  'https://britishdogfields.com/wp-content/uploads/2025/06/The-Dog-Meadow-Craigavon_1.jpg',
  'https://britishdogfields.com/wp-content/uploads/2025/06/The_Dog_Meadow_Magheralin_4.jpg',
  'https://britishdogfields.com/wp-content/uploads/2025/08/Stash_Stables_Dudley_6.jpg',
  'https://britishdogfields.com/wp-content/uploads/2025/08/Featured-Image-Stash-Stables-Dog-Park.png',
  'https://britishdogfields.com/wp-content/uploads/2025/08/Stash_Stables_Dudley_5.jpg',
  'https://britishdogfields.com/wp-content/uploads/2025/07/Callander_K9_Adventure_Playground_Callander_4.jpg',
  'https://britishdogfields.com/wp-content/uploads/2025/08/Stash_Stables_Dudley_4.jpg',
  'https://britishdogfields.com/wp-content/uploads/2025/07/Callander_K9_Adventure_Playground_Callander_3.jpg',
  'https://britishdogfields.com/wp-content/uploads/2025/07/Callander_K9_Adventure_Playground_Callander_2.jpg',
  'https://britishdogfields.com/wp-content/uploads/2025/07/Callander_K9_Adventure_Playground_Callander_1.jpg',
  'https://britishdogfields.com/wp-content/uploads/2025/08/Thornborough_Paws_Milton_Keynes_2.jpg',
  'https://britishdogfields.com/wp-content/uploads/2025/08/Thornborough_Paws_Milton_Keynes_1.jpg',
  'https://britishdogfields.com/wp-content/uploads/2025/08/Thornborough_Paws_Milton_Keynes_3.jpg',
  'https://britishdogfields.com/wp-content/uploads/2025/08/Thornborough_Paws_Milton_Keynes_4.jpg',

  // 403 errors
  'https://www.developingdogs.co.uk/wp-content/uploads/2021/04/fields.jpg',
  'https://www.developingdogs.co.uk/wp-content/uploads/2025/10/FB_IMG_1761042602896.jpg',
  'https://www.developingdogs.co.uk/wp-content/uploads/2025/10/Snapchat-282057651.jpg',
  'https://www.developingdogs.co.uk/wp-content/uploads/2025/12/Resized_1000013567.jpg',

  // 523 errors (Cloudflare)
  'https://dogwalkingfields.co.uk/wp-content/uploads/2024/03/2145_8899b23f0d1cc0e1a44e76ba868b25c8-1.jpeg',
  'https://dogwalkingfields.co.uk/wp-content/uploads/2024/03/2144_b8122654796e9a102e02913b63b73cef-1.jpg',
  'https://dogwalkingfields.co.uk/wp-content/uploads/2024/03/2145_085f4d6974275dfcfb3287a424e75c04-1.jpeg',
  'https://dogwalkingfields.co.uk/wp-content/uploads/2024/03/2144_d5329e7a70d4e089dfb7bf6cd28799d2-1.jpg',
  'https://dogwalkingfields.co.uk/wp-content/uploads/2024/03/2144_c515e366c6b46dc797d79c3542e55440-1.jpg',
  'https://dogwalkingfields.co.uk/wp-content/uploads/2024/03/2148_6f9fa01e600e186f447f6a13a46e3186-1.png',
  'https://dogwalkingfields.co.uk/wp-content/uploads/2024/03/2148_d9334c34b776093faf18fccd4f206098-1.jpg',
  'https://dogwalkingfields.co.uk/wp-content/uploads/2024/03/2148_adb5dc080796c2f4cce31b374a07d48c-1.jpg',
  'https://dogwalkingfields.co.uk/wp-content/uploads/2024/03/2148_8eee5815c5b53c6aa32c4cd1b8fdf402-1.jpg',
  'https://dogwalkingfields.co.uk/wp-content/uploads/2024/03/2141_c9a13015d34cbe04d63db7213279dad3-1.jpg',
  'https://dogwalkingfields.co.uk/wp-content/uploads/2024/03/2141_959bbecc6997575deb99d52a33f3772d-1.jpg',

  // DNS errors (domain not found)
  'https://dickensdoggydates.co.uk/Gallery/17.jpg',
  'https://dickensdoggydates.co.uk/Gallery/18.jpg',
  'https://dickensdoggydates.co.uk/Gallery/21.jpg',
  'https://dickensdoggydates.co.uk/Gallery/23.jpg',
];

// Create a Set for faster lookup
const failedUrlSet = new Set(failedUrls);

async function main() {
  const fields = await prisma.field.findMany({
    select: { id: true, name: true, images: true }
  });

  const fieldsWithBrokenImages = [];

  for (const field of fields) {
    const images = field.images || [];
    const brokenUrls = images.filter(img => failedUrlSet.has(img));
    if (brokenUrls.length > 0) {
      fieldsWithBrokenImages.push({
        id: field.id,
        name: field.name,
        totalImages: images.length,
        brokenCount: brokenUrls.length,
        brokenUrls
      });
    }
  }

  // Sort by broken count descending
  fieldsWithBrokenImages.sort((a, b) => b.brokenCount - a.brokenCount);

  console.log('=== Fields with Broken Image URLs ===\n');
  console.log(`Total fields affected: ${fieldsWithBrokenImages.length}`);
  console.log(`Total broken images: ${fieldsWithBrokenImages.reduce((sum, f) => sum + f.brokenCount, 0)}\n`);

  for (const f of fieldsWithBrokenImages) {
    console.log(`\n─────────────────────────────────────────────`);
    console.log(`Field: ${f.name}`);
    console.log(`ID: ${f.id}`);
    console.log(`Broken: ${f.brokenCount} / ${f.totalImages} images`);
    console.log(`URLs:`);
    f.brokenUrls.forEach(url => {
      // Shorten URL for display
      const short = url.length > 80 ? url.substring(0, 77) + '...' : url;
      console.log(`  • ${short}`);
    });
  }

  console.log('\n\n=== SUMMARY BY ERROR TYPE ===');

  // Group by domain
  const byDomain = {};
  for (const f of fieldsWithBrokenImages) {
    for (const url of f.brokenUrls) {
      try {
        const domain = new URL(url).hostname;
        if (!byDomain[domain]) byDomain[domain] = { count: 0, fields: new Set() };
        byDomain[domain].count++;
        byDomain[domain].fields.add(f.name);
      } catch (e) {}
    }
  }

  console.log('\nBroken images by domain:');
  Object.entries(byDomain)
    .sort((a, b) => b[1].count - a[1].count)
    .forEach(([domain, data]) => {
      console.log(`  ${domain}: ${data.count} images across ${data.fields.size} fields`);
    });

  await prisma.$disconnect();
}

main().catch(console.error);
