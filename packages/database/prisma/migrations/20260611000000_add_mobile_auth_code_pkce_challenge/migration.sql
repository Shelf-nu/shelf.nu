-- AlterTable
-- PKCE (S256) challenge for native-app SSO. Nullable + additive: existing rows
-- and legacy (pre-PKCE) app builds redeem without a verifier; only codes minted
-- with a challenge require a matching verifier at exchange.
ALTER TABLE "MobileAuthCode"
  ADD COLUMN "codeChallenge" TEXT;
