---
name: oauth-oidc-misconfiguration
description: >-
  OAuth and OIDC misconfiguration testing playbook. Use when reviewing redirect URI handling, state and nonce validation, PKCE, token audience, callback binding, and identity-provider trust flaws.
---

# SKILL: OAuth and OIDC Misconfiguration — Redirects, PKCE, Scopes, and Token Binding

> **AI LOAD INSTRUCTION**: Use this skill when the target uses OAuth 2.0 or OpenID Connect and you need a focused misconfiguration checklist: redirect URI validation, state and nonce handling, PKCE enforcement, token audience, and account binding mistakes.

## 1. WHEN TO LOAD THIS SKILL

Load when:

- The app supports `Login with Google`, GitHub, Microsoft, Okta, or other IdPs
- You see `authorize`, `callback`, `redirect_uri`, `code`, `state`, `nonce`, or `code_challenge`
- Mobile or SPA clients rely on OAuth or OIDC flows

For token cryptography and JWT header abuse, also load:

- [jwt oauth token attacks](../jwt-oauth-token-attacks/SKILL.md)

## 2. HIGH-VALUE MISCONFIGURATION CHECKS

| Theme                     | What to Check                                                             |
| ------------------------- | ------------------------------------------------------------------------- |
| `state` handling          | missing, static, predictable, or not bound to user session                |
| `redirect_uri` validation | prefix match, open redirect chaining, path confusion, localhost leftovers |
| PKCE                      | missing for public clients, code verifier not enforced, downgraded flow   |
| OIDC `nonce`              | missing or not validated on ID token return                               |
| token audience and issuer | weak `aud` / `iss` checks, cross-client token reuse                       |
| account binding           | callback binds attacker identity to victim session                        |
| scope handling            | broader scopes granted than the user or client should receive             |

## 3. QUICK TRIAGE

1. Map the full flow: authorize, callback, token exchange, logout.
2. Replay callback flows with altered `state`, `nonce`, and `redirect_uri`.
3. Compare SPA, mobile, and web clients for weaker validation.
4. Check whether one provider account can be rebound to another local account.

## 4. RELATED ROUTES

- CORS or cross-origin token exposure: [cors cross origin misconfiguration](../cors-cross-origin-misconfiguration/SKILL.md)
- XML federation or enterprise SSO: [saml sso assertion attacks](../saml-sso-assertion-attacks/SKILL.md)
- CSRF-heavy login or binding bugs: [csrf cross site request forgery](../csrf-cross-site-request-forgery/SKILL.md)
