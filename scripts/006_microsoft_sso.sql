-- Migration 006: Sign in with Microsoft (Entra ID)
-- Run once on the production database, before setting the AZURE_* env vars.
--
-- Adds:
--   1. nuvho_kb.users.azure_oid   Entra object ID — the stable link between a KB user
--                                 and their Microsoft account (emails can change).
--   2. password_hash becomes nullable: accounts auto-provisioned by Microsoft sign-in
--                                 have no password until an admin resets one.

ALTER TABLE nuvho_kb.users
  ADD COLUMN IF NOT EXISTS azure_oid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_azure_oid_key
  ON nuvho_kb.users (azure_oid)
  WHERE azure_oid IS NOT NULL;

ALTER TABLE nuvho_kb.users
  ALTER COLUMN password_hash DROP NOT NULL;
