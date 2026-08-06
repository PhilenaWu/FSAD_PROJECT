-- Migration: Create feedback table (general app feedback from any signed-in user)
CREATE TABLE IF NOT EXISTS feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  message     VARCHAR(1000) NOT NULL,
  rating      SMALLINT CHECK (rating BETWEEN 1 AND 5),
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
