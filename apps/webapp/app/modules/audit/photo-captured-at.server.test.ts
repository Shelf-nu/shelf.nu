/**
 * Tests for reading when an audit photo was taken.
 *
 * The photos are real JPEG bytes with real EXIF blocks, built by sharp, so the
 * whole read (sharp metadata, exif-reader, date rules) runs as in production.
 *
 * @see {@link file://./photo-captured-at.server.ts}
 */
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  captureTagsFromFormData,
  captureTimeFromTags,
  readExifCaptureTags,
  resolveCapturedAt,
} from "./photo-captured-at.server";

/** A tiny JPEG carrying the given EXIF (IFD2 is the Exif sub-directory). */
async function jpegWithExif(exif?: Record<string, string>) {
  const image = sharp({
    create: { width: 8, height: 8, channels: 3, background: "red" },
  }).jpeg();
  return (exif ? image.withExif({ IFD2: exif }) : image).toBuffer();
}

const NOW = new Date("2026-10-28T12:00:00.000Z");

describe("readExifCaptureTags", () => {
  it("reads the date and offset a phone camera writes", async () => {
    const photo = await jpegWithExif({
      DateTimeOriginal: "2026:10:21 09:15:00",
      OffsetTimeOriginal: "+02:00",
    });

    expect(await readExifCaptureTags(photo)).toEqual({
      dateTimeOriginal: "2026:10:21 09:15:00",
      offsetTimeOriginal: "+02:00",
    });
  });

  it("reads a date with no offset", async () => {
    const photo = await jpegWithExif({
      DateTimeOriginal: "2026:10:21 09:15:00",
    });

    expect(await readExifCaptureTags(photo)).toEqual({
      dateTimeOriginal: "2026:10:21 09:15:00",
      offsetTimeOriginal: null,
    });
  });

  it("returns null for a photo with no EXIF", async () => {
    expect(await readExifCaptureTags(await jpegWithExif())).toBeNull();
  });

  it("returns null, without throwing, for a file that is not an image", async () => {
    expect(
      await readExifCaptureTags(Buffer.from("definitely not an image"))
    ).toBeNull();
  });

  it("returns null for a date EXIF cannot parse", async () => {
    const photo = await jpegWithExif({ DateTimeOriginal: "not a date" });

    expect(await readExifCaptureTags(photo)).toBeNull();
  });
});

describe("captureTimeFromTags", () => {
  it("uses the offset the camera wrote", () => {
    expect(
      captureTimeFromTags(
        {
          dateTimeOriginal: "2026:10:21 09:15:00",
          offsetTimeOriginal: "+02:00",
        },
        "America/New_York",
        NOW
      )?.toISOString()
    ).toBe("2026-10-21T07:15:00.000Z");
  });

  it("reads a date with no offset in the uploader's time zone", () => {
    // why: 09:15 in New York in October is EDT, UTC-4
    expect(
      captureTimeFromTags(
        { dateTimeOriginal: "2026:10:21 09:15:00", offsetTimeOriginal: null },
        "America/New_York",
        NOW
      )?.toISOString()
    ).toBe("2026-10-21T13:15:00.000Z");
  });

  it.each([
    ["missing", null],
    ["garbage", "yesterday afternoon"],
    ["an unset camera clock", "0000:00:00 00:00:00"],
    ["an impossible day", "2026:02:30 10:00:00"],
  ])("returns null for a date that is %s", (_label, dateTimeOriginal) => {
    expect(
      captureTimeFromTags(
        { dateTimeOriginal, offsetTimeOriginal: null },
        "UTC",
        NOW
      )
    ).toBeNull();
  });

  it("returns null for a date after the upload (a wrong camera clock)", () => {
    expect(
      captureTimeFromTags(
        { dateTimeOriginal: "2027:01:01 10:00:00", offsetTimeOriginal: null },
        "UTC",
        NOW
      )
    ).toBeNull();
  });

  it("returns null for a zone the date library cannot read", () => {
    expect(
      captureTimeFromTags(
        { dateTimeOriginal: "2026:10:21 09:15:00", offsetTimeOriginal: null },
        "Not/AZone",
        NOW
      )
    ).toBeNull();
  });
});

describe("captureTagsFromFormData", () => {
  it("reads the fields the phone app sends", () => {
    const form = new FormData();
    form.append("exifDateTimeOriginal", "2026:10:21 09:15:00");
    form.append("exifOffsetTimeOriginal", "+02:00");

    expect(captureTagsFromFormData(form)).toEqual({
      dateTimeOriginal: "2026:10:21 09:15:00",
      offsetTimeOriginal: "+02:00",
    });
  });

  it("returns null when no date was sent", () => {
    expect(captureTagsFromFormData(new FormData())).toBeNull();
  });
});

describe("resolveCapturedAt", () => {
  const fromPhone = {
    dateTimeOriginal: "2026:10:20 08:00:00",
    offsetTimeOriginal: "+00:00",
  };

  it("prefers the file's own EXIF over the phone app's fields", async () => {
    const capturedAt = await resolveCapturedAt({
      fileTags: {
        dateTimeOriginal: "2026:10:21 09:15:00",
        offsetTimeOriginal: "+00:00",
      },
      formTags: fromPhone,
      getTimeZone: () => Promise.resolve("UTC"),
      now: NOW,
    });

    expect(capturedAt?.toISOString()).toBe("2026-10-21T09:15:00.000Z");
  });

  it("falls back to the phone app's fields when the file has no date", async () => {
    const capturedAt = await resolveCapturedAt({
      fileTags: null,
      formTags: fromPhone,
      getTimeZone: () => Promise.resolve("UTC"),
      now: NOW,
    });

    expect(capturedAt?.toISOString()).toBe("2026-10-20T08:00:00.000Z");
  });

  it("only looks up the uploader's zone when the date has no offset", async () => {
    let lookups = 0;
    await resolveCapturedAt({
      fileTags: null,
      formTags: fromPhone,
      getTimeZone: () => {
        lookups += 1;
        return Promise.resolve("UTC");
      },
      now: NOW,
    });

    expect(lookups).toBe(0);
  });

  it("returns null, without throwing, when the zone lookup fails", async () => {
    const capturedAt = await resolveCapturedAt({
      fileTags: {
        dateTimeOriginal: "2026:10:21 09:15:00",
        offsetTimeOriginal: null,
      },
      formTags: null,
      getTimeZone: () => Promise.reject(new Error("database down")),
      now: NOW,
    });

    expect(capturedAt).toBeNull();
  });

  it("returns null when neither source has a date", async () => {
    expect(
      await resolveCapturedAt({
        fileTags: null,
        formTags: null,
        getTimeZone: () => Promise.resolve("UTC"),
        now: NOW,
      })
    ).toBeNull();
  });
});
