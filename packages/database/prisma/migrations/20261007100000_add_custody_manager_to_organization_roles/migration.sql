-- Adds the Custody Manager organization role. Alone in its file: Postgres
-- cannot use a newly added enum value inside the transaction that adds it.
ALTER TYPE "OrganizationRoles" ADD VALUE 'CUSTODY_MANAGER';
