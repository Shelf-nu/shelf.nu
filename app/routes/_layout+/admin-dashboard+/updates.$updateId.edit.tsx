import { UpdateStatus, OrganizationRoles } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect , useLoaderData } from "react-router";
import { z } from "zod";
import { Card } from "~/components/shared/card";
import { UpdateForm } from "~/components/update/update-form";
import { getUpdateById, updateUpdate } from "~/modules/update/service.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import { requireAdmin } from "~/utils/roles.server";

export const loader = async ({ context, params }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { updateId } = params;

  try {
    await requireAdmin(userId);

    if (!updateId) {
      throw new Error("Update ID is required");
    }

    const update = await getUpdateById(updateId);
    if (!update) {
      throw new Error("Update not found");
    }

    return payload({ update });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
};

export const action = async ({
  context,
  request,
  params,
}: ActionFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { updateId } = params;

  try {
    await requireAdmin(userId);

    if (!updateId) {
      throw new Error("Update ID is required");
    }

    const formData = await request.formData();

    // Handle role targeting
    const targetRoles: OrganizationRoles[] = [];
    if (formData.get("targetAdmin")) targetRoles.push(OrganizationRoles.ADMIN);
    if (formData.get("targetOwner")) targetRoles.push(OrganizationRoles.OWNER);
    if (formData.get("targetSelfService"))
      targetRoles.push(OrganizationRoles.SELF_SERVICE);
    if (formData.get("targetBase")) targetRoles.push(OrganizationRoles.BASE);

    const payload = parseData(
      formData,
      z.object({
        title: z.string().min(1, "Title is required"),
        content: z.string().min(1, "Content is required"),
        url: z.string().url("Must be a valid URL").optional().or(z.literal("")),
        publishDate: z.string().transform((str) => new Date(str)),
        status: z.nativeEnum(UpdateStatus),
      })
    );

    await updateUpdate({
      id: updateId,
      ...payload,
      url: payload.url || undefined, // Convert empty string to undefined
      targetRoles,
    });

    return redirect("/admin-dashboard/updates");
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
};

export default function EditUpdate() {
  const { update } = useLoaderData<typeof loader>();

  return (
    <Card>
      <h3 className="mb-6 text-lg font-semibold">Edit Update</h3>
      <UpdateForm
        id={update.id}
        title={update.title}
        content={update.content}
        url={update.url}
        publishDate={new Date(update.publishDate)}
        status={update.status}
        targetRoles={update.targetRoles}
      />
    </Card>
  );
}
