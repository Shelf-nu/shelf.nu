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
import type { ScimPatchOp, ScimUserInput } from "~/modules/scim/types";

/**
 * GET /api/scim/v2/Users/:userId — Get a specific user
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const { organizationId } = await authenticateScimRequest(request);
    const userId = params.userId!;

    const user = await getScimUser(organizationId, userId);

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
    const userId = params.userId!;
    const method = request.method.toUpperCase();

    switch (method) {
      case "PUT": {
        const body = (await request.json()) as ScimUserInput;
        const user = await replaceScimUser(organizationId, userId, body);
        return new Response(JSON.stringify(user), {
          status: 200,
          headers: { "Content-Type": SCIM_CONTENT_TYPE },
        });
      }

      case "PATCH": {
        const body = (await request.json()) as ScimPatchOp;
        const user = await patchScimUser(organizationId, userId, body);
        return new Response(JSON.stringify(user), {
          status: 200,
          headers: { "Content-Type": SCIM_CONTENT_TYPE },
        });
      }

      case "DELETE": {
        await deactivateScimUser(organizationId, userId);
        return new Response(null, { status: 204 });
      }

      default:
        throw new ScimError(`Method ${method} not allowed`, 405);
    }
  } catch (err) {
    return handleScimError(err);
  }
}
