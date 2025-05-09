import type { Location } from "@prisma/client";
import { useActionData, useNavigation } from "@remix-run/react";
import { useAtom, useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { updateDynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { fileErrorAtom, defaultValidateFileAtom } from "~/atoms/file";
import type { action as editLocationAction } from "~/routes/_layout+/locations.$locationId_.edit";
import type { action as newLocationAction } from "~/routes/_layout+/locations.new";
import { ACCEPT_SUPPORTED_IMAGES } from "~/utils/constants";
import { isFormProcessing } from "~/utils/form";
import { zodFieldIsRequired } from "~/utils/zod";
import { Form } from "../custom-form";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { AbsolutePositionedHeaderActions } from "../layout/header/absolute-positioned-header-actions";
import { Button } from "../shared/button";
import { ButtonGroup } from "../shared/button-group";
import { Card } from "../shared/card";
import { Spinner } from "../shared/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";

export const NewLocationFormSchema = z.object({
  name: z.string().min(2, "Name is required"),
  description: z.string(),
  address: z.string(),
  addAnother: z
    .string()
    .optional()
    .transform((val) => val === "true"),
});

/** Pass props of the values to be used as default for the form fields */
interface Props {
  name?: Location["name"];
  address?: Location["address"];
  description?: Location["description"];
}

export const LocationForm = ({ name, address, description }: Props) => {
  const navigation = useNavigation();
  const zo = useZorm("NewQuestionWizardScreen", NewLocationFormSchema);
  const disabled = isFormProcessing(navigation.state);

  const fileError = useAtomValue(fileErrorAtom);
  const [, validateFile] = useAtom(defaultValidateFileAtom);
  const [, updateName] = useAtom(updateDynamicTitleAtom);
  const actionData = useActionData<
    typeof newLocationAction | typeof editLocationAction
  >();

  return (
    <Card className="w-full md:w-min">
      <Form
        ref={zo.ref}
        method="post"
        className="flex w-full flex-col gap-2"
        encType="multipart/form-data"
      >
        <AbsolutePositionedHeaderActions className="hidden md:flex">
          <Actions disabled={disabled} />
        </AbsolutePositionedHeaderActions>
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
            error={actionData?.error?.message || zo.errors.name()?.message}
            autoFocus
            onChange={updateName}
            className="w-full"
            defaultValue={name || undefined}
            placeholder="Storage room"
            required={zodFieldIsRequired(NewLocationFormSchema.shape.name)}
          />
        </FormRow>

        <FormRow rowLabel={"Main image"}>
          <div>
            <p className="hidden lg:block">
              Accepts PNG, JPG or JPEG (max.4 MB)
            </p>
            <Input
              // disabled={disabled}
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

        <div>
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
        </div>

        <FormRow className="border-y-0" rowLabel="">
          <div className="ml-auto">
            <Button type="submit" disabled={disabled}>
              {disabled ? <Spinner /> : "Save"}
            </Button>
          </div>
        </FormRow>
      </Form>
    </Card>
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
