import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticateScimRequest } from "~/modules/scim/auth.server";
import { handleScimError, ScimError } from "~/modules/scim/errors.server";
import {
  deactivateScimUser,
  getScimUser,
  patchScimUser,
  replaceScimUser,
} from "~/modules/scim/service.server";
import { SCIM_CONTENT_TYPE } from "~/modules/scim/types";
import {
  parseScimJsonBody,
  scimPatchOpSchema,
  scimUserInputSchema,
} from "~/modules/scim/validation.server";

/**
 * GET /api/scim/v2/Users/:userId — Get a specific user
 *
 * The `:userId` path segment is the SCIM resource id, which is the per-org
 * external id (the IdP object id) — NOT the Shelf `User.id`. See
 * `findScimResourceOrThrow` for why the two are decoupled.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const { organizationId } = await authenticateScimRequest(request);
    // The route param is the SCIM external id, not the Shelf User.id.
    const scimId = params.userId!;

    const user = await getScimUser(organizationId, scimId);

    return new Response(JSON.stringify(user), {
      status: 200,
      headers: { "Content-Type": SCIM_CONTENT_TYPE },
    });
  } catch (err) {
    return handleScimError(err);
  }
}

/**
 * PUT, PATCH, DELETE /api/scim/v2/Users/:userId
 */
export async function action({ request, params }: ActionFunctionArgs) {
  try {
    const { organizationId } = await authenticateScimRequest(request);
    // The route param is the SCIM external id, not the Shelf User.id.
    const scimId = params.userId!;
    const method = request.method.toUpperCase();

    switch (method) {
      case "PUT": {
        const body = await parseScimJsonBody(request, scimUserInputSchema);
        const user = await replaceScimUser(organizationId, scimId, body);
        return new Response(JSON.stringify(user), {
          status: 200,
          headers: { "Content-Type": SCIM_CONTENT_TYPE },
        });
      }

      case "PATCH": {
        const body = await parseScimJsonBody(request, scimPatchOpSchema);
        const user = await patchScimUser(organizationId, scimId, body);
        return new Response(JSON.stringify(user), {
          status: 200,
          headers: { "Content-Type": SCIM_CONTENT_TYPE },
        });
      }

      case "DELETE": {
        await deactivateScimUser(organizationId, scimId);
        return new Response(null, { status: 204 });
      }

      default:
        throw new ScimError(`Method ${method} not allowed`, 405);
    }
  } catch (err) {
    return handleScimError(err);
  }
}
