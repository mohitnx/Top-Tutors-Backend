import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

// Simple password hashing (use bcrypt in production)
function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
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
      password: hashPassword('Admin123!'),
      role: 'ADMIN',
    },
  });

  // Create sample tutor
  const tutor = await prisma.user.upsert({
    where: { email: 'tutor@toptutor.com' },
    update: {},
    create: {
      email: 'tutor@toptutor.com',
      name: 'John Tutor',
      password: hashPassword('Tutor123!'),
      role: 'TUTOR',
    },
  });

  // Create sample student
  const student = await prisma.user.upsert({
    where: { email: 'student@toptutor.com' },
    update: {},
    create: {
      email: 'student@toptutor.com',
      name: 'Jane Student',
      password: hashPassword('Student123!'),
      role: 'STUDENT',
    },
  });

  // Create sample courses
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
      },
    }),
    prisma.course.upsert({
      where: { id: 'course-3' },
      update: {},
      create: {
        id: 'course-3',
        title: 'English Literature',
        description: 'Explore classic and modern literature',
        price: 79.99,
        isPublished: false,
      },
    }),
  ]);

  console.log('✅ Database seeding completed!');
  console.log({
    users: { admin: admin.email, tutor: tutor.email, student: student.email },
    courses: courses.map(c => c.title),
  });
}

main()
  .catch(e => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

