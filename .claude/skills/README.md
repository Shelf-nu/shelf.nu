# Project-level Claude skills

Skills vendored into this repo so anyone reviewing or implementing the
**workspace MFA enforcement** PRD has the same agent capabilities locally.

The actual skill content lives in `.agents/skills/`; the entries here are
symlinks. Both are committed.

## What's in here

| Skill                                      | Why                                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `security-review`                          | OWASP-style security checklist for new code (auth, input, secrets, rate limits).    |
| `two-factor-authentication-best-practices` | Better-Auth's reference 2FA defaults — TOTP, OTP, backup codes, encryption-at-rest. |
| `auth0-mfa`                                | Auth0's MFA patterns — step-up, AAL/AMR claims, backend validation, error codes.    |
| `oauth-oidc-misconfiguration`              | Misconfiguration playbook for OAuth/OIDC flows — redirect, state, PKCE, audience.   |
| `supabase`                                 | Supabase-specific traps — JWT claims, RLS, view bypass, session deletion semantics. |
| `supabase-postgres-best-practices`         | Postgres performance/correctness patterns from Supabase's team.                     |

## Restoring after `git pull`

If symlinks didn't resolve cleanly on your platform (Windows w/o `core.symlinks=true`),
or if you prefer to refresh skill content from source:

```bash
npx skills experimental_install
```

This reads `skills-lock.json` at the repo root and re-fetches the pinned versions.

## Updating

Skills are pinned by content hash in `skills-lock.json`. To check for upstream
updates without applying them:

```bash
npx skills check
```

To update everything to latest:

```bash
npx skills update
```

To install the same set globally on your machine (so they apply outside this repo too):

```bash
npx skills add better-auth/skills@two-factor-authentication-best-practices -g
npx skills add affaan-m/everything-claude-code@security-review -g
npx skills add auth0/agent-skills@auth0-mfa -g
npx skills add yaklang/hack-skills@oauth-oidc-misconfiguration -g
npx skills add supabase/agent-skills@supabase -g
npx skills add supabase/agent-skills@supabase-postgres-best-practices -g
```

## Why these are committed (not gitignored)

`.gitignore` explicitly carves out project-shared settings and skills:
only `.claude/settings.local.json` and `.claude/.credentials*` are excluded.
Project skills are part of the development environment, like `.eslintrc` or
`tsconfig.json`.
