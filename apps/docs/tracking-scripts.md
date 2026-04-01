# Tracking & Analytics Scripts

Shelf supports several optional tracking and analytics integrations. Most of them follow the same pattern: set an environment variable with the service token/ID, and the script loads automatically on page load. Some UI-based tools (for example, the Crisp chat widget) are still configured via environment variable but only activate in response to user interaction. In all cases, if the required variable is not set, no script is injected — keeping the app lightweight for self-hosted instances.

This approach keeps tokens out of the open-source codebase while allowing each deployment to configure its own analytics or support tooling.

## How it works

1. Each tracking service has an environment variable registered in `app/utils/env.ts`
2. The variable is included in `getBrowserEnv()` so it's available on the client via `window.env`
3. A small React component conditionally renders the tracking script only when the token is present
4. The component is mounted in `app/root.tsx`

## Available integrations

### Cloudflare Web Analytics

Lightweight, privacy-first analytics that measures page views and Web Vitals without using client-side cookies.

**Environment variable:** `CLOUDFLARE_WEB_ANALYTICS_TOKEN`

**How to get a token:**

1. Log in to the [Cloudflare dashboard](https://dash.cloudflare.com/)
2. Navigate to **Analytics & Logs** > **Web Analytics**
3. Click **Add a site** and enter your domain
4. Copy the token from the JS snippet provided

**Component:** `app/components/marketing/cloudflare-web-analytics.tsx`

```bash
CLOUDFLARE_WEB_ANALYTICS_TOKEN="your-token-here"
```

---

### Microsoft Clarity

Session replay and heatmap tool that helps understand how users interact with the app.

**Environment variable:** `MICROSOFT_CLARITY_ID`

**How to get a project ID:**

1. Sign up at [clarity.microsoft.com](https://clarity.microsoft.com/)
2. Create a new project for your domain
3. Copy the project ID from the setup instructions

**Component:** `app/components/marketing/clarity.tsx`

```bash
MICROSOFT_CLARITY_ID="your-clarity-project-id"
```

---

### Crisp Chat

Live chat widget for customer support. Shelf configures it with the logged-in user's name and email so support agents have context.

**Environment variable:** `CRISP_WEBSITE_ID`

**How to get a website ID:**

1. Sign up at [crisp.chat](https://crisp.chat/)
2. Create a website and go to **Settings** > **Website Settings**
3. Copy the Website ID

**Component:** `app/components/marketing/crisp.tsx`

```bash
CRISP_WEBSITE_ID="your-crisp-website-id"
```

---

### Sentry

Error tracking and performance monitoring. Shelf includes a tunnel endpoint (`/api/sentry-tunnel`) that proxies Sentry events through the app's own domain, avoiding ad-blocker interference.

**Environment variables:**

| Variable         | Description                                     |
| ---------------- | ----------------------------------------------- |
| `SENTRY_DSN`     | Data Source Name — the main connection string   |
| `SENTRY_ORG`     | Sentry organization slug (used for source maps) |
| `SENTRY_PROJECT` | Sentry project slug (used for source maps)      |

**How to get these values:**

1. Sign up at [sentry.io](https://sentry.io/)
2. Create a project and go to **Settings** > **Projects** > your project > **Client Keys (DSN)**
3. The org and project slugs are visible in your Sentry URL: `https://sentry.io/organizations/{org}/projects/{project}/`

**Setup files:** `app/entry.client.tsx` (client), `app/entry.server.tsx` (server)

```bash
SENTRY_DSN="https://your-key@sentry.io/your-project-id"
SENTRY_ORG="your-org"
SENTRY_PROJECT="your-project"
```

## Adding a new tracking script

To add a new third-party tracking script, follow the established pattern:

1. **Register the env var** in `app/utils/env.ts`:

   - Add the key to the `Window.env` interface
   - Add the key to the `ProcessEnv` interface
   - Export it with `getEnv()` (`isSecret: false`, `isRequired: false`)
   - Add it to `getBrowserEnv()`

2. **Create a component** in `app/components/marketing/`:

   - The component must return `null` (no rendered markup) to avoid hydration mismatches
   - Use a `useEffect` hook to check `window.env.YOUR_TOKEN` and programmatically inject the `<script>` element into `document.head`
   - Include cleanup in the effect's return to remove the script on unmount
   - See `cloudflare-web-analytics.tsx` for a reference implementation

3. **Mount the component** in `app/root.tsx`

4. **Add the env var** to `.env.example` with a placeholder value
