import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

async function main() {
  console.log('🌱 Starting database seeding...');

  // Create admin user
  const admin = await prisma.user.upsert({
    where: { email: 'admin@toptutor.com' },
    update: {},
    create: {
      email: 'admin@toptutor.com',
      name: 'Admin User',
      password: await hashPassword('Admin123!'),
      role: 'ADMIN',
    },
  });

  // Create sample tutors with profiles
  const tutorUser1 = await prisma.user.upsert({
    where: { email: 'tutor@toptutor.com' },
    update: {},
    create: {
      email: 'tutor@toptutor.com',
      name: 'John Mathematics',
      password: await hashPassword('Tutor123!'),
      role: 'TUTOR',
    },
  });

  // Create tutor profile
  const tutorId1 = uuidv4();
  await (prisma as any).tutors.upsert({
    where: { userId: tutorUser1.id },
    update: {},
    create: {
      id: tutorId1,
      userId: tutorUser1.id,
      bio: 'Experienced mathematics tutor with 10+ years of experience',
      qualification: 'PhD in Mathematics from MIT',
      experience: 10,
      hourlyRate: 50.0,
      isVerified: true,
      isAvailable: true,
      rating: 4.8,
      subjects: ['MATHEMATICS', 'PHYSICS'],
      updatedAt: new Date(),
    },
  });

  const tutorUser2 = await prisma.user.upsert({
    where: { email: 'tutor2@toptutor.com' },
    update: {},
    create: {
      email: 'tutor2@toptutor.com',
      name: 'Sarah Science',
      password: await hashPassword('Tutor123!'),
      role: 'TUTOR',
    },
  });

  const tutorId2 = uuidv4();
  await (prisma as any).tutors.upsert({
    where: { userId: tutorUser2.id },
    update: {},
    create: {
      id: tutorId2,
      userId: tutorUser2.id,
      bio: 'Passionate about making science accessible to everyone',
      qualification: 'MSc in Physics, BSc in Chemistry',
      experience: 7,
      hourlyRate: 45.0,
      isVerified: true,
      isAvailable: true,
      rating: 4.9,
      subjects: ['PHYSICS', 'CHEMISTRY', 'BIOLOGY'],
      updatedAt: new Date(),
    },
  });

  const tutorUser3 = await prisma.user.upsert({
    where: { email: 'tutor3@toptutor.com' },
    update: {},
    create: {
      email: 'tutor3@toptutor.com',
      name: 'Mike Computer Science',
      password: await hashPassword('Tutor123!'),
      role: 'TUTOR',
    },
  });

  const tutorId3 = uuidv4();
  await (prisma as any).tutors.upsert({
    where: { userId: tutorUser3.id },
    update: {},
    create: {
      id: tutorId3,
      userId: tutorUser3.id,
      bio: 'Software engineer turned educator, specialized in CS fundamentals',
      qualification: 'MS in Computer Science from Stanford',
      experience: 5,
      hourlyRate: 60.0,
      isVerified: true,
      isAvailable: true,
      rating: 4.7,
      subjects: ['COMPUTER_SCIENCE', 'MATHEMATICS'],
      updatedAt: new Date(),
    },
  });

  // Create sample student with profile
  const studentUser = await prisma.user.upsert({
    where: { email: 'student@toptutor.com' },
    update: {},
    create: {
      email: 'student@toptutor.com',
      name: 'Jane Student',
      password: await hashPassword('Student123!'),
      role: 'STUDENT',
    },
  });

  const studentId = uuidv4();
  await (prisma as any).students.upsert({
    where: { userId: studentUser.id },
    update: {},
    create: {
      id: studentId,
      userId: studentUser.id,
      grade: 'Grade 11',
      school: 'Springfield High School',
      phoneNumber: '+1234567890',
      updatedAt: new Date(),
    },
  });

  // Create sample courses linked to tutors
  const courses = await Promise.all([
    prisma.course.upsert({
      where: { id: 'course-1' },
      update: {},
      create: {
        id: 'course-1',
        title: 'Introduction to Mathematics',
        description: 'Learn the fundamentals of mathematics',
        price: 99.99,
        isPublished: true,
        tutorId: tutorId1,
      },
    }),
    prisma.course.upsert({
      where: { id: 'course-2' },
      update: {},
      create: {
        id: 'course-2',
        title: 'Advanced Physics',
        description: 'Deep dive into physics concepts',
        price: 149.99,
        isPublished: true,
        tutorId: tutorId2,
      },
    }),
    prisma.course.upsert({
      where: { id: 'course-3' },
      update: {},
      create: {
        id: 'course-3',
        title: 'Computer Science Fundamentals',
        description: 'Learn programming and algorithms',
        price: 129.99,
        isPublished: true,
        tutorId: tutorId3,
      },
    }),
  ]);

  console.log('✅ Database seeding completed!');
  console.log({
    users: {
      admin: admin.email,
      tutors: [tutorUser1.email, tutorUser2.email, tutorUser3.email],
      student: studentUser.email,
    },
    courses: courses.map(c => c.title),
    tutorProfiles: 3,
    studentProfiles: 1,
  });
  console.log('\n📋 Test Credentials:');
  console.log('  Admin:   admin@toptutor.com / Admin123!');
  console.log('  Tutor:   tutor@toptutor.com / Tutor123!');
  console.log('  Student: student@toptutor.com / Student123!');
}

main()
  .catch(e => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
