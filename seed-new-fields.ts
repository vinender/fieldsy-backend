
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const adminId = "696a278c358cbcf2506c6c07"; // David Reid

    // 1. Add/Update Field Properties for fenceType
    const fenceTypes = [
        { label: "Deer Fencing", value: "deer-fencing" },
        { label: "Stock Fencing", value: "stock-fencing" },
        { label: "Fencing Dug Into the Ground", value: "fencing-dug-into-ground" },
        { label: "Extra Layer of Rabbit Fencing", value: "extra-layer-of-rabbit-fencing" }
    ];

    for (const ft of fenceTypes) {
        await prisma.fieldProperty.upsert({
            where: { category_value: { category: 'fenceType', value: ft.value } },
            update: { label: ft.label, isActive: true },
            create: { category: 'fenceType', value: ft.value, label: ft.label, isActive: true }
        });
    }

    // 2. Add/Update Field Properties for areaType
    const areaTypes = [
        { label: "Paddock", value: "paddock" },
        { label: "Open field/Meadow", value: "open-field-meadow" },
        { label: "Mixture of Fields and Trees", value: "mixture-of-fields-trees" },
        { label: "Outdoor Enrichment Area", value: "outdoor-enrichment-area" }
    ];

    for (const at of areaTypes) {
        await prisma.fieldProperty.upsert({
            where: { category_value: { category: 'areaType', value: at.value } },
            update: { label: at.label, isActive: true },
            create: { category: 'areaType', value: at.value, label: at.label, isActive: true }
        });
    }

    // 3. Helper to update counter and get fieldId
    async function getNextFieldId() {
        const counter = await prisma.counter.update({
            where: { name: 'field' },
            data: { value: { increment: 1 } }
        });
        return `F${counter.value}`;
    }

    // 4. Fields to add
    const fields = [
        {
            name: "Paw Paddock – Wickham West",
            address: "Titchfield Lane, Tapnage, Wickham, Winchester, Hampshire, PO17 5NZ",
            lat: 50.902476,
            lng: -1.202872,
            size: "1 – 2 Acres",
            fenceType: "deer-fencing, stock-fencing",
            areaType: "paddock",
            price30min: 7,
            price1hr: 12,
            openingTime: "07:15",
            closingTime: "17:15",
            maxDogs: 10
        },
        {
            name: "Release The Hounds taunton",
            address: "taunton", // No specific address given
            size: "3 acres",
            fenceType: "deer-fencing",
            areaType: "open-field-meadow, paddock, mixture-of-fields-trees, outdoor-enrichment-area",
            price30min: 6.5,
            price1hr: 10.5,
            maxDogs: 1
        },
        {
            name: "The Dog Walking Field – Danehill",
            address: "Tanyard Lane, Furner’s Green, Danehill, Wealden, East Sussex, TN22 3RJ",
            lat: 51.016727,
            lng: 0.007779,
            size: "3-4 acre",
            fenceType: "stock-fencing",
            price30min: 7,
            price1hr: 10,
            maxDogs: 10
        },
        {
            name: "Midge Hall Secure Dog Field",
            address: "Midge Hall", // No specific address given
            size: "2-4 acre",
            fenceType: "deer-fencing",
            areaType: "paddock",
            amenities: ["Shelter", "Seating or Benches Available", "Child friendly"],
            price30min: 7,
            price1hr: 12,
            maxDogs: 10
        },
        {
            name: "Linley Hill Dog Fields",
            address: "Linley Hill", // No specific address given
            size: "1 to 2 acres",
            fenceType: "deer-fencing, fencing-dug-into-ground, extra-layer-of-rabbit-fencing",
            maxDogs: 10
        }
    ];

    for (const f of fields) {
        const fieldId = await getNextFieldId();
        console.log(`Creating field ${f.name} with ID ${fieldId}`);

        await prisma.field.create({
            data: {
                fieldId,
                name: f.name,
                address: f.address,
                latitude: f.lat,
                longitude: f.lng,
                ownerId: adminId,
                size: f.size,
                fenceType: f.fenceType,
                areaType: f.areaType,
                price30min: f.price30min,
                price1hr: f.price1hr,
                openingTime: f.openingTime,
                closingTime: f.closingTime,
                amenities: f.amenities || [],
                maxDogs: f.maxDogs,
                isActive: true,
                isApproved: true,
                isSubmitted: true,
                fieldDetailsCompleted: true,
                uploadImagesCompleted: true,
                pricingAvailabilityCompleted: true,
                bookingRulesCompleted: true,
                location: f.lat ? {
                    streetAddress: f.address,
                    lat: f.lat,
                    lng: f.lng,
                    formatted_address: f.address
                } : null
            }
        });
    }

    console.log('Migration completed successfully');
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
