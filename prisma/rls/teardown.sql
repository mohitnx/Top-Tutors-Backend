-- ============================================================
-- Top Tutors — Row-Level Security (RLS) Teardown / Rollback
-- ============================================================
-- Run this to fully disable RLS if you need to roll back.
-- After running, re-run setup.sql to re-enable.
-- ============================================================

DROP POLICY IF EXISTS "user_isolation" ON ai_chat_sessions;
ALTER TABLE ai_chat_sessions DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_isolation" ON ai_messages;
ALTER TABLE ai_messages DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_isolation" ON students;
ALTER TABLE students DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_isolation" ON conversations;
ALTER TABLE conversations DISABLE ROW LEVEL SECURITY;
