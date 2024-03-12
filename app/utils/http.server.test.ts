import type { FailureReason } from "./error";
import { ShelfError } from "./error";
import {
  isGet,
  getCurrentPath,
  getRedirectTo,
  makeRedirectToFromHere,
  isPost,
  safeRedirect,
  data,
  error,
} from "./http.server";
import { Logger } from "./logger";

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

describe(isGet.name, () => {
  it("should return false for POST / PUT / PATCH / DELETE methods", () => {
    expect(isGet(new Request(BASE_URL, { method: "POST" }))).toBeFalsy();
    expect(isGet(new Request(BASE_URL, { method: "PUT" }))).toBeFalsy();
    expect(isGet(new Request(BASE_URL, { method: "PATCH" }))).toBeFalsy();
    expect(isGet(new Request(BASE_URL, { method: "DELETE" }))).toBeFalsy();
  });

  it("should return true for GET method", async () => {
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

  it("should return true for POST method", async () => {
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

describe(data.name, () => {
  it("should return data with error set to null", () => {
    const responseData = { name: "John" };
    const result = data(responseData);

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
