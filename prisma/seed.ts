import { PrismaClient, Role, AuthProvider, Subject } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function hashPassword(password: string): Promise<string> {
  const saltRounds = 12;
  return bcrypt.hash(password, saltRounds);
}

async function main() {
  console.log('🌱 Starting database seeding...');

  // Create admin user
  const adminPassword = await hashPassword('Admin123!');
  const admin = await prisma.user.upsert({
    where: { email: 'admin@toptutor.com' },
    update: {},
    create: {
      email: 'admin@toptutor.com',
      name: 'Admin User',
      password: adminPassword,
      role: Role.ADMIN,
      authProvider: AuthProvider.LOCAL,
    },
  });

  // Create 4 tutors with tutor profiles
  const tutorPassword = await hashPassword('Tutor123!');
  
  const tutorsData = [
    { email: 'john.tutor@toptutor.com', name: 'John Williams', bio: 'Experienced mathematics and physics teacher with 10 years of experience.', qualification: 'M.Sc. in Mathematics, B.Ed', experience: 10, hourlyRate: 50.0, subjects: [Subject.MATHEMATICS, Subject.PHYSICS] },
    { email: 'sarah.tutor@toptutor.com', name: 'Sarah Johnson', bio: 'Chemistry specialist with a passion for making science fun and accessible.', qualification: 'Ph.D. in Chemistry', experience: 8, hourlyRate: 60.0, subjects: [Subject.CHEMISTRY, Subject.BIOLOGY] },
    { email: 'mike.tutor@toptutor.com', name: 'Mike Chen', bio: 'Computer science expert specializing in programming and algorithms.', qualification: 'M.S. in Computer Science', experience: 6, hourlyRate: 55.0, subjects: [Subject.COMPUTER_SCIENCE, Subject.MATHEMATICS] },
    { email: 'emma.tutor@toptutor.com', name: 'Emma Davis', bio: 'English literature and language arts teacher with creative teaching methods.', qualification: 'M.A. in English Literature', experience: 12, hourlyRate: 45.0, subjects: [Subject.ENGLISH, Subject.HISTORY] },
  ];

  const tutorProfiles = [];
  for (const tutor of tutorsData) {
    const tutorUser = await prisma.user.upsert({
      where: { email: tutor.email },
      update: {},
      create: {
        email: tutor.email,
        name: tutor.name,
        password: tutorPassword,
        role: Role.TUTOR,
        authProvider: AuthProvider.LOCAL,
      },
    });

    const tutorProfile = await prisma.tutor.upsert({
      where: { userId: tutorUser.id },
      update: {
        subjects: tutor.subjects,
        isAvailable: true,
        rating: 4.5 + Math.random() * 0.5, // Random rating between 4.5 and 5.0
      },
      create: {
        userId: tutorUser.id,
        bio: tutor.bio,
        qualification: tutor.qualification,
        experience: tutor.experience,
        hourlyRate: tutor.hourlyRate,
        isVerified: true,
        isAvailable: true,
        subjects: tutor.subjects,
        rating: 4.5 + Math.random() * 0.5,
      },
    });
    tutorProfiles.push({ user: tutorUser, profile: tutorProfile });
  }

  // Create 3 students with student profiles
  const studentPassword = await hashPassword('Student123!');
  
  const studentsData = [
    { email: 'jane.student@toptutor.com', name: 'Jane Smith', grade: 'Grade 10', school: 'Springfield High School', phone: '+1234567890' },
    { email: 'alex.student@toptutor.com', name: 'Alex Brown', grade: 'Grade 11', school: 'Riverside Academy', phone: '+1234567891' },
    { email: 'lisa.student@toptutor.com', name: 'Lisa Wilson', grade: 'Grade 9', school: 'Oakwood Middle School', phone: '+1234567892' },
  ];

  const studentProfiles = [];
  for (const student of studentsData) {
    const studentUser = await prisma.user.upsert({
      where: { email: student.email },
      update: {},
      create: {
        email: student.email,
        name: student.name,
        password: studentPassword,
        role: Role.STUDENT,
        authProvider: AuthProvider.LOCAL,
      },
    });

    const studentProfile = await prisma.student.upsert({
      where: { userId: studentUser.id },
      update: {},
      create: {
        userId: studentUser.id,
        grade: student.grade,
        school: student.school,
        phoneNumber: student.phone,
      },
    });
    studentProfiles.push({ user: studentUser, profile: studentProfile });
  }

  // Create sample courses linked to tutors
  const courses = await Promise.all([
    prisma.course.upsert({
      where: { id: 'course-1' },
      update: {},
      create: {
        id: 'course-1',
        title: 'Introduction to Mathematics',
        description: 'Learn the fundamentals of mathematics including algebra, geometry, and calculus basics.',
        price: 99.99,
        isPublished: true,
        tutorId: tutorProfiles[0].profile.id,
      },
    }),
    prisma.course.upsert({
      where: { id: 'course-2' },
      update: {},
      create: {
        id: 'course-2',
        title: 'Advanced Chemistry',
        description: 'Deep dive into chemistry concepts including organic chemistry and biochemistry.',
        price: 149.99,
        isPublished: true,
        tutorId: tutorProfiles[1].profile.id,
      },
    }),
    prisma.course.upsert({
      where: { id: 'course-3' },
      update: {},
      create: {
        id: 'course-3',
        title: 'Programming Fundamentals',
        description: 'Learn to code from scratch with Python and JavaScript.',
        price: 129.99,
        isPublished: true,
        tutorId: tutorProfiles[2].profile.id,
      },
    }),
    prisma.course.upsert({
      where: { id: 'course-4' },
      update: {},
      create: {
        id: 'course-4',
        title: 'English Literature',
        description: 'Explore classic and modern literature with in-depth analysis and discussions.',
        price: 79.99,
        isPublished: true,
        tutorId: tutorProfiles[3].profile.id,
      },
    }),
  ]);

  // Enroll students in courses
  await prisma.enrollment.upsert({
    where: {
      studentId_courseId: {
        studentId: studentProfiles[0].profile.id,
        courseId: courses[0].id,
      },
    },
    update: {},
    create: {
      studentId: studentProfiles[0].profile.id,
      courseId: courses[0].id,
    },
  });

  await prisma.enrollment.upsert({
    where: {
      studentId_courseId: {
        studentId: studentProfiles[1].profile.id,
        courseId: courses[2].id,
      },
    },
    update: {},
    create: {
      studentId: studentProfiles[1].profile.id,
      courseId: courses[2].id,
    },
  });

  console.log('✅ Database seeding completed!');
  console.log({
    users: {
      admin: admin.email,
      tutors: tutorProfiles.map(t => t.user.email),
      students: studentProfiles.map(s => s.user.email),
    },
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
