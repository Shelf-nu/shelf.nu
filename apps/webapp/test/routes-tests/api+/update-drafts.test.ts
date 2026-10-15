/**
 * Route tests for `POST /api/update-drafts`.
 *
 * The endpoint is public (no session) and guarded only by its Bearer key, so
 * these tests pin the three promises it makes to whoever holds that key: it
 * stays off until a real key is configured, it refuses a wrong key before
 * reading the body, and the only thing it can ever write is a DRAFT filed
 * under a Shelf admin.
 *
 * The real route, schema and service run; only Prisma is replaced.
 *
 * @see {@link file://./../../../app/routes/api+/update-drafts.ts}
 * @see {@link file://./../../../app/modules/update/draft-api.server.ts}
 */
// @vitest-environment node
import { OrganizationRoles, Roles, UpdateStatus } from "@prisma/client";
import type { ActionFunctionArgs } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "~/database/db.server";
import { action } from "~/routes/api+/update-drafts";

// why: React Router v7 single fetch: `data()` outside a request context returns
// an internal wrapper, not a Response. Returning a real Response makes status
// and body directly assertable.
const createDataMock = vi.hoisted(
  () => () =>
    vi.fn((payload: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(payload), {
        status: init?.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    })
);

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

// why: the two Prisma calls the endpoint makes (find the admin author, create
// the update) are the observable effects; a real database is not available.
vi.mock("~/database/db.server", () => ({
  db: {
    user: { findFirst: vi.fn() },
    update: { create: vi.fn() },
  },
}));

const findAuthorMock = vi.mocked(db.user.findFirst);
const createUpdateMock = vi.mocked(db.update.create);

const KEY = "k".repeat(64);
const ADMIN_ID = "admin-user-1";

/** A body that passes the schema; tests override single fields. */
const validBody = {
  title: "Archive assets you no longer use",
  content: "Retired, broken or sold? Archive it instead of deleting it.",
  imageUrl:
    "https://example.supabase.co/storage/v1/object/public/website-images/archive.webp",
  url: "https://www.shelf.nu/knowledge-base/archiving-assets",
  targetRoles: [OrganizationRoles.ADMIN, OrganizationRoles.OWNER],
  authorEmail: "editor@shelf.nu",
};

/** Calls the action with a JSON body and the given headers. */
async function post(
  body: unknown,
  headers: Record<string, string> = { Authorization: `Bearer ${KEY}` },
  method = "POST"
) {
  const request = new Request("http://localhost/api/update-drafts", {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
        ? body
        : JSON.stringify(body),
  });
  const response = (await action({
    request,
    params: {},
    context: {},
  } as unknown as ActionFunctionArgs)) as unknown as Response;
  return { status: response.status, json: await response.json() };
}

describe("POST /api/update-drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("UPDATE_DRAFTS_API_KEY", KEY);
    findAuthorMock.mockResolvedValue({ id: ADMIN_ID } as never);
    createUpdateMock.mockResolvedValue({ id: "update-1" } as never);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates the update as a DRAFT filed under the Shelf admin", async () => {
    const { status, json } = await post(validBody);

    expect(status).toBe(201);
    expect(json).toEqual({
      error: null,
      update: { id: "update-1", status: UpdateStatus.DRAFT },
    });

    // The author lookup is restricted to holders of the Shelf ADMIN role.
    expect(findAuthorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          roles: { some: { name: Roles.ADMIN } },
        }),
      })
    );

    const { data } = createUpdateMock.mock.calls[0][0];
    expect(data).toMatchObject({
      title: validBody.title,
      content: validBody.content,
      imageUrl: validBody.imageUrl,
      url: validBody.url,
      targetRoles: [OrganizationRoles.ADMIN, OrganizationRoles.OWNER],
      status: UpdateStatus.DRAFT,
      createdById: ADMIN_ID,
    });
    expect(data.publishDate).toBeInstanceOf(Date);
  });

  it("accepts the Bearer scheme in any letter case", async () => {
    const { status } = await post(validBody, {
      Authorization: `bearer ${KEY}`,
    });

    expect(status).toBe(201);
  });

  it("stores no link or image, and targets every role, when those are omitted", async () => {
    const { status } = await post({
      title: validBody.title,
      content: validBody.content,
      authorEmail: validBody.authorEmail,
    });

    expect(status).toBe(201);
    expect(createUpdateMock.mock.calls[0][0].data).toMatchObject({
      url: null,
      imageUrl: null,
      targetRoles: [],
    });
  });

  it("collapses a role named twice", async () => {
    await post({
      ...validBody,
      targetRoles: [OrganizationRoles.BASE, OrganizationRoles.BASE],
    });

    expect(createUpdateMock.mock.calls[0][0].data.targetRoles).toEqual([
      OrganizationRoles.BASE,
    ]);
  });

  describe("stays off until a real key is configured", () => {
    it("answers 404 when UPDATE_DRAFTS_API_KEY is unset", async () => {
      vi.stubEnv("UPDATE_DRAFTS_API_KEY", undefined);

      const { status } = await post(validBody);

      expect(status).toBe(404);
      expect(findAuthorMock).not.toHaveBeenCalled();
      expect(createUpdateMock).not.toHaveBeenCalled();
    });

    it("answers 404 when the configured key is too short to be real, even if sent", async () => {
      vi.stubEnv("UPDATE_DRAFTS_API_KEY", "changeme");

      const { status } = await post(validBody, {
        Authorization: "Bearer changeme",
      });

      expect(status).toBe(404);
      expect(createUpdateMock).not.toHaveBeenCalled();
    });
  });

  describe("refuses a caller without the key", () => {
    it.each([
      ["no Authorization header", {}],
      ["a wrong key", { Authorization: `Bearer ${"x".repeat(64)}` }],
      ["the key without the Bearer scheme", { Authorization: KEY }],
      ["a prefix of the key", { Authorization: `Bearer ${KEY.slice(0, 32)}` }],
    ])("answers 401 for %s", async (_label, headers) => {
      const { status } = await post(validBody, headers);

      expect(status).toBe(401);
      expect(findAuthorMock).not.toHaveBeenCalled();
      expect(createUpdateMock).not.toHaveBeenCalled();
    });

    it("checks the key before reading the body", async () => {
      const { status } = await post("not json", {});

      expect(status).toBe(401);
    });
  });

  describe("can never publish or schedule", () => {
    it.each([
      ["status", { status: UpdateStatus.PUBLISHED }],
      ["publishDate", { publishDate: "2026-10-13T09:00:00Z" }],
    ])("refuses a body carrying %s", async (_field, extra) => {
      const { status, json } = await post({ ...validBody, ...extra });

      expect(status).toBe(400);
      expect(json.error.message).toMatch(/Unrecognized key/);
      expect(createUpdateMock).not.toHaveBeenCalled();
    });
  });

  describe("validates the body", () => {
    it.each([
      ["a missing title", { title: undefined }, /title/i],
      ["a blank title", { title: "   " }, /title is required/],
      ["blank content", { content: "" }, /content is required/],
      ["an http image", { imageUrl: "http://x.test/a.png" }, /https/],
      ["a javascript: link", { url: "javascript:alert(1)" }, /url must/],
      ["an unknown role", { targetRoles: ["SUPERUSER"] }, /Invalid enum/],
      ["a malformed author", { authorEmail: "editor" }, /authorEmail/],
    ])("answers 400 for %s", async (_label, override, message) => {
      const { status, json } = await post({ ...validBody, ...override });

      expect(status).toBe(400);
      expect(json.error.message).toMatch(message);
      expect(createUpdateMock).not.toHaveBeenCalled();
    });

    it("answers 400 for a body that is not JSON", async () => {
      const { status, json } = await post("{not json");

      expect(status).toBe(400);
      expect(json.error.message).toBe("Request body must be valid JSON.");
    });
  });

  it("answers 400 when the author is not a Shelf admin", async () => {
    findAuthorMock.mockResolvedValue(null);

    const { status, json } = await post(validBody);

    expect(status).toBe(400);
    expect(json.error.message).toBe("authorEmail must belong to a Shelf admin");
    expect(createUpdateMock).not.toHaveBeenCalled();
  });

  it("answers 405 to anything but POST", async () => {
    const { status } = await post(undefined, undefined, "PUT");

    expect(status).toBe(405);
    expect(createUpdateMock).not.toHaveBeenCalled();
  });
});
