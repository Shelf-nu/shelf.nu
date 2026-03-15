-- =============================================================================
-- 004_add_msp_tables.sql
-- Add 8 new MSP tables + new enums + deferred FKs from 003
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. New enum types
-- ---------------------------------------------------------------------------
CREATE TYPE person_status AS ENUM ('active', 'inactive', 'terminated');
CREATE TYPE software_status AS ENUM ('active', 'cancelled', 'trial');
CREATE TYPE license_status AS ENUM ('assigned', 'revoked', 'suspended');
CREATE TYPE license_source AS ENUM ('liongard', 'manual', 'entra');
CREATE TYPE sync_source_system AS ENUM ('ninjaone', 'connectwise', 'liongard');
CREATE TYPE sync_status AS ENUM ('ok', 'error', 'stale');
CREATE TYPE activity_action AS ENUM ('create', 'update', 'delete');

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

-- 2.1 person
CREATE TABLE person (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid          NOT NULL,
  first_name          text          NOT NULL,
  last_name           text          NOT NULL,
  email               text,
  department          text,
  job_title           text,
  manager_id          uuid,
  start_date          date,
  end_date            date,
  m365_user_id        text,
  cw_contact_id       text,
  cw_configuration_id text,
  ninja_user_id       text,
  liongard_user_id    text,
  status              person_status NOT NULL DEFAULT 'active',
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now()
);

-- 2.2 vendor (must exist before software_application and lease)
CREATE TABLE vendor (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid        NOT NULL,
  name                  text        NOT NULL,
  contact_name          text,
  contact_email         text,
  website               text,
  controlmap_vendor_id  text,
  total_hardware_spend  double precision NOT NULL DEFAULT 0,
  total_software_spend  double precision NOT NULL DEFAULT 0,
  total_lease_spend     double precision NOT NULL DEFAULT 0,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- 2.3 software_application
CREATE TABLE software_application (
  id              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid            NOT NULL,
  name            text            NOT NULL,
  vendor_id       uuid,
  description     text,
  category        text,
  contract_url    text,
  pricing_model   text,
  cost_per_seat   double precision,
  total_cost      double precision,
  license_count   integer,
  renewal_date    date,
  status          software_status NOT NULL DEFAULT 'active',
  created_at      timestamptz     NOT NULL DEFAULT now(),
  updated_at      timestamptz     NOT NULL DEFAULT now()
);

-- 2.4 license_assignment
CREATE TABLE license_assignment (
  id                      uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id               uuid           NOT NULL,
  software_application_id uuid           NOT NULL,
  seat_type               text,
  status                  license_status NOT NULL DEFAULT 'assigned',
  source                  license_source NOT NULL DEFAULT 'manual',
  source_id               text,
  assigned_at             timestamptz    NOT NULL DEFAULT now(),
  revoked_at              timestamptz,
  created_at              timestamptz    NOT NULL DEFAULT now(),
  updated_at              timestamptz    NOT NULL DEFAULT now()
);

-- 2.5 lease
CREATE TABLE lease (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid        NOT NULL,
  asset_id             uuid,
  vendor_id            uuid,
  description          text        NOT NULL,
  monthly_cost         double precision NOT NULL DEFAULT 0,
  start_date           date        NOT NULL,
  end_date             date,
  reminder_days_before integer     DEFAULT 30,
  auto_renew           boolean     NOT NULL DEFAULT false,
  contract_url         text,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- 2.6 asset_sync_source
CREATE TABLE asset_sync_source (
  id               uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id         uuid               NOT NULL,
  source_system    sync_source_system NOT NULL,
  source_native_id text               NOT NULL,
  last_sync_at     timestamptz,
  sync_status      sync_status        NOT NULL DEFAULT 'ok',
  field_overrides  jsonb              NOT NULL DEFAULT '{}',
  error_message    text,
  created_at       timestamptz        NOT NULL DEFAULT now(),
  updated_at       timestamptz        NOT NULL DEFAULT now(),

  UNIQUE (asset_id, source_system)
);

-- 2.7 activity_log
CREATE TABLE activity_log (
  id                      uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid            NOT NULL,
  entity_type             text            NOT NULL,
  entity_id               uuid            NOT NULL,
  action                  activity_action NOT NULL,
  field_name              text,
  old_value               text,
  new_value               text,
  changed_by_user_id      uuid,
  changed_by_sync_source  text,
  ip_address              text,
  user_agent              text,
  created_at              timestamptz     NOT NULL DEFAULT now()
);

-- 2.8 asset_status_config
CREATE TABLE asset_status_config (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL,
  name            text        NOT NULL,
  color           text,
  icon            text,
  is_default      boolean     NOT NULL DEFAULT false,
  sort_order      integer     NOT NULL DEFAULT 0,
  is_system       boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, name)
);

-- ---------------------------------------------------------------------------
-- 3. Foreign keys for new tables
-- ---------------------------------------------------------------------------

-- person
ALTER TABLE person
  ADD CONSTRAINT "person_organization_id_fkey"
    FOREIGN KEY (organization_id) REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "person_manager_id_fkey"
    FOREIGN KEY (manager_id) REFERENCES person(id)
    ON DELETE SET NULL;

-- vendor
ALTER TABLE vendor
  ADD CONSTRAINT "vendor_organization_id_fkey"
    FOREIGN KEY (organization_id) REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- software_application
ALTER TABLE software_application
  ADD CONSTRAINT "software_application_organization_id_fkey"
    FOREIGN KEY (organization_id) REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "software_application_vendor_id_fkey"
    FOREIGN KEY (vendor_id) REFERENCES vendor(id)
    ON DELETE SET NULL;

-- license_assignment
ALTER TABLE license_assignment
  ADD CONSTRAINT "license_assignment_person_id_fkey"
    FOREIGN KEY (person_id) REFERENCES person(id)
    ON DELETE CASCADE,
  ADD CONSTRAINT "license_assignment_software_application_id_fkey"
    FOREIGN KEY (software_application_id) REFERENCES software_application(id)
    ON DELETE CASCADE;

-- lease
ALTER TABLE lease
  ADD CONSTRAINT "lease_organization_id_fkey"
    FOREIGN KEY (organization_id) REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "lease_asset_id_fkey"
    FOREIGN KEY (asset_id) REFERENCES "Asset"(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT "lease_vendor_id_fkey"
    FOREIGN KEY (vendor_id) REFERENCES vendor(id)
    ON DELETE SET NULL;

-- asset_sync_source
ALTER TABLE asset_sync_source
  ADD CONSTRAINT "asset_sync_source_asset_id_fkey"
    FOREIGN KEY (asset_id) REFERENCES "Asset"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- activity_log
ALTER TABLE activity_log
  ADD CONSTRAINT "activity_log_organization_id_fkey"
    FOREIGN KEY (organization_id) REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "activity_log_changed_by_user_id_fkey"
    FOREIGN KEY (changed_by_user_id) REFERENCES "User"(id)
    ON DELETE SET NULL;

-- asset_status_config
ALTER TABLE asset_status_config
  ADD CONSTRAINT "asset_status_config_organization_id_fkey"
    FOREIGN KEY (organization_id) REFERENCES "Organization"(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 4. Deferred FKs from migration 003
-- ---------------------------------------------------------------------------

-- Asset.person_id → person
ALTER TABLE "Asset"
  ADD CONSTRAINT "Asset_person_id_fkey"
    FOREIGN KEY (person_id) REFERENCES person(id)
    ON DELETE SET NULL;

-- TeamMember.person_id → person
ALTER TABLE "TeamMember"
  ADD CONSTRAINT "TeamMember_person_id_fkey"
    FOREIGN KEY (person_id) REFERENCES person(id)
    ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 5. Asset status migration: add status_id column
--    FK to asset_status_config. The old enum column stays for now;
--    seed data (008) populates config rows, then app code can migrate.
-- ---------------------------------------------------------------------------
ALTER TABLE "Asset"
  ADD COLUMN IF NOT EXISTS status_id uuid;

ALTER TABLE "Asset"
  ADD CONSTRAINT "Asset_status_id_fkey"
    FOREIGN KEY (status_id) REFERENCES asset_status_config(id)
    ON DELETE SET NULL;

CREATE INDEX "Asset_status_id_idx" ON "Asset" (status_id);

-- ---------------------------------------------------------------------------
-- 6. Indexes for new tables
-- ---------------------------------------------------------------------------

-- person
CREATE INDEX "person_organization_id_idx" ON person (organization_id);
CREATE INDEX "person_manager_id_idx" ON person (manager_id);
CREATE INDEX "person_email_idx" ON person (email);
CREATE INDEX "person_status_idx" ON person (status);
CREATE INDEX "person_m365_user_id_idx" ON person (m365_user_id);
CREATE INDEX "person_cw_contact_id_idx" ON person (cw_contact_id);
CREATE INDEX "person_ninja_user_id_idx" ON person (ninja_user_id);
CREATE INDEX "person_name_gin_idx" ON person USING gin (first_name gin_trgm_ops, last_name gin_trgm_ops);

-- vendor
CREATE INDEX "vendor_organization_id_idx" ON vendor (organization_id);
CREATE INDEX "vendor_name_idx" ON vendor (name);
CREATE INDEX "vendor_controlmap_vendor_id_idx" ON vendor (controlmap_vendor_id);

-- software_application
CREATE INDEX "software_application_organization_id_idx" ON software_application (organization_id);
CREATE INDEX "software_application_vendor_id_idx" ON software_application (vendor_id);
CREATE INDEX "software_application_status_idx" ON software_application (status);
CREATE INDEX "software_application_renewal_date_idx" ON software_application (renewal_date);

-- license_assignment
CREATE INDEX "license_assignment_person_id_idx" ON license_assignment (person_id);
CREATE INDEX "license_assignment_software_application_id_idx" ON license_assignment (software_application_id);
CREATE INDEX "license_assignment_status_idx" ON license_assignment (status);
CREATE INDEX "license_assignment_source_idx" ON license_assignment (source);

-- lease
CREATE INDEX "lease_organization_id_idx" ON lease (organization_id);
CREATE INDEX "lease_asset_id_idx" ON lease (asset_id);
CREATE INDEX "lease_vendor_id_idx" ON lease (vendor_id);
CREATE INDEX "lease_end_date_idx" ON lease (end_date);

-- asset_sync_source
CREATE INDEX "asset_sync_source_asset_id_idx" ON asset_sync_source (asset_id);
CREATE INDEX "asset_sync_source_source_system_idx" ON asset_sync_source (source_system);
CREATE INDEX "asset_sync_source_sync_status_idx" ON asset_sync_source (sync_status);
CREATE INDEX "asset_sync_source_last_sync_at_idx" ON asset_sync_source (last_sync_at);

-- activity_log
CREATE INDEX "activity_log_organization_id_idx" ON activity_log (organization_id);
CREATE INDEX "activity_log_entity_type_entity_id_idx" ON activity_log (entity_type, entity_id);
CREATE INDEX "activity_log_action_idx" ON activity_log (action);
CREATE INDEX "activity_log_changed_by_user_id_idx" ON activity_log (changed_by_user_id);
CREATE INDEX "activity_log_created_at_idx" ON activity_log (created_at);
CREATE INDEX "activity_log_organization_id_created_at_idx" ON activity_log (organization_id, created_at);

-- asset_status_config
CREATE INDEX "asset_status_config_organization_id_idx" ON asset_status_config (organization_id);
CREATE INDEX "asset_status_config_sort_order_idx" ON asset_status_config (organization_id, sort_order);
