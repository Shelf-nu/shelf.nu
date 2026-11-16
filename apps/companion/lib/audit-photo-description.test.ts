/**
 * Tests for what the companion shows under an audit photo, fed a photo shaped
 * like the mobile evidence payload (the route test pins the same fields on the
 * server side).
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./audit-photo-description.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { AuditEvidenceImage } from "./api/types";
import { describeAuditPhotoForUser } from "./audit-photo-description";

/** Formatters that show which one was used. */
const formatter = {
  formatDate: (value: string | Date) =>
    `d(${new Date(value).toISOString().slice(0, 16)})`,
  formatDateTime: (value: string | Date) =>
    `dt(${new Date(value).toISOString().slice(0, 16)})`,
};

/** A photo as `GET /api/mobile/audits/:auditId/evidence` sends it. */
const evidence: AuditEvidenceImage = {
  id: "img-1",
  imageUrl: "https://storage.test/img-1.webp",
  thumbnailUrl: "https://storage.test/img-1-thumbnail.webp",
  description: null,
  capturedAt: "2026-10-01T06:30:00.000Z",
  captureSource: "LIBRARY",
  createdAt: "2026-10-28T10:52:00.000Z",
  authorName: null,
  authorImage: null,
};

test("flags a library photo taken weeks before its upload", () => {
  const photo = describeAuditPhotoForUser(evidence, formatter);

  assert.equal(photo.flag, "OLD_PHOTO");
  assert.equal(photo.flagLabel, "Old photo");
  assert.equal(photo.source, "LIBRARY");
  assert.match(photo.detail, /27 days before upload$/);
});

test("keeps a photo taken just before its upload quiet", () => {
  const photo = describeAuditPhotoForUser(
    { ...evidence, capturedAt: "2026-10-28T10:51:00.000Z" },
    formatter
  );

  assert.equal(photo.flag, null);
  assert.equal(
    photo.detail,
    "Photo library · file says dt(2026-10-28T10:51) · 1 min before upload"
  );
});

test("marks a new photo with no date", () => {
  const photo = describeAuditPhotoForUser(
    { ...evidence, capturedAt: null },
    formatter
  );

  assert.equal(photo.flag, "NO_DATE");
  assert.equal(photo.flagLabel, "No date");
});
