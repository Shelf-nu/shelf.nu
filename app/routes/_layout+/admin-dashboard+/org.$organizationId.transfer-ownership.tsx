import { data, type LoaderFunctionArgs } from "react-router";
import z from "zod";
import TransferOwnershipCard from "~/components/settings/transfer-ownership-card";
import { getOrganizationAdmins } from "~/modules/organization/service.server";
import { makeShelfError } from "~/utils/error";
import { error, getParams, payload } from "~/utils/http.server";
import { requireAdmin } from "~/utils/roles.server";

export async function loader({ context, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { organizationId } = getParams(
    params,
    z.object({ organizationId: z.string() })
  );

  try {
    await requireAdmin(userId);
    const admins = await getOrganizationAdmins({ organizationId });
    return payload({ admins });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export default function TransferOwnership() {
  return (
    <div>
      <TransferOwnershipCard />
    </div>
  );
}
