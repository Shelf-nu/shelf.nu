// @vitest-environment node
/**
 * Tests for the link preview policy: what `classifyHead` reads from real-shaped
 * page heads (title precedence, entities, charsets, sign-in pages and titles,
 * bot challenges, statuses, non-HTML), the refetch and retry schedule of
 * `nextFetchAfter`, and `decodeHtmlEntities`.
 *
 * @see {@link file://./policy.ts}
 */
import { parseLink } from "@shelf/links";
import { describe, expect, it } from "vitest";

import type { FetchedHead } from "./policy";
import { classifyHead, decodeHtmlEntities, nextFetchAfter } from "./policy";

type HeadFixture = {
  url: string;
  html?: string;
  body?: Uint8Array;
  status?: number;
  finalUrl?: string;
  headers?: Record<string, string>;
};

/** A fetched page head for `url`, served as UTF-8 HTML unless overridden. */
function head({
  url,
  html = "",
  body,
  status = 200,
  finalUrl = url,
  headers = { "content-type": "text/html; charset=utf-8" },
}: HeadFixture): FetchedHead {
  const link = parseLink(url);
  if (!link) throw new Error(`${url} is not one link`);
  return {
    link,
    status,
    finalUrl: new URL(finalUrl),
    headers: new Headers(headers),
    body: body ?? new TextEncoder().encode(html),
  };
}

const SHOP = "https://www.example-shop.com/c/product/1234";

describe("classifyHead: titles", () => {
  it("prefers og:title over twitter:title and <title>", () => {
    const html = `<html><head>
      <title>EOS R5 | Example Shop</title>
      <meta name="twitter:title" content="EOS R5 (twitter)">
      <meta property="og:title" content="Canon EOS R5 Mirrorless Camera">
    </head><body></body></html>`;

    expect(classifyHead(head({ url: SHOP, html }))).toEqual({
      outcome: "TITLE",
      title: "Canon EOS R5 Mirrorless Camera",
    });
  });

  it("falls back to twitter:title, then to <title>", () => {
    const withTwitter = `<head><title>Plain title</title>
      <meta content="Twitter title" name="twitter:title"></head>`;
    const withTitleOnly = `<head><title>Plain title</title></head>`;

    expect(classifyHead(head({ url: SHOP, html: withTwitter }))).toEqual({
      outcome: "TITLE",
      title: "Twitter title",
    });
    expect(classifyHead(head({ url: SHOP, html: withTitleOnly }))).toEqual({
      outcome: "TITLE",
      title: "Plain title",
    });
  });

  it("reads og:title whatever the attribute order and quoting", () => {
    const html = `<head><meta content='Torque wrench 1/2"' property=og:title></head>`;

    expect(classifyHead(head({ url: SHOP, html }))).toEqual({
      outcome: "TITLE",
      title: 'Torque wrench 1/2"',
    });
  });

  it("decodes character references in the title", () => {
    const html =
      "<head><title>Torque &amp; angle wrench &#8211; manual &#x2122;</title></head>";

    expect(classifyHead(head({ url: SHOP, html }))).toEqual({
      outcome: "TITLE",
      title: "Torque & angle wrench \u2013 manual \u2122",
    });
  });

  it("removes the Google Drive suffix from a Drive file's title", () => {
    const html =
      "<head><title>Calibration cert 2026.pdf - Google Drive</title></head>";

    expect(
      classifyHead(
        head({ url: "https://drive.google.com/file/d/1AbCdEf/view", html })
      )
    ).toEqual({ outcome: "TITLE", title: "Calibration cert 2026.pdf" });
  });

  it("is NO_TITLE when the title is empty", () => {
    const html = "<head><title>   </title></head><body>Hello</body>";

    expect(classifyHead(head({ url: SHOP, html }))).toEqual({
      outcome: "NO_TITLE",
    });
  });

  it("ignores a <title> after the head, such as one inside an SVG", () => {
    const html =
      "<head><meta charset=utf-8></head><body><svg><title>Cart icon</title></svg>";

    expect(classifyHead(head({ url: SHOP, html }))).toEqual({
      outcome: "NO_TITLE",
    });
  });

  it("reads the page as HTML when the content type is missing", () => {
    expect(
      classifyHead(
        head({
          url: SHOP,
          headers: {},
          html: "<head><title>No header</title></head>",
        })
      )
    ).toEqual({ outcome: "TITLE", title: "No header" });
  });
});

describe("classifyHead: charsets", () => {
  // "Café manual" in windows-1252: é is the single byte 0xE9.
  const cafe1252 = new Uint8Array([
    ...new TextEncoder().encode("<head><title>Caf"),
    0xe9,
    ...new TextEncoder().encode(" manual</title></head>"),
  ]);

  it("decodes with the charset from the content-type header", () => {
    expect(
      classifyHead(
        head({
          url: SHOP,
          body: cafe1252,
          headers: { "content-type": "text/html; charset=windows-1252" },
        })
      )
    ).toEqual({ outcome: "TITLE", title: "Caf\u00e9 manual" });
  });

  it("decodes with the page's meta charset when the header has none", () => {
    const body = new Uint8Array([
      ...new TextEncoder().encode('<head><meta charset="iso-8859-1">'),
      ...cafe1252.slice("<head>".length),
    ]);

    expect(
      classifyHead(
        head({ url: SHOP, body, headers: { "content-type": "text/html" } })
      )
    ).toEqual({ outcome: "TITLE", title: "Caf\u00e9 manual" });
  });

  it("falls back to UTF-8 for a charset label it does not know", () => {
    expect(
      classifyHead(
        head({
          url: SHOP,
          html: "<head><title>Caf\u00e9 manual</title></head>",
          headers: { "content-type": "text/html; charset=x-made-up" },
        })
      )
    ).toEqual({ outcome: "TITLE", title: "Caf\u00e9 manual" });
  });
});

describe("classifyHead: pages without a usable title", () => {
  it("is BLOCKED for a Cloudflare challenge flagged by its header", () => {
    expect(
      classifyHead(
        head({
          url: SHOP,
          status: 403,
          headers: {
            "content-type": "text/html",
            "cf-mitigated": "challenge",
          },
          html: "<head><title>Just a moment...</title></head>",
        })
      )
    ).toEqual({ outcome: "BLOCKED", permanent: false });
  });

  it("is BLOCKED for a 503 challenge page recognised by its script", () => {
    const html =
      '<head><title>Example Shop</title></head><body><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body>';

    expect(classifyHead(head({ url: SHOP, status: 503, html }))).toEqual({
      outcome: "BLOCKED",
      permanent: false,
    });
  });

  it("is BLOCKED for a challenge page recognised by its title", () => {
    const html = "<head><title>Just a moment...</title></head>";

    expect(classifyHead(head({ url: SHOP, status: 200, html }))).toEqual({
      outcome: "BLOCKED",
      permanent: false,
    });
  });

  it("reads the title of a page that only carries Cloudflare's script", () => {
    // Cloudflare's bot detection adds this script to ordinary pages.
    const html =
      '<head><title>Example Shop</title></head><body><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></body>';

    expect(classifyHead(head({ url: SHOP, status: 200, html }))).toEqual({
      outcome: "TITLE",
      title: "Example Shop",
    });
  });

  it("is SIGN_IN when a SharePoint link redirects to the Microsoft sign-in page", () => {
    expect(
      classifyHead(
        head({
          url: "https://contoso.sharepoint.com/:b:/s/Lab/EaBc12?e=x1",
          finalUrl:
            "https://login.microsoftonline.com/common/oauth2/authorize?client_id=00000003",
          html: "<head><title>Sign in to your account</title></head>",
        })
      )
    ).toEqual({ outcome: "SIGN_IN" });
  });

  it("is SIGN_IN when a Drive link redirects to Google's sign-in page", () => {
    expect(
      classifyHead(
        head({
          url: "https://drive.google.com/file/d/1AbCdEf/view",
          finalUrl:
            "https://accounts.google.com/ServiceLogin?service=wise&continue=https://drive.google.com/",
          html: "<head><title>Google Drive: Sign-in</title></head>",
        })
      )
    ).toEqual({ outcome: "SIGN_IN" });
  });

  it("is SIGN_IN for a Dropbox login path, and not for other Dropbox pages", () => {
    const url = "https://www.dropbox.com/scl/fi/abc/Cal%20cert.pdf?rlkey=x";

    expect(
      classifyHead(
        head({ url, finalUrl: "https://www.dropbox.com/login?cont=x" })
      )
    ).toEqual({ outcome: "SIGN_IN" });
    expect(
      classifyHead(
        head({ url, html: "<head><title>Cal cert.pdf</title></head>" })
      )
    ).toEqual({ outcome: "TITLE", title: "Cal cert.pdf" });
  });

  it.each([
    "Sign in",
    "Sign In to Example Corp",
    "Sign-in",
    "Log in",
    "LOGIN",
    "Login | Example Corp",
    "Sign on",
    "Single sign-on",
    "Access denied",
    "Example Corp - Sign In",
    "Example Corp | Login",
    "Example Corp: Sign-in",
    "Example Corp \u2013 Single Sign-On",
  ])("is SIGN_IN for a page titled %j", (title) => {
    const html = `<head><title>${title}</title></head>`;

    expect(
      classifyHead(head({ url: "https://intranet.example.org/docs/7", html }))
    ).toEqual({ outcome: "SIGN_IN" });
  });

  it.each([
    "Signing torque wrenches out of the crib",
    "How to sign in to the calibration portal",
    "Logistics handbook",
    "Access control panel manual",
  ])("reads %j as a title, not a sign-in page", (title) => {
    const html = `<head><title>${title}</title></head>`;

    expect(classifyHead(head({ url: SHOP, html }))).toEqual({
      outcome: "TITLE",
      title,
    });
  });

  it("is SIGN_IN for 401, and for 403 from a file-sharing service", () => {
    expect(classifyHead(head({ url: SHOP, status: 401 }))).toEqual({
      outcome: "SIGN_IN",
    });
    expect(
      classifyHead(
        head({
          url: "https://contoso.sharepoint.com/:w:/s/Lab/EdF34",
          status: 403,
        })
      )
    ).toEqual({ outcome: "SIGN_IN" });
  });

  it("is BLOCKED for 403 from a public site and for 429", () => {
    expect(classifyHead(head({ url: SHOP, status: 403 }))).toEqual({
      outcome: "BLOCKED",
      permanent: false,
    });
    expect(classifyHead(head({ url: SHOP, status: 429 }))).toEqual({
      outcome: "BLOCKED",
      permanent: false,
    });
  });

  it("is UNREACHABLE for now on 5xx and 408, and for good on 404", () => {
    expect(classifyHead(head({ url: SHOP, status: 503 }))).toEqual({
      outcome: "UNREACHABLE",
      permanent: false,
    });
    expect(classifyHead(head({ url: SHOP, status: 408 }))).toEqual({
      outcome: "UNREACHABLE",
      permanent: false,
    });
    expect(classifyHead(head({ url: SHOP, status: 404 }))).toEqual({
      outcome: "UNREACHABLE",
      permanent: true,
    });
  });

  it("is NO_TITLE for a PDF, without reading a body", () => {
    expect(
      classifyHead(
        head({
          url: "https://www.example-maker.com/manuals/eos-r5.pdf",
          headers: { "content-type": "application/pdf" },
          body: new Uint8Array(),
        })
      )
    ).toEqual({ outcome: "NO_TITLE" });
  });
});

describe("classifyHead: hostile pages", () => {
  const MB = 1024 * 1024;

  it.each([
    ["unclosed <meta tags", "<head>" + "<meta ".repeat(MB / 6)],
    ["unclosed <title tags", "<head>" + "<title>".repeat(MB / 7)],
    ["one huge <meta> tag", `<head><meta ${"a".repeat(MB)}>`],
    ["an unclosed quote", `<head><meta content="${"a= ".repeat(MB / 3)}>`],
  ])("reads a 1 MB head of %s in linear time", (_, html) => {
    const started = performance.now();

    expect(classifyHead(head({ url: SHOP, html }))).toEqual({
      outcome: "NO_TITLE",
    });
    // A scan that restarts at every tag takes minutes on 1 MB.
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("nextFetchAfter", () => {
  const now = new Date("2026-10-29T12:00:00.000Z");
  const transient = { outcome: "UNREACHABLE", permanent: false } as const;

  it("reads a title again 30 days later", () => {
    expect(
      nextFetchAfter(
        { outcome: "TITLE", title: "Manual" },
        0,
        now
      )?.toISOString()
    ).toBe("2026-11-28T12:00:00.000Z");
  });

  it.each([
    ["no title", { outcome: "NO_TITLE" } as const, 1],
    ["a sign-in page", { outcome: "SIGN_IN" } as const, 1],
    [
      "a permanent failure",
      { outcome: "UNREACHABLE", permanent: true } as const,
      1,
    ],
  ])("never fetches again after %s", (_, result, attempts) => {
    expect(nextFetchAfter(result, attempts, now)).toBeNull();
  });

  it.each([
    [1, "2026-10-29T13:00:00.000Z"],
    [2, "2026-10-30T12:00:00.000Z"],
    [3, "2026-11-05T12:00:00.000Z"],
  ])(
    "retries a transient failure after attempt %i at %s",
    (attempts, expected) => {
      expect(nextFetchAfter(transient, attempts, now)?.toISOString()).toBe(
        expected
      );
    }
  );

  it("gives up after the fourth transient failure", () => {
    expect(nextFetchAfter(transient, 4, now)).toBeNull();
    expect(
      nextFetchAfter({ outcome: "BLOCKED", permanent: false }, 4, now)
    ).toBeNull();
  });
});

describe("decodeHtmlEntities", () => {
  it.each([
    ["Tom &amp; Jerry", "Tom & Jerry"],
    ["&lt;b&gt;bold&lt;/b&gt;", "<b>bold</b>"],
    ["&quot;Quoted&quot; &apos;single&apos;", "\"Quoted\" 'single'"],
    ["a&nbsp;b", "a\u00a0b"],
    ["1&ndash;2 &mdash; wait&hellip;", "1\u20132 \u2014 wait\u2026"],
    ["&copy; &reg; &trade;", "\u00a9 \u00ae \u2122"],
    [
      "&laquo;x&raquo; &lsquo;y&rsquo; &ldquo;z&rdquo;",
      "\u00abx\u00bb \u2018y\u2019 \u201cz\u201d",
    ],
    ["Caf&#233; Caf&#xE9; Caf&#XE9;", "Caf\u00e9 Caf\u00e9 Caf\u00e9"],
    ["&#128295; wrench", "\u{1F527} wrench"],
    ["&#0; &#xD800; &#x110000;", "\ufffd \ufffd \ufffd"],
    ["&eacute; stays", "&eacute; stays"],
    ["&amp;lt; decodes once", "&lt; decodes once"],
    ["AT&T and a & b", "AT&T and a & b"],
  ])("decodes %j", (input, expected) => {
    expect(decodeHtmlEntities(input)).toBe(expected);
  });
});
