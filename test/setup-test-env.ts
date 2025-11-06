import "@testing-library/jest-dom/vitest";
import { server } from "../mocks";

process.env.DATABASE_URL =
  "postgres://{USER}:{PASSWORD}@{HOST}:6543/{DB_NAME}?pgbouncer=true";
process.env.DIRECT_URL = "postgres://{USER}:{PASSWORD}@{HOST}:5432/{DB_NAME}";
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

if (typeof window !== "undefined") {
  // @ts-expect-error missing vitest type
  window.happyDOM.settings.enableFileSystemHttpRequests = true;
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
