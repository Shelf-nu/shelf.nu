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

test("a camera photo is sent as CAMERA with its date and offset", () => {
  assert.deepEqual(
    fieldsOf(
      photoCaptureFromPicker(true, {
        DateTimeOriginal: "2026:10:21 09:15:00",
        OffsetTimeOriginal: "+02:00",
      })
    ),
    [
      ["captureSource", "CAMERA"],
      ["exifDateTimeOriginal", "2026:10:21 09:15:00"],
      ["exifOffsetTimeOriginal", "+02:00"],
    ]
  );
});

test("a library photo is sent as LIBRARY, with only the fields it has", () => {
  assert.deepEqual(
    fieldsOf(
      photoCaptureFromPicker(false, { DateTimeOriginal: "2026:10:21 09:15:00" })
    ),
    [
      ["captureSource", "LIBRARY"],
      ["exifDateTimeOriginal", "2026:10:21 09:15:00"],
    ]
  );
  assert.deepEqual(fieldsOf(photoCaptureFromPicker(false, null)), [
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
  assert.deepEqual(fieldsOf(photoCaptureFromPicker(false, pickerResult.exif)), [
    ["captureSource", "LIBRARY"],
    ["exifDateTimeOriginal", "2026:10:21 09:15:00"],
  ]);
});
