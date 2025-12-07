# 🎓 Top Tutors - Frontend API Documentation

**Version:** 1.0.0 | **Last Updated:** December 7, 2025  
**Backend Stack:** NestJS + Fastify + PostgreSQL + Prisma + WebSocket

---

## 📌 Quick Reference

| Item | URL |
|------|-----|
| **Base API URL** | `http://localhost:3000/api/v1` |
| **WebSocket URL** | `http://localhost:3000/messages` |
| **Swagger Docs** | `http://localhost:3000/docs` |

---

## 📑 Table of Contents

1. [Project Setup](#1-project-setup)
2. [Authentication Flow](#2-authentication-flow)
3. [Auth API Endpoints](#3-auth-api-endpoints)
4. [User Management](#4-user-management)
5. [Messaging & Conversations](#5-messaging--conversations)
6. [WebSocket Real-time Events](#6-websocket-real-time-events)
7. [Data Types & Enums](#7-data-types--enums)
8. [Error Handling](#8-error-handling)
9. [Test Accounts](#9-test-accounts)
10. [Frontend Checklist](#10-frontend-checklist)

---

## 1. Project Setup

### 1.1 Environment Variables (.env.local)

```env
REACT_APP_API_BASE_URL=http://localhost:3000/api/v1
REACT_APP_WS_URL=http://localhost:3000
REACT_APP_GOOGLE_CLIENT_ID=your_google_client_id
```

### 1.2 Required Dependencies

```bash
npm install axios socket.io-client react-router-dom
```

### 1.3 Axios Instance Setup

```typescript
// src/api/axios.ts
import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_BASE_URL,
  headers: { 'Content-Type': 'application/json' }
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 errors - redirect to login
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken) {
        try {
          const res = await axios.post(
            `${process.env.REACT_APP_API_BASE_URL}/auth/refresh`,
            { refreshToken }
          );
          localStorage.setItem('accessToken', res.data.data.tokens.accessToken);
          localStorage.setItem('refreshToken', res.data.data.tokens.refreshToken);
          error.config.headers.Authorization = `Bearer ${res.data.data.tokens.accessToken}`;
          return api.request(error.config);
        } catch {
          localStorage.clear();
          window.location.href = '/login';
        }
      } else {
        localStorage.clear();
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
```

---

## 2. Authentication Flow

### 2.1 Login Flow

1. **User visits `/login`** → Show login form
2. **User submits** → Call `POST /auth/login`
3. **On Success:**
   - Store `accessToken` and `refreshToken` in localStorage
   - Store user data in context/state
   - Redirect based on role:
     - `STUDENT` → `/dashboard/student`
     - `TUTOR` → `/dashboard/tutor`
     - `ADMIN` → `/admin`
4. **On Error:** Show "Invalid email or password"

### 2.2 Registration Flow (Students Only)

1. **User visits `/register`** → Show registration form
2. **Frontend validates:**
   - Valid email format
   - Password: min 8 chars, 1 uppercase, 1 number
   - Passwords match
3. **Submit** → Call `POST /auth/register/student`
4. **On Success:** Auto-login (tokens returned), redirect to dashboard

### 2.3 Google OAuth Flow

1. **User clicks "Sign in with Google"**
2. **Redirect to:** `http://localhost:3000/api/v1/auth/google`
3. **After Google auth**, backend redirects to:
   `http://localhost:3001/auth/callback?accessToken=xxx&refreshToken=xxx`
4. **Frontend `/auth/callback` page:**
   - Extract tokens from URL params
   - Store in localStorage
   - Fetch user profile
   - Redirect to dashboard

### 2.4 Protected Route Component

```tsx
const ProtectedRoute = ({ children, allowedRoles }) => {
  const token = localStorage.getItem('accessToken');
  const { user } = useAuth();
  
  if (!token) {
    return <Navigate to="/login" state={{ from: location }} />;
  }
  
  if (allowedRoles && !allowedRoles.includes(user?.role)) {
    return <Navigate to="/unauthorized" />;
  }
  
  return children;
};
```

### 2.5 Logout Flow

1. Call `POST /auth/logout` (optional, invalidates refresh token)
2. Clear localStorage
3. Redirect to `/login`

---

## 3. Auth API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/register/student` | ❌ | Register new student |
| POST | `/auth/login` | ❌ | Login |
| GET | `/auth/google` | ❌ | Start Google OAuth |
| POST | `/auth/refresh` | ❌ | Refresh tokens |
| POST | `/auth/logout` | ✅ | Logout |
| GET | `/auth/profile` | ✅ | Get current user |

### POST /auth/register/student

**Request:**
```json
{
  "email": "student@example.com",
  "password": "Password123!",
  "name": "John Doe"
}
```

**Response (201):**
```json
{
  "success": true,
  "statusCode": 201,
  "data": {
    "user": {
      "id": "uuid",
      "email": "student@example.com",
      "name": "John Doe",
      "role": "STUDENT",
      "isActive": true
    },
    "tokens": {
      "accessToken": "eyJhbGc...",
      "refreshToken": "eyJhbGc..."
    }
  }
}
```

### POST /auth/login

**Request:**
```json
{
  "email": "student@example.com",
  "password": "Password123!"
}
```

**Response (200):** Same as register

**Error (401):**
```json
{
  "statusCode": 401,
  "message": "Invalid credentials"
}
```

### POST /auth/refresh

**Request:**
```json
{
  "refreshToken": "eyJhbGc..."
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "tokens": {
      "accessToken": "new_token...",
      "refreshToken": "new_refresh..."
    }
  }
}
```

### GET /auth/profile

**Headers:** `Authorization: Bearer <token>`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "student@example.com",
    "name": "John Doe",
    "role": "STUDENT",
    "isActive": true,
    "createdAt": "2025-12-07T12:00:00.000Z"
  }
}
```

---

## 4. User Management

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/users` | ✅ | Get all users (paginated) |
| GET | `/users/:id` | ✅ | Get user by ID |
| POST | `/users` | ✅ | Create user |
| PATCH | `/users/:id` | ✅ | Update user |
| DELETE | `/users/:id` | ✅ | Delete user |

### GET /users

**Query Params:**
- `page` (default: 1)
- `limit` (default: 10)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "data": [
      {
        "id": "uuid",
        "email": "user@example.com",
        "name": "John Doe",
        "role": "STUDENT",
        "isActive": true,
        "createdAt": "2025-12-07T12:00:00.000Z",
        "updatedAt": "2025-12-07T12:00:00.000Z"
      }
    ],
    "meta": {
      "total": 50,
      "page": 1,
      "limit": 10,
      "totalPages": 5
    }
  }
}
```

---

## 5. Messaging & Conversations

### Flow: Student Asks Question

1. Student opens "Ask Question" page
2. Types question in text field
3. Clicks submit → `POST /messages/send`
4. **Backend automatically:**
   - AI classifies message (subject, topic, urgency)
   - Finds best matching tutor
   - Creates conversation
   - Assigns tutor
5. Show success: "Sent to [Tutor Name]!"
6. Redirect to conversation view

### Flow: Tutor Receives & Responds

1. Tutor logged in with WebSocket connected
2. Receives `newAssignment` event
3. Shows notification toast
4. Tutor opens conversation
5. Sends reply → `POST /messages/send` with `conversationId`
6. Student receives message in real-time

### Messaging Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/messages/send` | ✅ | Send message |
| GET | `/messages/conversations` | ✅ | Get my conversations |
| GET | `/messages/conversations/pending` | ✅ | Get unassigned (admin) |
| GET | `/messages/conversations/:id` | ✅ | Get conversation detail |
| POST | `/messages/conversations/:id/assign` | ✅ | Assign tutor |
| POST | `/messages/conversations/:id/close` | ✅ | Close conversation |
| POST | `/messages/conversations/:id/read` | ✅ | Mark as read |

### POST /messages/send

**New Conversation:**
```json
{
  "content": "I need help with quadratic equations",
  "messageType": "TEXT"
}
```

**Reply to Existing:**
```json
{
  "content": "Can you explain more?",
  "messageType": "TEXT",
  "conversationId": "conv-uuid"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "message": {
      "id": "msg-uuid",
      "conversationId": "conv-uuid",
      "senderId": "user-uuid",
      "senderType": "STUDENT",
      "content": "I need help with quadratic equations",
      "messageType": "TEXT",
      "isRead": false,
      "createdAt": "2025-12-07T12:00:00.000Z"
    },
    "conversation": {
      "id": "conv-uuid",
      "subject": "MATHEMATICS",
      "topic": "Quadratic Equations",
      "keywords": ["quadratic", "equations"],
      "urgency": "NORMAL",
      "status": "ASSIGNED",
      "tutorId": "tutor-uuid",
      "tutor": {
        "user": { "name": "John Williams" }
      }
    }
  }
}
```

### GET /messages/conversations

**Query Params:**
- `page` (default: 1)
- `limit` (default: 10)
- `status` (optional): PENDING | ASSIGNED | ACTIVE | RESOLVED | CLOSED

**Response:**
```json
{
  "success": true,
  "data": {
    "data": [
      {
        "id": "conv-uuid",
        "subject": "MATHEMATICS",
        "topic": "Quadratic Equations",
        "urgency": "NORMAL",
        "status": "ACTIVE",
        "tutor": {
          "id": "tutor-uuid",
          "user": { "name": "John Williams", "email": "..." }
        },
        "messages": [{ "content": "Last message...", "createdAt": "..." }],
        "createdAt": "...",
        "updatedAt": "..."
      }
    ],
    "meta": { "total": 5, "page": 1, "limit": 10, "totalPages": 1 }
  }
}
```

### GET /messages/conversations/:id

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "conv-uuid",
    "subject": "MATHEMATICS",
    "topic": "Quadratic Equations",
    "keywords": ["quadratic", "equations"],
    "urgency": "NORMAL",
    "status": "ACTIVE",
    "student": {
      "id": "student-uuid",
      "user": { "name": "Jane Smith", "email": "..." }
    },
    "tutor": {
      "id": "tutor-uuid",
      "user": { "name": "John Williams", "email": "..." }
    },
    "messages": [
      {
        "id": "msg-1",
        "senderId": "user-uuid",
        "senderType": "STUDENT",
        "content": "I need help...",
        "messageType": "TEXT",
        "isRead": true,
        "createdAt": "2025-12-07T12:00:00.000Z"
      },
      {
        "id": "msg-2",
        "senderId": "tutor-user-uuid",
        "senderType": "TUTOR",
        "content": "Sure! Let me explain...",
        "messageType": "TEXT",
        "isRead": false,
        "createdAt": "2025-12-07T12:05:00.000Z"
      }
    ]
  }
}
```

### POST /messages/conversations/:id/assign

**Request:**
```json
{ "tutorId": "tutor-profile-uuid" }
```

### POST /messages/conversations/:id/close

**Request:**
```json
{ "status": "RESOLVED" }
```
Options: `RESOLVED` or `CLOSED`

---

## 6. WebSocket Real-time Events

### Connection Setup

```typescript
import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export const connectSocket = (token: string) => {
  socket = io('http://localhost:3000/messages', {
    auth: { token },
    transports: ['websocket'],
  });

  socket.on('connect', () => console.log('WS Connected'));
  socket.on('disconnect', () => console.log('WS Disconnected'));
  
  return socket;
};

export const disconnectSocket = () => {
  socket?.disconnect();
  socket = null;
};

export const getSocket = () => socket;
```

### Events: Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `joinConversation` | `"conv-uuid"` | Join room for real-time messages |
| `leaveConversation` | `"conv-uuid"` | Leave room |
| `typing` | `{ conversationId, isTyping: boolean }` | Typing indicator |

### Events: Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `newMessage` | Message object | New message received |
| `userTyping` | `{ userId, isTyping }` | Other user typing |
| `newAssignment` | `{ conversationId, subject, urgency, studentName }` | New conversation assigned (tutors) |
| `statusChange` | `{ conversationId, status }` | Status changed |

### Usage in React

```tsx
useEffect(() => {
  const socket = getSocket();
  if (!socket || !conversationId) return;

  socket.emit('joinConversation', conversationId);

  socket.on('newMessage', (message) => {
    setMessages(prev => [...prev, message]);
  });

  socket.on('userTyping', ({ userId, isTyping }) => {
    setIsOtherTyping(isTyping);
  });

  return () => {
    socket.emit('leaveConversation', conversationId);
    socket.off('newMessage');
    socket.off('userTyping');
  };
}, [conversationId]);
```

---

## 7. Data Types & Enums

### TypeScript Interfaces

```typescript
interface User {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AuthResponse {
  user: User;
  tokens: { accessToken: string; refreshToken: string };
}

interface Conversation {
  id: string;
  studentId: string;
  tutorId: string | null;
  subject: Subject;
  topic: string | null;
  keywords: string[];
  urgency: Urgency;
  status: ConversationStatus;
  student?: { id: string; user: { name: string; email: string } };
  tutor?: { id: string; user: { name: string; email: string } };
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}

interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  senderType: SenderType;
  content: string | null;
  messageType: MessageType;
  audioUrl?: string;
  audioDuration?: number;
  transcription?: string;
  isRead: boolean;
  createdAt: string;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}
```

### Enums

```typescript
enum Role {
  USER = "USER",
  ADMIN = "ADMIN",
  TUTOR = "TUTOR",
  STUDENT = "STUDENT"
}

enum Subject {
  MATHEMATICS = "MATHEMATICS",
  PHYSICS = "PHYSICS",
  CHEMISTRY = "CHEMISTRY",
  BIOLOGY = "BIOLOGY",
  ENGLISH = "ENGLISH",
  HISTORY = "HISTORY",
  GEOGRAPHY = "GEOGRAPHY",
  COMPUTER_SCIENCE = "COMPUTER_SCIENCE",
  ECONOMICS = "ECONOMICS",
  ACCOUNTING = "ACCOUNTING",
  GENERAL = "GENERAL"
}

enum MessageType {
  TEXT = "TEXT",
  AUDIO = "AUDIO",
  IMAGE = "IMAGE",
  FILE = "FILE"
}

enum SenderType {
  STUDENT = "STUDENT",
  TUTOR = "TUTOR",
  SYSTEM = "SYSTEM"
}

enum ConversationStatus {
  PENDING = "PENDING",      // Waiting for tutor
  ASSIGNED = "ASSIGNED",    // Tutor assigned
  ACTIVE = "ACTIVE",        // Ongoing
  RESOLVED = "RESOLVED",    // Solved
  CLOSED = "CLOSED"         // Ended
}

enum Urgency {
  LOW = "LOW",
  NORMAL = "NORMAL",
  HIGH = "HIGH",
  URGENT = "URGENT"
}
```

---

## 8. Error Handling

### Error Response Format

```json
{
  "statusCode": 400,
  "timestamp": "2025-12-07T12:00:00.000Z",
  "path": "/api/v1/auth/login",
  "method": "POST",
  "message": "Error message or array of messages"
}
```

### HTTP Status Codes

| Code | Meaning | Frontend Action |
|------|---------|-----------------|
| 200 | Success | Process data |
| 201 | Created | Process data |
| 400 | Bad Request | Show validation errors |
| 401 | Unauthorized | Redirect to login |
| 403 | Forbidden | Show "Access Denied" |
| 404 | Not Found | Show 404 page |
| 409 | Conflict | Show specific error (e.g., "Email exists") |
| 500 | Server Error | Show generic error |

### Validation Error (400)

```json
{
  "statusCode": 400,
  "message": [
    "email must be an email",
    "password must be at least 8 characters"
  ]
}
```

---

## 9. Test Accounts

### Admin
| Field | Value |
|-------|-------|
| Email | admin@toptutor.com |
| Password | Admin123! |

### Tutors

| Email | Password | Subjects |
|-------|----------|----------|
| john.tutor@toptutor.com | Tutor123! | MATHEMATICS, PHYSICS |
| sarah.tutor@toptutor.com | Tutor123! | CHEMISTRY, BIOLOGY |
| mike.tutor@toptutor.com | Tutor123! | COMPUTER_SCIENCE, MATHEMATICS |
| emma.tutor@toptutor.com | Tutor123! | ENGLISH, HISTORY |

### Students

| Email | Password |
|-------|----------|
| jane.student@toptutor.com | Student123! |
| alex.student@toptutor.com | Student123! |
| lisa.student@toptutor.com | Student123! |

---

## 10. Frontend Checklist

### Pages Required

| Route | Auth | Roles |
|-------|------|-------|
| `/` | ❌ | Landing page |
| `/login` | ❌ | Login |
| `/register` | ❌ | Student registration |
| `/auth/callback` | ❌ | OAuth callback |
| `/dashboard/student` | ✅ | STUDENT |
| `/dashboard/tutor` | ✅ | TUTOR |
| `/admin` | ✅ | ADMIN |
| `/ask` | ✅ | STUDENT - Ask question |
| `/conversations` | ✅ | STUDENT, TUTOR |
| `/conversations/:id` | ✅ | STUDENT, TUTOR - Chat |
| `/admin/users` | ✅ | ADMIN |
| `/profile` | ✅ | All logged in |
| `/unauthorized` | ❌ | 403 page |
| `*` | ❌ | 404 page |

### Features Checklist

- [ ] Login/Register forms
- [ ] Google OAuth button
- [ ] Token refresh mechanism
- [ ] Role-based route protection
- [ ] Student: Ask question form
- [ ] Student: My conversations list
- [ ] Tutor: Assigned conversations
- [ ] Chat interface with bubbles
- [ ] Real-time messages (WebSocket)
- [ ] Typing indicators
- [ ] New assignment notifications (toast)
- [ ] Admin: User CRUD
- [ ] Admin: View all conversations
- [ ] Admin: Manual tutor assignment
- [ ] Responsive design
- [ ] Loading states
- [ ] Error handling & toasts

### UI Components

- [ ] Navbar with user menu
- [ ] Sidebar navigation
- [ ] Conversation list item
- [ ] Chat message bubble
- [ ] Message input field
- [ ] Subject badge (colored)
- [ ] Urgency indicator
- [ ] Status badge
- [ ] Pagination
- [ ] Modal dialogs
- [ ] Toast notifications
- [ ] Loading spinner
- [ ] Empty states

---

## Production Notes

1. Replace `localhost` URLs with production API via env vars
2. Consider httpOnly cookies for token storage
3. Implement error logging (Sentry, etc.)
4. Add rate limiting awareness
5. Proper form validation with UX-friendly messages
6. CSRF protection if using cookies

---

**Top Tutors API Documentation v1.0**  
Generated: December 7, 2025

