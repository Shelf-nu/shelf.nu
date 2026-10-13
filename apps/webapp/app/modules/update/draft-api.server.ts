/**
 * Draft-only intake for in-app updates.
 *
 * Shelf's content automation writes short announcements for shipped features
 * and hands them to the app through `POST /api/update-drafts`. Every update it
 * creates is a DRAFT: a Shelf admin opens it in Admin > Updates, edits it, and
 * publishes or schedules it from there. Nothing here can publish, edit or
 * delete an update, and the body schema refuses `status` and `publishDate`
 * outright so a caller cannot ask for either.
 *
 * Authentication is one shared key, `UPDATE_DRAFTS_API_KEY`, sent as a Bearer
 * token. While the variable is unset (or too short to be a real key) the
 * endpoint answers 404, so an instance that never configured it looks like one
 * that never had it.
 *
 * @see {@link file://./../../routes/api+/update-drafts.ts} the route
 * @see {@link file://./service.server.ts} createUpdate
 * @see {@link file://./../../routes/_layout+/admin-dashboard+/updates.tsx} where drafts are reviewed
 */
import { createHash, timingSafeEqual } from "crypto";
import { OrganizationRoles, Roles, UpdateStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "~/database/db.server";
import { caseInsensitiveEmailFilter } from "~/modules/invite/helpers";
import { getEnv } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { createUpdate } from "./service.server";

/**
 * Shortest `UPDATE_DRAFTS_API_KEY` the endpoint accepts. A shorter value keeps
 * the endpoint switched off, so a placeholder such as "changeme" can never
 * become a working credential. `openssl rand -hex 32` gives 64 characters.
 */
export const UPDATE_DRAFTS_MIN_KEY_LENGTH = 32;

/** The short-key warning is logged once per process, not once per request. */
let hasWarnedShortKey = false;

/**
 * An absolute `https://` URL. The update timeline renders `url` as a link and
 * `imageUrl` as an `<img>` on an https page, so other schemes are refused.
 */
const httpsUrl = (field: string) =>
  z
    .string()
    .trim()
    .url(`${field} must be a valid URL`)
    .refine((value) => value.toLowerCase().startsWith("https://"), {
      message: `${field} must start with https://`,
    });

/**
 * Body of `POST /api/update-drafts`.
 *
 * `.strict()` makes an unknown key a 400 instead of silently dropping it, so a
 * caller that sends `status` or `publishDate` learns that drafts are the only
 * thing this endpoint makes.
 */
export const UpdateDraftSchema = z
  .object({
    title: z
      .string({ required_error: "title is required" })
      .trim()
      .min(1, "title is required")
      .max(200, "title must be at most 200 characters"),
    /** Markdown, rendered the same way as an update written in the admin form. */
    content: z
      .string({ required_error: "content is required" })
      .trim()
      .min(1, "content is required")
      .max(10_000, "content must be at most 10000 characters"),
    imageUrl: httpsUrl("imageUrl").optional(),
    /** The "Read more" link shown on the update. */
    url: httpsUrl("url").optional(),
    /** Roles that see the update. Omitted or empty means every role. */
    targetRoles: z.array(z.nativeEnum(OrganizationRoles)).optional(),
    /**
     * The Shelf admin the draft is filed under. It shows as "Created By" in
     * Admin > Updates and must belong to a user holding the Shelf ADMIN role.
     */
    authorEmail: z
      .string({ required_error: "authorEmail is required" })
      .trim()
      .email("authorEmail must be an email address"),
  })
  .strict();

/** A validated `POST /api/update-drafts` body. */
export type UpdateDraftInput = z.infer<typeof UpdateDraftSchema>;

/**
 * Compares two secrets in constant time. Hashing both sides first gives the
 * equal-length buffers `timingSafeEqual` requires, so the comparison takes the
 * same time wherever the strings differ and whatever their lengths.
 */
function secretsMatch(presented: string, expected: string): boolean {
  const presentedDigest = createHash("sha256").update(presented).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(presentedDigest, expectedDigest);
}

/**
 * Checks the request's Bearer token against `UPDATE_DRAFTS_API_KEY`.
 *
 * The key is read per request, so tests and a restarted machine pick up the
 * current value without a module reload.
 *
 * @param request - The incoming request
 * @throws {ShelfError} 404 when the key is not configured (or shorter than
 *   {@link UPDATE_DRAFTS_MIN_KEY_LENGTH}); 401 when the token is missing or wrong
 */
export function assertUpdateDraftsKey(request: Request): void {
  const configuredKey =
    getEnv("UPDATE_DRAFTS_API_KEY", { isRequired: false }) ?? "";

  if (configuredKey.length < UPDATE_DRAFTS_MIN_KEY_LENGTH) {
    if (configuredKey.length > 0 && !hasWarnedShortKey) {
      hasWarnedShortKey = true;
      Logger.warn(
        `UPDATE_DRAFTS_API_KEY is shorter than ${UPDATE_DRAFTS_MIN_KEY_LENGTH} characters, so /api/update-drafts stays off`
      );
    }
    throw new ShelfError({
      cause: null,
      message: "Not found",
      label: "Update",
      status: 404,
      shouldBeCaptured: false,
    });
  }

  // The auth scheme is case-insensitive (RFC 7235), so "bearer" is accepted.
  const presentedKey =
    /^bearer (.+)$/i.exec(request.headers.get("Authorization") ?? "")?.[1] ??
    "";

  if (!presentedKey || !secretsMatch(presentedKey, configuredKey)) {
    throw new ShelfError({
      cause: null,
      message: "Invalid or missing API key",
      label: "Update",
      status: 401,
      shouldBeCaptured: false,
    });
  }
}

/**
 * Files a validated draft under its Shelf admin author.
 *
 * The update is always created as DRAFT with `publishDate` set to now. The
 * admin who publishes it can change the date in the edit form.
 *
 * @param input - A body that passed {@link UpdateDraftSchema}
 * @returns The id of the new draft
 * @throws {ShelfError} 400 when `authorEmail` does not belong to a Shelf admin
 */
export async function createUpdateDraft(
  input: UpdateDraftInput
): Promise<{ id: string }> {
  const author = await db.user.findFirst({
    where: {
      email: caseInsensitiveEmailFilter(input.authorEmail),
      // Shelf staff role, not a workspace role: only Shelf admins can open
      // Admin > Updates to review the draft.
      roles: { some: { name: Roles.ADMIN } },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!author) {
    throw new ShelfError({
      cause: null,
      message: "authorEmail must belong to a Shelf admin",
      additionalData: { authorEmail: input.authorEmail },
      label: "Update",
      status: 400,
      shouldBeCaptured: false,
    });
  }

  return createUpdate({
    title: input.title,
    content: input.content,
    url: input.url,
    imageUrl: input.imageUrl,
    targetRoles: [...new Set(input.targetRoles ?? [])],
    publishDate: new Date(),
    status: UpdateStatus.DRAFT,
    createdById: author.id,
  });
}
