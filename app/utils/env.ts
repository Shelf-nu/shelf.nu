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
      URL_SHORTENER: string;
      FREE_TRIAL_DAYS: string;
      SUPPORT_EMAIL: string;
      FULL_CALENDAR_LICENSE_KEY: string;
      SHOW_HOW_DID_YOU_FIND_US: string;
      COLLECT_BUSINESS_INTEL: string;
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
      URL_SHORTENER: string;
      SUPABASE_ANON_PUBLIC: string;
      SESSION_SECRET: string;
      MAPTILER_TOKEN: string;
      CRISP_WEBSITE_ID: string;
      MICROSOFT_CLARITY_ID: string;
      STRIPE_SECRET_KEY: string;
      STRIPE_WEBHOOK_ENDPOINT_SECRET: string;
      ENABLE_PREMIUM_FEATURES: string;
      DISABLE_SIGNUP: string;
      DISABLE_SSO: string;
      INVITE_TOKEN_SECRET: string;
      SMTP_PWD: string;
      SMTP_HOST: string;
      SMTP_PORT: string;
      SMTP_USER: string;
      SMTP_FROM: string;
      MAINTENANCE_MODE: string;
      DATABASE_URL: string;
      DIRECT_URL: string;
      SENTRY_DSN: string;
      ADMIN_EMAIL: string;
      CHROME_EXECUTABLE_PATH: string;
      FINGERPRINT: string;
      FREE_TRIAL_DAYS: string;
      SUPPORT_EMAIL: string;
      FULL_CALENDAR_LICENSE_KEY: string;
      SHOW_HOW_DID_YOU_FIND_US: string;
      COLLECT_BUSINESS_INTEL: string;
    }
  }
}

type EnvOptions = {
  isSecret?: boolean;
  isRequired?: boolean;
  allowEmpty?: boolean;
};

export function getEnv<K extends keyof NodeJS.ProcessEnv>(
  name: K,
  { isRequired = true, isSecret = true, allowEmpty = false }: EnvOptions = {}
): NodeJS.ProcessEnv[K] {
  if (isBrowser && isSecret) return "";

  const source = (isBrowser ? window.env : process.env) ?? {};

  const value = (source as NodeJS.ProcessEnv)[name];

  // If allowEmpty is true, only check for undefined/null
  // Otherwise, keep current behavior (treats empty string as "not set")
  if (allowEmpty) {
    if ((value === undefined || value === null) && isRequired) {
      throw new ShelfError({
        message: `${name} is not set`,
        cause: null,
        label: "Environment",
      });
    }
  } else {
    if (!value && isRequired) {
      throw new ShelfError({
        message: `${name} is not set`,
        cause: null,
        label: "Environment",
      });
    }
  }

  return value as NodeJS.ProcessEnv[K] | undefined;
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
const getNormalizedServerUrl = (): string => {
  const rawServerUrl = getEnv("SERVER_URL");
  const normalizedServerUrl = rawServerUrl.replace(/\/+$/, "");

  try {
    const url = new URL(normalizedServerUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error();
    }
  } catch {
    throw new Error(
      `Invalid SERVER_URL environment variable value: "${rawServerUrl}". ` +
        "Expected a non-empty absolute URL with http or https scheme."
    );
  }

  return normalizedServerUrl;
};

export const SERVER_URL = getNormalizedServerUrl();
export const SUPABASE_SERVICE_ROLE = getEnv("SUPABASE_SERVICE_ROLE");
export const INVITE_TOKEN_SECRET = getEnv("INVITE_TOKEN_SECRET", {
  isSecret: true,
});
export const URL_SHORTENER = getEnv("URL_SHORTENER", {
  isRequired: false,
});

export const SESSION_SECRET = getEnv("SESSION_SECRET");
export const FINGERPRINT = getEnv("FINGERPRINT", {
  isSecret: true,
  isRequired: false,
});

export const STRIPE_SECRET_KEY = getEnv("STRIPE_SECRET_KEY", {
  isSecret: true,
  isRequired: false,
});
export const SMTP_PWD = getEnv("SMTP_PWD", { allowEmpty: true });
export const SMTP_HOST = getEnv("SMTP_HOST");
export const SMTP_PORT = getEnv("SMTP_PORT", {
  isRequired: false,
});
export const SMTP_USER = getEnv("SMTP_USER", { allowEmpty: true });
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

/**
 * A comma separated list of customerIds that have custom install of shelf.
 * We need this in order to make our webhook work properly.
 */
export const CUSTOM_INSTALL_CUSTOMERS = getEnv("CUSTOM_INSTALL_CUSTOMERS", {
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

export const SUPPORT_EMAIL = getEnv("SUPPORT_EMAIL", {
  isSecret: false,
  isRequired: false,
});

export const GEOCODING_USER_AGENT = getEnv("GEOCODING_USER_AGENT", {
  isSecret: false,
  isRequired: false,
});

export const FULL_CALENDAR_LICENSE_KEY = getEnv("FULL_CALENDAR_LICENSE_KEY", {
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

export const SHOW_HOW_DID_YOU_FIND_US =
  getEnv("SHOW_HOW_DID_YOU_FIND_US", {
    isSecret: false,
    isRequired: false,
  }) === "true" || false;

export const COLLECT_BUSINESS_INTEL =
  getEnv("COLLECT_BUSINESS_INTEL", {
    isSecret: false,
    isRequired: false,
  }) === "true" || false;

export const FREE_TRIAL_DAYS =
  getEnv("FREE_TRIAL_DAYS", {
    isSecret: false,
    isRequired: false,
  }) || "14";

export const DISABLE_SIGNUP =
  getEnv("DISABLE_SIGNUP", {
    isSecret: false,
    isRequired: false,
  }) === "true" || false;

export const DISABLE_SSO =
  getEnv("DISABLE_SSO", {
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
    URL_SHORTENER,
    FREE_TRIAL_DAYS,
    SUPPORT_EMAIL,
    FULL_CALENDAR_LICENSE_KEY,
  };
}
