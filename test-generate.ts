import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testGenerate() {
  const counter = await prisma.counter.upsert({
    where: { name: 'user' },
    update: { value: { increment: 1 } },
    create: { name: 'user', value: 7777 },
  });
  console.log('Result:', counter);
}

testGenerate()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
