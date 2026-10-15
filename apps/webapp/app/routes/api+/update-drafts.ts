/**
 * `POST /api/update-drafts`: creates an in-app update as a DRAFT.
 *
 * Called by Shelf's content automation, not by a signed-in browser, so the
 * route is on the server's public-path list and authenticates with the
 * `UPDATE_DRAFTS_API_KEY` Bearer token instead of a session cookie. A Shelf
 * admin reviews and publishes the draft in Admin > Updates.
 *
 * Responses: 201 `{ update: { id, status: "DRAFT" } }`; 400 for a body that is
 * not JSON, fails the schema, or names an `authorEmail` that is not a Shelf
 * admin; 401 for a missing or wrong key; 404 while the key is not configured;
 * 405 for any method but POST.
 *
 * @see {@link file://./../../modules/update/draft-api.server.ts}
 * @see {@link file://./../../../server/index.ts} public-path list
 */
import { UpdateStatus } from "@prisma/client";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { parseMobileBody } from "~/modules/api/mobile-body.server";
import {
  assertUpdateDraftsKey,
  createUpdateDraft,
  UpdateDraftSchema,
} from "~/modules/update/draft-api.server";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, error, payload } from "~/utils/http.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    assertIsPost(request);
    // The key is checked before the body is read, so an unauthenticated
    // caller learns nothing about the schema.
    assertUpdateDraftsKey(request);

    const input = await parseMobileBody(UpdateDraftSchema, request, "Update");
    const draft = await createUpdateDraft(input);

    return data(
      payload({ update: { id: draft.id, status: UpdateStatus.DRAFT } }),
      { status: 201 }
    );
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(error(reason), { status: reason.status });
  }
}
