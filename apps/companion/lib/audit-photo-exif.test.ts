/**
 * Tests for reading an audit photo's capture date from the image picker.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./audit-photo-exif.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendAuditImageUpload,
  appendPhotoCapture,
  captureTagsFromPickerExif,
  photoCaptureFromPicker,
} from "./audit-photo-exif";

test("reads Android's flat EXIF tags", () => {
  assert.deepEqual(
    captureTagsFromPickerExif({
      DateTimeOriginal: "2026:10:21 09:15:00",
      OffsetTimeOriginal: "+02:00",
      Make: "Google",
    }),
    { dateTimeOriginal: "2026:10:21 09:15:00", offsetTimeOriginal: "+02:00" }
  );
});

test("reads iOS's nested {Exif} dictionary", () => {
  assert.deepEqual(
    captureTagsFromPickerExif({
      "{Exif}": {
        DateTimeOriginal: "2026:10:21 09:15:00",
        OffsetTimeOriginal: "-07:00",
      },
      "{TIFF}": { Make: "Apple" },
    }),
    { dateTimeOriginal: "2026:10:21 09:15:00", offsetTimeOriginal: "-07:00" }
  );
});

test("keeps a date with no offset, for the server to read in the uploader's zone", () => {
  assert.deepEqual(
    captureTagsFromPickerExif({ DateTimeOriginal: "2026:10:21 09:15:00" }),
    { dateTimeOriginal: "2026:10:21 09:15:00", offsetTimeOriginal: null }
  );
});

test("returns null when the photo has no capture date", () => {
  assert.equal(captureTagsFromPickerExif(null), null);
  assert.equal(captureTagsFromPickerExif(undefined), null);
  assert.equal(captureTagsFromPickerExif({ Make: "Apple" }), null);
  assert.equal(captureTagsFromPickerExif({ DateTimeOriginal: "  " }), null);
  assert.equal(captureTagsFromPickerExif({ DateTimeOriginal: 42 }), null);
});

/** Collects what an upload's form fields would carry. */
function fieldsOf(capture: Parameters<typeof appendPhotoCapture>[1]) {
  const fields: [string, string][] = [];
  appendPhotoCapture(
    {
      append: (name: string, value: string | Blob) =>
        void fields.push([name, String(value)]),
    },
    capture
  );
  return fields;
}

test("a camera photo is sent as CAMERA with its date, offset and device zone", () => {
  assert.deepEqual(
    fieldsOf(
      photoCaptureFromPicker(
        true,
        {
          DateTimeOriginal: "2026:10:21 09:15:00",
          OffsetTimeOriginal: "+02:00",
        },
        "Europe/Amsterdam"
      )
    ),
    [
      ["captureSource", "CAMERA"],
      ["deviceTimeZone", "Europe/Amsterdam"],
      ["exifDateTimeOriginal", "2026:10:21 09:15:00"],
      ["exifOffsetTimeOriginal", "+02:00"],
    ]
  );
});

test("a library photo is sent as LIBRARY, with only the fields it has", () => {
  assert.deepEqual(
    fieldsOf(
      photoCaptureFromPicker(
        false,
        { DateTimeOriginal: "2026:10:21 09:15:00" },
        "America/New_York"
      )
    ),
    [
      ["captureSource", "LIBRARY"],
      ["deviceTimeZone", "America/New_York"],
      ["exifDateTimeOriginal", "2026:10:21 09:15:00"],
    ]
  );
  // The zone still travels without a picker date: the file may carry one.
  assert.deepEqual(fieldsOf(photoCaptureFromPicker(false, null, "UTC")), [
    ["captureSource", "LIBRARY"],
    ["deviceTimeZone", "UTC"],
  ]);
  assert.deepEqual(fieldsOf(photoCaptureFromPicker(false, null, null)), [
    ["captureSource", "LIBRARY"],
  ]);
  assert.deepEqual(fieldsOf(null), []);
});

test("a HEIC photo converted to JPEG still sends its date", () => {
  // why: the conversion re-encodes the file and drops its EXIF, so the date
  // the server stores has to come from the picker result read before it.
  const pickerResult = {
    uri: "file:///photo.heic",
    exif: { "{Exif}": { DateTimeOriginal: "2026:10:21 09:15:00" } },
  };
  const convertedFile = { uri: "file:///photo.jpg", exif: null };

  assert.equal(captureTagsFromPickerExif(convertedFile.exif), null);
  assert.deepEqual(
    fieldsOf(photoCaptureFromPicker(false, pickerResult.exif, null)),
    [
      ["captureSource", "LIBRARY"],
      ["exifDateTimeOriginal", "2026:10:21 09:15:00"],
    ]
  );
});

test("the upload body carries the file, the caption and how and when it was taken", () => {
  // why: this is the body `auditsApi.uploadImage` sends; the server reads
  // these field names, so a rename here would silently drop every date.
  const names: string[] = [];
  const values = new Map<string, unknown>();
  appendAuditImageUpload(
    {
      append: (name: string, value: string | Blob) => {
        names.push(name);
        values.set(name, value);
      },
    },
    {
      imageUri: "file:///photo.jpg",
      mimeType: "image/jpeg",
      content: "Scratch on the lid",
      capture: photoCaptureFromPicker(
        true,
        {
          DateTimeOriginal: "2026:10:21 09:15:00",
          OffsetTimeOriginal: "+02:00",
        },
        "Europe/Amsterdam"
      ),
    }
  );

  assert.deepEqual(names, [
    "image",
    "content",
    "captureSource",
    "deviceTimeZone",
    "exifDateTimeOriginal",
    "exifOffsetTimeOriginal",
  ]);
  assert.deepEqual(values.get("image"), {
    uri: "file:///photo.jpg",
    type: "image/jpeg",
    name: "audit-photo.jpg",
  });
  assert.equal(values.get("captureSource"), "CAMERA");
  assert.equal(values.get("exifDateTimeOriginal"), "2026:10:21 09:15:00");
});
