import { ShelfStackError } from "./error";
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
      FORMBRICKS_ENV_ID: string;
      MAINTENANCE_MODE: string;
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
      FORMBRICKS_ENV_ID: string;
      SMTP_PWD: string;
      SMTP_HOST: string;
      SMTP_USER: string;
      MAINTENANCE_MODE: string;
      DATABASE_URL: string;
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
    throw new ShelfStackError({ message: `${name} is not set` });
  }

  return value;
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
export const DATABASE_URL = getEnv("DATABASE_URL");

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

export function getBrowserEnv() {
  return {
    NODE_ENV,
    SUPABASE_URL,
    SUPABASE_ANON_PUBLIC,
    MAPTILER_TOKEN,
    CRISP_WEBSITE_ID,
    MICROSOFT_CLARITY_ID,
    ENABLE_PREMIUM_FEATURES,
    FORMBRICKS_ENV_ID,
    MAINTENANCE_MODE,
  };
}
