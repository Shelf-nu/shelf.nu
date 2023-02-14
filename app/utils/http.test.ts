import {
  isGet,
  getCurrentPath,
  getRedirectTo,
  makeRedirectToFromHere,
  notFound,
  isPost,
  safeRedirect,
} from "./http.server";

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

describe(notFound.name, () => {
  it("should return 404 status", () => {
    expect(notFound("").status).toBe(404);
  });

  it("should return message", async () => {
    expect(await notFound("not-found-message").text()).toBe(
      "not-found-message"
    );
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
    expect(safeRedirect("/notes")).toBe("/notes");
  });
});
