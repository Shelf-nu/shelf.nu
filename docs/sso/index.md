# Enable SSO

Shelf offers single sign-on (SSO) as a login option to provide additional account security for your team. This allows company administrators to enforce the use of an identity provider when logging into Shelf. SSO improves the onboarding and offboarding experience of the company as the employee only needs a single set of credentials to access third-party applications or tools which can also be revoked easily by an administrator.

Shelf currently provides SAML SSO for Team and Enterprise plan customers. Please contact Sales to have this enabled for your organization.

## Setup and limitations [#](#setup-and-limitations)

Shelf supports most identity providers that support the SAML 2.0 SSO protocol. We've prepared these guides for commonly used identity providers to help you get started. If you use a different provider, our support stands ready to help you out.

- [Google Workspaces (formerly GSuite)](./providers/google-workspace.md)
- [Microsoft Entra (formerly Azure Active Directory)](./providers/microsoft-entra.md)
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
