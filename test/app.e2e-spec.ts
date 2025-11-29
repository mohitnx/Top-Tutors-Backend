import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('Health Check', () => {
    it('/api/v1/health (GET)', () => {
      return request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200)
        .expect(res => {
          expect(res.body.data.status).toBe('ok');
        });
    });
  });

  describe('Users CRUD', () => {
    const testUser = {
      email: 'test@example.com',
      name: 'Test User',
      password: 'Password123!',
    };

    it('/api/v1/users (POST) - should create a user', () => {
      return request(app.getHttpServer())
        .post('/api/v1/users')
        .send(testUser)
        .expect(201)
        .expect(res => {
          expect(res.body.data.email).toBe(testUser.email);
          expect(res.body.data.name).toBe(testUser.name);
          expect(res.body.data).not.toHaveProperty('password');
        });
    });

    it('/api/v1/users (GET) - should return paginated users', () => {
      return request(app.getHttpServer())
        .get('/api/v1/users')
        .expect(200)
        .expect(res => {
          expect(res.body.data).toHaveProperty('data');
          expect(res.body.data).toHaveProperty('meta');
          expect(Array.isArray(res.body.data.data)).toBe(true);
        });
    });
  });
});

