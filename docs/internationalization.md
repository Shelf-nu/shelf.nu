# Internationalization (i18n)

Shelf.nu uses i18next with TypeScript support for internationalization. This guide covers how to work with translations in the application.

## Overview

The i18n system provides:
- **TypeScript-first translations** with full type safety
- **Automatic compilation** from TypeScript to JSON during development and build
- **Hot reloading** in development mode
- **Type-safe translation keys** preventing runtime errors

## Architecture

### Translation Files Structure

```
app/locales/
├── en/
│   └── common.ts       # English translations (source)
├── fr/
│   └── common.ts       # French translations (typed)
└── [language]/
    └── [namespace].ts
```

### Build Output

The Vite plugin automatically compiles TypeScript translations to JSON:

```
public/locales/
├── en/
│   └── common.json     # Generated from app/locales/en/common.ts
└── fr/
    └── common.json     # Generated from app/locales/fr/common.ts
```

## Creating Translations

### 1. Source Language (English)

Create your source translations in `app/locales/en/common.ts`:

```typescript
const en = {
  login: {
    title: "Log in to your account",
    subtitle: "Welcome back! Please enter your details.",
    button: "Sign in",
  },
  dashboard: {
    welcome: "Welcome to Shelf.nu",
    assets: "Assets",
    bookings: "Bookings",
  },
};

export default en;
```

### 2. Target Languages

Create typed translations in `app/locales/fr/common.ts`:

```typescript
import type en from "../en/common";

const fr: typeof en = {
  login: {
    title: "Connectez-vous à votre compte",
    subtitle: "Bon retour ! Veuillez saisir vos informations.",
    button: "Se connecter",
  },
  dashboard: {
    welcome: "Bienvenue sur Shelf.nu",
    assets: "Actifs",
    bookings: "Réservations",
  },
};

export default fr;
```

**Key Benefits:**
- TypeScript ensures all keys from the source language are translated
- Compiler errors if translations are missing or have typos
- IntelliSense autocomplete for translation keys

### 3. Adding New Languages

1. Create a new directory: `app/locales/[language-code]/`
2. Add the language to `SUPPORTED_LANGUAGES` in your environment configuration
3. Create `common.ts` with the same structure as above

## Custom Vite Plugin

The i18n system uses a custom Vite plugin (`vite-plugins/i18n-translations.ts`) that:

### Development Mode
- Watches TypeScript translation files for changes
- Automatically recompiles to JSON when files change
- Triggers hot reloading to update translations instantly

### Build Mode
- Compiles all TypeScript translations to JSON during build
- Ensures production has all necessary translation files

### Plugin Configuration

In `vite.config.ts`:

```typescript
import { i18nTranslations } from "./vite-plugins/i18n-translations";

export default defineConfig({
  plugins: [
    i18nTranslations({
      sourceDir: 'app/locales',     // TypeScript files location
      outputDir: 'public/locales',  // JSON output location
    }),
    // ... other plugins
  ],
});
```

## Using Translations

### In React Components

```typescript
import { useTranslation } from "react-i18next";

export function LoginForm() {
  const { t } = useTranslation();
  
  return (
    <div>
      <h1>{t("login.title")}</h1>
      <p>{t("login.subtitle")}</p>
      <button>{t("login.button")}</button>
    </div>
  );
}
```

### In Remix Loaders/Actions

```typescript
import { json } from "@remix-run/node";
import { initTranslationLoader } from "~/i18n/i18next.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const t = await initTranslationLoader(request);
  
  return json({
    message: t("dashboard.welcome"),
  });
}
```

## Configuration Files

### i18n Configuration

Located in `app/i18n/i18n.ts`:

```typescript
import Backend from "i18next-fs-backend";
import { config } from "~/config/shelf.config";

export default {
  supportedLngs: config.SUPPORTED_LANGUAGES,
  fallbackLng: config.FALLBACK_LANGUAGE,
  defaultNS: "common",
  backend: {
    loadPath: "/locales/{{lng}}/{{ns}}.json", // Points to compiled JSON
  },
  plugins: [Backend],
};
```

### Server-side Configuration

Located in `app/i18n/i18next.server.ts` - handles server-side rendering and language detection.

## Development Workflow

### 1. Adding New Translation Keys

1. Add the key to `app/locales/en/common.ts`
2. The Vite plugin automatically compiles to JSON
3. Add translations to other language files
4. TypeScript will show errors for missing translations

### 2. Testing Translations

1. Start development server: `npm run dev`
2. Edit any `.ts` file in `app/locales/`
3. Save the file
4. Browser automatically reloads with updated translations

### 3. Type Safety

The system prevents common i18n errors:

```typescript
// ✅ Valid - key exists
t("login.title")

// ❌ TypeScript error - key doesn't exist  
t("login.nonexistent")

// ❌ TypeScript error - missing translation in French file
const fr: typeof en = {
  login: {
    title: "...",
    // Missing: subtitle, button
  }
}
```

## Best Practices

### 1. Translation Key Naming

Use nested objects for organization:

```typescript
const en = {
  // Group by feature/page
  login: { /* ... */ },
  dashboard: { /* ... */ },
  assets: { /* ... */ },
  
  // Group by component type
  buttons: {
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
  },
  
  // Group by message type
  errors: {
    required: "This field is required",
    invalid: "Invalid input",
  },
};
```

### 2. Interpolation and Pluralization

Support dynamic values:

```typescript
const en = {
  messages: {
    welcome: "Welcome, {{name}}!",
    itemCount: "{{count}} item",
    itemCount_plural: "{{count}} items",
  },
};

// Usage
t("messages.welcome", { name: "John" })
t("messages.itemCount", { count: 5 })
```

### 3. Namespace Organization

For larger applications, consider multiple namespaces:

```
app/locales/en/
├── common.ts      # Shared translations
├── navigation.ts  # Navigation-specific
├── forms.ts       # Form-related
└── errors.ts      # Error messages
```

## Troubleshooting

### Common Issues

**Plugin not compiling files:**
- Ensure `i18nTranslations()` is first in the Vite plugins array
- Check that TypeScript files have valid syntax
- Verify the `sourceDir` path is correct

**Missing translations in browser:**
- Check that JSON files are generated in `public/locales/`
- Verify the `loadPath` in i18n configuration matches output location
- Ensure language codes match between TypeScript files and configuration

**Type errors:**
- Make sure all target language files import and extend the source language type
- Verify all required keys are present in translation objects
- Check for typos in translation keys

## Environment Variables

Configure supported languages in your environment:

```bash
SUPPORTED_LANGUAGES=en,fr,es,de
FALLBACK_LANGUAGE=en
```

This system provides a robust, type-safe internationalization setup that scales with your application while maintaining excellent developer experience.