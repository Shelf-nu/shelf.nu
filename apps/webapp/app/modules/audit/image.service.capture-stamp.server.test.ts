/**
 * `uploadAuditImage` and the capture stamp, end to end through the real
 * multipart parser, the real resize and the real stamp.
 *
 * Only the edges are replaced: storage (to capture the bytes that would be
 * stored) and the database rows the upload reads and writes. The assertion
 * that matters most is the negative one: an upload that is not a fresh camera
 * capture must store exactly the bytes it stored before the stamp existed.
 */
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cropImage } from "~/utils/crop-image";
import { uploadAuditImage } from "./image.service.server";

// @vitest-environment node

// why: storage is an external service; capture what would be uploaded so the
// test can compare the stored bytes with the path that existed before stamps
const uploads = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("~/integrations/supabase/client", () => ({
  getSupabaseAdmin: () => ({
    storage: {
      from: () => ({
        upload: (path: string, file: Buffer) => {
          uploads.set(path, Buffer.from(file));
          return Promise.resolve({ data: { path }, error: null });
        },
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://storage.test/${path}` },
        }),
      }),
    },
  }),
}));

// why: the database is external; these are the rows the upload reads (image
// count, audit name, asset title, uploader preferences) and the one it writes
const dbMock = vi.hoisted(() => ({
  auditImage: { count: vi.fn(), create: vi.fn() },
  auditSession: { findFirst: vi.fn() },
  auditAsset: { findFirst: vi.fn() },
  user: { findFirst: vi.fn() },
}));
vi.mock("~/database/db.server", () => ({ db: dbMock }));

// why: a stamp that cannot be built must be reported, not swallowed silently;
// the logger forwards to Sentry, which a test must not reach
const loggerMock = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("~/utils/logger", () => ({ Logger: loggerMock }));

/** 14:02 on 1 October 2026 in Los Angeles. */
const NOW = new Date("2026-10-01T21:02:00.000Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

let photo: Buffer;

/** A multipart upload of `photo`, as the clients send it. */
function photoRequest() {
  const form = new FormData();
  form.append(
    "image",
    new File([new Uint8Array(photo)], "photo.jpg", { type: "image/jpeg" })
  );
  return new Request("http://localhost/upload", { method: "POST", body: form });
}

/** What the upload stored as the main image (not the thumbnail). */
function storedMainImage() {
  const entry = [...uploads].find(([path]) => !path.includes("-thumbnail"));
  if (!entry) throw new Error("no main image was stored");
  return entry[1];
}

/** The main image as the upload path produced it before stamps existed. */
async function unstampedMainImage() {
  return cropImage(
    (async function* () {
      await Promise.resolve();
      yield new Uint8Array(photo);
    })(),
    { width: 1200, withoutEnlargement: true }
  );
}

/** Average red level of a square at (x, y). */
async function sampleRed(image: Buffer, x: number, y: number, size = 6) {
  const { data, info } = await sharp(image)
    .extract({ left: x, top: y, width: size, height: size })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (let i = 0; i < data.length; i += info.channels) sum += data[i];
  return sum / (data.length / info.channels);
}

function upload(capturedAt?: string | null) {
  return uploadAuditImage({
    request: photoRequest(),
    auditSessionId: "audit-1",
    organizationId: "org-1",
    uploadedById: "user-1",
    auditAssetId: "audit-asset-1",
    capturedAt,
  });
}

describe("uploadAuditImage capture stamp", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    uploads.clear();
    // why: the freshness window compares against the server's clock; only
    // Date is faked so sharp and the parser keep their real timers
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });

    photo = await sharp({
      create: {
        width: 2400,
        height: 1800,
        channels: 3,
        background: { r: 200, g: 200, b: 200 },
      },
    })
      .jpeg()
      .toBuffer();

    dbMock.auditImage.count.mockResolvedValue(0);
    dbMock.auditImage.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: "image-1", ...data })
    );
    dbMock.auditSession.findFirst.mockResolvedValue({
      name: "Q4 warehouse count",
    });
    dbMock.auditAsset.findFirst.mockResolvedValue({
      asset: { title: "Libec LX-7 Tripod" },
    });
    dbMock.user.findFirst.mockResolvedValue({
      dateFormat: "DD_MMM_YYYY",
      timeFormat: "H24",
      weekStart: "MONDAY",
      timeZone: "America/Los_Angeles",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stamps a photo whose capture time is within ten minutes", async () => {
    await upload(minutes(-1).toISOString());

    const stored = storedMainImage();
    const { width, height } = await sharp(stored).metadata();
    expect([width, height]).toEqual([1200, 900]);
    expect(stored.equals(await unstampedMainImage())).toBe(false);

    // Inside the band's right padding (no glyphs): 60% black over grey 200.
    expect(await sampleRed(stored, 1200 - 18 - 20, 900 - 18 - 50)).toBeLessThan(
      110
    );
    // The opposite corner is untouched.
    expect(Math.abs((await sampleRed(stored, 0, 0, 20)) - 200)).toBeLessThan(4);

    // The thumbnail is cut from the stamped image, so it is stored too.
    expect([...uploads.keys()].some((p) => p.includes("-thumbnail"))).toBe(
      true
    );
  });

  it("reads the asset title and audit inside the uploader's organization", async () => {
    await upload(minutes(-1).toISOString());

    expect(dbMock.auditSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "audit-1", organizationId: "org-1" },
      })
    );
    expect(dbMock.auditAsset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "audit-asset-1",
          auditSessionId: "audit-1",
          auditSession: { organizationId: "org-1" },
        },
      })
    );
    expect(dbMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-1" } })
    );
  });

  it.each([
    ["absent", undefined],
    ["null", null],
    ["stale, eleven minutes old", minutes(-11).toISOString()],
    ["in the future beyond ten minutes", minutes(11).toISOString()],
    ["not a time", "yesterday-ish"],
  ])(
    "stores exactly today's bytes when capturedAt is %s",
    async (_label, capturedAt) => {
      await upload(capturedAt);

      expect(storedMainImage().equals(await unstampedMainImage())).toBe(true);
      expect(dbMock.auditSession.findFirst).not.toHaveBeenCalled();
    }
  );

  it("stores the photo unstamped and reports it when the stamp cannot be built", async () => {
    dbMock.auditSession.findFirst.mockResolvedValue(null);

    const image = await upload(minutes(-1).toISOString());

    expect(image).toEqual(expect.objectContaining({ id: "image-1" }));
    expect(storedMainImage().equals(await unstampedMainImage())).toBe(true);
    expect(loggerMock.error).toHaveBeenCalledTimes(1);
  });
});
