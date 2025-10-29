import { UpdateStatus, OrganizationRoles } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { z } from "zod";
import { Card } from "~/components/shared/card";
import { UpdateForm } from "~/components/update/update-form";
import { createUpdate } from "~/modules/update/service.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import { requireAdmin } from "~/utils/roles.server";

export const loader = async ({ context }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requireAdmin(userId);

    return json(payload(null));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
};

export const action = async ({ context, request }: ActionFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requireAdmin(userId);

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

    await createUpdate({
      ...payload,
      url: payload.url || undefined, // Convert empty string to undefined
      targetRoles,
      createdById: userId,
    });

    return redirect("/admin-dashboard/updates");
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
};

export default function NewUpdate() {
  return (
    <Card>
      <h3 className="mb-6 text-lg font-semibold">Create New Update</h3>
      <UpdateForm />
    </Card>
  );
}
