-- Records how a role changed: from the team settings, or from SSO group claims at sign-in.
-- Additive: existing rows all came from the team settings and take the MANUAL default.
CREATE TYPE "RoleChangeSource" AS ENUM ('MANUAL', 'SSO');

ALTER TABLE "RoleChangeLog"
  ADD COLUMN "source" "RoleChangeSource" NOT NULL DEFAULT 'MANUAL';
