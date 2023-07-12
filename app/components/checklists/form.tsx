import { Form, useNavigation } from "@remix-run/react";
import { useAtom, useAtomValue } from "jotai";
import {
  fileErrorAtom,
  updateTitleAtom,
  validateFileAtom,
} from "~/atoms/checklists.new";
import { isFormProcessing } from "~/utils";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { Button } from "../shared";
import { Spinner } from "../shared/spinner";

/** Pass props of the values to be used as default for the form fields */
interface Props {
  title?: any;
  description?: any;
}

export const NewChecklistForm = ({ title, description }: Props) => {
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  const fileError = useAtomValue(fileErrorAtom);
  const [, validateFile] = useAtom(validateFileAtom);
  const [, updateTitle] = useAtom(updateTitleAtom);

  return (
    <Form
      method="post"
      className="flex w-full flex-col gap-2"
      encType="multipart/form-data"
    >
      <FormRow rowLabel={"Name"} className="border-b-0">
        <Input
          label="Name"
          hideLabel
          name="name"
          disabled={disabled}
          autoFocus
          onChange={updateTitle}
          className="w-full"
          defaultValue={title || undefined}
          required
        />
      </FormRow>

      <div>
        <FormRow rowLabel="Description">
          <Input
            inputType="textarea"
            label="Description"
            name="description"
            defaultValue={description || ""}
            placeholder="Add a description for your asset."
            disabled={disabled}
            data-test-id="itemDescription"
            className="w-full"
          />
        </FormRow>
      </div>
      <FormRow rowLabel={"Thumbnail"}>
        <div>
          <p>Accepts PNG, JPG or JPEG (max.4 MB)</p>
          <Input
            disabled={disabled}
            accept="image/png,.png,image/jpeg,.jpg,.jpeg"
            name="thumbnail"
            type="file"
            onChange={validateFile}
            label={"thumbnail"}
            hideLabel
            error={fileError}
            className="mt-2"
            inputClassName="border-0 shadow-none p-0 rounded-none"
          />
        </div>
      </FormRow>

      <div className="text-right">
        <Button type="submit" disabled={disabled}>
          {disabled ? <Spinner /> : "Save"}
        </Button>
      </div>
    </Form>
  );
};
