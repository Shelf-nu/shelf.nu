import { useEffect } from "react";
import type { Location } from "@prisma/client";
import { useAtom, useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { updateDynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { fileErrorAtom, defaultValidateFileAtom } from "~/atoms/file";
import { useDisabled } from "~/hooks/use-disabled";
import useFetcherWithReset from "~/hooks/use-fetcher-with-reset";
import { ACCEPT_SUPPORTED_IMAGES } from "~/utils/constants";
import { tw } from "~/utils/tw";
import { zodFieldIsRequired } from "~/utils/zod";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { AbsolutePositionedHeaderActions } from "../layout/header/absolute-positioned-header-actions";
import { Button } from "../shared/button";
import { ButtonGroup } from "../shared/button-group";
import { Spinner } from "../shared/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";
import When from "../when/when";

export const NewLocationFormSchema = z.object({
  name: z.string().min(2, "Name is required"),
  description: z.string(),
  address: z.string(),
  addAnother: z
    .string()
    .optional()
    .transform((val) => val === "true"),
  preventRedirect: z.string().optional(),
});

/** Pass props of the values to be used as default for the form fields */
interface Props {
  className?: string;
  name?: Location["name"];
  address?: Location["address"];
  description?: Location["description"];
  apiUrl?: string;
  onSuccess?: () => void;
}

export const LocationForm = ({
  className,
  name,
  address,
  description,
  apiUrl,
  onSuccess,
}: Props) => {
  const zo = useZorm("NewQuestionWizardScreen", NewLocationFormSchema);
  const fetcher = useFetcherWithReset<{
    success: boolean;
    error?: { message: string };
  }>();
  const fetcherData = fetcher.data;
  const disabled = useDisabled(fetcher);

  const fileError = useAtomValue(fileErrorAtom);
  const [, validateFile] = useAtom(defaultValidateFileAtom);
  const [, updateName] = useAtom(updateDynamicTitleAtom);

  useEffect(() => {
    if (!onSuccess) return;

    if (fetcherData && fetcherData?.success) {
      onSuccess();
    }
  }, [fetcherData, onSuccess]);

  const hasOnSuccessFunc = typeof onSuccess === "function";

  return (
    <fetcher.Form
      ref={zo.ref}
      method="post"
      className={tw("flex w-full flex-col gap-2", className)}
      encType="multipart/form-data"
      action={apiUrl}
    >
      {typeof onSuccess === "function" ? null : (
        <AbsolutePositionedHeaderActions className="hidden md:flex">
          <Actions disabled={disabled} />
        </AbsolutePositionedHeaderActions>
      )}

      <When
        truthy={hasOnSuccessFunc}
        fallback={
          <FormRow
            rowLabel={"Name"}
            className="border-b-0 pb-[10px] pt-0"
            required={zodFieldIsRequired(NewLocationFormSchema.shape.name)}
          >
            <Input
              label="Name"
              hideLabel
              name={zo.fields.name()}
              disabled={disabled}
              error={fetcherData?.error?.message || zo.errors.name()?.message}
              autoFocus
              onChange={updateName}
              className="w-full"
              defaultValue={name || undefined}
              placeholder="Storage room"
              required={zodFieldIsRequired(NewLocationFormSchema.shape.name)}
            />
          </FormRow>
        }
      >
        <Input
          label="Name"
          name={zo.fields.name()}
          disabled={disabled}
          error={fetcherData?.error?.message || zo.errors.name()?.message}
          autoFocus
          onChange={updateName}
          className="w-full"
          defaultValue={name || undefined}
          placeholder="Storage room"
          required={zodFieldIsRequired(NewLocationFormSchema.shape.name)}
        />
      </When>

      <When
        truthy={hasOnSuccessFunc}
        fallback={
          <FormRow rowLabel={"Main image"}>
            <div>
              <p className="hidden lg:block">
                Accepts PNG, JPG or JPEG (max.4 MB)
              </p>
              <Input
                disabled={disabled}
                accept={ACCEPT_SUPPORTED_IMAGES}
                name="image"
                type="file"
                onChange={validateFile}
                label={"Main image"}
                hideLabel
                error={fileError}
                className="mt-2"
                inputClassName="border-0 shadow-none p-0 rounded-none"
              />
              <p className="mt-2 lg:hidden">
                Accepts PNG, JPG or JPEG (max.4 MB)
              </p>
            </div>
          </FormRow>
        }
      >
        <Input
          disabled={disabled}
          accept={ACCEPT_SUPPORTED_IMAGES}
          name="image"
          type="file"
          onChange={validateFile}
          label={"Main image"}
          error={fileError}
          className="mt-2"
          inputClassName="border-0 shadow-none p-0 rounded-none"
        />
        <p className="hidden lg:block">Accepts PNG, JPG or JPEG (max.4 MB)</p>
      </When>

      <When
        truthy={hasOnSuccessFunc}
        fallback={
          <FormRow
            rowLabel={"Address"}
            subHeading={
              <p>
                Will set location’s geo position to address. Make sure to add an
                accurate address, to ensure the map location is as accurate as
                possible
              </p>
            }
            className="pt-[10px]"
            required={zodFieldIsRequired(NewLocationFormSchema.shape.address)}
          >
            <Input
              label="Address"
              hideLabel
              name={zo.fields.address()}
              disabled={disabled}
              error={zo.errors.address()?.message}
              className="w-full"
              defaultValue={address || undefined}
              required={zodFieldIsRequired(NewLocationFormSchema.shape.address)}
            />
          </FormRow>
        }
      >
        <Input
          label="Address"
          name={zo.fields.address()}
          disabled={disabled}
          error={zo.errors.address()?.message}
          className="w-full"
          defaultValue={address || undefined}
          required={zodFieldIsRequired(NewLocationFormSchema.shape.address)}
        />
      </When>

      <When
        truthy={hasOnSuccessFunc}
        fallback={
          <FormRow
            rowLabel="Description"
            subHeading={
              <p>
                This is the initial object description. It will be shown on the
                location page. You can always change it.
              </p>
            }
            required={zodFieldIsRequired(
              NewLocationFormSchema.shape.description
            )}
          >
            <Input
              inputType="textarea"
              label="Description"
              hideLabel
              name={zo.fields.description()}
              defaultValue={description || ""}
              placeholder="Add a description for your location."
              disabled={disabled}
              data-test-id="locationDescription"
              className="w-full"
              required={zodFieldIsRequired(
                NewLocationFormSchema.shape.description
              )}
            />
          </FormRow>
        }
      >
        <Input
          inputType="textarea"
          label="Description"
          name={zo.fields.description()}
          defaultValue={description || ""}
          placeholder="Add a description for your location."
          disabled={disabled}
          data-test-id="locationDescription"
          className="w-full"
          required={zodFieldIsRequired(NewLocationFormSchema.shape.description)}
        />
      </When>

      {typeof onSuccess === "function" ? (
        <input type="hidden" name="preventRedirect" value="true" />
      ) : null}

      <div className="ml-auto">
        <Button type="submit" disabled={disabled}>
          {disabled ? <Spinner /> : "Save"}
        </Button>
      </div>
    </fetcher.Form>
  );
};

const Actions = ({ disabled }: { disabled: boolean }) => (
  <>
    <ButtonGroup>
      <Button to=".." variant="secondary" disabled={disabled}>
        Cancel
      </Button>
      <AddAnother disabled={disabled} />
    </ButtonGroup>

    <Button type="submit" disabled={disabled}>
      Save
    </Button>
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
        <p className="text-sm">Save the location and add a new one</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);
