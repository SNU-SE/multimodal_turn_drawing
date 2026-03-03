-- 8.1 DB Schema Updates
ALTER TABLE questions ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS options jsonb;
ALTER TABLE room_groups ADD COLUMN IF NOT EXISTS question_ids uuid[] DEFAULT '{}';
