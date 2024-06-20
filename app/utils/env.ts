import { z } from "zod";
import { ShelfError } from "./error";
import { isBrowser } from "./is-browser";

declare global {
  interface Window {
    env: {
      NODE_ENV: "development" | "production" | "test";
      SUPABASE_URL: string;
      SUPABASE_ANON_PUBLIC: string;
      MAPTILER_TOKEN: string;
      MICROSOFT_CLARITY_ID: string;
      CRISP_WEBSITE_ID: string;
      ENABLE_PREMIUM_FEATURES: string;
      MAINTENANCE_MODE: string;
      CHROME_EXECUTABLE_PATH: string;
    };
  }
}

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: "development" | "production" | "test";
      SUPABASE_URL: string;
      SUPABASE_SERVICE_ROLE: string;
      SERVER_URL: string;
      SUPABASE_ANON_PUBLIC: string;
      SESSION_SECRET: string;
      MAPTILER_TOKEN: string;
      CRISP_WEBSITE_ID: string;
      MICROSOFT_CLARITY_ID: string;
      STRIPE_SECRET_KEY: string;
      STRIPE_WEBHOOK_ENDPOINT_SECRET: string;
      ENABLE_PREMIUM_FEATURES: string;
      INVITE_TOKEN_SECRET: string;
      SMTP_PWD: string;
      SMTP_HOST: string;
      SMTP_USER: string;
      SMTP_FROM: string;
      MAINTENANCE_MODE: string;
      DATABASE_URL: string;
      DIRECT_URL: string;
      GEOCODE_API_KEY: string;
      SENTRY_DSN: string;
      ADMIN_EMAIL: string;
      ADMIN_PASSWORD: string;
      ADMIN_USERNAME: string;
      CHROME_EXECUTABLE_PATH: string;
    }
  }
}

type EnvOptions = {
  isSecret?: boolean;
  isRequired?: boolean;
};
function getEnv(
  name: string,
  { isRequired, isSecret }: EnvOptions = { isSecret: true, isRequired: true }
) {
  if (isBrowser && isSecret) return "";

  const source = (isBrowser ? window.env : process.env) ?? {};

  const value = source[name as keyof typeof source];

  if (!value && isRequired) {
    throw new ShelfError({
      message: `${name} is not set`,
      cause: null,
      label: "Environment",
    });
  }

  return value;
}

export const EnvSchema = z.object({
  SESSION_SECRET: z.string().min(1),
  NODE_ENV: z.enum(["development", "production", "test"]),
});

type Env = z.infer<typeof EnvSchema>;

const PublicEnvSchema = EnvSchema.pick({
  NODE_ENV: true,
});

export const env = (
  isBrowser ? PublicEnvSchema.parse(window.env) : EnvSchema.parse(process.env)
) as Env;

export function initEnv() {
  return env;
}

/**
 * Server env
 */
export const SERVER_URL = getEnv("SERVER_URL");
export const SUPABASE_SERVICE_ROLE = getEnv("SUPABASE_SERVICE_ROLE");
export const INVITE_TOKEN_SECRET = getEnv("INVITE_TOKEN_SECRET", {
  isSecret: true,
});
export const SESSION_SECRET = getEnv("SESSION_SECRET");
export const STRIPE_SECRET_KEY = getEnv("STRIPE_SECRET_KEY", {
  isSecret: true,
  isRequired: false,
});
export const SMTP_PWD = getEnv("SMTP_PWD");
export const SMTP_HOST = getEnv("SMTP_HOST");
export const SMTP_USER = getEnv("SMTP_USER");
export const SMTP_FROM = getEnv("SMTP_FROM", {
  isRequired: false,
});
export const DATABASE_URL = getEnv("DATABASE_URL");
export const DIRECT_URL = getEnv("DIRECT_URL", {
  isRequired: false,
});
export const SENTRY_DSN = getEnv("SENTRY_DSN", {
  isRequired: false,
});

export const ADMIN_EMAIL = getEnv("ADMIN_EMAIL", {
  isRequired: false,
});
export const ADMIN_PASSWORD = getEnv("ADMIN_PASSWORD", {
  isRequired: false,
});
export const ADMIN_USERNAME = getEnv("ADMIN_USERNAME", {
  isRequired: false,
});

/**
 * Shared envs
 */
export const NODE_ENV = getEnv("NODE_ENV", {
  isSecret: false,
  isRequired: false,
});
export const SUPABASE_URL = getEnv("SUPABASE_URL", { isSecret: false });
export const SUPABASE_ANON_PUBLIC = getEnv("SUPABASE_ANON_PUBLIC", {
  isSecret: false,
});
export const MAPTILER_TOKEN = getEnv("MAPTILER_TOKEN", {
  isSecret: false,
});
export const CRISP_WEBSITE_ID = getEnv("CRISP_WEBSITE_ID", {
  isSecret: false,
  isRequired: false,
});
export const MICROSOFT_CLARITY_ID = getEnv("MICROSOFT_CLARITY_ID", {
  isSecret: false,
  isRequired: false,
});
export const FORMBRICKS_ENV_ID = getEnv("FORMBRICKS_ENV_ID", {
  isSecret: false,
  isRequired: false,
});

export const GEOCODE_API_KEY = getEnv("GEOCODE_API_KEY", {
  isSecret: true,
  isRequired: false,
});

export const MAINTENANCE_MODE =
  getEnv("MAINTENANCE_MODE", {
    isSecret: false,
    isRequired: false,
  }) === "true" || false;

export const ENABLE_PREMIUM_FEATURES =
  getEnv("ENABLE_PREMIUM_FEATURES", {
    isSecret: false,
    isRequired: false,
  }) === "true" || false;

export const SEND_ONBOARDING_EMAIL =
  getEnv("SEND_ONBOARDING_EMAIL", {
    isSecret: false,
    isRequired: false,
  }) === "true" || false;

export const CHROME_EXECUTABLE_PATH = getEnv("CHROME_EXECUTABLE_PATH", {
  isSecret: false,
  isRequired: false,
});

export function getBrowserEnv() {
  return {
    NODE_ENV,
    SUPABASE_URL,
    SUPABASE_ANON_PUBLIC,
    MAPTILER_TOKEN,
    CRISP_WEBSITE_ID,
    MICROSOFT_CLARITY_ID,
    ENABLE_PREMIUM_FEATURES,
    MAINTENANCE_MODE,
    CHROME_EXECUTABLE_PATH,
  };
}
