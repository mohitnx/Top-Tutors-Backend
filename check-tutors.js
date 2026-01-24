const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('\n=== TUTORS ===');
  const tutors = await prisma.tutors.findMany({
    include: {
      users: {
        select: { id: true, email: true, name: true, role: true }
      }
    }
  });
  
  tutors.forEach(t => {
    console.log(`\nTutor ID: ${t.id}`);
    console.log(`User ID: ${t.userId}`);
    console.log(`Name: ${t.users?.name}`);
    console.log(`Email: ${t.users?.email}`);
    console.log(`Subjects: ${JSON.stringify(t.subjects)}`);
    console.log(`Available: ${t.isAvailable}`);
    console.log(`Verified: ${t.isVerified}`);
    console.log(`Busy: ${t.isBusy}`);
  });

  console.log('\n=== PENDING CONVERSATIONS ===');
  const conversations = await prisma.conversations.findMany({
    where: { status: 'PENDING' },
    include: {
      students: {
        include: {
          users: { select: { name: true, email: true } }
        }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 5
  });

  conversations.forEach(c => {
    console.log(`\nConversation ID: ${c.id}`);
    console.log(`Subject: ${c.subject}`);
    console.log(`Topic: ${c.topic}`);
    console.log(`Status: ${c.status}`);
    console.log(`Student: ${c.students?.users?.name}`);
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());







