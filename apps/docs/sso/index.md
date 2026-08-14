# Enable SSO

Shelf offers single sign-on (SSO) as a login option to provide additional account security for your team. This allows company administrators to enforce the use of an identity provider when logging into Shelf. SSO improves the onboarding and offboarding experience of the company as the employee only needs a single set of credentials to access third-party applications or tools which can also be revoked easily by an administrator.

Shelf currently provides SAML SSO for Team and Enterprise plan customers. Please contact Sales to have this enabled for your organization.

## Before you start: prerequisites [#](#before-you-start-prerequisites)

SSO changes how accounts on your domain are created and managed, so a few things must be in place **before** we activate the connection. Please read these carefully — most setup confusion comes from skipping them.

### 1. You need one non-SSO account to own the workspace [#](#1-non-sso-owner-account)

Shelf SSO requires **one non-SSO user to be the owner of the workspace**. This account's only job is to own the workspace and configure the SSO settings (the group-to-role mapping). It is not used for daily work — owners typically sign in only when doing the initial setup or adjusting the configuration later.

Most customers create a dedicated account for this purpose using an address such as `it@yourdomain.com` or `shelf_admin@yourdomain.com`.

> [!IMPORTANT]
> This account **must be created before SSO is activated**. Once your domain is configured as an SSO domain, no more non-SSO accounts can be created with that domain. If you don't have this owner account ready beforehand, you will be locked out of administrative changes.

### 2. Decide what happens to any existing workspace [#](#2-existing-workspace)

If you already have a workspace that was used for testing or trials (for example one created with a few standard accounts), decide whether you want to **keep it together with all the assets inside it**, or start fresh. Let your Shelf contact know so the right workspace is connected to SSO.

### 3. Existing standard accounts on the domain must be removed [#](#3-existing-standard-accounts)

Any existing **standard (non-SSO) accounts** that use the SSO domain — for example `jane@yourdomain.com` and `joe@yourdomain.com` — must be removed so that new accounts can be created through SSO login. Once an email is linked to a standard account it cannot log in via SSO, and once the domain is an SSO domain no new standard accounts can be created on it. Share the list of these accounts with your Shelf contact, who will take care of removing them at the right point in the setup.

### 4. Plan your group-to-role mapping [#](#4-plan-group-mapping)

Shelf decides which role a user gets by matching the groups they belong to in your identity provider. You map those groups to Shelf roles (Administrator, Self service, Base) in the workspace settings.

> [!NOTE]
> You only need to map the **roles you actually use** — a single group mapping is enough for SSO to work. You do not need to create a group for every role. See your provider guide below for whether to use group **names** or group **IDs**.

**Mapping more than one group to a role.** Each role field accepts **one or more group identifiers, separated by commas** — anyone in _any_ of the listed groups gets that role. This is useful when several groups you already have in your identity provider should all grant the same Shelf role, so you don't have to create a new dedicated group just for Shelf. For example, mapping the Self service role to `staff@your-idp, faculty@your-idp` gives both groups self-service access.

> [!NOTE]
> A user still only ever holds **one** Shelf role per workspace. If their groups match more than one role, the **highest** one applies (Administrator > Self service > Base) — so listing several groups for a role is a convenience for grouping people into one role, never a way to grant multiple roles. Matching ignores letter case and surrounding spaces, but paste each value exactly as your identity provider sends it to be safe.

## Setup and limitations [#](#setup-and-limitations)

Shelf supports most identity providers that support the SAML 2.0 SSO protocol. We've prepared these guides for commonly used identity providers to help you get started. If you use a different provider, our support stands ready to help you out.

- [Google Workspaces (formerly GSuite)](./providers/google-workspace.md)
- [Microsoft Entra (formerly Azure Active Directory)](./providers/microsoft-entra.md)
- [Shibboleth](./providers/shibboleth.md)
- Okta

Accounts signing in with SSO have certain limitations. The following sections outline the limitations when SSO is enabled or disabled for your team.

> [!IMPORTANT]
> When setting up SSO for your organization, you **must ensure that at least one non-SSO user remains as the owner** of all workspaces. This user will serve as the administrative fallback and maintain ownership of organizational resources.
>
> This non-SSO user account is only needed for rare administrative tasks such as SSO configuration changes - your team members will not need to access this account during normal operations and can use their SSO credentials for daily work.

### Enable SSO for your organization [#](#enable-sso-for-your-organization)

- Workspace invites are not restricted to company members belonging to the same identity provider. You can also invite normal users to your workspace
- SSO users don't get a personal workspace which by default comes with any normal user
- An SSO user will not be able to update or reset their password since the company administrator manages their access via the identity provider.
- An SSO user will not be able to buy their own subscription to Shelf.
- If an SSO user with the following email of huis@zaans.com attempts to sign in with email, they will be refused access to shelf. Once a email is linked to an SSO account, they are not able to create a normal account with the same email
- If a user with email huis@zaans.com already exists as a standard user, they will not be able to login via SSO. Please contact support to get this resolved.
- An SSO user will see and be added only to organizations that are mapped to their groups inside the IDP

### Disable SSO for your team [#](#disable-sso-for-your-team)

- You can prevent a user's account from further access to Shelf by removing or disabling their account in your identity provider.
- You can then optionally remove them from any workspaces inside Shelf. All custodies and bookings assigned to them will be transfered to a non-registered team member.

## Developers [#](#developers)

If you are self-hosting shelf and want to setup SSO, please refer to the supabase documentation for adding providers: [https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml](https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml)

### Attribute mapping [#](#attribute-mapping)

For SSO users to be able to login to shelf, you will need to do some attribute mapping as per [Supabase documentation](https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml?queryGroups=language&language=js#understanding-attribute-mappings). We already provide a file for mapping attributes which you can find inside the project root [./sso/attributes.json](../../sso/attributes.json)
