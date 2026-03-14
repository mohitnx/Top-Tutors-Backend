import { PrismaClient, Role, Subject } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

async function main() {
  console.log('Seeding database...');

  // ─── Super Admin (active, password set — no invitation needed) ───────────
  const admin = await prisma.user.upsert({
    where: { email: 'admin@toptutors.com' },
    update: {},
    create: {
      email: 'admin@toptutors.com',
      name: 'Platform Admin',
      password: await hashPassword('Admin@123'),
      role: Role.ADMIN,
      isActive: true,
    },
  });
  console.log(`Admin: ${admin.email}`);

  // ─── Schools ──────────────────────────────────────────────────────────────
  const school1 = await prisma.school.upsert({
    where: { code: 'SPH-001' },
    update: {},
    create: {
      name: 'Springfield High School',
      code: 'SPH-001',
      city: 'Springfield',
      country: 'US',
    },
  });

  const school2 = await prisma.school.upsert({
    where: { code: 'LMS-001' },
    update: {},
    create: {
      name: 'Lincoln Middle School',
      code: 'LMS-001',
      city: 'Lincoln',
      country: 'US',
    },
  });
  console.log(`Schools: ${school1.name}, ${school2.name}`);

  // ─── School Administrator for school1 ────────────────────────────────────
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin.sph@toptutors.com' },
    update: {},
    create: {
      email: 'admin.sph@toptutors.com',
      name: 'Sarah Wilson',
      password: await hashPassword('Admin@123'),
      role: Role.ADMINISTRATOR,
      isActive: true,
      administeredSchoolId: school1.id,
    },
  });
  console.log(`Administrator: ${adminUser.email} → ${school1.name}`);

  // ─── Tutors (platform-wide) ───────────────────────────────────────────────
  const tutor1User = await prisma.user.upsert({
    where: { email: 'john.math@toptutors.com' },
    update: {},
    create: {
      email: 'john.math@toptutors.com',
      name: 'John Mathematics',
      password: await hashPassword('Tutor@123'),
      role: Role.TUTOR,
      isActive: true,
    },
  });

  await prisma.tutors.upsert({
    where: { userId: tutor1User.id },
    update: {},
    create: {
      id: uuidv4(),
      userId: tutor1User.id,
      bio: 'Passionate mathematics educator with 10 years of experience.',
      qualification: 'MSc Mathematics',
      experience: 10,
      hourlyRate: 50,
      subjects: [Subject.MATHEMATICS, Subject.PHYSICS],
      isVerified: true,
      rating: 4.8,
      updatedAt: new Date(),
    },
  });

  const tutor2User = await prisma.user.upsert({
    where: { email: 'emma.science@toptutors.com' },
    update: {},
    create: {
      email: 'emma.science@toptutors.com',
      name: 'Emma Science',
      password: await hashPassword('Tutor@123'),
      role: Role.TUTOR,
      isActive: true,
    },
  });

  await prisma.tutors.upsert({
    where: { userId: tutor2User.id },
    update: {},
    create: {
      id: uuidv4(),
      userId: tutor2User.id,
      bio: 'Chemistry and Biology specialist with a PhD in Life Sciences.',
      qualification: 'PhD Biology',
      experience: 7,
      hourlyRate: 60,
      subjects: [Subject.CHEMISTRY, Subject.BIOLOGY],
      isVerified: true,
      rating: 4.9,
      updatedAt: new Date(),
    },
  });
  console.log(`Tutors: ${tutor1User.email}, ${tutor2User.email}`);

  // ─── Students (school-affiliated — SAP enabled) ───────────────────────────
  const student1User = await prisma.user.upsert({
    where: { email: 'alice@sph.edu' },
    update: {},
    create: {
      email: 'alice@sph.edu',
      name: 'Alice Johnson',
      password: await hashPassword('Student@123'),
      role: Role.STUDENT,
      isActive: true,
    },
  });

  await prisma.students.upsert({
    where: { userId: student1User.id },
    update: {},
    create: {
      id: uuidv4(),
      userId: student1User.id,
      schoolId: school1.id, // affiliated → SAP enabled
      grade: 'Grade 11',
      updatedAt: new Date(),
    },
  });

  const student2User = await prisma.user.upsert({
    where: { email: 'bob@lms.edu' },
    update: {},
    create: {
      email: 'bob@lms.edu',
      name: 'Bob Smith',
      password: await hashPassword('Student@123'),
      role: Role.STUDENT,
      isActive: true,
    },
  });

  await prisma.students.upsert({
    where: { userId: student2User.id },
    update: {},
    create: {
      id: uuidv4(),
      userId: student2User.id,
      schoolId: school2.id, // affiliated → SAP enabled
      grade: 'Grade 8',
      updatedAt: new Date(),
    },
  });

  // ─── Student (unaffiliated — no SAP) ─────────────────────────────────────
  const student3User = await prisma.user.upsert({
    where: { email: 'carol@gmail.com' },
    update: {},
    create: {
      email: 'carol@gmail.com',
      name: 'Carol Davis',
      password: await hashPassword('Student@123'),
      role: Role.STUDENT,
      isActive: true,
    },
  });

  await prisma.students.upsert({
    where: { userId: student3User.id },
    update: {},
    create: {
      id: uuidv4(),
      userId: student3User.id,
      schoolId: null, // no school → SAP disabled
      updatedAt: new Date(),
    },
  });
  console.log(`Students: ${student1User.email} (SPH), ${student2User.email} (LMS), ${student3User.email} (unaffiliated)`);

  console.log('\nSeeding complete.');
  console.log('Login credentials for development:');
  console.log('  Admin:          admin@toptutors.com / Admin@123');
  console.log('  Administrator:  admin.sph@toptutors.com / Admin@123');
  console.log('  Tutor:          john.math@toptutors.com / Tutor@123');
  console.log('  Student (SAP):  alice@sph.edu / Student@123');
  console.log('  Student (no SAP): carol@gmail.com / Student@123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


