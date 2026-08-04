import { UpdateStatus, OrganizationRoles } from "@prisma/client";
import { DateTime } from "luxon";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { z } from "zod";
import { Card } from "~/components/shared/card";
import { UpdateForm } from "~/components/update/update-form";
import { createUpdate } from "~/modules/update/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getClientHint } from "~/utils/client-hints";
import { DATE_TIME_FORMAT } from "~/utils/constants";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import { requireAdmin } from "~/utils/roles.server";

export const meta = () => [{ title: appendToMetaTitle("New update") }];

export const loader = async ({ context }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requireAdmin(userId);

    return payload(null);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
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

    // Parse the submitted publish-date wall-clock in the acting admin's
    // RESOLVED timezone preference (the same zone the form seeds it in), not
    // the server zone, so the stored instant matches what the admin picked.
    const { timeZone } = await resolveUserFormatPrefsById(
      userId,
      getClientHint(request)
    );

    const payload = parseData(
      formData,
      z.object({
        title: z.string().min(1, "Title is required"),
        content: z.string().min(1, "Content is required"),
        url: z.string().url("Must be a valid URL").optional().or(z.literal("")),
        imageUrl: z
          .string()
          .url("Must be a valid URL")
          .optional()
          .or(z.literal("")),
        publishDate: z.string().transform((str) =>
          DateTime.fromFormat(str, DATE_TIME_FORMAT, {
            zone: timeZone,
          }).toJSDate()
        ),
        status: z.nativeEnum(UpdateStatus),
      })
    );

    await createUpdate({
      ...payload,
      url: payload.url || undefined, // Convert empty string to undefined
      imageUrl: payload.imageUrl || undefined, // Convert empty string to undefined
      targetRoles,
      createdById: userId,
    });

    return redirect("/admin-dashboard/updates");
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
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
