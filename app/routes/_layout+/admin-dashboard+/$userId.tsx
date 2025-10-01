import type { ReactNode } from "react";
import {
  TierId,
  type Asset,
  type Qr,
  type User,
  type CustomTierLimit,
  OrganizationRoles,
} from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  SerializeFrom,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Link, useFetcher } from "@remix-run/react";

import { z } from "zod";
import { Form } from "~/components/custom-form";
import FormRow from "~/components/forms/form-row";
import Input from "~/components/forms/input";
import { Switch } from "~/components/forms/switch";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import { Spinner } from "~/components/shared/spinner";
import { SubscriptionsOverview } from "~/components/subscription/subscriptions-overview";
import { Table, Td, Th, Tr } from "~/components/table";
import { DeleteUser } from "~/components/user/delete-user";
import { db } from "~/database/db.server";
import { useDisabled } from "~/hooks/use-disabled";
import { updateUserTierId } from "~/modules/tier/service.server";
import { softDeleteUser, getUserByID } from "~/modules/user/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  data,
  error,
  getParams,
  isDelete,
  parseData,
} from "~/utils/http.server";
import { requireAdmin } from "~/utils/roles.server";
import type { CustomerWithSubscriptions } from "~/utils/stripe.server";
import {
  createStripeCustomer,
  getOrCreateCustomerId,
  getStripeCustomer,
  getStripePricesAndProducts,
} from "~/utils/stripe.server";

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
      businessIntel: true,
    });

    const userOrganizations = await db.userOrganization
      .findMany({
        where: {
          userId: shelfUserId,
        },
        select: {
          organization: {
            include: {
              ssoDetails: true,
              userOrganizations: {
                // Include ALL users in each org with SSO enabled so we cna count them
                where: {
                  user: {
                    sso: true,
                  },
                },
                select: {
                  userId: true,
                },
              },
            },
          },
          roles: true,
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

    /** Which organizations of the user have SSO enabled */
    const organizationsOwnedByUserWithSso = userOrganizations.filter(
      (uo) =>
        uo.organization.enabledSso &&
        uo.organization.ssoDetails &&
        uo.roles.some((role) => role === OrganizationRoles.OWNER)
    );

    /** Process the data you already have - no second query needed! */
    const usersByDomain = organizationsOwnedByUserWithSso.reduce(
      (acc, uo) => {
        const domain = uo.organization.ssoDetails?.domain;

        if (domain) {
          if (!acc[domain]) {
            acc[domain] = new Set<string>();
          }
          // Add all SSO users from this organization
          uo.organization.userOrganizations.forEach((userOrg) => {
            acc[domain].add(userOrg.userId);
          });
        }

        return acc;
      },
      {} as Record<string, Set<string>>
    );

    /** Convert Sets to counts */
    const ssoUsersByDomain = Object.entries(usersByDomain).reduce(
      (acc, [domain, userSet]) => {
        acc[domain] = userSet.size;
        return acc;
      },
      {} as Record<string, number>
    );

    /** Get the Stripe customer */
    const customer = (await getStripeCustomer(
      await getOrCreateCustomerId(user)
    )) as CustomerWithSubscriptions;

    /* Get the prices and products from Stripe */
    const prices = await getStripePricesAndProducts();
    return json(
      data({
        user,
        organizations: userOrganizations.map((uo) => uo.organization),
        ssoUsersByDomain,
        customer,
        prices,
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
        intent: z.enum([
          "updateTier",
          "updateCustomTierDetails",
          "createCustomerId",
          "deleteUser",
          "toggleSubscriptionCheck",
        ]),
      })
    );

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
        const { maxOrganizations, isEnterprise } = parseData(
          await request.formData(),
          z.object({
            maxOrganizations: z.string().transform((val) => +val),
            isEnterprise: z
              .string()
              .optional()
              .transform((val) => (val === "on" ? true : false)),
          })
        );

        await db.customTierLimit.upsert({
          where: { userId: shelfUserId },
          create: {
            userId: shelfUserId,
            maxOrganizations,
            isEnterprise,
          },
          update: {
            maxOrganizations,
            isEnterprise,
          },
        });

        break;
      }
      case "deleteUser":
        if (isDelete(request)) {
          await softDeleteUser(shelfUserId);

          sendNotification({
            title: "User deleted",
            message: "The user has been deleted successfully",
            icon: { name: "trash", variant: "error" },
            senderId: userId,
          });
          return json(data({ success: true }));
        }
      case "createCustomerId": {
        const user = await getUserByID(shelfUserId);
        await createStripeCustomer({
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          userId: user.id,
        });
        return json(data(null));
      }
      case "toggleSubscriptionCheck": {
        const { skipSubscriptionCheck } = parseData(
          await request.formData(),
          z.object({
            skipSubscriptionCheck: z.coerce.boolean(),
          })
        );

        await db.user.update({
          where: { id: shelfUserId },
          data: { skipSubscriptionCheck },
        });

        sendNotification({
          title: "Subscription check updated",
          message: `The user's subscription check has been ${
            skipSubscriptionCheck ? "disabled" : "enabled"
          } successfully`,
          icon: { name: "check", variant: "success" },
          senderId: userId,
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
  // Get the loader data type
  type LoaderData = SerializeFrom<typeof loader>;

  const { user, organizations, ssoUsersByDomain, customer, prices } =
    useLoaderData<LoaderData>();
  const hasCustomTier =
    user?.tierId === "custom" && user?.customTierLimit !== null;
  // Extract user type from loader data
  type User = NonNullable<LoaderData["user"]>;
  type BusinessIntel = NonNullable<User["businessIntel"]>;

  const renderValue = (key: keyof User, value: User[keyof User]): ReactNode => {
    switch (key) {
      case "tierId":
        return <TierUpdateForm tierId={user.tierId} />;
      case "customerId":
        return !value ? (
          <Form className="inline-block" method="POST">
            <input type="hidden" name="intent" value="createCustomerId" />
            <Button type="submit" variant="link" size="sm">
              Create customer ID
            </Button>
          </Form>
        ) : (
          <>
            <Button
              to={`https://dashboard.stripe.com/customers/${value}`}
              target="_blank"
              variant={"block-link"}
            >
              {value}
            </Button>
          </>
        );
      case "skipSubscriptionCheck":
        return (
          <SubscriptionCheckUpdateForm
            skipSubscriptionCheck={user.skipSubscriptionCheck}
          />
        );
      default:
        return typeof value === "string"
          ? value
          : typeof value === "boolean"
          ? String(value)
          : null;
    }
  };
  const renderBusinessIntelValue = (
    value: BusinessIntel[keyof BusinessIntel]
  ): ReactNode => {
    if (value === null || value === undefined) {
      return "—";
    }

    if (typeof value === "string" && value.trim().length === 0) {
      return "—";
    }

    return value;
  };
  const businessIntelExcludedFields = new Set<keyof BusinessIntel>([
    "id",
    "userId",
    "createdAt",
    "updatedAt",
  ]);
  const hasSubscription = (customer?.subscriptions?.total_count ?? 0) > 0;

  return user ? (
    <div>
      <div>
        <div className="flex justify-between">
          <h1>User: {user?.email}</h1>
          <DeleteUser />
        </div>
        <div className="flex gap-4">
          <div className="w-[400px]">
            <ul className="mt-5">
              {user
                ? Object.entries(user)
                    .filter(
                      ([k, _v]) =>
                        ![
                          "qrCodes",
                          "customTierLimit",
                          "businessIntel",
                        ].includes(k)
                    )
                    .map(([key, value]) => (
                      <li key={key}>
                        <span className="font-semibold">{key}</span>:{" "}
                        {renderValue(key as keyof User, value)}
                      </li>
                    ))
                : null}
            </ul>
            {user.businessIntel ? (
              <div className="mt-6">
                <h4 className="font-semibold">Business intel</h4>
                <ul className="mt-2 space-y-1">
                  {Object.entries(user.businessIntel)
                    .filter(
                      ([key]) =>
                        !businessIntelExcludedFields.has(
                          key as keyof BusinessIntel
                        )
                    )
                    .map(([key, value]) => (
                      <li key={key}>
                        <span className="font-semibold">{key}</span>:{" "}
                        {renderBusinessIntelValue(
                          value as BusinessIntel[keyof BusinessIntel]
                        )}
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
          </div>

          {hasCustomTier && (
            <div className="flex w-[400px] flex-col gap-2 bg-gray-200 p-4">
              <CustomTierDetailsForm customTierLimit={user.customTierLimit!} />
            </div>
          )}
          <div>
            <SsoUsersByDomainTable ssoUsersByDomain={ssoUsersByDomain} />
          </div>
          <div>
            <h3>User subscriptions</h3>
            {!hasSubscription ? (
              <div>No subscription found</div>
            ) : (
              <SubscriptionsOverview customer={customer} prices={prices} />
            )}
          </div>
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
              <th className="border-b p-4 text-left text-gray-600 md:px-6">
                SSO
              </th>
              <th className="border-b p-4 text-left text-gray-600 md:px-6">
                Workspace disabled
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
                <Td>{org.enabledSso ? "yes" : "no"}</Td>
                <Td>{org.workspaceDisabled ? "yes" : "no"}</Td>
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
  const disabled = useDisabled(fetcher);
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

function SubscriptionCheckUpdateForm({
  skipSubscriptionCheck,
}: {
  skipSubscriptionCheck: boolean;
}) {
  const fetcher = useFetcher();
  const disabled = useDisabled(fetcher);
  return (
    <fetcher.Form
      method="post"
      onChange={(e) => {
        const form = e.currentTarget;
        fetcher.submit(form);
      }}
      className="inline-flex items-center gap-2"
    >
      <input type="hidden" name="intent" value="toggleSubscriptionCheck" />

      <input
        type="checkbox"
        name="skipSubscriptionCheck"
        defaultChecked={skipSubscriptionCheck}
        disabled={disabled}
      />
    </fetcher.Form>
  );
}

function CustomTierDetailsForm({
  customTierLimit,
}: {
  customTierLimit: Pick<CustomTierLimit, "maxOrganizations" | "isEnterprise">;
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
          rowLabel="Is Enterprise?"
          className="block border-b-0 pb-0 [&>div]:lg:basis-auto"
        >
          <div className="flex items-center gap-3">
            <Switch
              name={"isEnterprise"}
              defaultChecked={customTierLimit.isEnterprise}
            />
          </div>
        </FormRow>

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

interface SsoUsersByDomainTableProps {
  ssoUsersByDomain: Record<string, number>;
}
const SsoUsersByDomainTable = ({
  ssoUsersByDomain,
}: SsoUsersByDomainTableProps) => {
  // Convert object to array and sort by domain name for consistent display
  const sortedDomains = Object.entries(ssoUsersByDomain).sort(
    ([domainA], [domainB]) => domainA.localeCompare(domainB)
  );

  if (sortedDomains.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500">
        No SSO users found in workspaces owned by this user.
      </div>
    );
  }

  const totalUsers = sortedDomains.reduce((sum, [, count]) => sum + count, 0);

  return (
    <div className="flex flex-col bg-gray-200 p-4">
      <h4>SSO user count</h4>

      <div className="">
        <table className="w-full border">
          <thead className="bg-gray-50">
            <Tr>
              <Th className="">Domain</Th>
              <Th className="whitespace-nowrap">SSO Users</Th>
            </Tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {sortedDomains.map(([domain, userCount]) => (
              <Tr key={domain} className="transition-colors hover:bg-gray-50">
                <Td className="max-w-none">{domain}</Td>
                <Td className="text-right">{userCount.toLocaleString()}</Td>
              </Tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-gray-200 bg-gray-50">
            <Tr>
              <Td className="px-4 py-3 text-sm font-semibold text-gray-800">
                Total
              </Td>
              <Td className="px-4 py-3 text-right font-mono text-sm font-semibold text-gray-800">
                {totalUsers.toLocaleString()}
              </Td>
            </Tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};
