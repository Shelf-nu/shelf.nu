# Set Up SSO with Shibboleth

Shelf supports single sign-on (SSO) using [Shibboleth](https://www.shibboleth.net/), the self-hosted, open-source SAML 2.0 identity provider widely used across higher education and research institutions.

Unlike Google Workspace or Microsoft Entra, Shibboleth has no hosted admin console — everything is configured through XML files on your IdP server (`saml-nameid.xml`, `attribute-filter.xml`, `attribute-resolver.xml`, and friends). This guide therefore shows annotated config snippets instead of console screenshots, and points out the couple of settings that differ from a typical Shibboleth deployment and trip up first-time Shelf integrations.

Shelf connects to Shibboleth the same way it connects to every other identity provider: through the standard SAML 2.0 flow, brokered by Supabase Auth.

## Prerequisites [#](#prerequisites)

Before you start, make sure you've read the general [SSO prerequisites](../index.md#before-you-start-prerequisites) — in particular:

- You have a **non-SSO owner account** ready to own the Shelf workspace.
- Any existing **standard accounts** on your SSO domain are ready to be removed.
- You've planned which of your Shibboleth attributes/groups map to which Shelf role (Administrator, Self service, Base).

## Service provider (SP) details [#](#service-provider-sp-details)

Shelf's SAML layer is handled by Supabase Auth, so the values you register in your Shibboleth relying-party (SP) metadata are Supabase's, not Shelf's directly.

| Detail                   | Value                                                     |
| ------------------------ | --------------------------------------------------------- |
| ACS URL                  | `https://<project>.supabase.co/auth/v1/sso/saml/acs`      |
| Entity ID / Metadata URL | `https://<project>.supabase.co/auth/v1/sso/saml/metadata` |
| Relay State              | `https://app.shelf.nu/oauthcallback`                      |

> [!NOTE]
> The `<project>` placeholder is the Supabase project host for your Shelf
> instance. Your Shelf contact will give you the exact value to substitute —
> do not guess it.

## Configure a persistent NameID (required) [#](#configure-a-persistent-nameid-required)

Supabase identifies a returning user by the SAML `NameID`. Shibboleth's out-of-the-box default `NameIDFormat` is `transient` — a value that changes on every login. Supabase **rejects** transient NameIDs (the login fails with a "no user id" error), so you must configure a **`persistent`** NameID for the Shelf relying party. The `emailAddress` format is also acceptable if you'd rather key off email.

Add (or edit) the NameID precedence for the Shelf/Supabase relying party in `conf/saml-nameid.xml` and `conf/relying-party.xml`:

```xml
<!-- conf/saml-nameid.xml -->
<util:list id="shibboleth.saml2.NameIDFormatPrecedence">
    <value>urn:oasis:names:tc:SAML:2.0:nameid-format:persistent</value>
</util:list>
```

```xml
<!-- conf/relying-party.xml (excerpt) -->
<util:list id="shibboleth.RelyingPartyOverrides">
    <bean parent="RelyingPartyByName"
          c:relyingPartyIds="#{ {'https://&lt;project&gt;.supabase.co/auth/v1/sso/saml/metadata'} }">
        <property name="profileConfigurations">
            <list>
                <bean parent="SAML2.SSO"
                      p:nameIDFormatPrecedence="#{ {'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent'} }" />
            </list>
        </bean>
    </bean>
</util:list>
```

> [!IMPORTANT]
> If you skip this step, users will be able to reach the Shibboleth login screen but sign-in will fail immediately afterward on the Supabase side. If you've verified everything else and login still fails at that point, this is almost always the cause.

## Release the required attributes [#](#release-the-required-attributes)

Shibboleth releases **no attributes by default** — every attribute has to be explicitly permitted to a relying party via an `AttributeFilterPolicy`. This is the single most common gotcha when connecting a new Shibboleth SP: if you skip it, Shelf will see an empty (or near-empty) SAML assertion and the user will fail to sign in with no email or name.

Add a policy in `conf/attribute-filter.xml` scoped to the Supabase entity ID, releasing `mail`, `givenName`, `sn`, and whichever group attribute you've chosen (see the next section — this example uses `isMemberOf`):

```xml
<!-- conf/attribute-filter.xml (excerpt) -->
<afp:AttributeFilterPolicy id="releaseToShelf">
    <afp:PolicyRequirementRule xsi:type="basic:AttributeRequesterString"
        value="https://<project>.supabase.co/auth/v1/sso/saml/metadata" />

    <afp:AttributeRule attributeID="mail">
        <afp:PermitValueRule xsi:type="basic:ANY" />
    </afp:AttributeRule>

    <afp:AttributeRule attributeID="givenName">
        <afp:PermitValueRule xsi:type="basic:ANY" />
    </afp:AttributeRule>

    <afp:AttributeRule attributeID="sn">
        <afp:PermitValueRule xsi:type="basic:ANY" />
    </afp:AttributeRule>

    <afp:AttributeRule attributeID="isMemberOf">
        <afp:PermitValueRule xsi:type="basic:ANY" />
    </afp:AttributeRule>
</afp:AttributeFilterPolicy>
```

> [!IMPORTANT]
> "No email" or "missing name/groups after login" almost always means the attribute isn't being **released** to the Shelf/Supabase entity ID — it's rarely a resolver problem. Check `attribute-filter.xml` first.

## Choose a group strategy [#](#choose-a-group-strategy)

Shelf maps users to roles (Administrator, Self service, Base) based on group values in the `groups` claim. Shibboleth deployments commonly source that claim from one of three attributes — pick whichever your institution already populates. All three work the same way on the Shelf side; you only need one.

| Strategy                     | SAML Name (OID)                    | Value example                   |
| ---------------------------- | ---------------------------------- | ------------------------------- |
| `isMemberOf` (recommended)   | `urn:oid:1.3.6.1.4.1.5923.1.5.1.1` | `university:apps:shelf:admins`  |
| `eduPersonEntitlement`       | `urn:oid:1.3.6.1.4.1.5923.1.1.1.7` | `urn:mace:your.edu:shelf:admin` |
| `eduPersonScopedAffiliation` | `urn:oid:1.3.6.1.4.1.5923.1.1.1.9` | `staff@your.edu`                |

### `isMemberOf` (recommended) [#](#ismemberof-recommended)

Most Shibboleth/Grouper deployments already resolve group membership (often from LDAP `memberOf` or a Grouper registry) into `isMemberOf`. It's the most direct fit for "map a real IdP group to a Shelf role."

```xml
<!-- conf/attribute-resolver.xml (excerpt) -->
<resolver:AttributeDefinition xsi:type="ad:Mapped" id="isMemberOf" sourceAttributeID="memberOf">
    <resolver:Dependency ref="myLDAP" />
    <resolver:AttributeEncoder xsi:type="enc:SAML2StringAttributeEncoder"
        name="urn:oid:1.3.6.1.4.1.5923.1.5.1.1" friendlyName="isMemberOf" />
    <ad:ValueMap>
        <ad:ReturnValue>university:apps:shelf:admins</ad:ReturnValue>
        <ad:SourceValue>cn=shelf-admins,ou=groups,dc=your,dc=edu</ad:SourceValue>
    </ad:ValueMap>
</resolver:AttributeDefinition>
```

Then permit it in `attribute-filter.xml` alongside `mail`/`givenName`/`sn` (see the example above).

### `eduPersonEntitlement` [#](#edupersonentitlement)

Use this if your institution already expresses application-level entitlements as URNs (common in eduGAIN/InCommon federations).

```xml
<!-- conf/attribute-resolver.xml (excerpt) -->
<resolver:AttributeDefinition xsi:type="ad:Mapped" id="eduPersonEntitlement" sourceAttributeID="memberOf">
    <resolver:Dependency ref="myLDAP" />
    <resolver:AttributeEncoder xsi:type="enc:SAML2StringAttributeEncoder"
        name="urn:oid:1.3.6.1.4.1.5923.1.1.1.7" friendlyName="eduPersonEntitlement" />
    <ad:ValueMap>
        <ad:ReturnValue>urn:mace:your.edu:shelf:admin</ad:ReturnValue>
        <ad:SourceValue>cn=shelf-admins,ou=groups,dc=your,dc=edu</ad:SourceValue>
    </ad:ValueMap>
</resolver:AttributeDefinition>
```

```xml
<!-- conf/attribute-filter.xml (excerpt) -->
<afp:AttributeRule attributeID="eduPersonEntitlement">
    <afp:PermitValueRule xsi:type="basic:ANY" />
</afp:AttributeRule>
```

### `eduPersonScopedAffiliation` [#](#edupersonscopedaffiliation)

Use this if you want a coarse role split (e.g. all `staff` get Admin, all `student` get Base) rather than a dedicated Shelf group. This is usually already populated from `eduPersonAffiliation` and doesn't require any new group provisioning.

```xml
<!-- conf/attribute-resolver.xml (excerpt) -->
<resolver:AttributeDefinition xsi:type="ad:Scoped" id="eduPersonScopedAffiliation"
    scope="%{idp.scope}" sourceAttributeID="eduPersonAffiliation">
    <resolver:Dependency ref="myLDAP" />
    <resolver:AttributeEncoder xsi:type="enc:SAML2ScopedStringAttributeEncoder"
        name="urn:oid:1.3.6.1.4.1.5923.1.1.1.9" friendlyName="eduPersonScopedAffiliation" />
</resolver:AttributeDefinition>
```

```xml
<!-- conf/attribute-filter.xml (excerpt) -->
<afp:AttributeRule attributeID="eduPersonScopedAffiliation">
    <afp:PermitValueRule xsi:type="basic:ANY" />
</afp:AttributeRule>
```

> [!NOTE]
> Whichever strategy you pick, the released **value** (e.g. `university:apps:shelf:admins`, `urn:mace:your.edu:shelf:admin`, or `staff@your.edu`) is exactly what you'll paste into Shelf's group-mapping fields later — see [Map your groups in Shelf](#map-your-groups-in-shelf).

## Attribute mapping (what Shelf configures in Supabase) [#](#attribute-mapping-what-shelf-configures-in-supabase)

On the Shelf side, we register your Shibboleth provider in Supabase with a dedicated attribute-mapping preset that already knows how to read Shibboleth's `urn:oid:…`-named attributes. You don't need to configure this yourself — it's shown here so you understand what happens to the attributes you release.

```json
{
  "keys": {
    "email": { "names": ["urn:oid:0.9.2342.19200300.100.1.3", "mail"] },
    "firstName": { "names": ["urn:oid:2.5.4.42", "givenName"] },
    "lastName": { "names": ["urn:oid:2.5.4.4", "sn"] },
    "groups": {
      "names": ["urn:oid:1.3.6.1.4.1.5923.1.5.1.1", "isMemberOf"],
      "array": true
    }
  }
}
```

A few notes on how to read this:

- **OID sources** — Shibboleth assertions typically carry attributes under their formal `urn:oid:…` name (e.g. `mail` is `urn:oid:0.9.2342.19200300.100.1.3`). Supabase matches attributes by SAML `Name` **or** `FriendlyName`, case-insensitively, so listing both the OID and the friendly name (`names: [...]`) means the mapping works whether your `attribute-resolver.xml` encodes the OID, the friendly name, or both.
- **`groups.array`** — the `groups` key is declared as a multi-valued array claim (`"array": true`), because a user can belong to more than one group and Shelf's role matcher (`getRoleFromGroupId`) accepts multiple values.
- **Swapping the group source** — the `groups.names` list above pairs the `isMemberOf` OID (`urn:oid:1.3.6.1.4.1.5923.1.5.1.1`) with its friendly name. If you chose `eduPersonEntitlement` or `eduPersonScopedAffiliation` instead, tell your Shelf contact — they'll swap those two values to `urn:oid:1.3.6.1.4.1.5923.1.1.1.7` / `eduPersonEntitlement` or `urn:oid:1.3.6.1.4.1.5923.1.1.1.9` / `eduPersonScopedAffiliation` respectively when they register your provider. Everything else in the mapping stays the same.

> [!NOTE]
> These target key names (`firstName`, `lastName`, `groups`) are intentionally non-standard. Supabase promotes _standard_ OIDC claim names (like `given_name` or `name`) straight into the user's top-level profile and strips them out of the `custom_claims` object that Shelf actually reads — so the preset avoids them everywhere except `email`.

## Send us your metadata [#](#send-us-your-metadata)

Once your IdP is configured, send your Shelf contact:

- Your **IdP metadata** — either the metadata URL (e.g. `https://idp.your.edu/idp/shibboleth`) or the exported XML file.
- The **domain** your users will sign in with (the one they'll type on Shelf's SSO login screen).
- Which **group strategy** you chose (`isMemberOf`, `eduPersonEntitlement`, or `eduPersonScopedAffiliation`), so we register the matching attribute mapping.

If you're not sure where to send this, reach us at [hello@shelf.nu](mailto:hello@shelf.nu).

We'll register the provider in Supabase and confirm once it's live — this usually takes about **1 business day**. Don't test sign-in until you've heard back.

## Map your groups in Shelf [#](#map-your-groups-in-shelf)

<!-- TODO: screenshot from local Shibboleth rig — workspace SSO settings group mapping fields -->

Once we've confirmed your provider is registered, go to your workspace SSO settings in Shelf and enter the group value for each role you use: Administrator, Self service, Base.

- Each field accepts **one or more values, comma-separated** — for example `staff@your.edu, faculty@your.edu` if two different affiliation values should both grant the same role.
- Paste the value(s) **exactly** as your IdP releases them. Matching is trimmed and case-insensitive on Shelf's side, but the safest approach is always to copy the real released value rather than retype it.
- You only need to fill in the roles you actually use — leave the rest blank, but at least one group must be mapped.
- Precedence is **Administrator > Self service > Base**: if a user's claim matches groups mapped to more than one role, the highest one wins.

## Test single sign-on [#](#test-single-sign-on)

Go to `/sso-login`, enter your domain, and sign in as a test user who belongs to one of the groups you mapped.

- A user whose groups match a mapped role should land straight in the workspace with that role.
- A user with **no matching group** lands on the pending-assignment screen rather than being denied outright — this is expected, and resolves itself as soon as an admin maps their group (or adds them to a mapped one).

If sign-in doesn't work as expected, see the troubleshooting section below, then reach out to your support contact at Shelf.

## Troubleshooting [#](#troubleshooting)

**No email, or missing name/groups after a successful redirect back from Shibboleth.**
This is almost always a missing (or mis-scoped) `attribute-filter.xml` policy — the attribute resolver may have the value, but Shibboleth doesn't release anything to a relying party unless a filter policy explicitly permits it. Double-check the `AttributeFilterPolicy` covers the Supabase entity ID and includes `mail`, `givenName`, `sn`, and your chosen group attribute.

**Login fails right after the Shibboleth screen, with no clear error on Shelf's side.**
Check the `NameIDFormat` your IdP is issuing for the Shelf/Supabase relying party — the Shibboleth default is `transient`, which Supabase rejects. It must be `persistent` (or `emailAddress`). See [Configure a persistent NameID](#configure-a-persistent-nameid-required).

**User logs in but always lands on the pending-assignment screen, even though you mapped their group.**
This is a group **value mismatch** — the string Shibboleth actually released doesn't match what's pasted in Shelf's settings byte-for-byte (matching is case-insensitive/trimmed, but not fuzzy). Ask your identity team for a sample SAML assertion (or check the IdP's audit log) to confirm the exact value being released for that user, then update the mapping in Shelf to match it exactly.
