import type { Organization, Currency } from "@prisma/client";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import { useAtom, useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { updateDynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { fileErrorAtom, validateFileAtom } from "~/atoms/file";
import type { loader } from "~/routes/_layout+/account-details.workspace.$workspaceId.edit";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import { zodFieldIsRequired } from "~/utils/zod";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms/select";
import { Button } from "../shared/button";
import { Card } from "../shared/card";
import { Spinner } from "../shared/spinner";

/** Pass props of the values to be used as default for the form fields */
interface Props {
  name?: Organization["name"];
  currency?: Organization["currency"];
  children?: string | React.ReactNode;
  className?: string;
}

export const EditWorkspaceFormSchema = (sso: boolean = false) =>
  z.object({
    id: z.string(),
    name: z.string().min(2, "Name is required"),
    logo: z.any().optional(),
    currency: z.custom<Currency>(),
    selfServiceGroupId: sso
      ? z.string().min(1, "Self service group id is required")
      : z.string().optional(),
    adminGroupId: sso
      ? z.string().min(1, "Administrator group id is required")
      : z.string().optional(),
  });

export const WorkspaceEditForm = ({
  name,
  currency,
  children,
  className,
}: Props) => {
  const { curriences, organization } = useLoaderData<typeof loader>();
  const navigation = useNavigation();

  let schema = EditWorkspaceFormSchema(organization.enabledSso);
  const zo = useZorm("NewQuestionWizardScreen", schema);
  const disabled = isFormProcessing(navigation.state);
  const fileError = useAtomValue(fileErrorAtom);
  const [, validateFile] = useAtom(validateFileAtom);
  const [, updateTitle] = useAtom(updateDynamicTitleAtom);

  return (
    <Card className={tw("w-full md:w-min", className)}>
      <Form
        ref={zo.ref}
        method="post"
        className="flex w-full flex-col gap-2"
        encType="multipart/form-data"
      >
        <input type="hidden" value={organization.id} name="id" />

        <FormRow
          rowLabel={"Name"}
          className="border-b-0 pb-[10px] pt-0"
          required={zodFieldIsRequired(schema.shape.name)}
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
            required={zodFieldIsRequired(schema.shape.name)}
          />
        </FormRow>

        <FormRow rowLabel={"Main image"} className="border-b-0">
          <div>
            <p className="hidden lg:block">
              Accepts PNG, JPG or JPEG (max.4 MB)
            </p>
            <Input
              // disabled={disabled}
              accept="image/png,.png,image/jpeg,.jpg,.jpeg"
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
          <label className="lg:hidden">Currency</label>
          <FormRow
            rowLabel={"Currency"}
            className={children ? "border-b-0" : ""}
          >
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
                      <span className="mr-4 text-[14px] text-gray-700">
                        {value}
                      </span>
                    </SelectItem>
                  ))}
                </div>
              </SelectContent>
            </Select>
          </FormRow>
        </div>

        {organization.enabledSso && organization.ssoDetails ? (
          <div>
            <div className=" border-b pb-5">
              <h2 className=" text-[18px] font-semibold">SSO details</h2>
              <p>
                This workspace has SSO enabled so you can see your SSO settings.
              </p>
            </div>

            <FormRow
              rowLabel={"SSO Domain"}
              className="border-b-0 pb-[10px]"
              subHeading={
                "The domain that this workspace is linked to. If you want it changed, please contact support."
              }
              required
            >
              <Input
                label="SSO Domain"
                hideLabel
                disabled={true}
                className="disabled w-full"
                defaultValue={organization.ssoDetails.domain}
                required
              />
            </FormRow>

            <FormRow
              rowLabel={`Administrator role group id`}
              subHeading={
                <div>
                  Place the Id of the group that should be mapped to the{" "}
                  <b>Administrator</b> role.
                </div>
              }
              className="border-b-0 pb-[10px]"
              required
            >
              <Input
                label={"Administrator role group id"}
                hideLabel
                className="w-full"
                name={zo.fields.adminGroupId()}
                error={zo.errors.adminGroupId()?.message}
                defaultValue={organization.ssoDetails.adminGroupId || undefined}
                required
              />
            </FormRow>

            <FormRow
              rowLabel={`Self service role group id`}
              subHeading={
                <div>
                  Place the Id of the group that should be mapped to the{" "}
                  <b>Self service</b> role.
                </div>
              }
              className="border-b-0 pb-[10px]"
              required
            >
              <Input
                label={"Self service role group id"}
                hideLabel
                name={zo.fields.selfServiceGroupId()}
                error={zo.errors.selfServiceGroupId()?.message}
                defaultValue={
                  organization.ssoDetails.selfServiceGroupId || undefined
                }
                className="w-full"
                required
              />
            </FormRow>
          </div>
        ) : null}

        <div className="text-right">
          <Button type="submit" disabled={disabled}>
            {disabled ? <Spinner /> : "Save"}
          </Button>
        </div>
      </Form>
    </Card>
  );
};
