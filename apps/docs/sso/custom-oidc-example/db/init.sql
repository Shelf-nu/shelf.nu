-- Prepares a plain PostgreSQL for Supabase Auth (GoTrue) and Supabase Storage.
-- Runs once, when the database volume is first created.
--
-- Shelf itself connects as the `postgres` superuser, as it does on Supabase.

-- GoTrue: owns the `auth` schema and runs its migrations in it. Taken from
-- GoTrue's own hack/init_postgres.sql.
CREATE USER supabase_auth_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION PASSWORD 'postgres';
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;
GRANT CREATE ON DATABASE postgres TO supabase_auth_admin;
ALTER USER supabase_auth_admin SET search_path = 'auth';

-- Storage: its first migration creates the anon/authenticated/service_role
-- roles and hands its tables to `postgres`, which needs a superuser here
-- (on Supabase the role is prepared by their Postgres image instead).
CREATE USER supabase_storage_admin SUPERUSER LOGIN PASSWORD 'postgres';
CREATE SCHEMA IF NOT EXISTS storage AUTHORIZATION supabase_storage_admin;
ALTER USER supabase_storage_admin SET search_path = 'storage';

-- Extensions Shelf's migrations expect.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
