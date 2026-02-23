import { z } from "zod";
import type { FailureReason } from "./error";
import { ShelfError } from "./error";
import {
  isGet,
  getCurrentPath,
  getRedirectTo,
  getRefererPath,
  makeRedirectToFromHere,
  isPost,
  safeRedirect,
  payload,
  error,
  getParams,
  parseData,
  buildContentDisposition,
} from "./http.server";
import { Logger } from "./logger";
import { assertIsDataWithResponseInit } from "../../test/helpers/assertions";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

vitest.mock("./logger", () => ({
  Logger: {
    error: vitest.fn(),
  },
}));

const BASE_URL = "https://my-app.com";

describe(getCurrentPath.name, () => {
  it("should return current request url path", () => {
    expect(getCurrentPath(new Request(`${BASE_URL}/profile`))).toBe("/profile");
  });
});

describe(makeRedirectToFromHere.name, () => {
  it("should return search params with redirectTo set with current request url path", () => {
    expect(makeRedirectToFromHere(new Request(`${BASE_URL}/profile`))).toEqual(
      new URLSearchParams([["redirectTo", "/profile"]])
    );
  });
});

describe(getRedirectTo.name, () => {
  it("should return default redirectTo value", () => {
    expect(getRedirectTo(new Request(BASE_URL))).toBe("/");
  });

  it("should return url redirectTo param value", () => {
    expect(getRedirectTo(new Request(`${BASE_URL}?redirectTo=/profile`))).toBe(
      "/profile"
    );
  });

  it("should return root redirectTo param value if invalid param value", () => {
    expect(getRedirectTo(new Request(`${BASE_URL}?redirectTo=//profile`))).toBe(
      "/"
    );
  });
});

describe(getRefererPath.name, () => {
  it("should return null if no referer header", () => {
    const request = new Request(BASE_URL);
    expect(getRefererPath(request)).toBe(null);
  });

  it("should return pathname from referer header", () => {
    const request = new Request(BASE_URL, {
      headers: { referer: `${BASE_URL}/assets` },
    });
    expect(getRefererPath(request)).toBe("/assets");
  });

  it("should return pathname with query params from referer", () => {
    const request = new Request(BASE_URL, {
      headers: { referer: `${BASE_URL}/assets?search=test&status=AVAILABLE` },
    });
    expect(getRefererPath(request)).toBe(
      "/assets?search=test&status=AVAILABLE"
    );
  });

  it("should return pathname with hash from referer", () => {
    const request = new Request(BASE_URL, {
      headers: { referer: `${BASE_URL}/assets#section` },
    });
    expect(getRefererPath(request)).toBe("/assets");
  });

  it("should return null for invalid referer URL", () => {
    const request = new Request(BASE_URL, {
      headers: { referer: "not-a-valid-url" },
    });
    expect(getRefererPath(request)).toBe(null);
  });

  it("should handle referer from different domain", () => {
    const request = new Request(BASE_URL, {
      headers: { referer: "https://other-domain.com/some-page" },
    });
    expect(getRefererPath(request)).toBe("/some-page");
  });

  it("should return root path for root referer", () => {
    const request = new Request(BASE_URL, {
      headers: { referer: BASE_URL },
    });
    expect(getRefererPath(request)).toBe("/");
  });

  it("should handle nested paths", () => {
    const request = new Request(BASE_URL, {
      headers: { referer: `${BASE_URL}/assets/123/edit` },
    });
    expect(getRefererPath(request)).toBe("/assets/123/edit");
  });
});

describe(isGet.name, () => {
  it("should return false for POST / PUT / PATCH / DELETE methods", () => {
    expect(isGet(new Request(BASE_URL, { method: "POST" }))).toBeFalsy();
    expect(isGet(new Request(BASE_URL, { method: "PUT" }))).toBeFalsy();
    expect(isGet(new Request(BASE_URL, { method: "PATCH" }))).toBeFalsy();
    expect(isGet(new Request(BASE_URL, { method: "DELETE" }))).toBeFalsy();
  });

  it("should return true for GET method", () => {
    expect(isGet(new Request(BASE_URL, { method: "GET" }))).toBeTruthy();
  });
});

describe(isPost.name, () => {
  it("should return false for GET / PUT / PATCH / DELETE methods", () => {
    expect(isPost(new Request(BASE_URL, { method: "GET" }))).toBeFalsy();
    expect(isPost(new Request(BASE_URL, { method: "PUT" }))).toBeFalsy();
    expect(isPost(new Request(BASE_URL, { method: "PATCH" }))).toBeFalsy();
    expect(isPost(new Request(BASE_URL, { method: "DELETE" }))).toBeFalsy();
  });

  it("should return true for POST method", () => {
    expect(isPost(new Request(BASE_URL, { method: "POST" }))).toBeTruthy();
  });
});

describe(safeRedirect.name, () => {
  it("should return root path if invalid destination", () => {
    expect(safeRedirect(null)).toBe("/");
    expect(safeRedirect(undefined)).toBe("/");
    // @ts-expect-error js wrong type
    expect(safeRedirect(false)).toBe("/");
    expect(safeRedirect("")).toBe("/");
    expect(safeRedirect("my-url")).toBe("/");
    expect(safeRedirect("//")).toBe("/");
    expect(safeRedirect("//my-url")).toBe("/");
  });

  it("should return destination path", () => {
    expect(safeRedirect("/items")).toBe("/items");
  });
});

describe(payload.name, () => {
  it("should return data with error set to null", () => {
    const responseData = { name: "John" };
    const result = payload(responseData);

    expect(result).toEqual({
      ...responseData,
      error: null,
    });
  });
});

describe(error.name, () => {
  it("should return an error object", () => {
    const reason: FailureReason = {
      cause: null,
      message: "An error occurred",
      label: "Unknown",
    };

    const result = error(new ShelfError(reason));

    expect(result).toEqual({
      error: {
        message: reason.message,
        label: reason.label,
        traceId: expect.any(String),
      },
    });
  });

  it("should forward title", () => {
    const reason: FailureReason = {
      cause: null,
      message: "An error occurred",
      label: "Unknown",
      title: "Oops!",
    };

    const result = error(new ShelfError(reason));

    expect(result).toEqual({
      error: {
        message: reason.message,
        title: reason.title,
        label: reason.label,
        traceId: expect.any(String),
      },
    });
  });

  it("should forward additionalData", () => {
    const reason: FailureReason = {
      cause: null,
      message: "An error occurred",
      label: "Unknown",
      additionalData: { key: "value" },
    };

    const result = error(new ShelfError(reason));

    expect(result).toEqual({
      error: {
        message: reason.message,
        label: reason.label,
        traceId: expect.any(String),
        additionalData: reason.additionalData,
      },
    });
  });

  it("should log the cause", () => {
    const cause = new ShelfError({
      cause: null,
      message: "An error occurred",
      label: "Unknown",
    });

    error(cause);

    expect(Logger.error).toBeCalledWith(cause);
  });
});

describe(getParams.name, () => {
  it("should return params", () => {
    const params = { id: "123" };
    const result = getParams(params, z.object({ id: z.string() }));

    expect(result).toEqual(params);
  });

  it("should throw a `json` response if params are invalid", () => {
    const params = {};

    try {
      getParams(params, z.object({ id: z.string() }));
    } catch (e) {
      assertIsDataWithResponseInit(e);
      expect(e.init?.status).toEqual(400);
      expect(e.data).toEqual({
        error: {
          additionalData: {
            data: {},
            validationErrors: {
              id: {
                message: "Required",
              },
            },
          },
          label: "Request validation",
          // Uses the first validation error message for better UX
          message: "Required",
          title: "Validation error",
          traceId: expect.any(String),
        },
      });
    }
  });

  it("should return additionalData if validation fails", () => {
    const params = { id: "123" };

    try {
      getParams(params, z.object({ id: z.string(), name: z.string() }), {
        additionalData: { userId: "user-id" },
      });
    } catch (e) {
      assertIsDataWithResponseInit(e);
      expect(e.init?.status).toEqual(400);
      expect(e.data).toEqual({
        error: {
          additionalData: {
            data: params,
            userId: "user-id",
            validationErrors: {
              name: {
                message: "Required",
              },
            },
          },
          label: expect.any(String),
          message: expect.any(String),
          title: "Validation error",
          traceId: expect.any(String),
        },
      });
    }
  });
});

describe(parseData.name, () => {
  it("should parse formData", () => {
    const formData = new FormData();
    formData.append("id", "123");

    const result = parseData(formData, z.object({ id: z.string() }));

    expect(result).toEqual({ id: "123" });
  });

  it("should parse URLSearchParams", () => {
    const searchParams = new URLSearchParams();
    searchParams.append("id", "123");

    const result = parseData(searchParams, z.object({ id: z.string() }));

    expect(result).toEqual({ id: "123" });
  });

  it("should parse request params", () => {
    const params = { id: "123" };

    const result = parseData(params, z.object({ id: z.string() }));

    expect(result).toEqual({ id: "123" });
  });

  it("should throw a `badRequest` if validation fails", () => {
    const params = {};

    try {
      parseData(params, z.object({ id: z.string() }));
    } catch (e) {
      expect(e).toBeInstanceOf(ShelfError);
      const error = e as ShelfError;
      expect(error.status).toEqual(400);
      // Uses the first validation error message for better UX
      expect(error.message).toEqual("Required");
      expect(error.additionalData).toEqual({
        data: {},
        validationErrors: {
          id: {
            message: "Required",
          },
        },
      });
    }
  });

  it("should throw a `badRequest` with custom options", () => {
    const params = {};

    try {
      parseData(params, z.object({ id: z.string() }), {
        title: "Oops!",
        message: "Params are invalid!",
        additionalData: {
          userId: "123",
        },
      });
    } catch (e) {
      expect(e).toBeInstanceOf(ShelfError);
      const error = e as ShelfError;
      expect(error.status).toEqual(400);
      expect(error.title).toEqual("Oops!");
      expect(error.message).toEqual("Params are invalid!");
      expect(error.additionalData).toEqual({
        userId: "123",
        data: {},
        validationErrors: {
          id: {
            message: "Required",
          },
        },
      });
    }
  });
});

describe(buildContentDisposition.name, () => {
  // why: freeze time so the timestamp in filenames is deterministic
  beforeEach(() => {
    vitest.useFakeTimers();
    vitest.setSystemTime(new Date("2024-06-15T12:30:45.123Z"));
  });

  afterEach(() => {
    vitest.useRealTimers();
  });

  it("should produce a valid header for plain ASCII names", () => {
    const result = buildContentDisposition("My Booking", {
      fallback: "booking",
      suffix: "-activity",
    });

    expect(result).toBe(
      'attachment; filename="My Booking-activity-2024-06-15T1230.csv"; ' +
        "filename*=UTF-8''My%20Booking-activity-2024-06-15T1230.csv"
    );
  });

  it("should replace non-ASCII characters with underscores in the ASCII filename", () => {
    const result = buildContentDisposition("ทดสอบ", {
      fallback: "booking",
      suffix: "-activity",
    });

    // ASCII filename should have underscores instead of Thai chars
    expect(result).toContain('filename="_____-activity-');
    // filename* should have the percent-encoded Thai characters
    expect(result).toContain("filename*=UTF-8''");
    expect(result).toContain("%E0%B8%97");
  });

  it("should handle CJK characters", () => {
    const result = buildContentDisposition("测试资产", {
      fallback: "asset",
      suffix: "-activity",
    });

    expect(result).toContain('filename="____-activity-');
    expect(result).toContain("filename*=UTF-8''");
    expect(result).toContain("%E6%B5%8B");
  });

  it("should handle accented Latin characters", () => {
    const result = buildContentDisposition("café résumé", {
      fallback: "asset",
    });

    expect(result).toContain('filename="caf_ r_sum_-');
    expect(result).toContain("filename*=UTF-8''caf%C3%A9%20r%C3%A9sum%C3%A9-");
  });

  it("should use fallback when name is null", () => {
    const result = buildContentDisposition(null, {
      fallback: "booking",
      suffix: "-activity",
    });

    expect(result).toContain('filename="booking-activity-');
  });

  it("should use fallback when name is undefined", () => {
    const result = buildContentDisposition(undefined, {
      fallback: "location",
    });

    expect(result).toContain('filename="location-');
  });

  it("should use fallback when name is empty string", () => {
    const result = buildContentDisposition("  ", {
      fallback: "asset",
      suffix: "-activity",
    });

    expect(result).toContain('filename="asset-activity-');
  });

  it("should replace filesystem-special characters in the ASCII filename", () => {
    const result = buildContentDisposition('file/name:with*special?"chars', {
      fallback: "asset",
    });

    // The special chars should be replaced with hyphens
    expect(result).toContain('filename="file-name-with-special--chars-');
    // The filename* should have the original chars percent-encoded
    expect(result).toContain("filename*=UTF-8''");
  });

  it("should work without suffix option", () => {
    const result = buildContentDisposition("My Asset", {
      fallback: "asset",
    });

    expect(result).toContain('filename="My Asset-2024-06-15T1230.csv"');
  });

  it("should produce a header that does not throw when used in a Response", () => {
    const header = buildContentDisposition("ทดสอบ", {
      fallback: "booking",
      suffix: "-activity",
    });

    // This should not throw TypeError: Cannot convert argument to a ByteString
    expect(() => {
      new Response("test", {
        headers: { "content-disposition": header },
      });
    }).not.toThrow();
  });
});
