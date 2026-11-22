/**
 * Inline Entity Creation Forms
 *
 * The body of the inline entity creation dialog: the category, asset model
 * and location create forms. The asset model form brings the markdown editor
 * with it, and the dialog sits closed inside the selects of the asset index,
 * the asset and kit forms and the bulk update dialogs. So this file loads only
 * when the dialog first opens, not with every page that offers the dialog.
 *
 * Nothing outside the dialog may import this file statically: that would put
 * the forms back into the first load of those pages.
 *
 * @see {@link file://./inline-entity-creation-dialog.tsx}
 */
import type { InlineEntityCreated } from "./inline-entity-creation-dialog";
import InlineAssetModelForm from "../asset-model/inline-form";
import NewCategoryForm from "../category/new-category-form";
import { LocationForm } from "../location/form";
import When from "../when/when";

/** Props for {@link InlineEntityCreationForms}. */
type InlineEntityCreationFormsProps = {
  /** Which entity's form to show */
  type: InlineEntityCreated["type"];
  /** Called with the new entity once it is created */
  onCreated?: (created: InlineEntityCreated) => void;
  /** Closes the dialog, after a create or on cancel */
  onClose: () => void;
};

/**
 * The create form for one entity type, wired to report what it created.
 *
 * @param props - The entity type and the dialog's callbacks
 * @returns The form for `type`
 */
export default function InlineEntityCreationForms({
  type,
  onCreated,
  onClose,
}: InlineEntityCreationFormsProps) {
  return (
    <>
      {/* Category creation form */}
      <When truthy={type === "category"}>
        <NewCategoryForm
          apiUrl="/categories/new"
          formClassName="flex-col w-full border-none px-0 py-0"
          className="w-full flex-col"
          inputClassName="w-full lg:max-w-full"
          buttonsClassName="w-full mt-4"
          onCancel={onClose}
          onSuccess={(data) => {
            if (data?.category) {
              onCreated?.({
                type: "category",
                entity: {
                  id: data.category.id,
                  name: data.category.name,
                  color: data.category.color,
                  description: data.category.description,
                },
              });
            }

            onClose();
          }}
        />
      </When>

      {/* Asset model creation form */}
      <When truthy={type === "assetModel"}>
        <InlineAssetModelForm
          onSuccess={(data) => {
            if (data?.assetModel) {
              onCreated?.({
                type: "assetModel",
                entity: {
                  id: data.assetModel.id,
                  name: data.assetModel.name,
                  description: data.assetModel.description,
                },
              });
            }
            onClose();
          }}
          onCancel={onClose}
          apiUrl="/settings/asset-models/new"
        />
      </When>

      {/* Location creation form */}
      <When truthy={type === "location"}>
        <LocationForm
          apiUrl="/locations/new"
          onCancel={onClose}
          onSuccess={(data) => {
            if (data?.location) {
              onCreated?.({
                type: "location",
                entity: {
                  id: data.location.id,
                  name: data.location.name,
                  thumbnailUrl: data.location.thumbnailUrl,
                  imageUrl: data.location.imageUrl,
                },
              });
            }

            onClose();
          }}
        />
      </When>
    </>
  );
}
