// List ALL fields that have no valid images

print("Analyzing all 1138 fields for missing images...");
print("");

const fields = db.fields.find({}).sort({ createdAt: -1 }).toArray();

print("Total fields: " + fields.length);
print("");

const fieldsWithoutImages = [];

fields.forEach((f, i) => {
  const img = f.images && f.images.length > 0 ? f.images[0] : f.image;
  let hasValidImage = false;

  if (img && img !== "null" && img !== "") {
    const lowerImg = img.toLowerCase();
    // Valid if starts with http and is not a map image
    if (lowerImg.startsWith("http")) {
      const isMapImage = lowerImg.includes("maps.google") ||
        lowerImg.includes("google.com/maps") ||
        lowerImg.includes("maps.googleapis.com") ||
        lowerImg.includes("staticmap") ||
        lowerImg.includes("street_view") ||
        lowerImg.includes("streetview") ||
        lowerImg.includes("openstreetmap") ||
        lowerImg.includes("mapbox");

      const isPlaceholder = lowerImg.includes("placeholder") || lowerImg.includes("/fields/field");

      if (!isMapImage && !isPlaceholder) {
        hasValidImage = true;
      }
    }
  }

  if (!hasValidImage) {
    // Calculate page number (assuming 10 per page)
    const pageNum = Math.floor(i / 10) + 1;

    fieldsWithoutImages.push({
      position: i + 1,
      page: pageNum,
      id: f._id.toString(),
      name: f.name,
      location: f.location && f.location.formatted_address
        ? f.location.formatted_address
        : (f.address ? f.address : "N/A"),
      image: img || "NONE"
    });
  }
});

print("=== ALL FIELDS WITHOUT VALID IMAGES ===");
print("Total without images: " + fieldsWithoutImages.length);
print("");

// Group by page
const byPage = {};
fieldsWithoutImages.forEach(f => {
  if (!byPage[f.page]) byPage[f.page] = [];
  byPage[f.page].push(f);
});

// Show summary by page
print("Fields without images by page:");
Object.keys(byPage).sort((a,b) => Number(a) - Number(b)).forEach(page => {
  print("  Page " + page + ": " + byPage[page].length + " fields");
});

print("");
print("=== DETAILED LIST ===");
print("");

fieldsWithoutImages.forEach((f, i) => {
  print((i + 1) + ". " + f.name);
  print("   Page: " + f.page + " | Position: #" + f.position);
  print("   ID: " + f.id);
  print("   Location: " + f.location);
  print("   Image value: " + (f.image.length > 100 ? f.image.substring(0, 100) + "..." : f.image));
  print("");
});
