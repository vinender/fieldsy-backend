import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateUsers() {
    console.log('🚀 Starting User ID migration...');

    // 1. Initialize counter for users if it doesn't exist
    // We want to start from 7777 as requested
    const counter = await prisma.counter.upsert({
        where: { name: 'user' },
        update: {},
        create: { name: 'user', value: 7776 }, // Next value will be 7777
    });

    console.log(`📊 Counter initialized: ${counter.value}`);

    // 2. Fetch all users without a userId
    const users = await prisma.user.findMany({
        where: {
            userId: null,
        },
        orderBy: {
            createdAt: 'asc',
        },
    });

    console.log(`👥 Found ${users.length} users to migrate.`);

    // 3. Assign userId sequentially
    let currentVal = counter.value;
    for (const user of users) {
        currentVal++;
        const userId = `U${currentVal}`; // Or just the number? User said "4 digit starting 7777", usually good to prefix or keep as string

        await prisma.user.update({
            where: { id: user.id },
            data: { userId: userId.toString() },
        });
        console.log(`✅ Assigned userId ${userId} to user ${user.email} (${user.id})`);
    }

    // 4. Update the counter value
    await prisma.counter.update({
        where: { name: 'user' },
        data: { value: currentVal },
    });

    console.log('🏁 Migration completed successfully!');
}

migrateUsers()
    .catch((e) => {
        console.error('❌ Migration failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
