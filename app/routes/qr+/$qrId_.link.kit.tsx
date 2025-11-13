import { useState } from "react";
import type { Kit } from "@prisma/client";
import type {
  MetaFunction,
  LoaderFunctionArgs,
  LinksFunction,
} from "react-router";
import { data, redirect , useFetcher, useLoaderData, useParams } from "react-router";
import { useHydrated } from "remix-utils/use-hydrated";
import { z } from "zod";
import DynamicDropdown from "~/components/dynamic-dropdown/dynamic-dropdown";
import { ErrorContent } from "~/components/errors";
import { ChevronRight, LinkIcon } from "~/components/icons/library";
import KitImage from "~/components/kits/kit-image";
import Header from "~/components/layout/header";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { Button } from "~/components/shared/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/shared/modal";
import { Td } from "~/components/table";
import When from "~/components/when/when";
import { db } from "~/database/db.server";

import { useViewportHeight } from "~/hooks/use-viewport-height";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import {
  getPaginatedAndFilterableKits,
  updateKitQrCode,
} from "~/modules/kit/service.server";
import { getQr } from "~/modules/qr/service.server";
import css from "~/styles/link-existing-asset.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError, notAllowedMethod, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import {
  payload,
  error,
  getActionMethod,
  getCurrentSearchParams,
  getParams,
  parseData,
} from "~/utils/http.server";

import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";

export const loader = async ({
  context,
  request,
  params,
}: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { qrId } = getParams(params, z.object({ qrId: z.string() }));

  try {
    const qr = await getQr({ id: qrId });
    if (qr?.assetId || qr?.kitId) {
      throw new ShelfError({
        message: "This QR code is already linked to an asset or a kit.",
        title: "QR already linked",
        label: "QR",
        status: 403,
        cause: null,
        shouldBeCaptured: false,
      });
    }

    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.qr,
      action: PermissionAction.update,
    });

    const searchParams = getCurrentSearchParams(request);
    const [
      { kits, totalKits, perPage, page, totalPages, search },
      teamMembers,
      totalTeamMembers,
    ] = await Promise.all([
      getPaginatedAndFilterableKits({
        request,
        organizationId,
        extraInclude: {
          assets: {
            select: { id: true, availableToBook: true, status: true },
          },
        },
      }),
      db.teamMember
        .findMany({
          where: { deletedAt: null, organizationId },
          include: { user: true },
          orderBy: { userId: "asc" },
          take: searchParams.get("getAll") === "teamMember" ? undefined : 12,
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            message:
              "Something went wrong while fetching team members. Please try again or contact support.",
            additionalData: { userId, organizationId },
            label: "Assets",
          });
        }),
      db.teamMember.count({ where: { deletedAt: null, organizationId } }),
    ]);

    if (totalPages !== 0 && page > totalPages) {
      return redirect(".");
    }

    const modelName = {
      singular: "kit",
      plural: "kits",
    };

    return payload({
      header: {
        title: "Link with existing asset",
        subHeading: "Choose an asset to link with this QR tag.",
      },
      qrId,
      items: kits,
      search,
      page,
      totalItems: totalKits,
      perPage,
      totalPages,
      modelName,
      searchFieldLabel: "Search kits",
      searchFieldTooltip: {
        title: "Search your kits database",
        text: "Search kits based on name or description.",
      },
      teamMembers,
      totalTeamMembers,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, qrId });
    throw data(error(reason), { status: reason.status });
  }
};

export const action = async ({
  context,
  request,
  params,
}: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { qrId } = getParams(params, z.object({ qrId: z.string() }));

  try {
    const method = getActionMethod(request);
    if (method !== "POST") throw notAllowedMethod(method);

    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.qr,
      action: PermissionAction.update,
    });
    const { kitId } = parseData(
      await request.formData(),
      z.object({ kitId: z.string() })
    );

    await updateKitQrCode({
      newQrId: qrId,
      kitId,
      organizationId,
    });

    return redirect(`/qr/${qrId}/successful-link?type=kit`);
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(error(reason), { status: reason.status });
  }
};

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header.title) },
];

export const links: LinksFunction = () => [{ rel: "stylesheet", href: css }];

export default function QrLinkExisting() {
  const { header } = useLoaderData<typeof loader>();
  const { qrId } = useParams();
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const { roles } = useUserRoleHelper();

  /** The id of the asset the user selected to update */
  const [selectedKitId, setSelectedKitId] = useState<string>("");

  function handleSelectKit(kitId: string) {
    setConfirmOpen(true);
    setSelectedKitId(kitId);
  }

  const isHydrated = useHydrated();
  const { vh } = useViewportHeight();
  const maxHeight = isHydrated ? vh - 12 + "px" : "100%"; // We need to handle SSR and we are also substracting 12px to properly handle spacing on the bottom

  return (
    <div className="flex flex-1 flex-col" style={{ maxHeight }}>
      <Header {...header} hideBreadcrumbs={true} classNames="text-left" />

      <Filters className="-mx-4 border-b px-4 py-3">
        <div className="flex flex-1 justify-center pt-3">
          <When
            truthy={userHasPermission({
              roles,
              entity: PermissionEntity.qr,
              action: PermissionAction.update,
            })}
          >
            <DynamicDropdown
              trigger={
                <div className="flex cursor-pointer items-center gap-2">
                  Custodian{" "}
                  <ChevronRight className="hidden rotate-90 md:inline" />
                </div>
              }
              model={{ name: "teamMember", queryKey: "name", deletedAt: null }}
              label="Filter by custodian"
              placeholder="Search team members"
              countKey="totalTeamMembers"
              initialDataKey="teamMembers"
              transformItem={(item) => ({
                ...item,
                id: item.metadata?.userId ? item.metadata.userId : item.id,
              })}
              renderItem={(item) => resolveTeamMemberName(item)}
            />
          </When>
        </div>
      </Filters>

      {/* Body of the modal*/}

      <div className="-mx-4 flex-1 overflow-y-auto px-4 pb-4">
        <List
          ItemComponent={RowComponent}
          /** Clicking on the row will add the current asset to the atom of selected assets */
          navigate={handleSelectKit}
          customEmptyStateContent={{
            title: "You haven't added any kits yet.",
            text: "What are you waiting for? Create your first kit now!",
            newButtonRoute: `/kits/new?qrId=${qrId}`,
            newButtonContent: "Create new kit and link",
          }}
          className="h-full border-t-0"
        />
      </div>
      <ConfirmLinkingKitModal
        open={confirmOpen}
        kitId={selectedKitId}
        onCancel={() => {
          // Reset the selected kit id and close the modal
          setSelectedKitId("");
          setConfirmOpen(false);
        }}
      />

      {/* Footer of the modal */}
      <footer className="-mx-4 flex justify-between border-t px-4 pt-3">
        <Button variant="secondary" to={`/qr/${qrId}/link`} width="full">
          Close
        </Button>
      </footer>
    </div>
  );
}

const RowComponent = ({ item }: { item: Kit }) => (
  <>
    <Td className="w-full p-0 md:p-0">
      <div className="flex justify-between gap-3 p-4 md:px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center">
            <KitImage
              kit={{
                kitId: item.id,
                image: item.image,
                imageExpiration: item.imageExpiration,
                alt: item.name,
              }}
              className="size-full rounded-[4px] border object-cover"
            />
          </div>
          <div className="flex flex-col">
            <p className="word-break whitespace-break-spaces text-left font-medium">
              {item.name}
            </p>
          </div>
        </div>
      </div>
    </Td>

    <Td>
      <ChevronRight />
    </Td>
  </>
);

export const ConfirmLinkingKitModal = ({
  kitId,
  open = false,
  onCancel,
}: {
  kitId: string;
  open: boolean;
  /**
   * Runs when the modal is closed
   */
  onCancel: () => void;
}) => {
  const { items: kits } = useLoaderData<typeof loader>();
  const kit = kits.find((a) => a.id === kitId);
  const fetcher = useFetcher<typeof action>();
  const { data, state } = fetcher;
  const disabled = isFormProcessing(state);

  return kit ? (
    <AlertDialog
      open={open}
      /**
       * When the modal is closed, we want to set the state to false by using the callback
       */
      onOpenChange={(v) => (!v ? onCancel() : null)}
    >
      <AlertDialogContent className="w-[calc(100vw-32px)]">
        <AlertDialogHeader>
          <span className="flex size-12 items-center justify-center rounded-full bg-primary-50 p-2 text-primary-600">
            <LinkIcon />
          </span>
          <AlertDialogTitle className="text-left">
            Link QR code with ‘{kit.name}’
          </AlertDialogTitle>
          <AlertDialogDescription className="text-left">
            Are you sure that you want to do this? The current QR code that is
            linked to this kit will be unlinked. You can always re-link it with
            the old QR code.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel asChild>
            <Button variant="secondary" disabled={disabled}>
              Cancel
            </Button>
          </AlertDialogCancel>

          <fetcher.Form method="post">
            <input type="hidden" name="kitId" value={kit.id} />
            <Button
              type="submit"
              data-test-id="confirmLinkKitButton"
              width="full"
              disabled={disabled}
            >
              Confirm
            </Button>
          </fetcher.Form>
          {data?.error ? (
            <div className="flex flex-col items-center">
              <div className={tw(`mb-2 h-6 text-center text-red-600`)}>
                {data.error.message}
              </div>
            </div>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : null;
};

export const ErrorBoundary = () => <ErrorContent />;
