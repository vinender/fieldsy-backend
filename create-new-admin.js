const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function createNewAdmin() {
  try {
    console.log('\n🔐 Admin Management Script\n');

    // Delete old admin(s)
    console.log('Deleting existing admin users...');
    const deleted = await prisma.user.deleteMany({
      where: {
        role: 'ADMIN'
      }
    });
    console.log(`✅ Deleted ${deleted.count} admin user(s)`);

    // Create new admin
    const email = 'david@fieldsy.co.uk';
    const password = '@davidfieldsy123';
    const name = 'David';

    const hashedPassword = await bcrypt.hash(password, 10);

    const admin = await prisma.user.create({
      data: {
        email: email,
        password: hashedPassword,
        name: name,
        role: 'ADMIN',
        emailVerified: new Date()
      }
    });

    console.log('\n✅ New admin created successfully!');
    console.log('   Email:', admin.email);
    console.log('   Name:', admin.name);
    console.log('   Role:', admin.role);
    console.log('\n🔑 Login credentials:');
    console.log('   Email: david@fieldsy.co.uk');
    console.log('   Password: @davidfieldsy123');
    console.log('\n');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createNewAdmin();
