-- Sub-phase 3c: add new ConsumptionCategory values for quantity-aware check-in.
--
-- CONSUME: units used as intended (ONE_WAY consumables — AA batteries,
--          latex gloves, etc.). Semantically distinct from RETURN/LOSS
--          because it's the "happy path" for one-way items.
--
-- DAMAGE:  units returned but unusable. Kept distinct from LOSS so that
--          future loss-vs-damage dashboards can tell the difference:
--          LOSS = never came back; DAMAGE = came back but unusable.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction, and Prisma
-- wraps each migration.sql in a transaction by default. We split into
-- separate statements; Postgres executes each ALTER TYPE independently.

ALTER TYPE "ConsumptionCategory" ADD VALUE 'CONSUME';
ALTER TYPE "ConsumptionCategory" ADD VALUE 'DAMAGE';
