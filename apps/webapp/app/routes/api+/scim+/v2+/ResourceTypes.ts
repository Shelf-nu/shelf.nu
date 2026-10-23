/**
 * GET /api/scim/v2/ResourceTypes
 *
 * Returns the SCIM ResourceTypes ListResponse (RFC 7643 §6) — the resource
 * types this server exposes (just `User`). Read by IdPs during connector setup.
 * Requires the org's SCIM bearer token, like `/Users`.
 *
 * @see {@link file://./../../../../modules/scim/discovery.server.ts}
 */
import type { LoaderFunctionArgs } from "react-router";
import { authenticateScimRequest } from "~/modules/scim/auth.server";
import { buildResourceTypesListResponse } from "~/modules/scim/discovery.server";
import { handleScimError } from "~/modules/scim/errors.server";
import { SCIM_CONTENT_TYPE } from "~/modules/scim/types";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    // Authenticate to keep the endpoint closed; the list itself is org-agnostic.
    await authenticateScimRequest(request);

    return new Response(JSON.stringify(buildResourceTypesListResponse()), {
      status: 200,
      headers: { "Content-Type": SCIM_CONTENT_TYPE },
    });
  } catch (err) {
    return handleScimError(err);
  }
}
