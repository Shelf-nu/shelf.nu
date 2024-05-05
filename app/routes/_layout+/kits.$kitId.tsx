import { json } from "@remix-run/node";
import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import { z } from "zod";
import ActionsDropdown from "~/components/kits/actions-dropdown";
import KitImage from "~/components/kits/kit-image";
import { KitStatusBadge } from "~/components/kits/kit-status-badge";
import ContextualModal from "~/components/layout/contextual-modal";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { ScanDetails } from "~/components/location/scan-details";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import TextualDivider from "~/components/shared/textual-divider";
import { Th } from "~/components/table";
import { useUserIsSelfService } from "~/hooks/user-user-is-self-service";
import { getKit } from "~/modules/kit/service.server";
import { getScanByQrId } from "~/modules/scan/service.server";
import { parseScanData } from "~/modules/scan/utils.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getDateTimeFormat } from "~/utils/client-hints";
import { makeShelfError } from "~/utils/error";
import { data, error, getParams } from "~/utils/http.server";
import { parseMarkdownToReact } from "~/utils/md.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { kitId } = getParams(
    params,
    z.object({
      kitId: z.string(),
    })
  );

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.read,
    });

    const { kit, assets } = await getKit({
      id: kitId,
      organizationId,
      request,
    });

    /** We get the first QR code(for now we can only have 1)
     * And using the ID of that qr code, we find the latest scan
     */
    const lastScan = kit.qrCodes[0]?.id
      ? parseScanData({
          scan: (await getScanByQrId({ qrId: kit.qrCodes[0].id })) ?? null,
          userId,
          request,
        })
      : null;

    const notes = kit.notes.map((note) => ({
      ...note,
      dateDisplay: getDateTimeFormat(request, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(note.createdAt),
      content: parseMarkdownToReact(note.content),
    }));

    let custody = null;
    if (kit.custody) {
      const date = new Date(kit.custody.createdAt);
      const dateDisplay = getDateTimeFormat(request, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);

      custody = {
        ...kit.custody,
        dateDisplay,
      };
    }

    const header: HeaderData = {
      title: kit.name,
    };

    const modelName = {
      singular: "asset",
      plural: "assets",
    };

    return json(
      data({
        kit: {
          ...kit,
          custody,
          notes,
        },
        lastScan,
        header,
        ...assets,
        modelName,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason));
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header?.title) },
];

export const handle = {
  breadcrumb: () => "single",
};

export default function KitDetails() {
  const navigate = useNavigate();
  const { kit } = useLoaderData<typeof loader>();

  const isSelfService = useUserIsSelfService();
  const kitIsAvailable = kit.status === "AVAILABLE";

  return (
    <>
      <Header
        subHeading={<KitStatusBadge status={kit.status} availableToBook />}
      >
        {!isSelfService ? (
          <>
            <Button to="qr" variant="secondary" icon="barcode">
              View QR code
            </Button>
            <ActionsDropdown />
          </>
        ) : null}
      </Header>

      <ContextualModal />

      <div className="mt-8 lg:flex">
        <div className="shrink-0 overflow-hidden lg:w-[343px] xl:w-[400px]">
          <KitImage
            kit={{
              kitId: kit.id,
              image: kit.image,
              imageExpiration: kit.imageExpiration,
              alt: kit.name,
            }}
            className={tw(
              "h-auto w-full rounded border object-cover",
              kit.description ? "rounded-b-none border-b-0" : ""
            )}
          />
          {kit.description ? (
            <Card className="mb-3 mt-0 rounded-t-none border-t-0">
              <p className="whitespace-pre-wrap text-gray-600">
                {kit.description}
              </p>
            </Card>
          ) : null}

          {/* Kit Custody */}
          {!isSelfService && !kitIsAvailable && kit?.custody?.createdAt ? (
            <Card className="my-3">
              <div className="flex items-center gap-3">
                <img
                  src="/static/images/default_pfp.jpg"
                  alt="custodian"
                  className="size-10 rounded"
                />
                <div>
                  <p className="">
                    In custody of{" "}
                    <span className="font-semibold">
                      {kit.custody?.custodian.name}
                    </span>
                  </p>
                  <span>Since {kit.custody.dateDisplay}</span>
                </div>
              </div>
            </Card>
          ) : null}

          <TextualDivider text="Details" className="mb-8 lg:hidden" />
          <Card className="my-3 flex justify-between">
            <span className="text-xs font-medium text-gray-600">ID</span>
            <div className="max-w-[250px] font-medium">{kit.id}</div>
          </Card>

          {!isSelfService ? <ScanDetails /> : null}
        </div>

        <div className="w-full lg:ml-6">
          <List
            ItemComponent={ListContent}
            navigate={(itemId) => navigate(`/assets/${itemId}`)}
            className=" overflow-x-visible md:overflow-x-auto"
            customEmptyStateContent={{
              title: "Not assets in kit",
              text: "Start by adding your first asset.",
              newButtonContent: "Manage assets",
              newButtonRoute: "manage-assets",
            }}
            headerChildren={
              <>
                <Th className="hidden md:table-cell">Name</Th>
                <Th className="hidden md:table-cell">Category</Th>
                <Th className="hidden md:table-cell">Location</Th>
              </>
            }
          />
        </div>
      </div>
    </>
  );
}

function ListContent() {
  return <div>List</div>;
}
