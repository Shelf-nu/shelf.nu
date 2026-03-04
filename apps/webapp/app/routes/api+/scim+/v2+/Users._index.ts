import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticateScimRequest } from "~/modules/scim/auth.server";
import { handleScimError, ScimError } from "~/modules/scim/errors.server";
import { createScimUser, listScimUsers } from "~/modules/scim/service.server";
import { SCIM_CONTENT_TYPE } from "~/modules/scim/types";
import type { ScimUserInput } from "~/modules/scim/types";

/**
 * GET /api/scim/v2/Users — List or search users in the organization
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { organizationId } = await authenticateScimRequest(request);

    const url = new URL(request.url);
    const startIndex = Number(url.searchParams.get("startIndex")) || 1;
    const count = Number(url.searchParams.get("count")) || 100;
    const filter = url.searchParams.get("filter") ?? undefined;

    const result = await listScimUsers(organizationId, {
      startIndex,
      count,
      filter,
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": SCIM_CONTENT_TYPE },
    });
  } catch (err) {
    return handleScimError(err);
  }
}

/**
 * POST /api/scim/v2/Users — Create (provision) a new user
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    if (request.method !== "POST") {
      throw new ScimError(`Method ${request.method} not allowed`, 405);
    }

    const { organizationId } = await authenticateScimRequest(request);
    const body = (await request.json()) as ScimUserInput;

    const user = await createScimUser(organizationId, body);

    return new Response(JSON.stringify(user), {
      status: 201,
      headers: { "Content-Type": SCIM_CONTENT_TYPE },
    });
  } catch (err) {
    return handleScimError(err);
  }
}
