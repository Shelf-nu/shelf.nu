import {
  json,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "@remix-run/node";
import {
  Outlet,
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigation,
} from "@remix-run/react";
import { z } from "zod";
import { FileForm } from "~/components/assets/import-content";
import { Form } from "~/components/custom-form";
import FormRow from "~/components/forms/form-row";
import Input from "~/components/forms/input";
import { Switch } from "~/components/forms/switch";
import HorizontalTabs from "~/components/layout/horizontal-tabs";
import { Button } from "~/components/shared/button";
import { db } from "~/database/db.server";
import { createAssetsFromContentImport } from "~/modules/asset/service.server";
import { toggleOrganizationSso } from "~/modules/organization/service.server";
import { csvDataFromRequest } from "~/utils/csv.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { getParams, data, error, parseData } from "~/utils/http.server";
import { extractCSVDataFromContentImport } from "~/utils/import.server";
import { isValidDomain } from "~/utils/misc";
import { requireAdmin } from "~/utils/roles.server";

export const loader = async ({ context, params }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { organizationId } = getParams(
    params,
    z.object({ organizationId: z.string() }),
    { additionalData: { userId } }
  );

  try {
    await requireAdmin(userId);

    const organization = await db.organization
      .findFirstOrThrow({
        where: { id: organizationId },
        include: {
          qrCodes: {
            include: {
              asset: true,
            },
          },
          owner: true,
          ssoDetails: true,
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          title: "Organization not found",
          message:
            "The organization you are trying to access does not exist or you do not have permission to access it.",
          additionalData: { userId, params },
          label: "Admin dashboard",
        });
      });

    return json(data({ organization }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, organizationId });
    throw json(error(reason), { status: reason.status });
  }
};

export const action = async ({
  context,
  request,
  params,
}: ActionFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { organizationId } = getParams(
    params,
    z.object({ organizationId: z.string() }),
    { additionalData: { userId } }
  );

  try {
    await requireAdmin(userId);
    const { intent } = parseData(
      await request.clone().formData(),
      z.object({
        intent: z.enum(["toggleSso", "updateSsoDetails", "content"]),
      })
    );

    switch (intent) {
      case "toggleSso":
        const { enabledSso } = parseData(
          await request.formData(),
          z.object({
            enabledSso: z
              .string()
              .transform((val) => val === "on")
              .default("false"),
          })
        );
        await toggleOrganizationSso({ organizationId, enabledSso });

        return json(data({ message: "SSO toggled" }));
      case "updateSsoDetails":
        const { adminGroupId, selfServiceGroupId, domain } = parseData(
          await request.formData(),
          z.object({
            adminGroupId: z.string(),
            selfServiceGroupId: z.string(),
            domain: z
              .string()
              .transform((email) => email.toLowerCase())
              .refine(isValidDomain, () => ({
                message: "Please enter a valid domain name",
              })),
          })
        );

        await db.organization.update({
          where: { id: organizationId },
          data: {
            ssoDetails: {
              upsert: {
                create: {
                  domain,
                  adminGroupId,
                  selfServiceGroupId,
                },
                update: {
                  domain,
                  adminGroupId,
                  selfServiceGroupId,
                },
              },
            },
          },
        });

        return json(data({ message: "SSO details updated" }));
      case "content":
        const csvData = await csvDataFromRequest({ request });
        if (csvData.length < 2) {
          throw new ShelfError({
            cause: null,
            message: "CSV file is empty",
            additionalData: { intent },
            label: "Assets",
          });
        }
        const contentData = extractCSVDataFromContentImport(csvData);
        await createAssetsFromContentImport({
          data: contentData,
          userId,
          organizationId,
        });
        return json(data(null));
      default:
        throw new ShelfError({
          cause: null,
          title: "Invalid intent",
          message: "The intent provided is not valid",
          additionalData: { intent },
          label: "Admin dashboard",
        });
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, organizationId });
    return json(error(reason), { status: reason.status });
  }
};

export default function OrgPage() {
  const { organization } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);
  return (
    <div>
      <h1>{organization.name}</h1>
      <h3>
        {" "}
        Owner: {organization.owner.firstName} {organization.owner.lastName} -{" "}
        {organization.owner.email}
      </h3>

      {/* @ts-ignore */}
      {actionData && actionData.message && (
        <div className="my-4 bg-green-100 p-4 text-green-700">
          {/* @ts-ignore */}
          {actionData.message}
        </div>
      )}
      <div className="my-5 flex gap-3">
        <div className="flex w-[400px] flex-col gap-2 bg-gray-200 p-4">
          <h4>Organization details</h4>
          <ol className="">
            {Object.entries(organization).map(([key, value]) => (
              <li key={key}>
                <span className="font-semibold">{key}</span>:{" "}
                {typeof value === "string" ? value : null}
                {typeof value === "boolean" ? String(value) : null}
              </li>
            ))}
          </ol>
          <hr className="border-1 border-gray-700" />
          <h4>Enable SSO</h4>
          <p>Enable or disable SSO functionality for a workspace</p>
          <fetcher.Form
            method="post"
            onChange={(e) => fetcher.submit(e.currentTarget)}
          >
            <div className="flex justify-between gap-3">
              <div>
                <p className="text-[14px] font-medium text-gray-700">
                  Toggle SSO
                </p>
              </div>
              <Switch
                name={"enabledSso"}
                disabled={isFormProcessing(fetcher.state)} // Disable for self service users
                defaultChecked={organization?.enabledSso}
                required
                title={"Toggle SSO"}
              />
              <input type="hidden" value="toggleSso" name="intent" />
            </div>
          </fetcher.Form>
        </div>
        {organization.enabledSso ? (
          <div className="w-[400px] bg-gray-200 p-4">
            <Form method="post">
              <div>
                <div className=" border-b pb-5">
                  <h2 className=" text-[18px] font-semibold">SSO details</h2>
                  <p>
                    This workspace has SSO enabled so you can see your SSO
                    settings.
                  </p>
                </div>

                <div className="flex flex-col">
                  <FormRow
                    rowLabel={"SSO Domain"}
                    className="block border-b-0 pb-0 [&>div]:lg:basis-auto"
                    subHeading={
                      "The domain that this workspace is linked to. If you want it changed, please contact support."
                    }
                    required
                  >
                    <Input
                      label="SSO Domain"
                      name="domain"
                      hideLabel
                      className="disabled w-full"
                      defaultValue={organization?.ssoDetails?.domain}
                      required
                    />
                  </FormRow>

                  <FormRow
                    rowLabel={`Administrator role group id`}
                    subHeading={
                      <div>
                        Place the Id of the group that should be mapped to the{" "}
                        <b>Administrator</b> role.
                      </div>
                    }
                    className="block border-b-0 pb-0 [&>div]:lg:basis-auto"
                    required
                  >
                    <Input
                      label={"Administrator role group id"}
                      hideLabel
                      className="w-full"
                      name={"adminGroupId"}
                      defaultValue={
                        organization?.ssoDetails?.adminGroupId || undefined
                      }
                      required
                    />
                  </FormRow>

                  <FormRow
                    rowLabel={`Self service role group id`}
                    subHeading={
                      <div>
                        Place the Id of the group that should be mapped to the{" "}
                        <b>Self service</b> role.
                      </div>
                    }
                    className="block border-b-0 pb-0 [&>div]:lg:basis-auto"
                    required
                  >
                    <Input
                      label={"Self service role group id"}
                      hideLabel
                      name={"selfServiceGroupId"}
                      required
                      defaultValue={
                        organization?.ssoDetails?.selfServiceGroupId ||
                        undefined
                      }
                      className="w-full"
                    />
                  </FormRow>

                  <Button
                    type="submit"
                    name="intent"
                    value="updateSsoDetails"
                    className="mt-2"
                    disabled={disabled}
                  >
                    Save
                  </Button>
                </div>
              </div>
            </Form>
          </div>
        ) : null}
        <div className="w-[400px] bg-gray-200 p-4">
          <div className="flex flex-col gap-8">
            <div>
              <h3>Export assets backup</h3>
              <Button
                type="submit"
                to={`/api/admin/export-org-assets/${
                  organization.id
                }/assets-${new Date().toISOString().slice(0, 10)}.csv`}
                download={true}
                reloadDocument={true}
              >
                Export assets backup
              </Button>
            </div>
            <div>
              <h3>Import assets backup</h3>
              <FileForm
                intent="backup"
                url={`/api/admin/import-org-assets/${organization.id}`}
              />
            </div>

            <div>
              <h3>Import content</h3>
              <FileForm intent={"content"} />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-10">
        <HorizontalTabs
          items={[
            { to: "assets", content: "Assets" },
            { to: "qr-codes", content: "QR codes" },
            { to: "members", content: "Members" },
          ]}
        />
        <div>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
