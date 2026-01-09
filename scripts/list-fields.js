const fields = db.fields.find({}).toArray();
print("=== ALL " + fields.length + " FIELDS ===");
print("");

fields.forEach((f, i) => {
  const img = f.images && f.images.length > 0 ? f.images[0] : f.image;
  let hasImage = false;

  if (img && img !== "null" && img !== "") {
    const lowerImg = img.toLowerCase();
    if (lowerImg.startsWith("http") && !lowerImg.includes("maps")) {
      hasImage = true;
    }
  }

  const loc = f.location && f.location.formatted_address
    ? f.location.formatted_address
    : (f.address ? f.address : "N/A");

  print((i + 1) + ". " + f.name);
  print("   ID: " + f._id);
  print("   Location: " + loc);
  print("   Has valid image: " + (hasImage ? "YES" : "NO"));
  if (!hasImage) {
    print("   Image value: " + (img || "NONE"));
  }
  print("");
});
