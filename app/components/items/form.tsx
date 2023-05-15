import type { Item, Qr } from "@prisma/client";
import { Form, useNavigation } from "@remix-run/react";
import { useAtom, useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import {
  fileErrorAtom,
  updateTitleAtom,
  validateFileAtom,
} from "~/atoms/items.new";
import { isFormProcessing } from "~/utils";
import { CategorySelect } from "../category/category-select";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { Button } from "../shared";
import { Spinner } from "../shared/spinner";

export const NewItemFormSchema = z.object({
  title: z.string().min(2, "Title is required"),
  description: z.string(),
  category: z.string(),
  qrId: z.string().optional(),
});

/** Pass props of the values to be used as default for the form fields */
interface Props {
  title?: Item["title"];
  category?: Item["categoryId"];
  description?: Item["description"];
  qrId?: Qr["id"] | null;
}

export const ItemForm = ({ title, category, description, qrId }: Props) => {
  const navigation = useNavigation();
  const zo = useZorm("NewQuestionWizardScreen", NewItemFormSchema);
  const disabled = isFormProcessing(navigation.state);

  const fileError = useAtomValue(fileErrorAtom);
  const [, validateFile] = useAtom(validateFileAtom);
  const [, updateTitle] = useAtom(updateTitleAtom);

  return (
    <Form
      ref={zo.ref}
      method="post"
      className="flex w-full flex-col gap-2"
      encType="multipart/form-data"
    >
      {qrId ? (
        <input type="hidden" name={zo.fields.qrId()} value={qrId} />
      ) : null}
      <FormRow rowLabel={"Name"} className="border-b-0">
        <Input
          label="Name"
          hideLabel
          name={zo.fields.title()}
          disabled={disabled}
          error={zo.errors.title()?.message}
          autoFocus
          onChange={updateTitle}
          className="w-full"
          defaultValue={title || undefined}
        />
      </FormRow>

      <FormRow rowLabel={"Main image"}>
        <div>
          <p>Accepts PNG, JPG or JPEG (max.4 MB)</p>
          <Input
            disabled={disabled}
            accept="image/png,.png,image/jpeg,.jpg,.jpeg"
            name="mainImage"
            type="file"
            onChange={validateFile}
            label={"mainImage"}
            hideLabel
            error={fileError}
            className="mt-2"
            inputClassName="border-0 shadow-none p-0 rounded-none"
          />
        </div>
      </FormRow>

      <FormRow
        rowLabel={"Category"}
        subHeading={
          <p>
            Make it unique. Each item can have 1 category. It will show on your
            index.
          </p>
        }
      >
        <CategorySelect defaultValue={category || undefined} />
      </FormRow>

      <div>
        <FormRow
          rowLabel="Description"
          subHeading={
            <p>
              This is the initial object description. It will be shown on the
              item’s overview page. You can always change it.
            </p>
          }
        >
          <Input
            inputType="textarea"
            label={zo.fields.description()}
            name={zo.fields.description()}
            defaultValue={description || ""}
            placeholder="Add a description for your asset."
            disabled={disabled}
            data-test-id="itemDescription"
            className="w-full"
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
