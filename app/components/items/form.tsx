import type { Item } from "@prisma/client";
import { Form, Link, useFetcher, useNavigation } from "@remix-run/react";
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
import { MarkdownEditor } from "../markdown";
import { Button } from "../shared";

export const NewItemFormSchema = z.object({
  title: z.string().min(2, "Title is required"),
  description: z.string(),
  category: z.string(),
});

/** Pass props of the values to be used as default for the form fields */
interface Props {
  title?: Item["title"];
  category?: Item["categoryId"];
  description?: Item["description"];
}

export const ItemForm = ({ title, category, description }: Props) => {
  const fetcher = useFetcher();
  const zo = useZorm("NewQuestionWizardScreen", NewItemFormSchema);
  const disabled = isFormProcessing(fetcher.state);

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
        rowLabel={"Cateogry"}
        subHeading="Make it unique. Each item can have 1 category. It will show on your index."
      >
        <CategorySelect defaultValue={category || undefined} />
      </FormRow>

      <div>
        <FormRow
          rowLabel="Description"
          subHeading={
            <p>
              This is the initial object description. It will be shown on the
              item’s overview page. You can always change it. This field
              supports{" "}
              <Link
                to="https://www.markdownguide.org/cheat-sheet"
                target="_blank"
                className="text-gray-800 underline"
                rel="nofollow noopener noreferrer"
              >
                markdown
              </Link>
              .
            </p>
          }
        >
          <MarkdownEditor
            label={zo.fields.description()}
            name={zo.fields.description()}
            defaultValue={description || ""}
            disabled={disabled}
            data-test-id="itemDescription"
          />
        </FormRow>
      </div>

      <div className="text-right">
        <Button type="submit" disabled={disabled}>
          Save
        </Button>
      </div>
    </Form>
  );
};
