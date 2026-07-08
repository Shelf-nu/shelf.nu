/**
 * Guard tests for the Supabase SAML `attribute_mapping` presets.
 *
 * GoTrue promotes *standard* OIDC claim names (given_name, family_name, name,
 * full_name, …) to top-level user_metadata and REMOVES them from `custom_claims`.
 * Shelf reads names/groups from `custom_claims`, so the preset target keys MUST
 * stay non-standard (firstName/lastName/groups). `email` is the one intentional
 * exception (GoTrue uses it as the user's email). This test locks that invariant
 * for every preset so a future edit can't silently blank out names or groups.
 *
 * @see {@link file://../../sso/attributes.json}
 * @see {@link file://../../sso/shibboleth-attributes.json}
 */
import { describe, expect, it } from "vitest";
import defaultMapping from "../../sso/attributes.json";
import shibbolethMapping from "../../sso/shibboleth-attributes.json";

/** OIDC claim names GoTrue promotes out of custom_claims (must not be used as target keys). */
const STANDARD_OIDC_KEYS = new Set([
  "name",
  "family_name",
  "given_name",
  "middle_name",
  "nickname",
  "preferred_username",
  "profile",
  "picture",
  "website",
  "gender",
  "birthdate",
  "zoneinfo",
  "locale",
  "updated_at",
  "email_verified",
  "phone",
  "phone_verified",
  "full_name",
  "avatar_url",
  "slug",
  "provider_id",
  "user_name",
]);

const presets = {
  "attributes.json": defaultMapping,
  "shibboleth-attributes.json": shibbolethMapping,
};

describe.each(Object.entries(presets))(
  "SSO attribute preset %s",
  (_name, mapping) => {
    it("keeps name/group target keys out of the GoTrue standard-key strip list", () => {
      for (const key of Object.keys(mapping.keys)) {
        if (key === "email") continue; // email is intentionally standard
        expect(STANDARD_OIDC_KEYS.has(key)).toBe(false);
      }
    });

    it("declares groups as a multi-valued array claim", () => {
      expect(mapping.keys.groups.array).toBe(true);
    });

    it("maps the four claims Shelf consumes", () => {
      expect(Object.keys(mapping.keys).sort()).toEqual([
        "email",
        "firstName",
        "groups",
        "lastName",
      ]);
    });
  }
);
