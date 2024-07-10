import {
  TierId,
  type Asset,
  type Qr,
  type User,
  type CustomTierLimit,
} from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, Link, useFetcher } from "@remix-run/react";

import { z } from "zod";
import { Form } from "~/components/custom-form";
import FormRow from "~/components/forms/form-row";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import { Spinner } from "~/components/shared/spinner";
import { Table, Td, Tr } from "~/components/table";
import { DeleteUser } from "~/components/user/delete-user";
import { db } from "~/database/db.server";
import { updateUserTierId } from "~/modules/tier/service.server";
import { deleteUser, getUserByID } from "~/modules/user/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import {
  data,
  error,
  getParams,
  isDelete,
  parseData,
} from "~/utils/http.server";
import { requireAdmin } from "~/utils/roles.server";

export type QrCodeWithAsset = Qr & {
  asset: {
    title: Asset["title"];
  };
};

export type UserWithQrCodes = User & {
  qrCodes: QrCodeWithAsset[];
};

export const loader = async ({ context, params }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { userId: shelfUserId } = getParams(
    params,
    z.object({ userId: z.string() }),
    { additionalData: { userId } }
  );

  try {
    await requireAdmin(userId);

    const user = await getUserByID(shelfUserId, {
      qrCodes: {
        orderBy: { createdAt: "desc" },
        include: {
          asset: {
            select: {
              title: true,
            },
          },
        },
      },
      customTierLimit: true,
    });

    const userOrganizations = await db.userOrganization
      .findMany({
        where: {
          userId: shelfUserId,
        },
        select: {
          organization: true,
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Failed to load user organizations",
          additionalData: { userId, shelfUserId },
          label: "Admin dashboard",
        });
      });

    return json(
      data({
        user,
        organizations: userOrganizations.map((uo) => uo.organization),
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, shelfUserId });
    throw json(error(reason), { status: reason.status });
  }
};

export const handle = {
  breadcrumb: () => "User details",
};

export const action = async ({
  context,
  request,
  params,
}: ActionFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { userId: shelfUserId } = getParams(
    params,
    z.object({ userId: z.string() }),
    { additionalData: { userId } }
  );

  try {
    await requireAdmin(userId);

    const { intent } = parseData(
      await request.clone().formData(),
      z.object({
        intent: z.enum(["updateTier", "updateCustomTierDetails"]),
      })
    );

    if (isDelete(request)) {
      await deleteUser(shelfUserId);

      sendNotification({
        title: "User deleted",
        message: "The user has been deleted successfully",
        icon: { name: "trash", variant: "error" },
        senderId: userId,
      });

      return redirect("/admin-dashboard");
    }

    switch (intent) {
      case "updateTier": {
        const { tierId } = parseData(
          await request.formData(),
          z.object({
            tierId: z.nativeEnum(TierId),
          })
        );

        const user = await updateUserTierId(shelfUserId, tierId);

        sendNotification({
          title: "Tier updated",
          message: `The user's tier has been updated successfully to ${user.tierId}`,
          icon: { name: "check", variant: "success" },
          senderId: userId,
        });

        break;
      }
      case "updateCustomTierDetails": {
        const { maxOrganizations } = parseData(
          await request.formData(),
          z.object({
            maxOrganizations: z.string().transform((val) => +val),
          })
        );

        await db.customTierLimit.upsert({
          where: { userId: shelfUserId },
          create: {
            userId: shelfUserId,
            maxOrganizations,
          },
          update: {
            maxOrganizations,
          },
        });

        break;
      }
    }

    return json(data(null));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, shelfUserId });
    return json(error(reason), { status: reason.status });
  }
};

export default function Area51UserPage() {
  const { user, organizations } = useLoaderData<typeof loader>();

  const hasCustomTier =
    user?.tierId === "custom" && user?.customTierLimit !== null;

  return user ? (
    <div>
      <div>
        <div className="flex justify-between">
          <h1>User: {user?.email}</h1>
          <div className="flex gap-3">
            <DeleteUser user={user} />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="w-[400px]">
            <ul className="mt-5">
              {user
                ? Object.entries(user)
                    .filter(
                      ([k, _v]) => !["qrCodes", "customTierLimit"].includes(k)
                    )
                    .map(([key, value]) => (
                      <li key={key}>
                        <span className="font-semibold">{key}</span>:{" "}
                        {key === "tierId" ? (
                          <TierUpdateForm tierId={user.tierId} />
                        ) : (
                          <>
                            {typeof value === "string" ? value : null}
                            {typeof value === "boolean" ? String(value) : null}
                          </>
                        )}
                      </li>
                    ))
                : null}
            </ul>
          </div>

          {hasCustomTier && (
            <div className="flex w-[400px] flex-col gap-2 bg-gray-200 p-4">
              <CustomTierDetailsForm customTierLimit={user.customTierLimit!} />
            </div>
          )}
        </div>
      </div>
      <div className="mt-10">
        <Table>
          <thead>
            <tr>
              <th className="border-b p-4 text-left text-gray-600 md:px-6">
                Name
              </th>
              <th className="border-b p-4 text-left text-gray-600 md:px-6">
                Type
              </th>
              <th className="border-b p-4 text-left text-gray-600 md:px-6">
                Created at
              </th>
              <th className="border-b p-4 text-left text-gray-600 md:px-6">
                Is Owner
              </th>
            </tr>
          </thead>
          <tbody>
            {organizations.map((org) => (
              <Tr key={org.id}>
                <Td>
                  <Link
                    to={`/admin-dashboard/org/${org.id}/assets`}
                    className="underline hover:text-gray-500"
                  >
                    {org.name}
                  </Link>
                </Td>
                <Td>{org.type}</Td>
                <Td>
                  <DateS date={org.createdAt} />
                </Td>
                <Td>{org.userId === user.id ? "yes" : "no"}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  ) : null;
}

function TierUpdateForm({ tierId }: { tierId: TierId }) {
  const fetcher = useFetcher();
  const disabled = isFormProcessing(fetcher.state);
  return (
    <fetcher.Form
      method="post"
      onChange={(e) => {
        const form = e.currentTarget;
        fetcher.submit(form);
      }}
      className="inline-flex items-center gap-2"
    >
      <input type="hidden" name="intent" value="updateTier" />
      <select
        style={{ all: "revert" }}
        disabled={disabled}
        defaultValue={tierId}
        name="tierId"
      >
        {Object.keys(TierId).map((tier) => (
          <option key={tier} value={tier}>
            {tier}
          </option>
        ))}
      </select>
      {disabled && <Spinner />}
    </fetcher.Form>
  );
}

function CustomTierDetailsForm({
  customTierLimit,
}: {
  customTierLimit: Pick<CustomTierLimit, "maxOrganizations">;
}) {
  return (
    <div>
      <h4>Custom tier details</h4>
      <p>
        NOTE: We have more fields but for custom tier for now, the only relevant
        one is number of workspaces so I only added this to form so we can ship
        faster. Fields that are not added are: <b>canImportAssets</b>,
        <b>canExportAssets</b>, <b>maxCustomFields</b>
      </p>
      <Form method="post">
        <FormRow
          rowLabel={"Max workspaces (organizations)"}
          className="block border-b-0 pb-0 [&>div]:lg:basis-auto"
          subHeading={
            "How many workspaces should this user be allowed to create/own? Keep in mind that the user always has 1 Personal workspace so you need to do the desired number + 1."
          }
          required
        >
          <Input
            label="Max workspaces (organizations)"
            name="maxOrganizations"
            type="number"
            min={1}
            max={1000}
            hideLabel
            className="disabled my-2 w-full"
            defaultValue={customTierLimit.maxOrganizations}
            required
          />
        </FormRow>

        <Button type="submit" name="intent" value="updateCustomTierDetails">
          Save
        </Button>
      </Form>
    </div>
  );
}
