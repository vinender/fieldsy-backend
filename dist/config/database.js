//@ts-nocheck
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get default () {
        return _default;
    },
    get prisma () {
        return prisma;
    }
});
const _client = require("@prisma/client");
// Create a single instance of PrismaClient
const prismaClient = new _client.PrismaClient({
    log: process.env.NODE_ENV === 'development' ? [
        'query',
        'error',
        'warn'
    ] : [
        'error'
    ]
});
// Handle connection events
prismaClient.$connect().then(()=>{
    console.log('✅ MongoDB connected successfully');
}).catch((error)=>{
    console.error('❌ MongoDB connection failed:', error);
    console.log('📌 Make sure MongoDB is running:');
    console.log('   - For local MongoDB: mongod or brew services start mongodb-community');
    console.log('   - For MongoDB Atlas: Check your connection string and network access');
    process.exit(1);
});
// Graceful shutdown
process.on('beforeExit', async ()=>{
    await prismaClient.$disconnect();
});
const prisma = prismaClient;
const _default = prismaClient;

//# sourceMappingURL=database.js.map