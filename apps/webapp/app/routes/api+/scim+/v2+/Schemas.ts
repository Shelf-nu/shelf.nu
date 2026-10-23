/**
 * GET /api/scim/v2/Schemas
 *
 * Returns the SCIM Schemas ListResponse (RFC 7643 §7) — the attribute
 * definitions for the resource types this server exposes (the core User
 * schema). Read by IdPs during connector setup to map attributes. Requires the
 * org's SCIM bearer token, like `/Users`.
 *
 * @see {@link file://./../../../../modules/scim/discovery.server.ts}
 */
import type { LoaderFunctionArgs } from "react-router";
import { authenticateScimRequest } from "~/modules/scim/auth.server";
import { buildSchemasListResponse } from "~/modules/scim/discovery.server";
import { handleScimError } from "~/modules/scim/errors.server";
import { SCIM_CONTENT_TYPE } from "~/modules/scim/types";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    await authenticateScimRequest(request);

    return new Response(JSON.stringify(buildSchemasListResponse()), {
      status: 200,
      headers: { "Content-Type": SCIM_CONTENT_TYPE },
    });
  } catch (err) {
    return handleScimError(err);
  }
}
