# Local Shibboleth v5 test IdP for the Shelf Supabase SAML SSO integration.
# See README.md for the full runbook (up/down, test users, attribute-release
# verification via aacli.sh, metadata export).
#
# NOTE ON IMAGE CHOICE: the original brief suggested vegardit/openldap, but its
# actual bootstrap env vars (LDAP_INIT_ORG_DN, LDAP_INIT_ROOT_USER_DN, etc.) are
# a different shape entirely from what was assumed. osixia/openldap turned out
# to be genuinely multi-arch (arm64/v8 manifest verified + booted natively on
# this arm64 Mac) and matches the LDAP_ORGANISATION/LDAP_DOMAIN/LDAP_ADMIN_PASSWORD
# + --copy-service + custom-LDIF-bootstrap-path conventions the brief described,
# so it's used here instead (verified working, not merely assumed).
services:
  ldap:
    image: osixia/openldap:1.5.0
    environment:
      LDAP_ORGANISATION: "IdP Test Bed"
      LDAP_DOMAIN: "idptestbed"
      # Matches the idp.authn.LDAP.bindDNCredential baked into the Shibboleth
      # image's credentials/secrets.properties (see idp-home/conf/ldap.properties
      # for why we don't override that property from conf/ instead).
      LDAP_ADMIN_PASSWORD: "myServicePassword"
    command: ["--copy-service"]
    volumes:
      - ./ldap/init.ldif:/container/service/slapd/assets/config/bootstrap/ldif/custom/init.ldif:ro
    ports: ["389:389"]
    healthcheck:
      test:
        [
          "CMD",
          "ldapsearch",
          "-x",
          "-H",
          "ldap://localhost",
          "-b",
          "dc=idptestbed",
          "-D",
          "cn=admin,dc=idptestbed",
          "-w",
          "myServicePassword",
          "(uid=carol)",
        ]
      interval: 3s
      timeout: 5s
      retries: 20
      start_period: 5s

  idp:
    image: i2incommon/shib-idp:5.2.3_20260618_rocky9_multiarch
    depends_on:
      ldap:
        condition: service_healthy
    environment:
      JAVA_OPTS: "-Xmx1024m"
    volumes:
      # Mount conf/ — the image's own baked credentials/ and war stay
      # untouched, so no signing/encryption keys ever touch the repo.
      - ./idp-home/conf:/opt/shibboleth-idp/conf
      # The image's metadata/idp-metadata.xml is a STATIC file (its own header
      # says so) baked with the placeholder idp.example.org entityID/endpoints
      # and example.org scope — /idp/shibboleth serves it as-is and does NOT
      # regenerate it from conf/idp.properties. Left unmounted, the exported
      # metadata would advertise SSO endpoints at a domain that doesn't
      # resolve, silently breaking the human's later Supabase registration.
      # We overlay a corrected copy (idp-home/metadata/idp-metadata.xml) that
      # only edits URLs/entityID/scope text — the embedded X.509 certs are
      # left byte-for-byte identical (they're the image's real public certs;
      # only their Subject CN/SAN still say idp.example.org, which is cosmetic
      # and does not affect SAML signature validation).
      - ./idp-home/metadata/idp-metadata.xml:/opt/shibboleth-idp/metadata/idp-metadata.xml:ro
    ports: ["443:443"]
