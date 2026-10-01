import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import {
  buildStampLines,
  buildStampSvg,
  CAPTURE_FRESHNESS_WINDOW_MS,
  isFreshCapture,
  stampCaptureTime,
  STAMP_SUBJECT_MAX_CHARS,
} from "./photo-stamp.server";

// @vitest-environment node

/** 14:02 on 1 October 2026 in Los Angeles (PDT, UTC-7). */
const RECEIVED_AT = new Date("2026-10-01T21:02:00.000Z");

const prefs = (
  overrides: Partial<ResolvedFormatPrefs>
): ResolvedFormatPrefs => ({
  dateFormat: "DD_MMM_YYYY",
  timeFormat: "H24",
  weekStartsOn: 1,
  timeZone: "America/Los_Angeles",
  ...overrides,
});

describe("isFreshCapture", () => {
  it("accepts a capture time within ten minutes either side of receipt", () => {
    const at = (offsetMs: number) =>
      new Date(RECEIVED_AT.getTime() + offsetMs).toISOString();

    expect(isFreshCapture(at(-30_000), RECEIVED_AT)).toBe(true);
    expect(isFreshCapture(at(-CAPTURE_FRESHNESS_WINDOW_MS), RECEIVED_AT)).toBe(
      true
    );
    expect(isFreshCapture(at(CAPTURE_FRESHNESS_WINDOW_MS), RECEIVED_AT)).toBe(
      true
    );
  });

  it("refuses a time outside the window, a missing time and garbage", () => {
    const at = (offsetMs: number) =>
      new Date(RECEIVED_AT.getTime() + offsetMs).toISOString();

    expect(
      isFreshCapture(at(-CAPTURE_FRESHNESS_WINDOW_MS - 1000), RECEIVED_AT)
    ).toBe(false);
    expect(
      isFreshCapture(at(CAPTURE_FRESHNESS_WINDOW_MS + 1000), RECEIVED_AT)
    ).toBe(false);
    expect(isFreshCapture(undefined, RECEIVED_AT)).toBe(false);
    expect(isFreshCapture(null, RECEIVED_AT)).toBe(false);
    expect(isFreshCapture("", RECEIVED_AT)).toBe(false);
    expect(isFreshCapture("now", RECEIVED_AT)).toBe(false);
  });
});

describe("buildStampLines", () => {
  const base = {
    receivedAt: RECEIVED_AT,
    assetTitle: "Libec LX-7 Tripod",
    auditName: "Q4 warehouse count",
  };

  it("writes the moment in the uploader's 24-hour format and zone", () => {
    expect(buildStampLines({ ...base, prefs: prefs({}) })).toEqual([
      "1 Oct 2026, 14:02 PDT",
      "Libec LX-7 Tripod",
    ]);
  });

  it("writes a 12-hour clock with numeric dates when the uploader prefers it", () => {
    const [line1] = buildStampLines({
      ...base,
      prefs: prefs({ dateFormat: "MM_DD_YYYY", timeFormat: "H12" }),
    });
    expect(line1).toBe("10/01/2026, 2:02 PM PDT");
  });

  it("converts to the uploader's zone and names it", () => {
    expect(
      buildStampLines({
        ...base,
        prefs: prefs({ dateFormat: "YYYY_MM_DD", timeZone: "Europe/Berlin" }),
      })[0]
    ).toBe("2026-10-01, 23:02 GMT+2");
    expect(
      buildStampLines({
        ...base,
        prefs: prefs({ dateFormat: "DD_MM_YYYY", timeZone: "UTC" }),
      })[0]
    ).toBe("01/10/2026, 21:02 UTC");
  });

  it("names the audit when the photo belongs to no asset", () => {
    expect(
      buildStampLines({ ...base, assetTitle: null, prefs: prefs({}) })[1]
    ).toBe("Audit: Q4 warehouse count");
  });

  it("cuts a long subject to 34 characters ending in an ellipsis", () => {
    const [, line2] = buildStampLines({
      ...base,
      assetTitle: "Blackmagic Design Pocket Cinema Camera 6K Pro",
      prefs: prefs({}),
    });
    expect(Array.from(line2)).toHaveLength(STAMP_SUBJECT_MAX_CHARS);
    expect(line2).toBe("Blackmagic Design Pocket Cinema C…");

    const [, auditLine] = buildStampLines({
      ...base,
      assetTitle: null,
      auditName: "Quarterly count of the east wing storage rooms",
      prefs: prefs({}),
    });
    expect(auditLine).toBe("Audit: Quarterly count of the eas…");
  });

  it("keeps a subject on one line, without control characters", () => {
    expect(
      buildStampLines({
        ...base,
        assetTitle: "Tripod\n  north   shelf",
        prefs: prefs({}),
      })[1]
    ).toBe("Tripod north shelf");

    expect(
      buildStampLines({
        ...base,
        assetTitle: "Tri\u0001pod\u007f",
        prefs: prefs({}),
      })[1]
    ).toBe("Tripod");
  });

  it("drops emoji from a subject, which the stamp font cannot draw", () => {
    expect(
      buildStampLines({
        ...base,
        assetTitle: "📷 Camera 👍🏽",
        prefs: prefs({}),
      })[1]
    ).toBe("Camera");
    expect(
      buildStampLines({
        ...base,
        assetTitle: "🇧🇬 Sofia kit",
        prefs: prefs({}),
      })[1]
    ).toBe("Sofia kit");
  });

  it("keeps names in Latin, Greek and Cyrillic, accents typed either way", () => {
    expect(
      buildStampLines({
        ...base,
        assetTitle: "Kamera Gro\u0308sse",
        prefs: prefs({}),
      })[1]
    ).toBe("Kamera Grösse");
    for (const title of ["Kamera Größe", "Κάμερα", "Камера Сони", "Łódź €12"]) {
      expect(
        buildStampLines({ ...base, assetTitle: title, prefs: prefs({}) })[1]
      ).toBe(title);
    }
  });

  it("leaves off a name the stamp font cannot draw instead of printing boxes", () => {
    expect(
      buildStampLines({
        ...base,
        assetTitle: "三脚架 Tripod",
        prefs: prefs({}),
      })
    ).toEqual(["1 Oct 2026, 14:02 PDT"]);
    // A sign in a block the font covers only partly.
    expect(
      buildStampLines({ ...base, assetTitle: "Wallet ₿", prefs: prefs({}) })
    ).toEqual(["1 Oct 2026, 14:02 PDT"]);
    expect(
      buildStampLines({
        ...base,
        assetTitle: null,
        auditName: "جرد المستودع",
        prefs: prefs({}),
      })
    ).toEqual(["1 Oct 2026, 14:02 PDT"]);
  });
});

describe("buildStampSvg", () => {
  const lines = ["1 Oct 2026, 14:02 PDT", "Libec LX-7 Tripod"] as const;

  it("draws both lines in DejaVu Sans Mono at 2.5% of the width, line 2 at 0.8x", () => {
    const svg = buildStampSvg({ lines, imageWidth: 1200, imageHeight: 900 });

    expect(svg).toContain(">1 Oct 2026, 14:02 PDT</text>");
    expect(svg).toContain(">Libec LX-7 Tripod</text>");
    expect(
      svg.match(/font-family="DejaVu Sans Mono, monospace"/g)
    ).toHaveLength(2);
    expect(svg).toContain('font-size="30" fill="white">');
    expect(svg).toContain('font-size="24" fill="white" fill-opacity="0.9">');
    expect(svg).toContain('fill="black" fill-opacity="0.6"');
  });

  it("sizes the band like the approved mock and keeps the same font on portrait", () => {
    const landscape = buildStampSvg({
      lines,
      imageWidth: 1200,
      imageHeight: 900,
    });
    // 21 chars x 30 px x 0.62 + 2 x 30 padding = 451; 15 + 30 + 9 + 24 + 15 = 93.
    // Margin is 2% of the shorter side: 18 px.
    expect(landscape).toContain('width="469" height="111"');
    expect(landscape).toContain('<rect width="451" height="93" rx="11"');

    const portrait = buildStampSvg({
      lines,
      imageWidth: 1200,
      imageHeight: 1600,
    });
    expect(portrait).toContain('font-size="30" fill="white">');
    expect(portrait).toContain('<rect width="451" height="93"');
    expect(portrait).toContain('width="475" height="117"');
  });

  it("draws a one-line band when there is no second line", () => {
    const svg = buildStampSvg({
      lines: ["1 Oct 2026, 14:02 PDT"],
      imageWidth: 1200,
      imageHeight: 900,
    });
    expect(svg.match(/<text /g)).toHaveLength(1);
    // 15 + 30 + 15 = 60 px tall; 21 chars x 30 px x 0.62 + 60 = 451 px wide.
    expect(svg).toContain('<rect width="451" height="60"');
  });

  it("never draws line 1 smaller than 24 px on a narrow image", () => {
    const svg = buildStampSvg({ lines, imageWidth: 600, imageHeight: 800 });
    expect(svg).toContain('font-size="24" fill="white">');
    expect(svg).toContain('font-size="19" fill="white" fill-opacity="0.9">');
  });

  it("shrinks the font only when the band would not fit the image", () => {
    const svg = buildStampSvg({ lines, imageWidth: 300, imageHeight: 200 });
    const width = Number(svg.match(/<svg[^>]* width="(\d+)"/)?.[1]);
    const height = Number(svg.match(/<svg[^>]* height="(\d+)"/)?.[1]);
    expect(width).toBeLessThanOrEqual(300);
    expect(height).toBeLessThanOrEqual(200);
  });

  it("escapes markup in a title so it stays text", () => {
    const svg = buildStampSvg({
      lines: ["1 Oct 2026, 14:02 PDT", `Tom & Jerry's <Cam> "A"`],
      imageWidth: 1200,
      imageHeight: 900,
    });
    expect(svg).toContain(
      ">Tom &amp; Jerry&apos;s &lt;Cam&gt; &quot;A&quot;</text>"
    );
    expect(svg).not.toContain("<Cam>");
  });
});

describe("stampCaptureTime", () => {
  const GREY = 180;

  /** A plain grey JPEG of the given size. */
  const greyJpeg = (width: number, height: number) =>
    sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: GREY, g: GREY, b: GREY },
      },
    })
      .jpeg()
      .toBuffer();

  /** Average of the red channel over a square of `size` px at (x, y). */
  async function sampleRed(image: Buffer, x: number, y: number, size = 6) {
    const { data, info } = await sharp(image)
      .extract({ left: x, top: y, width: size, height: size })
      .raw()
      .toBuffer({ resolveWithObject: true });
    let sum = 0;
    for (let i = 0; i < data.length; i += info.channels) sum += data[i];
    return sum / (data.length / info.channels);
  }

  it("keeps the dimensions, darkens the bottom-right band and leaves the rest", async () => {
    const input = await greyJpeg(1200, 900);
    const lines = ["1 Oct 2026, 14:02 PDT", "Libec LX-7 Tripod"];

    const output = await stampCaptureTime(input, lines);
    const meta = await sharp(output).metadata();

    expect(meta.format).toBe("webp");
    expect([meta.width, meta.height]).toEqual([1200, 900]);

    // The band is 451 x 93 and ends 18 px from the right and bottom edges.
    // Sample its right padding, where no glyph is drawn: 60% black over grey.
    const bandRight = 1200 - 18;
    const bandBottom = 900 - 18;
    expect(
      await sampleRed(output, bandRight - 20, bandBottom - 50)
    ).toBeLessThan(GREY * 0.5);

    // Away from the band the photo is untouched (lossy WebP: within 3 levels).
    expect(
      Math.abs((await sampleRed(output, 0, 0, 20)) - GREY)
    ).toBeLessThanOrEqual(3);
    expect(
      Math.abs((await sampleRed(output, 1200 - 20, 0, 20)) - GREY)
    ).toBeLessThanOrEqual(3);
  });

  it("stamps a portrait photo without changing its shape", async () => {
    const output = await stampCaptureTime(await greyJpeg(1200, 1600), [
      "1 Oct 2026, 14:02 PDT",
      "Audit: Q4 warehouse count",
    ]);
    const meta = await sharp(output).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 1600]);
  });
});
