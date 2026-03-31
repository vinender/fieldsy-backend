"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
//@ts-nocheck
const client_1 = require("@prisma/client");
// Create a single instance of PrismaClient
const prismaClient = new client_1.PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});
// Handle connection events
prismaClient.$connect()
    .then(() => {
    console.log('✅ MongoDB connected successfully');
})
    .catch((error) => {
    console.error('❌ MongoDB connection failed:', error);
    console.log('📌 Make sure MongoDB is running:');
    console.log('   - For local MongoDB: mongod or brew services start mongodb-community');
    console.log('   - For MongoDB Atlas: Check your connection string and network access');
    process.exit(1);
});
// Graceful shutdown
process.on('beforeExit', async () => {
    await prismaClient.$disconnect();
});
// Export both default and named export for better compatibility
exports.prisma = prismaClient;
exports.default = prismaClient;
