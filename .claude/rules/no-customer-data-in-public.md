---
description: shelf.nu is a public repo - never put customer names, emails, companies or account details in PRs, issues, commits, code or tests
---

# No Customer Data In Public

This repository is public, and GitHub keeps every edit: a PR body, issue,
comment or commit message stays readable in its edit history after you fix it.
Treat everything you write here as published.

Never write, anywhere in this repo or on its GitHub pages:

- a customer's or lead's name, email address, phone number or company name
- their workspace or organization name or id, record names from their account,
  or numbers about their account (asset counts, plan, revenue)
- counts from production data ("59 workspaces have more than 50 locations"):
  write "real workspaces have more than 50 locations" instead
- quotes from their emails, chats or support tickets
- details of an unfixed security weakness (that stays in the private tracker)

Say who asked in neutral words instead.

❌ `Requested by: Jane Doe, Acme Corp (jane@acme.com). Can't bulk-tag 30 assets.`

✅ `Requested by: a customer (details in our CRM). Bulk tagging misses tags past the first 100.`

The same goes for test data, fixtures and screenshots: use made-up names
(`ZZ Test Kit`, `test@example.com`), and crop or blur real account data.

If you find customer data already published in a PR description, issue or
comment you can edit, remove it from the text, then delete the old revisions
from the edit history. Tell a maintainer privately in every other case: text
you cannot edit, a committed file or commit message (a later commit does not
remove it), or an uploaded screenshot (its file stays reachable at its URL
until GitHub Support removes it).
