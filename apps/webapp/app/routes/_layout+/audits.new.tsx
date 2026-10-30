/**
 * Dedicated audit creation page: `/audits/new`.
 *
 * The bulk "Start an audit" dialog on the assets index and the "Create audit"
 * actions on a location or kit page both need an existing selection. This
 * page is the entry point that needs none: the audit's details (name,
 * description, due date, assignee) sit at the top, the workspace's active
 * assets are picked from a filterable list below, and one submit creates the
 * audit and lands on its overview.
 *
 * The asset list is the same picker the location and kit "Manage assets"
 * routes use: rows toggle the shared bulk-selection atom, "select all" submits
 * the list's search params so the action resolves exactly the rows the list
 * showed, and the selection is reset by `AtomsResetHandler` on leaving.
 *
 * @see {@link file://./../api+/audits.start.ts} the bulk-dialog entry point
 * @see {@link file://./../../modules/audit/start-audit.server.ts} shared creation
 * @see {@link file://./locations.$locationId.assets.manage-assets.tsx} picker pattern
 */
import type { ChangeEvent } from "react";
import { useId, useState } from "react";
import type { Prisma } from "@prisma/client";
import { useAtomValue, useSetAtom } from "jotai";
import { DateTime } from "luxon";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, redirect, useActionData, useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
  setSelectedBulkItemAtom,
} from "~/atoms/list";
import { AssetImage } from "~/components/assets/asset-image/component";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";
import { ASSET_SORTING_OPTIONS } from "~/components/assets/assets-index/filters";
import { ListItemTagsColumn } from "~/components/assets/assets-index/list-item-tags-column";
import { CategoryBadge } from "~/components/assets/category-badge";
import AuditTeamMemberSelector from "~/components/audit/audit-team-member-selector";
import { AUDIT_DESCRIPTION_MAX_LENGTH } from "~/components/audit/start-audit-dialog-content";
import { Form } from "~/components/custom-form";
import DynamicDropdown from "~/components/dynamic-dropdown/dynamic-dropdown";
import Input from "~/components/forms/input";
import { ChevronRight } from "~/components/icons/library";
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { SortBy } from "~/components/list/filters/sort-by";
import { LocationBadge } from "~/components/location/location-badge";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { DateTimePicker } from "~/components/shared/date-time-picker";
import { Separator } from "~/components/shared/separator";
import { Td, Th } from "~/components/table";
import { db } from "~/database/db.server";
import { useSearchParams } from "~/hooks/search-params";
import { useDisabled } from "~/hooks/use-disabled";
import type { LOCATION_WITH_HIERARCHY } from "~/modules/asset/fields";
import { getAssetListWhereForSelectAll } from "~/modules/asset/list-where.server";
import { getPaginatedAndFilterableAssets } from "~/modules/asset/service.server";
import { getPrimaryLocation } from "~/modules/asset/utils";
import { CurrentSearchParamsSchema } from "~/modules/asset/utils.server";
import { startAudit } from "~/modules/audit/start-audit.server";
import { BaseAuditSchema } from "~/routes/api+/audits.start";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getClientHint } from "~/utils/client-hints";
import { DATE_TIME_FORMAT } from "~/utils/constants";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { assertIsPost, error, parseData, payload } from "~/utils/http.server";
import { ALL_SELECTED_KEY, isSelectingAllItems } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { AUDIT_ANY_PERFORMER_SENTENCE } from "~/utils/permissions/role-audience";
import { requirePermission } from "~/utils/roles.server";
import { canUseAudits } from "~/utils/subscription.server";

/** The `id` of the details form, so the footer's submit button can target it from outside. */
const NEW_AUDIT_FORM_ID = "new-audit-form";

/**
 * What the page submits: the shared audit fields plus the picked assets.
 * `assetIds` may hold `ALL_SELECTED_KEY` when the whole filtered list was
 * ticked; the action then expands it from `currentSearchParams`.
 *
 * This is the server-side schema. The client form uses
 * {@link NewAuditFormSchema}, which adds the due-date check: the action parses
 * the raw date in the user's own timezone instead.
 */
export const NewAuditSchema = BaseAuditSchema.extend({
  assetIds: z
    .array(z.string(), {
      required_error: "Select at least one asset to audit",
    })
    .min(1, "Select at least one asset to audit"),
});

/**
 * Client-side schema: {@link NewAuditSchema} plus a check that the due date,
 * read in the browser's own clock, lies in the future.
 */
export const NewAuditFormSchema = NewAuditSchema.refine(
  (values) => {
    if (!values.dueDate) return true;
    const parsed = DateTime.fromFormat(values.dueDate, DATE_TIME_FORMAT);
    return parsed.isValid && parsed > DateTime.now();
  },
  {
    message: "Due date must be in the future",
    path: ["dueDate"],
  }
);

/** The title and intro the page's header shows. */
export const newAuditHeader: HeaderData = {
  title: "New audit",
  subHeading:
    "Name the audit, optionally set a due date and an assignee, then pick the assets it should cover.",
};

/**
 * Lists one page of the workspace's active assets for the picker, with the
 * category, tag and location filter seeds.
 *
 * Only members who may create audits reach this page. Whether the workspace
 * has the audits add-on is decided by the parent `audits` layout, which
 * replaces this page with the unlock screen when it does not.
 *
 * @throws An error response when the caller may not create audits
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.create,
    });

    const {
      search,
      totalAssets,
      perPage,
      page,
      categories,
      tags,
      assets,
      totalPages,
      totalCategories,
      totalTags,
      locations,
      totalLocations,
    } = await getPaginatedAndFilterableAssets({
      request,
      organizationId,
      // The picker renders no custodian filter, so the seed is not fetched.
      canSeeAllCustody: false,
    });

    return payload({
      header: newAuditHeader,
      searchFieldLabel: "Search assets",
      searchFieldTooltip: {
        title: "Search your asset database",
        text: "Search assets based on asset name or description, category, tag, location, custodian name. Simply separate your keywords by a space: 'Laptop lenovo 2020'.",
      },
      items: assets,
      categories,
      tags,
      search,
      page,
      totalItems: totalAssets,
      perPage,
      totalPages,
      modelName: { singular: "asset", plural: "assets" },
      totalCategories,
      totalTags,
      locations,
      totalLocations,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header.title ?? newAuditHeader.title) },
];

export const handle = {
  breadcrumb: () => "New audit",
};

/**
 * Creates the audit from the submitted details and selection, then redirects
 * to its overview.
 *
 * "Select all" is expanded with the same query the list ran, so the audit
 * covers exactly the assets the picker showed under the current filters.
 * Explicit ids are checked against the workspace by `createAuditSession`.
 *
 * @returns A redirect to `/audits/:id/overview`, or an error response that
 *   carries the field errors for the form to show
 * @throws Never; every failure becomes the error response
 */
export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    assertIsPost(request);

    const { organizationId, currentOrganization } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.create,
    });

    // The layout hides the page without the add-on; a crafted POST must not
    // get past it.
    if (!canUseAudits(currentOrganization)) {
      throw new ShelfError({
        cause: null,
        title: "Audits are not enabled",
        message:
          "This workspace does not have the audits add-on. Enable it from the Audits page to create audits.",
        label: "Audit",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    const formData = await request.formData();
    const hints = getClientHint(request);

    const {
      name,
      description,
      assignee,
      assetIds: submittedAssetIds,
      currentSearchParams,
    } = parseData(formData, NewAuditSchema.and(CurrentSearchParamsSchema), {
      additionalData: { organizationId, userId },
    });

    let assetIds = submittedAssetIds;
    if (submittedAssetIds.includes(ALL_SELECTED_KEY)) {
      // The picker's own query, with the options its loader passed, so the
      // selection is the set the list showed: active assets, no custodian
      // filter, every other filter honoured.
      const where = await getAssetListWhereForSelectAll({
        organizationId,
        currentSearchParams,
        allowedTeamMemberIds: [],
        bookableScope: null,
        locationIdsOverride: undefined,
        honorArchivedView: false,
        honorLowStockFilter: false,
      });
      const allAssets = await db.asset.findMany({
        // `where` carries `archivedAt: null` from the list query.
        // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: the list's own where clause already scopes to active assets
        where,
        select: { id: true },
      });
      assetIds = allAssets.map((asset) => asset.id);
    }

    const { sessionId } = await startAudit({
      name,
      description,
      assetIds,
      assignee,
      // The raw form value: `startAudit` parses the wall clock in the acting
      // user's timezone preference.
      dueDateString: formData.get("dueDate")?.toString(),
      userId,
      organizationId,
      hints,
      resolveTimeZone: async () =>
        (await resolveUserFormatPrefsById(userId, hints)).timeZone,
    });

    return redirect(`/audits/${sessionId}/overview`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

/**
 * The creation page: audit details on top, the asset picker below, and a
 * footer that submits both.
 */
export default function NewAudit() {
  const { totalItems } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const actionData = useActionData<DataOrErrorResponse>();
  const disabled = useDisabled();

  /** Server-side errors, shown when client validation was bypassed or disagreed. */
  const validationErrors = getValidationErrors<typeof NewAuditSchema>(
    actionData?.error
  );
  const serverError = actionData?.error?.message;

  const zo = useZorm("NewAudit", NewAuditFormSchema);

  const [descriptionLength, setDescriptionLength] = useState(0);
  const descriptionCounterId = useId();
  const handleDescriptionChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setDescriptionLength(event.currentTarget.value.length);
  };

  const selectedBulkItems = useAtomValue(selectedBulkItemsAtom);
  const selectedBulkItemsCount = useAtomValue(selectedBulkItemsCountAtom);
  const updateItem = useSetAtom(setSelectedBulkItemAtom);
  const hasSelectedAllItems = isSelectingAllItems(selectedBulkItems);
  const selectedCount = hasSelectedAllItems
    ? totalItems
    : selectedBulkItemsCount;

  const assetIdsError =
    validationErrors?.assetIds?.message || zo.errors.assetIds()?.message;

  return (
    <div className="relative">
      <Header />

      <Form method="post" ref={zo.ref} id={NEW_AUDIT_FORM_ID} className="mt-4">
        <Card className="my-0 p-0">
          <div className="grid grid-cols-1 md:grid-cols-2 md:divide-x">
            <div className="p-4">
              <Input
                name={zo.fields.name()}
                label="Audit name"
                placeholder="Quarterly warehouse audit"
                error={
                  validationErrors?.name?.message || zo.errors.name()?.message
                }
                required
                disabled={disabled}
                className="mb-4"
              />

              <Input
                name={zo.fields.description()}
                label="Description"
                placeholder="Add context that will help auditors (optional)."
                inputType="textarea"
                rows={5}
                maxLength={AUDIT_DESCRIPTION_MAX_LENGTH}
                error={
                  validationErrors?.description?.message ||
                  zo.errors.description()?.message
                }
                disabled={disabled}
                className="mb-1"
                onChange={handleDescriptionChange}
                aria-describedby={descriptionCounterId}
              />
              <div
                id={descriptionCounterId}
                className="text-right text-xs text-gray-500"
                aria-live="polite"
              >
                {descriptionLength}/{AUDIT_DESCRIPTION_MAX_LENGTH}
              </div>

              <DateTimePicker
                mode="datetime"
                name={zo.fields.dueDate()}
                label="Due date"
                error={
                  validationErrors?.dueDate?.message ||
                  zo.errors.dueDate()?.message
                }
                disabled={disabled}
                className="mt-4"
              />
            </div>

            <div>
              <Separator className="md:hidden" />
              <p className="p-3 pb-0 font-medium">
                Select assignee (optional).
              </p>
              <p className="border-b p-3">
                {AUDIT_ANY_PERFORMER_SENTENCE} Choosing assignees also lets
                those people perform it, including several at different times.
              </p>
              <AuditTeamMemberSelector
                error={
                  validationErrors?.assignee?.message ||
                  zo.errors.assignee()?.message
                }
              />
            </div>
          </div>
        </Card>

        {/* The picked assets. With "select all" ticked the key stands in for
            every row and the list's own search params travel with it, so the
            action can expand it to the same set. */}
        {hasSelectedAllItems ? (
          <>
            <input type="hidden" name="assetIds[0]" value={ALL_SELECTED_KEY} />
            <input
              type="hidden"
              name="currentSearchParams"
              value={searchParams.toString()}
            />
          </>
        ) : (
          selectedBulkItems.map((asset, i) => (
            <input
              key={asset.id}
              type="hidden"
              name={`assetIds[${i}]`}
              value={asset.id}
            />
          ))
        )}
      </Form>

      <div className="mt-4 flex flex-col gap-2">
        <h3 className="text-lg font-semibold">Select assets</h3>
        <Filters
          slots={{
            "right-of-search": (
              <SortBy
                sortingOptions={ASSET_SORTING_OPTIONS}
                defaultSortingBy="createdAt"
              />
            ),
          }}
        >
          <div className="flex items-center gap-2 lg:gap-4">
            <DynamicDropdown
              trigger={
                <div className="flex h-6 cursor-pointer items-center gap-2">
                  Categories{" "}
                  <ChevronRight className="hidden rotate-90 md:inline" />
                </div>
              }
              model={{ name: "category", queryKey: "name" }}
              label="Filter by category"
              placeholder="Search categories"
              initialDataKey="categories"
              countKey="totalCategories"
            />
            <DynamicDropdown
              trigger={
                <div className="flex h-6 cursor-pointer items-center gap-2">
                  Tags <ChevronRight className="hidden rotate-90 md:inline" />
                </div>
              }
              model={{ name: "tag", queryKey: "name" }}
              label="Filter by tag"
              initialDataKey="tags"
              countKey="totalTags"
            />
            <DynamicDropdown
              trigger={
                <div className="flex h-6 cursor-pointer items-center gap-2">
                  Locations{" "}
                  <ChevronRight className="hidden rotate-90 md:inline" />
                </div>
              }
              model={{ name: "location", queryKey: "name" }}
              label="Filter by location"
              initialDataKey="locations"
              countKey="totalLocations"
              renderItem={({ metadata }) => (
                <div className="flex items-center gap-2">
                  <ImageWithPreview
                    thumbnailUrl={metadata.thumbnailUrl}
                    alt={metadata.name}
                    className="size-6 rounded-[2px]"
                  />
                  <div>{metadata.name}</div>
                </div>
              )}
            />
          </div>
        </Filters>

        <List
          ItemComponent={AssetRow}
          /** Clicking a row toggles the asset in the selection */
          navigate={(_assetId, item) => {
            updateItem(item);
          }}
          customEmptyStateContent={{
            title: "You haven't added any assets yet.",
            text: "Create assets first, then come back to audit them.",
            newButtonRoute: "/assets/new",
            newButtonContent: "New asset",
          }}
          bulkActions={<> </>}
          headerChildren={
            <>
              <Th>Location</Th>
              <Th>Category</Th>
              <Th>Tags</Th>
            </>
          }
        />
      </div>

      <footer className="sticky bottom-0 mt-4 flex items-center justify-between gap-4 rounded border bg-white px-4 py-3">
        <div className="min-w-0">
          <p>
            {selectedCount} asset{selectedCount === 1 ? "" : "s"} selected
          </p>
          {assetIdsError ? (
            <p className="text-sm text-error-500">{assetIdsError}</p>
          ) : null}
          {serverError && !validationErrors ? (
            <p className="text-sm text-error-500">{serverError}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 gap-3">
          <Button variant="secondary" to="/audits" disabled={disabled}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={NEW_AUDIT_FORM_ID}
            variant="primary"
            disabled={disabled}
          >
            {disabled ? "Creating..." : "Create audit"}
          </Button>
        </div>
      </footer>
    </div>
  );
}

/** One picker row: the asset's title, image and status, then its location, category and tags. */
type AssetRowItem = Prisma.AssetGetPayload<{
  include: {
    assetLocations: {
      select: { location: typeof LOCATION_WITH_HIERARCHY };
    };
    category: true;
    tags: true;
    // Model cover image for assets with no image of their own.
    assetModel: { select: { image: true; thumbnailImage: true } };
  };
}>;

/**
 * Renders one asset in the picker. Selection state is shown by the list's own
 * checkbox column; the row itself only describes the asset.
 */
function AssetRow({ item }: { item: AssetRowItem }) {
  const { tags, category } = item;
  const primaryLocation = getPrimaryLocation(item);

  return (
    <>
      <Td className="w-full min-w-[330px] p-0 md:p-0">
        <div className="flex items-center gap-3 p-4 md:pr-6">
          <div className="flex size-14 shrink-0 items-center justify-center">
            <AssetImage
              asset={{
                id: item.id,
                mainImage: item.mainImage,
                thumbnailImage: item.thumbnailImage,
                mainImageExpiration: item.mainImageExpiration,
                assetModel: item.assetModel ?? null,
              }}
              alt={`Image of ${item.title}`}
              className="size-full rounded-[4px] border object-cover"
            />
          </div>
          <div className="flex min-w-0 flex-col gap-y-1">
            <p className="word-break whitespace-break-spaces font-medium">
              {item.title}
            </p>
            <AssetStatusBadge
              id={item.id}
              status={item.status}
              availableToBook={item.availableToBook}
              asset={item}
            />
          </div>
        </div>
      </Td>

      <Td>
        {primaryLocation ? (
          <LocationBadge
            location={{
              id: primaryLocation.id,
              name: primaryLocation.name,
              parentId: primaryLocation.parentId ?? undefined,
              childCount: primaryLocation._count?.children ?? 0,
            }}
          />
        ) : null}
      </Td>

      <Td>
        <CategoryBadge category={category} />
      </Td>

      <Td className="text-left">
        <ListItemTagsColumn tags={tags} />
      </Td>
    </>
  );
}
