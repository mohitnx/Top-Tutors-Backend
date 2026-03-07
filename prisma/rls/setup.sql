-- ============================================================
-- Top Tutors — Row-Level Security (RLS) Setup
-- ============================================================
-- Run this ONCE against the Neon database via:
--   Neon Console → SQL Editor → paste and run
--   OR: psql <DATABASE_URL> -f prisma/rls/setup.sql
--
-- Safe to re-run — uses DROP POLICY IF EXISTS before CREATE.
--
-- How it works:
--   Before any protected query, the app calls:
--     SELECT set_config('app.current_user_id', '<uuid>', true)
--   inside a transaction. The policy then filters rows by that value.
--   When no context is set (admin ops, seed scripts), the setting is ''
--   and the policy allows all rows through — no regressions.
--
-- FORCE ROW LEVEL SECURITY is required because the app connects as
-- neondb_owner (superuser), which bypasses RLS by default.
-- ============================================================

-- ─── ai_chat_sessions ───────────────────────────────────────────────────────
-- Protects: each user's AI chat sessions are invisible to other users.

ALTER TABLE ai_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chat_sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_isolation" ON ai_chat_sessions;
CREATE POLICY "user_isolation" ON ai_chat_sessions
  FOR ALL
  USING (
    -- No context set → system/admin operation → allow through
    current_setting('app.current_user_id', true) = ''
    -- Context set → enforce ownership
    OR "userId" = current_setting('app.current_user_id', true)::uuid
  );

-- ─── ai_messages ────────────────────────────────────────────────────────────
-- Protects: messages are only visible if the parent session belongs to the user.

ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_isolation" ON ai_messages;
CREATE POLICY "user_isolation" ON ai_messages
  FOR ALL
  USING (
    current_setting('app.current_user_id', true) = ''
    OR "sessionId" IN (
      SELECT id FROM ai_chat_sessions
      WHERE "userId" = current_setting('app.current_user_id', true)::uuid
    )
  );

-- ─── students ────────────────────────────────────────────────────────────────
-- Protects: student profile rows are only directly visible to the owning user.
-- Note: admin queries run without context → allowed through.

ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE students FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_isolation" ON students;
CREATE POLICY "user_isolation" ON students
  FOR ALL
  USING (
    current_setting('app.current_user_id', true) = ''
    OR "userId" = current_setting('app.current_user_id', true)::uuid
  );

-- ─── conversations ───────────────────────────────────────────────────────────
-- Protects: each student's tutor conversation threads.

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_isolation" ON conversations;
CREATE POLICY "user_isolation" ON conversations
  FOR ALL
  USING (
    current_setting('app.current_user_id', true) = ''
    OR "studentId" IN (
      SELECT id FROM students
      WHERE "userId" = current_setting('app.current_user_id', true)::uuid
    )
  );

-- ─── Verify ─────────────────────────────────────────────────────────────────
-- Run this to confirm policies were created:
--
-- SELECT tablename, policyname, cmd, qual
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('ai_chat_sessions', 'ai_messages', 'students', 'conversations')
-- ORDER BY tablename;
