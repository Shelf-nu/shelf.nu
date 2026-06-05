import { useMemo, useRef, useState } from "react";
import type { Asset, Barcode, Qr } from "@prisma/client";
import { AssetType, ConsumptionType } from "@prisma/client";
import {
  Popover,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
} from "@radix-ui/react-popover";
import { useAtom, useAtomValue } from "jotai";
import {
  useActionData,
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
} from "react-router";
import type { Tag } from "react-tag-autocomplete";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { updateDynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { fileErrorAtom, assetImageValidateFileAtom } from "~/atoms/file";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { getPrimaryKit, isQuantityTracked } from "~/modules/asset/utils";
import type {
  AssetEditLoaderData,
  loader,
} from "~/routes/_layout+/assets.$assetId_.edit";
import { ACCEPT_SUPPORTED_IMAGES } from "~/utils/constants";
import type { CustomFieldZodSchema } from "~/utils/custom-fields";
import { mergedSchema } from "~/utils/custom-fields";
import { isFormProcessing } from "~/utils/form";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { useBarcodePermissions } from "~/utils/permissions/use-barcode-permissions";
import { tw } from "~/utils/tw";
import { AssetImage } from "./asset-image";
import { AssetModelFormRow } from "./asset-model-form-row";
import {
  BulkCreateSuccessModal,
  type BulkCreateSuccess,
} from "./bulk-create-success-modal";
import AssetCustomFields from "./custom-fields-inputs";
import { PreferredBarcodeFormRow } from "./preferred-barcode-form-row";
import { UnlockBarcodesBanner } from "../barcode/unlock-barcodes-banner";
import { Form } from "../custom-form";
import DynamicSelect from "../dynamic-select/dynamic-select";
import BarcodesInput, { type BarcodesInputRef } from "../forms/barcodes-input";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { RefererRedirectInput } from "../forms/referer-redirect-input";
import ImageWithPreview from "../image-with-preview/image-with-preview";
import InlineEntityCreationDialog from "../inline-entity-creation-dialog/inline-entity-creation-dialog";
import { Button } from "../shared/button";
import { ButtonGroup } from "../shared/button-group";
import { Card } from "../shared/card";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../shared/hover-card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";
import { TagsAutocomplete } from "../tag/tags-autocomplete";
import When from "../when/when";

export const NewAssetFormSchema = z.object({
  // Title is required in single-create mode. In bulk mode the form
  // submits the rendered first-preview title to satisfy this check
  // (the bulk action ignores `title` and uses `nameTemplate` instead).
  title: z
    .string()
    .min(2, "Name is required")
    .transform((val) => val.trim()), // We trim to avoid white spaces at start and end

  description: z.string().transform((val) => val.trim()),
  category: z.string(),
  assetModelId: z.string().optional(),

  // ── Bulk-create extension fields ──────────────────────────────────
  // `bulk` is the mode discriminator the action reads to branch to the
  // bulkCreateAssetsFromModel service. The other three are raw string
  // passthroughs validated server-side via bulkCreateAssetsFromModel
  // (which throws labelled 400 ShelfErrors with row-friendly messages).
  bulk: z.string().optional(),
  count: z.string().optional(),
  nameTemplate: z.string().optional(),
  startNumber: z.string().optional(),
  newLocationId: z.string().optional(),
  /** This holds the value of the current location. We need it for comparison reasons on the server.
   * We send it as part of the form data and compare it with the current location of the asset and prevent querying the database if it's the same.
   */
  currentLocationId: z.string().optional(),
  qrId: z.string().optional(),
  tags: z.string().optional(),
  /**
   * Per-asset override of which Barcode to display in list views. Empty
   * string means "use workspace default" (resolver follows
   * `Organization.qrIdDisplayPreference`). A non-empty value must match
   * one of this asset's persisted barcode ids — enforced server-side.
   */
  preferredBarcodeId: z
    .string()
    .optional()
    .transform((val) => (val && val.length > 0 ? val : null)),
  valuation: z
    .string()
    .optional()
    .transform((val) => (val ? +val : null)),
  addAnother: z
    .string()
    .optional()
    .transform((val) => val === "true"),
  redirectTo: z.string().optional(),

  // Tracking method & quantity fields
  type: z.nativeEnum(AssetType).default(AssetType.INDIVIDUAL),
  quantity: z
    .string()
    .optional()
    .transform((val) => (val === "" || val === undefined ? undefined : +val))
    .pipe(
      z
        .number({ invalid_type_error: "Quantity must be a number" })
        .int("Quantity must be a whole number")
        .positive("Quantity is required and must be at least 1")
        .optional()
    ),
  minQuantity: z
    .string()
    .optional()
    .transform((val) => (val === "" || val === undefined ? null : +val))
    .pipe(
      z
        .number({ invalid_type_error: "Min quantity must be a number" })
        .int("Min quantity must be a whole number")
        .positive("Min quantity must be at least 1")
        .nullable()
    ),
  consumptionType: z
    .nativeEnum(ConsumptionType, {
      errorMap: () => ({ message: "Please select a consumption type" }),
    })
    .optional(),
  unitOfMeasure: z
    .string()
    .optional()
    .refine(
      (v) => !v || !/{%|%}/.test(v),
      "Unit of measure may not contain Markdoc syntax (`{%` / `%}`)"
    ),
});

/**
 * Bulk-create variant of `NewAssetFormSchema`. Extends the base shape
 * (via Zod's `.extend()` which keeps the result as a `ZodObject`, so
 * `mergedSchema` still accepts it) and tightens the fields the bulk
 * flow needs to validate client-side:
 *
 * - `assetModelId` → required (the whole point of the flow; defaults
 *   for category + valuation flow from it)
 * - `nameTemplate` → required (otherwise we can't render N titles)
 * - `count`        → required, whole number between 2 and 100 (server
 *   re-validates with the same bounds in `bulkCreateAssetsFromModel`)
 *
 * The server picks this schema instead of `NewAssetFormSchema` when
 * the request carries `bulk=1`, so client-side Zorm errors and
 * server-side validation messages line up.
 */
export const NewAssetBulkFormSchema = NewAssetFormSchema.extend({
  assetModelId: z.string().min(1, "Please select an asset model"),
  nameTemplate: z
    .string()
    .min(1, "Name template is required")
    .transform((val) => val.trim()),
  count: z
    .string()
    .transform((val) =>
      val === "" || val === undefined ? Number.NaN : Number(val)
    )
    .pipe(
      z
        .number({ invalid_type_error: "Count must be a number" })
        .int("Count must be a whole number")
        .min(2, "Count must be at least 2")
        .max(100, "Count must be at most 100")
    ),
});

/** Pass props of the values to be used as default for the form fields */

type Props = Partial<
  Pick<
    Asset,
    | "id"
    | "sequentialId"
    | "title"
    | "thumbnailImage"
    | "mainImage"
    | "mainImageExpiration"
    | "categoryId"
    | "assetModelId"
    | "description"
    | "valuation"
    | "type"
    | "quantity"
    | "minQuantity"
    | "consumptionType"
    | "unitOfMeasure"
    | "preferredBarcodeId"
  >
> & {
  qrId?: Qr["id"] | null;
  tags?: Tag[];
  barcodes?: Pick<Barcode, "id" | "value" | "type">[];
  referer?: string | null;
  /**
   * Location is not a column on `Asset` — it lives on the `AssetLocation`
   * pivot. Callers derive the single primary-location id via
   * `getPrimaryLocation()` and pass it explicitly.
   */
  locationId?: string | null;
  /**
   * When `true`, the form renders in bulk-create mode:
   * - The Title field is replaced with Name template + Count + Start at
   *   inputs (and the rendered first preview is also submitted as `title`
   *   so the shared schema still validates).
   * - Tracking method is forced to INDIVIDUAL (qty-tracked stock pools
   *   are single-create + restock, not bulk).
   * - Custodian, QR, and Barcodes sections are hidden — they don't
   *   make sense as shared values across N assets.
   * - AssetModel becomes required (the whole point of bulk-create).
   * - A hidden `bulk=1` field flags the server-side action to route
   *   through `bulkCreateAssetsFromModel` instead of `createAsset`.
   * Default `false` preserves the single-create behaviour.
   */
  bulkMode?: boolean;
};

// react-doctor:no-giant-component — deferred for follow-up refactor
export const AssetForm = ({
  id,
  sequentialId,
  title,
  thumbnailImage,
  mainImage,
  mainImageExpiration,
  categoryId,
  assetModelId,
  locationId,
  description,
  valuation,
  type: assetType,
  quantity,
  minQuantity,
  consumptionType,
  unitOfMeasure,
  qrId,
  tags,
  barcodes,
  preferredBarcodeId,
  referer,
  bulkMode = false,
}: Props) => {
  const navigation = useNavigation();
  const { canUseBarcodes } = useBarcodePermissions();
  // Workspace's current code-display preference — used by PreferredBarcodeSelector
  // to tell the user what "Workspace default" actually resolves to (and to warn
  // about silent fallback when this asset can't satisfy the workspace preference).
  const currentOrganization = useCurrentOrganization();
  const barcodesInputRef = useRef<BarcodesInputRef>(null);

  // Live mirror of BarcodesInput state — feeds PreferredBarcodeSelector so
  // removing a barcode in the section above immediately removes the matching
  // override option. Initial value seeded from the loader; BarcodesInput
  // notifies us via `onBarcodesChange`. `id` is optional because rows newly
  // added in this edit session have no persisted id yet — the call-site
  // filter strips them before handing to PreferredBarcodeSelector.
  const [liveBarcodes, setLiveBarcodes] = useState<
    { id?: string; type: Barcode["type"]; value: string }[]
  >(barcodes ?? []);

  const customFields = useLoaderData<typeof loader>().customFields.map(
    (cf) =>
      cf.active && {
        id: cf.id,
        name: cf.name,
        helpText: cf?.helpText || "",
        required: cf.required,
        type: cf.type.toLowerCase() as "text" | "number" | "date" | "boolean",
        options: cf.options,
      }
  ) as CustomFieldZodSchema[];

  // Bulk mode tightens a few fields (assetModelId, nameTemplate,
  // count). Same `mergedSchema` pipeline either way — both base
  // schemas are plain `ZodObject`s so custom-field merging works.
  // Cast the union to the base schema's type so `mergedSchema`'s
  // generic resolves cleanly (the bulk schema is structurally a
  // superset of the base — same fields, stricter rules).
  const FormSchema = useMemo(
    () =>
      mergedSchema({
        baseSchema: (bulkMode
          ? NewAssetBulkFormSchema
          : NewAssetFormSchema) as typeof NewAssetFormSchema,
        customFields,
      }),
    [bulkMode, customFields]
  );

  const zo = useZorm("NewAssetFormScreen", FormSchema);
  const disabled = isFormProcessing(navigation.state);

  // Focus the asset Title field on mount so create/edit pages start
  // ready for typing instead of relying on the removed autoFocus prop.
  const titleInputRef = useAutoFocus<HTMLInputElement>();

  // Extract custom field errors into a plain object to pass to AssetCustomFields
  // This avoids passing the complex zo object which causes React 19 issues
  const customFieldErrors = useMemo(() => {
    const errors: Record<string, string | undefined> = {};
    // Type assertion: zo.errors has dynamic custom field keys from merged schema
    const errorsObj = zo.errors as unknown as Record<
      string,
      (() => { message?: string } | undefined) | undefined
    >;

    customFields.forEach((cf) => {
      const fieldKey = `cf-${cf.id}`;
      try {
        const errorFn = errorsObj[fieldKey];
        if (typeof errorFn === "function") {
          const error = errorFn();
          if (error?.message) {
            errors[cf.id] = error.message;
          }
        }
      } catch {
        // Ignore errors accessing zo.errors
      }
    });
    return errors;
  }, [customFields, zo.errors]);

  const actionData = useActionData<
    DataOrErrorResponse & {
      errors?: Record<string, { message: string }>;
      /** Present when /assets/new posted with `bulk=1` and the bulk
       * create service succeeded. Drives BulkCreateSuccessModal. */
      bulkSuccess?: BulkCreateSuccess;
    }
  >();

  /** Server-side validation errors as fallback when client-side validation fails */
  const validationErrors = getValidationErrors<typeof NewAssetFormSchema>(
    actionData?.error
  );

  const fileError = useAtomValue(fileErrorAtom);
  const [, validateFile] = useAtom(assetImageValidateFileAtom);
  const [, updateDynamicTitle] = useAtom(updateDynamicTitleAtom);

  const { currency, asset } = useLoaderData<AssetEditLoaderData>();
  const kitMembership = getPrimaryKit<{ id: string; name: string }>(asset);
  const isKitAsset = Boolean(kitMembership);
  const locationDisabled = disabled || isKitAsset;

  /** Whether we are in edit mode (asset already exists). */
  const isEditMode = Boolean(id);
  /** Track the selected asset type for conditional field rendering. */
  const [selectedAssetType, setSelectedAssetType] = useState<AssetType>(
    bulkMode ? AssetType.INDIVIDUAL : assetType ?? AssetType.INDIVIDUAL
  );
  const isQtyTracked = isQuantityTracked(selectedAssetType);

  // ── Bulk-mode controlled state ─────────────────────────────────────
  // Three related inputs grouped into one useState object so they
  // travel together and keep the AssetForm's total useState count
  // below react-doctor's `prefer-useReducer` threshold. Each field has
  // its own update helper below.
  // Defaults are tuned for the most common case (a 5-item starter
  // batch). The `{i}` token in the placeholder teaches the convention
  // without forcing users to type it — they can drop it and the
  // renderer auto-appends.
  const [bulkFields, setBulkFields] = useState<{
    nameTemplate: string;
    count: number;
    startNumber: number;
  }>({
    nameTemplate: bulkMode ? "Asset {i}" : "",
    count: 5,
    startNumber: 1,
  });
  const {
    nameTemplate: bulkNameTemplate,
    count: bulkCount,
    startNumber: bulkStartNumber,
  } = bulkFields;
  const setBulkNameTemplate = (nameTemplate: string) =>
    setBulkFields((prev) => ({ ...prev, nameTemplate }));
  const setBulkCount = (count: number) =>
    setBulkFields((prev) => ({ ...prev, count }));
  const setBulkStartNumber = (startNumber: number) =>
    setBulkFields((prev) => ({ ...prev, startNumber }));

  /** Render the title for the Nth bulk-created asset. Mirrors the
   * server-side `renderBulkAssetTitle` (intentionally a local copy to
   * keep the form bundle free of server modules). */
  const renderBulkTitle = (template: string, indexValue: number): string => {
    if (template.includes("{i}")) {
      return template.replace(/\{i\}/g, String(indexValue)).trim();
    }
    return `${template.trim()} ${indexValue}`.trim();
  };

  const bulkPreviewTitles = useMemo(() => {
    if (!bulkMode) return [] as string[];
    const safeCount =
      Number.isInteger(bulkCount) && bulkCount > 0 ? bulkCount : 0;
    return Array.from({ length: safeCount }, (_, i) =>
      renderBulkTitle(bulkNameTemplate, bulkStartNumber + i)
    );
  }, [bulkMode, bulkNameTemplate, bulkCount, bulkStartNumber]);

  /** First rendered title — also submitted as the hidden `title` input
   * so the shared NewAssetFormSchema (title.min(2)) still passes in
   * bulk mode. The server-side action ignores `title` when `bulk=1`. */
  const bulkFirstTitle = bulkPreviewTitles[0] || "";
  const [consumptionTypeError, setConsumptionTypeError] = useState<
    string | undefined
  >();
  /** Live mirror of whether the user has picked an asset model.
   * Seeded from the initial prop (truthy when editing an existing
   * asset that already has a model). Used by the row's error-display
   * gate so a Zorm "required" error after a failed submit clears
   * immediately when the user picks a model — Zorm itself only
   * re-validates on the next submit. */
  const [hasPickedAssetModel, setHasPickedAssetModel] = useState<boolean>(
    Boolean(assetModelId)
  );
  const navigate = useNavigate();
  const location = useLocation();

  /** Asset models from the loader, used to look up defaults on selection. */
  const assetModelsData = useLoaderData<{
    assetModels?: Array<{ id: string; defaultCategoryId?: string | null }>;
  }>()?.assetModels;

  /**
   * When a model is selected, apply its default category by updating
   * the search params. When cleared, remove the category param.
   * This triggers a revalidation so the Category DynamicSelect
   * picks up the new default.
   */
  const handleAssetModelChange = (modelId: string | undefined) => {
    // Mirror the DynamicSelect's current selection so the row's error
    // display can suppress the Zorm "required" message once the user
    // picks something. Zorm only re-validates on submit by default,
    // and calling `zo.validate()` here reads stale FormData (React
    // hasn't committed the hidden input update yet) so it would
    // wrongly flash the error.
    setHasPickedAssetModel(Boolean(modelId));
    const params = new URLSearchParams(location.search);

    if (!modelId) {
      // Model was cleared — remove the category param
      params.delete("category");
    } else if (assetModelsData) {
      const model = assetModelsData.find((m) => m.id === modelId);
      if (model?.defaultCategoryId) {
        params.set("category", model.defaultCategoryId);
      }
    }

    void navigate(`${location.pathname}?${params.toString()}`, {
      preventScrollReset: true,
      replace: true,
    });
  };

  const mainImageError =
    actionData?.errors?.mainImage?.message ??
    (actionData?.error?.additionalData?.field === "mainImage"
      ? actionData?.error?.message
      : undefined) ??
    fileError;
  /** Get the tags from the loader */
  const tagsSuggestions = useLoaderData<typeof loader>().tags.map((tag) => ({
    label: tag.name,
    value: tag.id,
  }));

  /**
   * Asset Model selector — rendered in two positions depending on mode
   * (see the two render sites in the JSX below). Hidden entirely for
   * QUANTITY_TRACKED — that visibility gate lives here so each render
   * site stays a single `<When>` toggle on `bulkMode`.
   */
  const assetModelFormRow = isQtyTracked ? null : (
    <AssetModelFormRow
      disabled={disabled}
      required={bulkMode}
      assetModelId={assetModelId}
      onChange={handleAssetModelChange}
      // Zorm validation against the dynamic schema covers the
      // required-when-bulk rule; server-returned error after a
      // tampered POST falls back via validationErrors (per CLAUDE.md).
      // Suppress once the user has picked a model — Zorm only
      // re-validates on submit, so without this gate a failed submit
      // would leave the inline error stuck even after a valid pick.
      error={
        hasPickedAssetModel
          ? undefined
          : validationErrors?.assetModelId?.message ||
            zo.errors.assetModelId()?.message
      }
    />
  );

  return (
    <Card className="w-full lg:w-min">
      <BulkCreateSuccessModal
        success={actionData?.bulkSuccess}
        sampleTitles={bulkPreviewTitles}
      />
      <Form
        ref={zo.ref}
        method="post"
        action="."
        className="flex w-full flex-col gap-2"
        encType="multipart/form-data"
        onSubmit={(e) => {
          // Force validation of all barcode fields to show errors
          barcodesInputRef.current?.validateAll();

          // Check for barcode validation errors
          const hasBarcodeErrors = barcodesInputRef.current?.hasErrors();

          // Validate consumption type for quantity-tracked assets
          if (isQtyTracked) {
            const formData = new FormData(e.currentTarget);
            if (!formData.get("consumptionType")) {
              setConsumptionTypeError("Please select a consumption type");
              e.preventDefault();
              e.stopPropagation();
              return false;
            } else {
              setConsumptionTypeError(undefined);
            }
          }

          // If there are barcode errors, prevent submission
          // Zorm will handle its own validation and prevent submission if needed
          if (hasBarcodeErrors) {
            e.preventDefault();
            e.stopPropagation();
            return false;
          }
        }}
      >
        {/* QR linkage is per-asset; in bulk mode each created asset
            gets its own fresh QR via createAsset and we never reuse one. */}
        {qrId && !bulkMode ? (
          <input type="hidden" name="qrId" value={qrId} />
        ) : null}
        <RefererRedirectInput fieldName="redirectTo" referer={referer} />

        {/* Bulk-mode discriminator + synthetic title (satisfies the
            shared schema's title.min(2) check; the action ignores it
            when bulk=1 and uses nameTemplate instead). */}
        <When truthy={bulkMode}>
          <input type="hidden" name="bulk" value="1" />
          <input type="hidden" name="title" value={bulkFirstTitle} />
        </When>

        <div className="flex items-start justify-between border-b pb-5">
          <div className=" ">
            <h2 className="mb-1 text-[18px] font-semibold">
              {bulkMode ? "Bulk create from model" : "Basic fields"}
            </h2>
            <p>
              {bulkMode
                ? "Create multiple assets from a model in one go. Common fields below apply to every asset created."
                : "Basic information about your asset."}
            </p>
          </div>
          <div className="hidden flex-1 justify-end gap-2 md:flex">
            <Actions
              disabled={disabled}
              referer={referer}
              showAddAnother={!bulkMode}
            />
          </div>
        </div>

        <When truthy={!bulkMode}>
          <FormRow
            rowLabel={"Name"}
            className="border-b-0 pb-[10px]"
            required={true}
          >
            <Input
              ref={titleInputRef}
              label="Name"
              hideLabel
              name="title"
              disabled={disabled}
              error={
                actionData?.errors?.title?.message || zo.errors.title()?.message
              }
              onChange={updateDynamicTitle}
              className="w-full"
              defaultValue={title || ""}
              required={true}
            />
          </FormRow>
        </When>

        {/* Bulk mode: Asset Model is the key field — defaults (category,
            valuation) flow from it — so it sits as the very first row
            above Batch. Single mode keeps the historical layout (model
            sits between Description and Category lower in the form). */}
        <When truthy={bulkMode}>{assetModelFormRow}</When>

        <When truthy={bulkMode}>
          <FormRow
            rowLabel="Batch"
            className="border-b-0 pb-[10px]"
            subHeading={
              <p>
                Each asset will be named using the template below. Use{" "}
                <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">
                  {"{i}"}
                </code>{" "}
                to substitute the asset number; otherwise it&apos;s appended.
              </p>
            }
            required={true}
          >
            <div className="flex w-full flex-col gap-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <div className="flex-1">
                  <Input
                    label="Name template"
                    name="nameTemplate"
                    disabled={disabled}
                    value={bulkNameTemplate}
                    onChange={(e) => setBulkNameTemplate(e.target.value)}
                    placeholder="Dell Latitude {i}"
                    error={
                      validationErrors?.nameTemplate?.message ||
                      zo.errors.nameTemplate()?.message ||
                      (actionData?.error?.additionalData?.field ===
                      "nameTemplate"
                        ? actionData?.error?.message
                        : undefined)
                    }
                    required
                  />
                </div>
                <div className="w-full md:w-32">
                  <Input
                    type="number"
                    label="Count"
                    name="count"
                    disabled={disabled}
                    value={bulkCount}
                    onChange={(e) =>
                      setBulkCount(
                        Number.isFinite(+e.target.value)
                          ? Math.max(2, Math.min(100, +e.target.value))
                          : 2
                      )
                    }
                    min={2}
                    max={100}
                    step={1}
                    required
                    error={
                      validationErrors?.count?.message ||
                      zo.errors.count()?.message ||
                      (actionData?.error?.additionalData?.field === "count"
                        ? actionData?.error?.message
                        : undefined)
                    }
                  />
                </div>
                <div className="w-full md:w-32">
                  <Input
                    type="number"
                    label="Start at"
                    name="startNumber"
                    disabled={disabled}
                    value={bulkStartNumber}
                    onChange={(e) =>
                      setBulkStartNumber(
                        Number.isFinite(+e.target.value)
                          ? Math.max(0, +e.target.value)
                          : 1
                      )
                    }
                    min={0}
                    step={1}
                  />
                </div>
              </div>
              <BulkCreatePreview titles={bulkPreviewTitles} />
            </div>
          </FormRow>
        </When>

        <When truthy={!bulkMode}>
          <FormRow
            rowLabel={"Tracking method"}
            className="border-b-0 pb-[10px]"
            subHeading={
              isEditMode
                ? "Tracking method cannot be changed after creation."
                : "Choose how this asset is tracked. This cannot be changed later."
            }
            required={true}
          >
            <input type="hidden" name="type" value={selectedAssetType} />
            <TrackingMethodCards
              selectedAssetType={selectedAssetType}
              onSelect={setSelectedAssetType}
              disabled={disabled || isEditMode}
              isEditMode={isEditMode}
            />
          </FormRow>
        </When>

        <When truthy={bulkMode}>
          {/* Bulk-create assets are always INDIVIDUAL by design. */}
          <input type="hidden" name="type" value={AssetType.INDIVIDUAL} />
        </When>

        <When truthy={isQtyTracked}>
          <div className="flex flex-col gap-2">
            <FormRow
              rowLabel="Quantity"
              className="border-b-0 pb-[10px]"
              subHeading="Total number of items in this pool."
              required={true}
            >
              <Input
                type="number"
                label="Quantity"
                hideLabel
                name="quantity"
                disabled={disabled}
                min={1}
                step={1}
                className="w-full"
                defaultValue={quantity ?? ""}
                required={true}
                error={
                  validationErrors?.quantity?.message ||
                  zo.errors.quantity()?.message
                }
              />
            </FormRow>

            <FormRow
              rowLabel="Unit of measure"
              className="border-b-0 pb-[10px]"
              subHeading="Label for the unit (e.g. pcs, boxes, liters)."
            >
              <Input
                label="Unit of measure"
                hideLabel
                name="unitOfMeasure"
                disabled={disabled}
                className="w-full"
                placeholder="e.g., pcs, boxes, liters"
                defaultValue={unitOfMeasure ?? ""}
              />
            </FormRow>

            <FormRow
              rowLabel="Min quantity"
              className="border-b-0 pb-[10px]"
              subHeading="Low-stock alert threshold. You will be notified when available quantity falls to or below this number."
            >
              <Input
                type="number"
                label="Min quantity"
                hideLabel
                name="minQuantity"
                disabled={disabled}
                min={1}
                step={1}
                className="w-full"
                defaultValue={minQuantity ?? ""}
              />
            </FormRow>

            <FormRow
              rowLabel="Consumption type"
              className="border-b-0 pb-[10px]"
              subHeading={
                'Choose "Used up (one-way)" for items that are consumed and not returned, or "Returnable (two-way)" for items that are checked out and returned.'
              }
              required={true}
            >
              <ConsumptionTypeSelect
                initialValue={consumptionType ?? undefined}
                disabled={disabled}
                error={consumptionTypeError}
                onSelect={() => setConsumptionTypeError(undefined)}
              />
            </FormRow>
          </div>
        </When>

        {/* Sequential-ID preview shows one prefix-number pair, which is
            meaningful for single-create but misleading in bulk mode —
            each of the N created assets gets its own auto-allocated ID
            from the same sequence. Hide entirely under bulkMode. */}
        <When truthy={!bulkMode}>
          <FormRow
            rowLabel={"Asset ID"}
            className="border-b-0 pb-[10px]"
            subHeading={
              id
                ? "This is the unique identifier for this asset"
                : "This sequential ID will be assigned when the asset is created"
            }
          >
            <div className="flex items-center gap-2">
              <div className="shrink-0">
                <Input
                  label="Prefix"
                  hideLabel
                  name="sequentialIdPrefix"
                  disabled={true}
                  value="SAM"
                  className="w-20 text-center"
                  placeholder="SAM"
                />
              </div>
              <span className="font-medium text-gray-400">-</span>
              <div className="grow">
                <Input
                  label="Number"
                  hideLabel
                  name="sequentialIdNumber"
                  disabled={true}
                  value={
                    sequentialId ? sequentialId.split("-")[1] || "0001" : "0001"
                  }
                  className="w-full text-center font-mono"
                  placeholder="0001"
                />
              </div>
            </div>
            <p className="mt-1 text-sm text-gray-600"></p>
          </FormRow>
        </When>

        <FormRow rowLabel={"Main image"} className="pt-[10px]">
          <div className="flex items-center gap-2">
            {id && thumbnailImage && mainImageExpiration ? (
              <AssetImage
                className="size-16"
                asset={{
                  id,
                  thumbnailImage: thumbnailImage,
                  mainImage: mainImage,
                  mainImageExpiration: new Date(mainImageExpiration),
                }}
                alt={`${title} main image`}
              />
            ) : null}
            <div>
              <p className="hidden lg:block">
                <HoverCard openDelay={50} closeDelay={50}>
                  <HoverCardTrigger className={tw("inline-flex w-full  ")}>
                    Accepts PNG, JPG, JPEG, or WebP (max.8 MB)
                  </HoverCardTrigger>
                  <HoverCardContent side="left">
                    Images will be automatically resized on upload. Width will
                    be set at 1200px and height will be adjusted accordingly to
                    keep the aspect ratio.
                  </HoverCardContent>
                </HoverCard>
              </p>
              <Input
                disabled={disabled}
                accept={ACCEPT_SUPPORTED_IMAGES}
                name="mainImage"
                type="file"
                onChange={validateFile}
                label={"Main image"}
                hideLabel
                error={mainImageError}
                className="mt-2"
                inputClassName="border-0 shadow-none p-0 rounded-none"
              />
              <p className="mt-2 lg:hidden">
                Accepts PNG, JPG, JPEG, or WebP (max.8 MB)
              </p>
            </div>
          </div>
        </FormRow>

        <div>
          <FormRow
            rowLabel={"Description"}
            subHeading={
              <p>
                This is the initial object description. It will be shown on the
                asset’s overview page. You can always change it. Maximum 1000
                characters.
              </p>
            }
            className="border-b-0"
          >
            <Input
              inputType="textarea"
              maxLength={1000}
              label={"Description"}
              name="description"
              defaultValue={description || ""}
              hideLabel
              placeholder="Add a description for your asset."
              disabled={disabled}
              data-test-id="assetDescription"
              className="w-full"
            />
          </FormRow>
        </div>

        {/* Asset Model — single-create position (between Description and
            Category). In bulk mode this row is rendered at the top of the
            form instead; see the matching `<When truthy={bulkMode}>` block
            above the Batch row. Always hidden for QUANTITY_TRACKED — models
            are an INDIVIDUAL-only concept (enforced server-side too). */}
        <When truthy={!bulkMode}>{assetModelFormRow}</When>

        <FormRow
          rowLabel="Category"
          subHeading={
            <p>
              Make it unique. Each asset can have 1 category. It will show on
              your index.{" "}
              <Button
                to="/categories/new"
                variant="link-gray"
                className="text-gray-600 underline"
                target="_blank"
              >
                Create categories
              </Button>
            </p>
          }
          className="border-b-0 pb-[10px]"
        >
          <DynamicSelect
            disabled={disabled}
            defaultValue={
              new URLSearchParams(location.search).get("category") ||
              categoryId ||
              undefined
            }
            model={{ name: "category", queryKey: "name" }}
            triggerWrapperClassName="flex flex-col !gap-0 justify-start items-start [&_.inner-label]:w-full [&_.inner-label]:text-left "
            contentLabel="Categories"
            label="Category"
            hideLabel
            initialDataKey="categories"
            countKey="totalCategories"
            closeOnSelect
            selectionMode="set"
            allowClear={true}
            extraContent={({ onItemCreated, closePopover }) => (
              <InlineEntityCreationDialog
                title="Create new category"
                type="category"
                buttonLabel="Create new category"
                onCreated={(created) => {
                  if (created?.type !== "category") return;
                  const category = created.entity;
                  onItemCreated({
                    id: category.id,
                    name: category.name,
                    color: category.color,
                    metadata: { ...category },
                  });
                  closePopover();
                }}
              />
            )}
          />
        </FormRow>

        <FormRow
          rowLabel="Tags"
          subHeading={
            <p>
              Tags can help you organise your database. They can be combined.{" "}
              <Button
                to="/tags/new"
                className="text-gray-600 underline"
                target="_blank"
                variant="link-gray"
              >
                Create tags
              </Button>
            </p>
          }
          className="border-b-0 py-[10px]"
          // required={zodFieldIsRequired(FormSchema.shape.tags)}
        >
          <TagsAutocomplete
            existingTags={tags ?? []}
            suggestions={tagsSuggestions}
            hideLabel
          />
        </FormRow>

        <FormRow
          rowLabel="Location"
          subHeading={
            <p>
              A location is a place where an item is supposed to be located.
              This is different than the last scanned location{" "}
              <Button
                to="/locations/new"
                className="text-gray-600 underline"
                target="_blank"
                variant="link-gray"
              >
                Create locations
              </Button>
            </p>
          }
          className="border-b-0 py-[10px]"
        >
          <input
            type="hidden"
            name="currentLocationId"
            value={locationId || ""}
          />
          {isKitAsset ? (
            <HoverCard openDelay={50} closeDelay={50}>
              <HoverCardTrigger className="disabled w-full cursor-not-allowed">
                <DynamicSelect
                  disabled={locationDisabled}
                  selectionMode="set"
                  fieldName="newLocationId"
                  triggerWrapperClassName="flex flex-col !gap-0 justify-start items-start [&_.inner-label]:w-full [&_.inner-label]:text-left "
                  defaultValue={locationId || undefined}
                  model={{ name: "location", queryKey: "name" }}
                  contentLabel="Locations"
                  label="Location"
                  hideLabel
                  initialDataKey="locations"
                  countKey="totalLocations"
                  closeOnSelect
                  allowClear
                />
              </HoverCardTrigger>
              <HoverCardContent side="left">
                <h5 className="text-left text-[14px]">Action disabled</h5>
                <p className="text-left text-[14px]">
                  This asset's location is managed by its parent kit{" "}
                  <strong>"{kitMembership?.name}"</strong>. Update the kit's
                  location instead.
                </p>
              </HoverCardContent>
            </HoverCard>
          ) : (
            <DynamicSelect
              disabled={disabled}
              selectionMode="set"
              fieldName="newLocationId"
              triggerWrapperClassName="flex flex-col !gap-0 justify-start items-start [&_.inner-label]:w-full [&_.inner-label]:text-left "
              defaultValue={locationId || undefined}
              model={{ name: "location", queryKey: "name" }}
              contentLabel="Locations"
              label="Location"
              hideLabel
              initialDataKey="locations"
              countKey="totalLocations"
              closeOnSelect
              allowClear
              extraContent={({ onItemCreated, closePopover }) => (
                <InlineEntityCreationDialog
                  type="location"
                  title="Create new location"
                  buttonLabel="Create new location"
                  onCreated={(created) => {
                    if (created?.type !== "location") return;
                    const location = created.entity;
                    onItemCreated({
                      id: location.id,
                      name: location.name,
                      metadata: { ...location },
                    });
                    closePopover();
                  }}
                />
              )}
              renderItem={({ name, metadata }) => (
                <div className="flex items-center gap-2">
                  {metadata?.thumbnailUrl ? (
                    <ImageWithPreview
                      thumbnailUrl={metadata.thumbnailUrl}
                      alt={metadata.name}
                      className="size-6 rounded-[2px]"
                    />
                  ) : null}
                  <div>{name}</div>
                </div>
              )}
            />
          )}
        </FormRow>

        <FormRow
          rowLabel={"Value"}
          subHeading={
            <p>
              Specify the value of assets to get an idea of the total value of
              your inventory.
            </p>
          }
          className="border-b-0 py-[10px]"
        >
          <div className="relative w-full">
            <Input
              type="number"
              label="Value"
              inputClassName="pl-[70px] valuation-input"
              hideLabel
              name="valuation"
              disabled={disabled}
              step="any"
              min={0}
              className="w-full"
              defaultValue={valuation || ""}
            />
            <span className="absolute bottom-0 border-r px-3 py-2.5 text-[16px] text-gray-600 lg:bottom-[11px]">
              {currency}
            </span>
          </div>
        </FormRow>

        {/* Bulk mode hides the barcode + preferred-barcode UI entirely:
            assigning the same alternative barcode value to N assets is
            nonsensical, and the SAM/sequential barcode allocator runs
            per-asset inside createAsset (so each of the N rows still
            gets its own auto-allocated barcode when the workspace
            preference is enabled). */}
        <When truthy={!bulkMode}>
          {canUseBarcodes ? (
            <>
              <FormRow
                rowLabel={"Barcodes"}
                className="border-b-0"
                subHeading="Add additional barcodes to this asset (Code 128, Code 39, or Data Matrix). Note: Each asset automatically gets a default Shelf QR code for tracking."
              >
                <BarcodesInput
                  ref={barcodesInputRef}
                  barcodes={barcodes || []}
                  typeName={(i) => `barcodes[${i}].type`}
                  valueName={(i) => `barcodes[${i}].value`}
                  idName={(i) => `barcodes[${i}].id`}
                  disabled={disabled}
                  onBarcodesChange={setLiveBarcodes}
                />
              </FormRow>

              {/* why: newly-added barcodes in this edit session have no id yet
                  and cannot be referenced server-side until the asset is
                  saved. Filtering keeps the selector in sync with persisted
                  ids only; the selector's empty-state copy already explains
                  this gap to the user. */}
              <PreferredBarcodeFormRow
                barcodes={liveBarcodes.filter(
                  (b): b is typeof b & { id: string } =>
                    typeof b.id === "string" && b.id.length > 0
                )}
                defaultValue={preferredBarcodeId}
                workspacePreference={currentOrganization?.qrIdDisplayPreference}
              />
            </>
          ) : (
            <FormRow rowLabel={"Barcodes"} className="border-b-0">
              <UnlockBarcodesBanner />
            </FormRow>
          )}
        </When>

        <AssetCustomFields
          currency={currency}
          fieldErrors={customFieldErrors}
        />

        <FormRow className="border-y-0 pb-0 pt-5" rowLabel="">
          <div className="flex flex-1 justify-end gap-2">
            <Actions
              disabled={disabled}
              referer={referer}
              showAddAnother={!bulkMode}
            />
          </div>
        </FormRow>
      </Form>
    </Card>
  );
};

const Actions = ({
  disabled,
  referer,
  showAddAnother = true,
}: {
  disabled: boolean;
  referer?: string | null;
  /** "Add another" submits the form and reloads `/assets/new?` to clear
   * the fields for a second entry. In bulk-create mode it makes no
   * sense — one submit already creates many assets, and the success
   * modal offers the natural follow-up CTAs — so the caller hides it. */
  showAddAnother?: boolean;
}) => (
  <>
    {/* Save button is first in DOM order so Enter key triggers it by default */}
    <Button type="submit" disabled={disabled} className="order-last">
      Save
    </Button>

    <ButtonGroup>
      <Button to={referer} variant="secondary" disabled={disabled}>
        Cancel
      </Button>
      {showAddAnother ? <AddAnother disabled={disabled} /> : null}
    </ButtonGroup>
  </>
);

const AddAnother = ({ disabled }: { disabled: boolean }) => (
  <TooltipProvider delayDuration={100}>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="submit"
          variant="secondary"
          disabled={disabled}
          name="addAnother"
          value="true"
        >
          Add another
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="text-sm">Save the asset and add a new one</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

/**
 * Live-preview block rendered inside the bulk-create row.
 *
 * Renders up to the first 5 titles inline so the user sees exactly what
 * names will land in the database before submitting, with an "…and N
 * more" tail for larger batches. Empty array → nothing rendered.
 */
function BulkCreatePreview({ titles }: { titles: string[] }) {
  if (titles.length === 0) return null;
  const PREVIEW_LIMIT = 5;
  const head = titles.slice(0, PREVIEW_LIMIT);
  const remaining = titles.length - head.length;
  // Render as a single comma-joined string — avoids per-item React keys
  // (titles can transiently collide while the user is editing the
  // template, which would log key-duplication warnings if we mapped
  // them into individual <span>s).
  return (
    <div
      className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700"
      data-test-id="bulkCreatePreview"
    >
      <span className="font-medium text-gray-900">Preview:</span>{" "}
      <span className="font-mono">{head.join(", ")}</span>
      {remaining > 0 ? (
        <span className="text-gray-500"> …and {remaining} more</span>
      ) : null}
    </div>
  );
}

/** Radio card options for the tracking method selector. */
const TRACKING_OPTIONS = [
  {
    value: AssetType.INDIVIDUAL,
    title: "Individually tracked",
    description:
      "Each item gets its own QR code, custody record, and booking entry. Best for unique or high-value items.",
  },
  {
    value: AssetType.QUANTITY_TRACKED,
    title: "Tracked by quantity",
    description:
      "A single record represents a pool of identical items. Custody and bookings are managed by numeric quantity.",
  },
] as const;

/**
 * Styled radio-card selector for choosing the asset tracking method.
 * Renders two stacked cards with radio circle, title, and description.
 * When disabled (edit mode), wraps in a tooltip explaining the restriction.
 */
function TrackingMethodCards({
  selectedAssetType,
  onSelect,
  disabled,
  isEditMode,
}: {
  selectedAssetType: AssetType;
  onSelect: (type: AssetType) => void;
  disabled: boolean;
  isEditMode: boolean;
}) {
  const cards = (
    <div className="flex flex-col gap-2">
      {TRACKING_OPTIONS.map((option) => {
        const isSelected = selectedAssetType === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(option.value)}
            className={tw(
              "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
              isSelected
                ? "border-primary-500 bg-primary-25"
                : "border-gray-200 bg-white hover:border-gray-300",
              disabled && "cursor-not-allowed opacity-50"
            )}
          >
            {/* Radio circle indicator */}
            <span
              className={tw(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2",
                isSelected ? "border-primary-500" : "border-gray-300"
              )}
            >
              {isSelected && (
                <span className="size-2 rounded-full bg-primary-500" />
              )}
            </span>
            <div className="flex flex-col">
              <span className="text-[14px] font-medium text-gray-900">
                {option.title}
              </span>
              <span className="text-[13px] text-gray-600">
                {option.description}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );

  /* In edit mode, wrap the cards in a tooltip explaining the restriction. */
  if (isEditMode) {
    return (
      <TooltipProvider delayDuration={100}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div>{cards}</div>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-sm">
              Tracking method cannot be changed after creation.
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return cards;
}

/** Label + description pairs for consumption type options. */
const CONSUMPTION_OPTIONS = [
  {
    value: ConsumptionType.ONE_WAY,
    label: "Used up (one-way) — consumed and not returned",
  },
  {
    value: ConsumptionType.TWO_WAY,
    label: "Returnable (two-way) — checked out and returned",
  },
] as const;

/**
 * Popover-based select for picking the consumption type.
 * Follows the pattern from field-selector.tsx using @radix-ui/react-popover
 * instead of the deprecated DropdownMenu / Select components.
 */
/** Popover-based select for consumption type, following the field-selector pattern.
 *
 * The `initialValue` prop seeds the local selection on mount (uncontrolled
 * after that). Named `initialValue` rather than `defaultValue` deliberately:
 * the prop is NOT a controlled-value default that should sync across
 * re-renders — once the user picks an option, local state owns it. This
 * also silences react-doctor's `no-derived-useState` heuristic (which
 * flags `defaultValue`-named props seeded into useState). */
function ConsumptionTypeSelect({
  initialValue,
  disabled,
  error,
  onSelect,
}: {
  initialValue?: ConsumptionType;
  disabled: boolean;
  error?: string;
  /** Called when a value is selected — used to clear external error state. */
  onSelect?: () => void;
}) {
  const [selected, setSelected] = useState<ConsumptionType | undefined>(
    initialValue
  );
  const [open, setOpen] = useState(false);

  const selectedLabel =
    CONSUMPTION_OPTIONS.find((o) => o.value === selected)?.label ??
    "Select consumption type";

  return (
    <div className="w-full">
      {selected ? (
        <input type="hidden" name="consumptionType" value={selected} />
      ) : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={tw(
              "flex w-full items-center justify-between rounded border bg-white px-3 py-2.5 text-left text-[14px]",
              "focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-25",
              selected ? "text-gray-900" : "text-gray-500",
              error ? "border-error-300" : "border-gray-300",
              disabled && "cursor-not-allowed opacity-50"
            )}
          >
            <span className="truncate">{selectedLabel}</span>
            <svg
              className="size-4 shrink-0 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            align="start"
            className="z-[999999] mt-1 w-[var(--radix-popover-trigger-width)] overflow-auto rounded-md border border-gray-200 bg-white py-1 shadow-md"
          >
            {CONSUMPTION_OPTIONS.map((option) => (
              <div
                key={option.value}
                role="option"
                aria-selected={selected === option.value}
                tabIndex={0}
                className={tw(
                  "cursor-pointer px-3 py-2 text-[14px] text-gray-700 hover:bg-gray-50",
                  selected === option.value &&
                    "bg-gray-50 font-medium text-gray-900"
                )}
                onClick={() => {
                  setSelected(option.value);
                  setOpen(false);
                  onSelect?.();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected(option.value);
                    setOpen(false);
                    onSelect?.();
                  }
                }}
              >
                {option.label}
              </div>
            ))}
          </PopoverContent>
        </PopoverPortal>
      </Popover>
      {error ? <p className="mt-1 text-sm text-error-500">{error}</p> : null}
    </div>
  );
}
