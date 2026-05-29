# Mobile App SSO Support Brief

## The Problem

SSO users (our high-paying enterprise customers) currently cannot use the Shelf Companion mobile app. The mobile app only supports email/password authentication, but SSO organizations have password authentication disabled by policy.

**Business Impact**: Our most valuable customers are locked out of mobile functionality.

---

## What Are Deep Links?

Deep links are special URLs that open a specific screen inside a mobile app instead of a website. Think of them like a direct phone number to a specific person, rather than calling a company's main line.

**Two types:**

| Type | Example | Requires IdP Changes? |
|------|---------|----------------------|
| Custom URL Scheme | `shelf://auth/callback` | Yes - customers must add to IdP |
| **Universal Link** | `https://app.shelf.nu/mobile-callback` | **No** - it's just an HTTPS URL |

**Universal Links** (iOS) and **App Links** (Android) let us use normal HTTPS URLs that the phone intercepts and opens in our app instead of the browser. This is the key to avoiding customer IdP changes.

---

## How SSO Currently Works (SAML via Supabase)

Based on our [Microsoft Entra docs](https://docs.shelf.nu/sso/providers/microsoft-entra):

```
User clicks "Sign in with SSO"
    ↓
Webapp redirects to Microsoft Entra
    ↓
User authenticates with company credentials
    ↓
Entra posts SAML assertion to Supabase ACS URL
   (https://xxx.supabase.co/auth/v1/sso/saml/acs)
    ↓
Supabase validates SAML, creates session
    ↓
Supabase redirects to relay state: https://app.shelf.nu/oauthcallback
    ↓
User is logged in
```

**Critical insight:** Customers configure their IdP to point to **Supabase's ACS URL**, not directly to Shelf. The relay state (where users land after auth) is controlled by us.

---

## Why Customers Don't Need to Change Their IdP

The CTO concern: "Customers will need to create a separate SSO application in their IdP."

**This is NOT required.** Here's why:

| Component | Current (Web) | Mobile | Change Required? |
|-----------|--------------|--------|------------------|
| SAML ACS URL | `supabase.co/.../acs` | `supabase.co/.../acs` | **No change** |
| Entity ID | `supabase.co/.../metadata` | `supabase.co/.../metadata` | **No change** |
| Relay State | `app.shelf.nu/oauthcallback` | `app.shelf.nu/mobile-callback` | **Shelf backend only** |

The customer's Microsoft Entra / Okta / etc. configuration stays **exactly the same**. They don't touch anything.

---

## Proposed Mobile Implementation

### The Flow (Using Universal Links)

```
User opens mobile app → taps "Sign in with SSO"
    ↓
User enters company domain (e.g., "acme.com")
    ↓
App opens browser to:
   https://app.shelf.nu/sso/start?domain=acme.com&platform=mobile
    ↓
Webapp sees platform=mobile, calls Supabase with:
   signInWithSSO({ domain, redirectTo: '/mobile-callback' })
    ↓
Supabase redirects to Microsoft Entra / Okta / etc.
    ↓
User authenticates with company credentials
    ↓
Entra posts SAML to Supabase ACS URL (unchanged)
    ↓
Supabase redirects to the redirectTo we specified:
   https://app.shelf.nu/mobile-callback?token=xxx
    ↓
iOS/Android intercepts this HTTPS URL (Universal Link)
    ↓
App opens with session token
    ↓
User is logged in
```

**Key point:** We explicitly tell Supabase which callback URL to use via the `redirectTo` parameter. Supabase doesn't "detect" anything - we control the relay state when initiating the request.

### What Shelf Needs to Build

| Component | Description | Where |
|-----------|-------------|-------|
| **SSO start route** | `/sso/start?domain=X&platform=mobile` - initiates SSO with mobile redirectTo | Webapp |
| **Mobile callback route** | `/mobile-callback` - receives token, serves Universal Link or fallback page | Webapp |
| **Universal Link config** | `apple-app-site-association` file at `app.shelf.nu/.well-known/` | Webapp |
| **App Link handler** | Register Universal Links in mobile app, extract token from callback | Mobile app |
| **SSO Login Screen** | Domain input field, "Continue with SSO" button, opens browser to start route | Mobile app |

**How we control the redirect (no magic detection):**

```typescript
// Webapp: /sso/start route
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const domain = url.searchParams.get("domain");
  const platform = url.searchParams.get("platform");

  // We explicitly set redirectTo based on platform parameter
  const redirectTo = platform === "mobile"
    ? "https://app.shelf.nu/mobile-callback"
    : "https://app.shelf.nu/oauthcallback";

  const { data } = await supabase.auth.signInWithSSO({
    domain,
    options: { redirectTo }
  });

  return redirect(data.url);
}
```

### What Customers Need to Do

**Nothing.** Their existing IdP configuration continues to work unchanged.

---

## Technical Details

### Universal Links Setup

1. **Webapp hosts association file:**
   ```
   https://app.shelf.nu/.well-known/apple-app-site-association
   ```
   Contains our app's bundle ID and allowed paths.

2. **Mobile app registers for Universal Links:**
   - iOS: Associated Domains entitlement
   - Android: Asset links verification
   - Expo handles this via `app.json` config

3. **When user hits `https://app.shelf.nu/mobile-callback`:**
   - If app installed → iOS/Android opens app directly
   - If app not installed → Shows "Please download Shelf" page

### Session Handoff

Two options for passing the session from Supabase to mobile:

**Option A: Token in URL** (simpler)
- Supabase redirects to `https://app.shelf.nu/mobile-callback?access_token=xxx`
- App extracts token from URL
- ⚠️ Token briefly visible in URL

**Option B: Token exchange** (more secure)
- Supabase redirects with short-lived code
- App exchanges code for token via API call
- Token never in URL

Recommend Option B for enterprise customers.

---

## Questions for Discussion

1. **Scope**: SSO-only, or also "Sign in with Google/Microsoft" for non-SSO users?

2. **Priority**: Ship as part of current PR, or separate release?

3. **Testing**: Do we have a test SSO organization we can use?

---

## Estimated Effort

| Task | Effort |
|------|--------|
| Webapp: Dynamic relay state + mobile callback route | 1 day |
| Webapp: Universal Link association file | 0.5 day |
| Mobile: Universal Link handler + SSO screen | 1-2 days |
| Testing with real SSO org | 1 day |
| **Total** | **3-5 days** |

---

## Summary

- **Customer impact**: Zero. No IdP changes required.
- **Technical approach**: Universal Links (HTTPS URLs that open the app)
- **Key insight**: SAML ACS URL stays the same; we only change the relay state on our backend
