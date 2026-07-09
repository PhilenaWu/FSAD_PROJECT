-- Migration: Create users profile table
-- Authentication is handled by Supabase Auth (the auth.users table holds the
-- email + password). This table stores application profile data and links to
-- the auth user by id. Credentials are never stored here.
--   id           = the Supabase auth user id (auth.users.id), supplied on insert
--   email        = mirrored from auth.users for convenient joins/queries
--   contractor_id = contractors only; FK to contractors(id) added in migration 002
--                   (contractors does not exist yet — avoids a circular dependency)
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         VARCHAR(255) NOT NULL UNIQUE,
  full_name     VARCHAR(255) NOT NULL,
  role          VARCHAR(20)  NOT NULL
                CHECK (role IN ('resident','inspector','manager','contractor','admin')),
  block_number  VARCHAR(20),                     -- residents only
  unit_number   VARCHAR(20),                     -- residents only
  contractor_id UUID,                            -- contractors only; FK added in migration 002
  status        VARCHAR(20)  NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'suspended')),
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
