/**
 * Real-database test environment
 *
 * Registered in `vitest.db.config.ts` as a setup file, so it runs in every
 * worker before a test file is imported. App modules read required variables
 * at import time (`app/utils/env.ts` throws when one is missing), so this sets
 * non-secret placeholders for them, matching `test/setup-test-env.ts`.
 *
 * `DATABASE_URL` and `DIRECT_URL` are the exception: both are set to the
 * validated `TEST_DATABASE_URL`, so any module that reaches the app's own `db`
 * client connects to the `*_test` database and never to a developer's `.env`
 * database.
 *
 * @see {@link file://./client.ts} `readTestDatabaseUrl` holds the name guard.
 */

import { readTestDatabaseUrl } from "./client";

const testDatabaseUrl = readTestDatabaseUrl();
process.env.DATABASE_URL = testDatabaseUrl;
process.env.DIRECT_URL = testDatabaseUrl;

process.env.SESSION_SECRET = "super-duper-s3cret";
process.env.SUPABASE_ANON_PUBLIC = "{ANON_PUBLIC}";
process.env.SUPABASE_SERVICE_ROLE = "{SERVICE_ROLE}";
process.env.SUPABASE_URL = "https://supabase-project.supabase.co";
process.env.SERVER_URL = "http://localhost:3000";
process.env.APP_NAME = "Shelf";
process.env.ENABLE_PREMIUM_FEATURES = "true";
process.env.STRIPE_SECRET_KEY = "stripe-secret-key";
process.env.STRIPE_PUBLIC_KEY = "stripe-public-key";
process.env.STRIPE_WEBHOOK_ENDPOINT_SECRET = "stripe-endpoint-secret";
process.env.SMTP_PWD = "super-safe-passw0rd";
process.env.SMTP_HOST = "mail.example.com";
process.env.SMTP_PORT = "465";
process.env.SMTP_USER = "some-email@example.com";
process.env.MAPTILER_TOKEN = "maptiler-token";
process.env.GEOCODING_USER_AGENT = "Test Asset Management";
process.env.MICROSOFT_CLARITY_ID = "microsoft-clarity-id";
process.env.INVITE_TOKEN_SECRET = "secret-test-invite";
process.env.SENTRY_ORG = "sentry-org";
process.env.SENTRY_PROJECT = "sentry-project";
process.env.SENTRY_DSN = "sentry-dsn";
