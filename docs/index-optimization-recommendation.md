# Database Index Optimization Recommendations

## Context

Following the schema review requested by Carlos Virreira, we audited the Shelf.nu codebase to identify high-impact database indexes that are currently missing. The analysis focused on frequently executed queries, their filtering/sorting patterns, and the presence (or absence) of supporting indexes. This document packages the findings as a recommendation brief for CTO review.

## Executive Summary

- **Seven critical access patterns** (scans, bookings, team members, categories/tags/locations, kits, QR listings, and user administration) repeatedly fall back to sequential scans because supporting composite indexes are absent.
- **Adding targeted composite B-tree indexes** will reduce query latency, prevent table scans, and limit locking contention as the dataset grows.
- **No destructive schema changes are required**; each recommendation introduces additive indexes that can be created concurrently in production.

## Recommended Actions

1. **Scan lookups** – Create `index_scans_raw_qr_created_at` on `(rawQrId, createdAt)` to support latest-entry lookups by `rawQrId`.
2. **Booking listings** – Add composite indexes covering `(organizationId, status)`, `(organizationId, from, to)`, and `(organizationId, updatedAt)` to align with listing filters and sorts.
3. **Team member queries** – Introduce `(organizationId, deletedAt, createdAt)` and `(organizationId, updatedAt)` indexes for admin lists and command palette searches.
4. **Category, tag, and location lists** – Add `(organizationId, updatedAt)` indexes to accelerate organization-scoped lists sorted by recency.
5. **Kit views** – Create organization/time composites `(organizationId, createdAt)` and `(organizationId, updatedAt)` for dashboards and palette lookups.
6. **QR listings** – Add `(createdAt)` (or `(organizationId, createdAt)` if multi-tenant scope is required) to support chronological pagination.
7. **User administration** – Add `(tierId, createdAt)` (or at minimum `(createdAt)`) to match admin panel sorting and tier filters.

## Prioritization Matrix

| Recommendation | Impact on Latency | Performance Gain | Ease of Integration | Merge Risk | Rationale |
| --- | --- | --- | --- | --- | --- |
| Scans `(rawQrId, createdAt)` | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | Directly eliminates full-table scans on high-volume `Scan` reads used in real-time workflows. |
| Bookings composites | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐ | Aligns with critical scheduling views; composite indexes require careful naming but are straightforward additions. |
| Team members composites | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | Targets frequently used admin list and search features; low migration complexity. |
| Categories/Tags/Locations `(organizationId, updatedAt)` | ⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ | Lightweight composites on medium-traffic tables; easy to create concurrently. |
| Kits `(organizationId, createdAt/updatedAt)` | ⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐ | Supports dashboard and command palette; moderate impact with low risk. |
| QR listings `(createdAt)` | ⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | ⭐ | Single-column index, minimal risk, supports pagination workloads. |
| Users `(tierId, createdAt)` | ⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐⭐ | Ensures admin views remain performant as user base grows; requires one composite index.

_Impact/Performance scale_: ⭐ to ⭐⭐⭐⭐ (higher is better) — qualitative estimation based on query frequency and current scan cost.

## Outstanding Questions for CTO

1. **Growth projections** – Are scans and bookings expected to continue scaling at current rates, or should we prioritize indexes for anticipated feature launches?
2. **Tenant isolation** – Should all high-traffic tables favor organization-scoped composites (`organizationId, createdAt`) to prepare for potential sharding/partitioning initiatives?
3. **Migration windows** – Do we have preferred deployment windows for creating concurrent indexes to minimize lock contention during rollout?
4. **Monitoring** – Is there appetite to add telemetry (e.g., `pg_stat_statements`, APM dashboards) to validate performance gains post-deployment?

## Next Steps

- Confirm prioritization with the CTO and product stakeholders.
- Schedule concurrent index creation migrations for the top-priority items (Scans and Bookings).
- Update onboarding and operational runbooks to reflect new indexes and monitoring expectations.

---
Prepared by Chocoloco, AI software engineering agent.
