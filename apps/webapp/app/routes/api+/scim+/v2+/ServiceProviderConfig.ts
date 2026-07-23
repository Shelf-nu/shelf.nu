/**
 * GET /api/scim/v2/ServiceProviderConfig
 *
 * Returns the SCIM ServiceProviderConfig (RFC 7643 §5) describing which SCIM
 * features this server supports. Read by IdPs (Okta, Entra group sync) during
 * connector setup. Requires the org's SCIM bearer token, like `/Users`.
 *
 * @see {@link file://./../../../../modules/scim/discovery.server.ts}
 */
import type { LoaderFunctionArgs } from "react-router";
import { authenticateScimRequest } from "~/modules/scim/auth.server";
import { buildServiceProviderConfig } from "~/modules/scim/discovery.server";
import { handleScimError } from "~/modules/scim/errors.server";
import { SCIM_CONTENT_TYPE } from "~/modules/scim/types";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    await authenticateScimRequest(request);

    return new Response(JSON.stringify(buildServiceProviderConfig()), {
      status: 200,
      headers: { "Content-Type": SCIM_CONTENT_TYPE },
    });
  } catch (err) {
    return handleScimError(err);
  }
}
