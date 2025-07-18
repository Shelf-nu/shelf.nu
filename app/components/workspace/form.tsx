import { useEffect, useRef } from "react";
import type { Organization, Currency } from "@prisma/client";
import { useLoaderData, useNavigation } from "@remix-run/react";
import { useAtom, useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { updateDynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { defaultValidateFileAtom, fileErrorAtom } from "~/atoms/file";
import { useSearchParams } from "~/hooks/search-params";
import type { loader } from "~/routes/_layout+/account-details.workspace.new";
import { ACCEPT_SUPPORTED_IMAGES } from "~/utils/constants";
import { isFormProcessing } from "~/utils/form";
import { zodFieldIsRequired } from "~/utils/zod";
import { Form } from "../custom-form";
import FormRow from "../forms/form-row";
import { InnerLabel } from "../forms/inner-label";
import Input from "../forms/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms/select";
import { CrispButton } from "../marketing/crisp";
import { Button } from "../shared/button";
import { Card } from "../shared/card";
import { Spinner } from "../shared/spinner";

export const NewWorkspaceFormSchema = z.object({
  name: z.string().min(2, "Name is required"),
  currency: z.custom<Currency>(),
});

/** Pass props of the values to be used as default for the form fields */
interface Props {
  name?: Organization["name"];
  currency?: Organization["currency"];
  children?: string | React.ReactNode;
}

export const WorkspaceForm = ({ name, currency, children }: Props) => {
  const { curriences } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const navigation = useNavigation();
  const zo = useZorm("NewQuestionWizardScreen", NewWorkspaceFormSchema);
  const disabled = isFormProcessing(navigation.state);
  const fileError = useAtomValue(fileErrorAtom);
  const [, validateFile] = useAtom(defaultValidateFileAtom);
  const [, updateTitle] = useAtom(updateDynamicTitleAtom);
  const nameFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const team = searchParams.get("team");
    if (!team && nameFieldRef.current) {
      nameFieldRef.current.focus();
    }
  }, [searchParams]);

  return (
    <Card className="w-full md:w-min">
      <Form
        ref={zo.ref}
        method="post"
        className="flex w-full flex-col gap-2"
        encType="multipart/form-data"
      >
        <FormRow
          rowLabel={"Name"}
          subHeading={
            "Choose a name that represents your Organization. Make it easily recognizable for your team members."
          }
          className="border-b-0 pb-[10px] pt-0"
          required={zodFieldIsRequired(NewWorkspaceFormSchema.shape.name)}
        >
          <Input
            label="Name"
            hideLabel
            name={zo.fields.name()}
            disabled={disabled}
            error={zo.errors.name()?.message}
            autoFocus
            onChange={updateTitle}
            className="w-full"
            defaultValue={name || undefined}
            placeholder=""
            required={zodFieldIsRequired(NewWorkspaceFormSchema.shape.name)}
            ref={nameFieldRef}
          />
        </FormRow>

        <FormRow
          rowLabel={"Main image"}
          className="border-b-0"
          subHeading={
            "Used to place your organization's logo or symbol. For best results, use a square image."
          }
        >
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

        <div>
          <FormRow
            rowLabel={"Currency"}
            className={children ? "border-b-0" : ""}
            subHeading={
              <p>
                Choose the currency for your workspace. If you don't see your
                currency, please{" "}
                <CrispButton variant="link" className="inline text-xs">
                  contact support
                </CrispButton>
                .
              </p>
            }
          >
            <InnerLabel hideLg>Currency</InnerLabel>

            <Select
              defaultValue={currency || "USD"}
              disabled={disabled}
              name={zo.fields.currency()}
            >
              <SelectTrigger className="px-3.5 py-3">
                <SelectValue placeholder="Choose a field type" />
              </SelectTrigger>
              <SelectContent
                position="popper"
                className="w-full min-w-[300px]"
                align="start"
              >
                <div className=" max-h-[320px] overflow-auto">
                  {curriences.map((value) => (
                    <SelectItem value={value} key={value}>
                      <span className="mr-4 text-[14px] text-color-700">
                        {value}
                      </span>
                    </SelectItem>
                  ))}
                </div>
              </SelectContent>
            </Select>
          </FormRow>
        </div>
        <div className="text-right">
          <Button type="submit" disabled={disabled}>
            {disabled ? <Spinner /> : "Save"}
          </Button>
        </div>
      </Form>
    </Card>
  );
};
