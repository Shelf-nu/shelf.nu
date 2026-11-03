/**
 * PDF Templates Settings
 *
 * The "PDF templates" card on Settings > General: the workspace's list of
 * templates, each a saved layout for a booking's PDF. Owners and admins add,
 * edit, duplicate, delete and pick the default template here; the Generate PDF
 * dialog on a booking then offers them by name.
 *
 * PDF templates are a paid feature. On a free workspace the card holds only
 * an upgrade note, the way the label branding switch does.
 *
 * Every change posts to the settings route's action, which re-checks the
 * caller's permission and scopes every write to the workspace.
 *
 * @see {@link file://../../routes/_layout+/settings.general.tsx}
 * @see {@link file://../../modules/pdf-template/service.server.ts}
 * @see {@link file://./booking-overview-pdf.tsx}
 */
import { useEffect, useState } from "react";
import type { CustomFieldType } from "@prisma/client";
import { useFetcher } from "react-router";
import { useDisabled } from "~/hooks/use-disabled";
import { useFetcherOutcomeSinceOpen } from "~/hooks/use-fetcher-error-since-open";
import type { BookingTemplateConfig } from "~/modules/pdf-template/config";
import {
  MAX_TEMPLATE_CUSTOM_FIELDS,
  MAX_TEMPLATE_NAME_LENGTH,
  printsAsColumn,
  TEMPLATE_GROUP_BY_OPTIONS,
  TEMPLATE_OPTIONAL_COLUMNS,
  TEMPLATE_SORT_BY_OPTIONS,
} from "~/modules/pdf-template/config";
import type { PdfTemplateFormSchema } from "~/modules/pdf-template/form";
import type { AddTemplateFormSchema } from "~/modules/pdf-template/form";
import { EMPTY_SLOT } from "~/modules/pdf-template/form";
import { FIELD_TYPE_NAME } from "~/utils/custom-fields";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";
import Input from "../forms/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms/select";
import { Switch } from "../forms/switch";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";
import { Card } from "../shared/card";
import { GrayBadge } from "../shared/gray-badge";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../shared/modal";
import { Spinner } from "../shared/spinner";

/** One template as the settings loader returns it. */
type TemplateItem = {
  id: string;
  name: string;
  isDefault: boolean;
  config: BookingTemplateConfig;
};

/** A custom field a template can print, as the settings loader returns it. */
type TemplateCustomField = {
  id: string;
  name: string;
  type: CustomFieldType;
  active: boolean;
};

/**
 * The PDF templates card.
 *
 * @param props.canCustomize - Whether the workspace's tier includes PDF
 *   templates; without it the card shows an upgrade note instead of the list
 * @param props.templates - The workspace's booking templates, default first
 * @param props.customFields - The custom fields a template can print
 */
export function PdfTemplatesSettings({
  canCustomize,
  templates,
  customFields,
}: {
  canCustomize: boolean;
  templates: TemplateItem[];
  customFields: TemplateCustomField[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = templates.find((item) => item.id === editingId) ?? null;

  return (
    <Card className="my-0 w-full">
      <div className="mb-4 border-b pb-4">
        <h3 className="text-text-lg font-semibold">PDF templates</h3>
        <p className="text-sm text-gray-600">
          What prints when someone generates a PDF for a booking. Each template
          is a saved layout with its own columns, rows and header lines, picked
          by name when the PDF is generated. Code pictures follow the "Print
          code images on PDFs" switch above on every template.
        </p>
      </div>

      {canCustomize ? (
        <>
          <ul className="flex flex-col divide-y rounded-md border">
            {templates.map((item) => (
              <TemplateRow
                key={item.id}
                template={item}
                canDelete={templates.length > 1}
                onEdit={() => setEditingId(item.id)}
              />
            ))}
          </ul>

          <AddTemplateForm onAdded={setEditingId} />
        </>
      ) : (
        <p className="text-sm text-gray-600">
          Every booking prints the Checklist. Choosing and editing PDF templates
          is a premium feature.{" "}
          <Button
            variant="link"
            className="inline text-sm"
            to="/account-details/subscription"
          >
            Upgrade your plan
          </Button>{" "}
          to add a Check-out receipt, custom field columns and more.
        </p>
      )}

      {editing ? (
        <EditTemplateDialog
          // A fresh form per template, so one template's typing never shows on another.
          key={editing.id}
          template={editing}
          customFields={customFields}
          onClose={() => setEditingId(null)}
        />
      ) : null}
    </Card>
  );
}

/** One template in the list, with its actions. */
function TemplateRow({
  template,
  canDelete,
  onEdit,
}: {
  template: TemplateItem;
  canDelete: boolean;
  onEdit: () => void;
}) {
  const fetcher = useFetcher<DataOrErrorResponse>({
    key: `pdf-template-${template.id}`,
  });
  const disabled = useDisabled(fetcher);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const error =
    fetcher.state === "idle" && fetcher.data?.error
      ? fetcher.data.error.message
      : null;

  const submit = (intent: string) =>
    fetcher.submit({ intent, templateId: template.id }, { method: "post" });

  return (
    <li className="flex flex-col gap-1 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900">{template.name}</span>
          {template.isDefault ? <GrayBadge>Default template</GrayBadge> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onEdit}
            disabled={disabled}
          >
            Edit
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => submit("duplicate-template")}
            disabled={disabled}
          >
            Duplicate
          </Button>
          {!template.isDefault ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => submit("default-template")}
              disabled={disabled}
            >
              Make default
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setConfirmDelete(true)}
            disabled={
              disabled ||
              (!canDelete && {
                reason: "A workspace always keeps at least one template.",
              })
            }
          >
            Delete
          </Button>
        </div>
      </div>
      {error ? (
        <p className="text-sm text-error-500" role="alert">
          {error}
        </p>
      ) : null}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{template.name}"</AlertDialogTitle>
            <AlertDialogDescription>
              Nobody can print this template any more.
              {template.isDefault
                ? " The oldest remaining template becomes the default."
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              className="bg-error-500 hover:bg-error-600"
              onClick={() => {
                void submit("delete-template");
                setConfirmDelete(false);
              }}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

/** Adds a template laid out like the Checklist, then opens it for editing. */
function AddTemplateForm({
  onAdded,
}: {
  onAdded: (templateId: string) => void;
}) {
  const fetcher = useFetcher<DataOrErrorResponse & { templateId?: string }>({
    key: "pdf-template-add",
  });
  const disabled = useDisabled(fetcher);
  const [name, setName] = useState("");
  const validationErrors = getValidationErrors<typeof AddTemplateFormSchema>(
    fetcher.data?.error
  );
  const error =
    validationErrors?.name?.message ??
    (fetcher.data?.error ? fetcher.data.error.message : undefined);
  const addedId =
    fetcher.state === "idle" ? fetcher.data?.templateId : undefined;
  // A keyed fetcher can still hold an answer from before this form mounted.
  // That template was already opened once; only a template added from here opens.
  const [answerBeforeMount] = useState(addedId);

  useEffect(() => {
    if (addedId && addedId !== answerBeforeMount) {
      setName("");
      onAdded(addedId);
    }
    // why: answers each new template once; `onAdded` is a fresh setter wrapper
    // on every render and must not re-trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addedId]);

  return (
    <fetcher.Form
      method="post"
      className="mt-4 flex flex-wrap items-start gap-2"
    >
      <input type="hidden" name="intent" value="add-template" />
      <Input
        name="name"
        label="New template name"
        hideLabel
        placeholder="New template name, for example Client quote"
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={MAX_TEMPLATE_NAME_LENGTH}
        className="min-w-[260px] grow"
        error={error}
      />
      <Button
        type="submit"
        variant="secondary"
        disabled={
          disabled || (!name.trim() && { reason: "Name the template." })
        }
      >
        {disabled ? <Spinner /> : "Add template"}
      </Button>
    </fetcher.Form>
  );
}

/** A labelled on/off switch that always posts "on" or "off". */
function TemplateSwitch({
  id,
  name,
  label,
  description,
  defaultChecked,
}: {
  id: string;
  name: string;
  label: string;
  description?: string;
  defaultChecked: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <input type="hidden" name={name} value="off" />
      <Switch
        id={id}
        name={name}
        defaultChecked={defaultChecked}
        aria-describedby={description ? `${id}-desc` : undefined}
      />
      <div>
        <label
          htmlFor={id}
          className="cursor-pointer text-[14px] font-medium text-gray-700"
        >
          {label}
        </label>
        {description ? (
          <p id={`${id}-desc`} className="text-[13px] text-gray-600">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** A labelled select that posts its value under `name`. */
function TemplateSelect({
  id,
  name,
  label,
  defaultValue,
  options,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span id={`${id}-label`} className="text-sm font-medium text-gray-700">
        {label}
      </span>
      <Select name={name} defaultValue={defaultValue}>
        <SelectTrigger aria-labelledby={`${id}-label`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          position="popper"
          className="w-[var(--radix-select-trigger-width)]"
          align="start"
        >
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} className="p-2">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** The edit form of one template, in a dialog. */
function EditTemplateDialog({
  template,
  customFields,
  onClose,
}: {
  template: TemplateItem;
  customFields: TemplateCustomField[];
  onClose: () => void;
}) {
  const fetcher = useFetcher<DataOrErrorResponse>({
    key: `pdf-template-save-${template.id}`,
  });
  const disabled = useDisabled(fetcher);
  const outcome = useFetcherOutcomeSinceOpen(fetcher, true);
  // Field messages belong to this opening's submit only, like `outcome`.
  const validationErrors =
    outcome.status === "rejected"
      ? getValidationErrors<typeof PdfTemplateFormSchema>(fetcher.data?.error)
      : undefined;
  const { config } = template;
  const idPrefix = `template-${template.id}`;

  useEffect(() => {
    if (outcome.status === "accepted") onClose();
  }, [outcome.status, onClose]);

  const fieldOptions = [
    { value: EMPTY_SLOT, label: "None" },
    ...customFields.map((field) => ({
      value: field.id,
      label: `${field.name} (${FIELD_TYPE_NAME[field.type]}${
        printsAsColumn(field.type) ? "" : ", prints under the asset"
      }${field.active ? "" : ", inactive"})`,
    })),
  ];
  const slots = Array.from(
    { length: MAX_TEMPLATE_CUSTOM_FIELDS },
    (_, i) => config.customFieldIds[i] ?? EMPTY_SLOT
  );

  return (
    <DialogPortal>
      <Dialog
        open
        onClose={onClose}
        className="w-full md:w-[640px]"
        title={
          <div>
            <h3>Edit template</h3>
            <p className="text-sm font-normal text-gray-600">
              Changes apply to every booking printed with this template.
            </p>
          </div>
        }
      >
        <fetcher.Form method="post" className="flex flex-col gap-5 px-6 pb-6">
          <input type="hidden" name="intent" value="save-template" />
          <input type="hidden" name="templateId" value={template.id} />

          <Input
            name="name"
            label="Name"
            defaultValue={template.name}
            maxLength={MAX_TEMPLATE_NAME_LENGTH}
            required
            error={validationErrors?.name?.message}
          />

          <fieldset>
            <legend className="text-sm font-semibold text-gray-900">
              Columns
            </legend>
            <p className="text-[13px] text-gray-600">
              #, Name and Code always print, in a fixed order.
            </p>
            {TEMPLATE_OPTIONAL_COLUMNS.map((column) => (
              <TemplateSwitch
                key={column.key}
                id={`${idPrefix}-column-${column.key}`}
                name={`columns.${column.key}`}
                label={column.label}
                defaultChecked={config.columns[column.key]}
              />
            ))}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold text-gray-900">
              Custom fields
            </legend>
            <p className="text-[13px] text-gray-600">
              Up to {MAX_TEMPLATE_CUSTOM_FIELDS}. Each prints as a column before
              Code. A multi-line text prints under the asset instead, while the
              description row is on.
            </p>
            {customFields.length === 0 ? (
              <p className="text-[13px] text-gray-500">
                This workspace has no custom fields a template can print.
              </p>
            ) : (
              slots.map((value, i) => (
                <TemplateSelect
                  key={i}
                  id={`${idPrefix}-custom-field-${i}`}
                  name={`customFieldIds[${i}]`}
                  label={`Custom field ${i + 1}`}
                  defaultValue={value}
                  options={fieldOptions}
                />
              ))
            )}
            {validationErrors?.customFieldIds?.message ? (
              <p className="text-sm text-error-500" role="alert">
                {validationErrors.customFieldIds.message}
              </p>
            ) : null}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold text-gray-900">
              Rows
            </legend>
            <TemplateSwitch
              id={`${idPrefix}-asset-description`}
              name="assetDescription"
              label="Asset description under each asset"
              defaultChecked={config.assetDescription}
            />
            <TemplateSelect
              id={`${idPrefix}-group-by`}
              name="groupBy"
              label="Group by"
              defaultValue={config.groupBy}
              options={TEMPLATE_GROUP_BY_OPTIONS}
            />
            <TemplateSelect
              id={`${idPrefix}-sort-by`}
              name="sortBy"
              label="Sort by"
              defaultValue={config.sortBy}
              options={TEMPLATE_SORT_BY_OPTIONS}
            />
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold text-gray-900">
              Header and footer
            </legend>
            <TemplateSwitch
              id={`${idPrefix}-booking-description`}
              name="bookingDescription"
              label="Booking description"
              defaultChecked={config.bookingDescription}
            />
            <TemplateSwitch
              id={`${idPrefix}-total-value`}
              name="totalValue"
              label="Total assets value"
              description="The value of everything on the template."
              defaultChecked={config.totalValue}
            />
            <TemplateSwitch
              id={`${idPrefix}-signature-lines`}
              name="signatureLines"
              label="Signature lines"
              description="Lines for the custodian and the person handing out, each with a date."
              defaultChecked={config.signatureLines}
            />
          </fieldset>

          {outcome.status === "rejected" && outcome.message ? (
            <p className="text-sm text-error-500" role="alert">
              {outcome.message}
            </p>
          ) : null}

          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={disabled}>
              {disabled ? <Spinner /> : "Save template"}
            </Button>
          </div>
        </fetcher.Form>
      </Dialog>
    </DialogPortal>
  );
}
