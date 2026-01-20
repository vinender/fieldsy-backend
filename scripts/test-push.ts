
import { PrismaClient } from '@prisma/client';
import { PushNotificationService } from '../src/services/push-notification.service';
import { initializeFirebase } from '../src/config/firebase.config';
import dotenv from 'dotenv';
import path from 'path';

// Load env vars
dotenv.config({ path: path.join(__dirname, '../.env') });

const prisma = new PrismaClient();

async function main() {
    // Initialize Firebase first
    initializeFirebase();

    const email = process.argv[2] || 'chandel.vinender@gmail.com';

    if (!email) {
        console.error('Please provide an email address as an argument');
        console.log('Usage: npx ts-node scripts/test-push.ts user@example.com');
        process.exit(1);
    }

    console.log(`Looking up user with email: ${email}`);
    const user = await prisma.user.findFirst({
        where: { email },
    });

    if (!user) {
        console.error('User not found');
        process.exit(1);
    }

    console.log(`Found user: ${user.id}`);

    // Check tokens
    const tokens = await prisma.deviceToken.findMany({
        where: { userId: user.id }
    });

    console.log(`Found ${tokens.length} device tokens:`);
    tokens.forEach(t => console.log(`- [${t.platform}] ${t.token.substring(0, 20)}... (Active: ${t.isActive})`));

    console.log('\nSending test notification...');

    const result = await PushNotificationService.sendToUser({
        userId: user.id,
        title: 'Test Notification',
        body: 'This is a test notification from the debug script',
        data: {
            type: 'test_notification',
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
            test_data: '123'
        }
    });

    console.log('Result:', JSON.stringify(result, null, 2));
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
