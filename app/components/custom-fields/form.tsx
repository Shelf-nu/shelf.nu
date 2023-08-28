import { Form, useNavigation } from "@remix-run/react";
import { useAtom } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { updateTitleAtom } from "~/atoms/custom-fields.new";
import { isFormProcessing } from "~/utils";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms/select";
import { Switch } from "../forms/switch";
import { Button } from "../shared";
import { Spinner } from "../shared/spinner";

export const NewCustomFieldFormSchema = z.object({
  title: z.string().min(2, "Title is required"),
  helpText: z.string(),
  type: z.string(),
  required: z.boolean(),
});

/** Pass props of the values to be used as default for the form fields */
interface Props {
  title?: string;
  helpText?: string;
}

export const CustomFieldForm = ({ title, helpText }: Props) => {
  const navigation = useNavigation();
  const zo = useZorm("NewQuestionWizardScreen", NewCustomFieldFormSchema);
  const disabled = isFormProcessing(navigation.state);
  const fieldTypes = ["Text"];

  const [, updateTitle] = useAtom(updateTitleAtom);

  return (
    <Form
      ref={zo.ref}
      method="post"
      className="flex w-full flex-col gap-2"
      encType="multipart/form-data"
    >
      <FormRow rowLabel={"Name"} className="border-b-0 pb-[10px]">
        <Input
          label="Name"
          hideLabel
          name={zo.fields.title()}
          disabled={disabled}
          error={zo.errors.title()?.message}
          autoFocus
          onChange={updateTitle}
          className="w-full"
          defaultValue={title || ""}
          placeholder="Choose a field name"
        />
      </FormRow>

      <div>
        <label className="lg:hidden">Type</label>
        <FormRow rowLabel={"Type"} className="border-b-0 pb-[10px] pt-[6px]">
          <Select name="type" defaultValue="Text">
            <SelectTrigger
              className="px-3.5 py-3"
              placeholder="Choose a field type"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              position="popper"
              className="w-full min-w-[300px]"
              align="start"
            >
              <div className=" max-h-[320px] overflow-auto">
                {fieldTypes.map((value) => (
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

      <FormRow rowLabel="" className="border-b-0 pt-2">
        <div className="flex items-center gap-3">
          <Switch name={zo.fields.required()} />
          <label className="text-base font-medium text-gray-700">
            Required
          </label>
        </div>
      </FormRow>

      <div>
        <FormRow
          rowLabel="Help Text"
          subHeading={
            <p>
              This text will function as a help text that is visible when
              filling the field
            </p>
          }
        >
          <Input
            inputType="textarea"
            label="Help Text"
            name={zo.fields.helpText()}
            defaultValue={helpText || ""}
            placeholder="Add a help text for your custom field."
            disabled={disabled}
            data-test-id="fieldHelpText"
            className="w-full"
            hideLabel
          />
        </FormRow>
      </div>

      <div className="text-right">
        <Button type="submit" disabled={disabled}>
          {disabled ? <Spinner /> : "Save"}
        </Button>
      </div>
    </Form>
  );
};
