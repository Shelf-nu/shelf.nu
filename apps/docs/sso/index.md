# Enable SSO

Shelf offers single sign-on (SSO) as a login option to provide additional account security for your team. This allows company administrators to enforce the use of an identity provider when logging into Shelf. SSO improves the onboarding and offboarding experience of the company as the employee only needs a single set of credentials to access third-party applications or tools which can also be revoked easily by an administrator.

Shelf currently provides SAML SSO for Team and Enterprise plan customers. Please contact Sales to have this enabled for your organization.

## Before you start: prerequisites [#](#before-you-start-prerequisites)

SSO changes how accounts on your domain are created and managed, so a few things must be in place **before** we activate the connection. Please read these carefully — most setup confusion comes from skipping them.

### 1. You need one non-SSO account to own the workspace [#](#1-non-sso-owner-account)

Shelf SSO needs **one non-SSO user as the owner of the workspace** to set it up. This account's job is to own the workspace and configure the SSO settings (the group-to-role mapping). It is not used for daily work: owners typically sign in only when doing the initial setup or adjusting the configuration later. Because the owner keeps password login, it is also your administrative fallback if your identity provider is ever unavailable. If you prefer, Shelf can convert the owner to SSO as well once setup is complete (see [Existing standard accounts on your domain](#existing-standard-accounts-on-your-domain)).

Most customers create a dedicated account for this purpose using an address such as `it@yourdomain.com` or `shelf_admin@yourdomain.com`.

> [!IMPORTANT]
> This account **must be created before SSO is activated**. Once your domain is configured as an SSO domain, no more non-SSO accounts can be created with that domain. If you don't have this owner account ready beforehand, you will be locked out of administrative changes.

### 2. Decide what happens to any existing workspace [#](#2-existing-workspace)

If you already have a workspace that was used for testing or trials (for example one created with a few standard accounts), decide whether you want to **keep it together with all the assets inside it**, or start fresh. Let your Shelf contact know so the right workspace is connected to SSO.

### 3. Existing standard accounts on the domain [#](#3-existing-standard-accounts)

Existing **standard (non-SSO) accounts** that use the SSO domain, for example `jane@yourdomain.com` and `joe@yourdomain.com`, do **not** need to be deleted or recreated. Shelf converts them to SSO, and each account keeps its identity, data and workspace memberships (see [Existing standard accounts on your domain](#existing-standard-accounts-on-your-domain)).

Once the domain is an SSO domain, no new standard accounts can be created on it, and existing standard accounts can no longer sign in with a password, an email code or a password reset (the owner of your SSO workspace excepted). Let your Shelf contact know about these accounts: they are converted once your identity provider is configured, and **before** you announce SSO to your team.

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
> When setting up SSO for your organization, the workspace needs **a non-SSO owner** to create it and configure the SSO settings. We recommend keeping that owner on standard login afterwards: it is the administrative fallback if your identity provider is unavailable. Converting the owner to SSO is optional and done on request.
>
> This non-SSO owner account is only needed for rare administrative tasks such as SSO configuration changes. Your team members do not need it during normal operations and use their SSO credentials for daily work.

### Enable SSO for your organization [#](#enable-sso-for-your-organization)

- You can invite people whose email domain is not set up for SSO (for example a contractor's gmail.com address). They join as normal users.
- You cannot invite people whose email is on your workspace's SSO domain. Their access comes from your identity provider's group mapping, not from invites.
- People on a different company's SSO domain can only be invited after they have signed in to Shelf with SSO at least once.
- SSO users cannot see or switch to a personal workspace. When the account is created by the user's first SSO sign-in, Shelf still creates one in the background, but it stays hidden on web and mobile. Accounts provisioned through SCIM don't get one.
- An SSO user will not be able to update or reset their password since the company administrator manages their access via the identity provider.
- An SSO user will not be able to buy their own subscription to Shelf.
- If an SSO user with the following email of huis@zaans.com attempts to sign in with email, they will be refused access to shelf. Once a email is linked to an SSO account, they are not able to create a normal account with the same email
- An SSO user will see and be added only to organizations that are mapped to their groups inside the IDP

### Existing standard accounts on your domain [#](#existing-standard-accounts-on-your-domain)

If users on your domain already have standard (email/password) Shelf accounts, for example from earlier testing, they do **not** need to be deleted or recreated. Shelf converts them to SSO during onboarding. The account keeps the same identity, data and workspace memberships: only the login method changes to SSO.

- Conversion is performed by Shelf staff from the admin dashboard once your SSO provider is configured for the domain. Staff can convert accounts one at a time, or convert every eligible account on the domain at once so nobody is missed.
- Converting an account signs the user out of every existing session and removes their password. From then on they sign in only via SSO.
- The first SSO sign-in after conversion lands the user directly in their existing account, with all their data and workspaces. No NameID change is needed in your identity provider.
- If a user tries to sign in via SSO before their account is converted, the sign-in is refused and they are asked to contact support. Their first SSO sign-in after conversion then shows "Your account is now on single sign-on" with a button to sign in with SSO again. They sign in with SSO once more and land in their existing account. After that they sign in once, as usual. Convert accounts before announcing SSO to your team: it avoids both the refusal and this extra sign-in.
- **Group mappings decide the role.** If the workspace's SSO settings map identity provider groups to roles (the Administrator, Self service and Base group fields), every SSO login sets the user's role from their groups. A converted user whose groups do not map to any role loses access to that workspace at their first SSO login. If no group mappings are configured, existing workspace memberships and roles are kept as they are. Set up the groups (or leave the mappings empty) before converting.
- **The owner of your SSO workspace can keep standard login.** This means the owner of the workspace that uses SSO for the domain (the workspace whose SSO settings list it). An owner who is not converted keeps signing in with their password, which gives you an administrative fallback if your identity provider is unavailable. Converting this owner is optional and done individually, on request: converting all accounts on a domain always skips them. Owning any other workspace, such as one an employee created for themselves, does not exempt an account from SSO.
- **Once a domain is configured for SSO, legacy sign-in is refused on it.** Password login, email codes (OTP) and password reset stop working for every account on the domain, in the web app and in the mobile app, except for owners of the workspace that uses SSO for the domain who have not been converted. A refused account that is still signed in from before is signed out on its next page load and asked to use SSO. Messages shown before sign-in never reveal whether a particular account exists. Convert accounts as soon as the domain is configured, so your team is not locked out in between.
- **If your identity provider becomes unavailable**, Shelf support can revert a converted owner of the workspace that uses SSO for the domain to standard login. The owner then sets a new password with **Forgot password** on the login page and signs in with it. Other accounts on an SSO domain cannot be reverted while the domain is configured for SSO, because they would still be refused a password login.

Mixing SSO and standard (password) users on the same domain, apart from the workspace owner described above, is not currently supported. If you need this, contact support.

### Disable SSO for your team [#](#disable-sso-for-your-team)

- You can prevent a user's account from further access to Shelf by removing or disabling their account in your identity provider.
- You can then optionally remove them from any workspaces inside Shelf. All custodies and bookings assigned to them will be transfered to a non-registered team member.

## Developers [#](#developers)

If you are self-hosting shelf and want to setup SSO, please refer to the supabase documentation for adding providers: [https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml](https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml)

### Attribute mapping [#](#attribute-mapping)

For SSO users to be able to login to shelf, you will need to do some attribute mapping as per [Supabase documentation](https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml?queryGroups=language&language=js#understanding-attribute-mappings). We already provide a file for mapping attributes which you can find inside the project root [./sso/attributes.json](../../sso/attributes.json)
