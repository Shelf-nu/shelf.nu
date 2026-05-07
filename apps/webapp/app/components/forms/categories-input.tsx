import { useState } from "react";
import type { CSSProperties } from "react";
import { tw } from "~/utils/tw";
import DynamicSelect from "../dynamic-select/dynamic-select";
import InlineEntityCreationDialog from "../inline-entity-creation-dialog/inline-entity-creation-dialog";
import { Button } from "../shared/button";
import When from "../when/when";

type CategoriesInputProps = {
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  name: (index: number) => string;
  categories: string[];
  error: (index: number) => string | undefined;
};

/**
 * Internal row shape carrying a stable React key alongside the selected
 * category value. The `clientKey` survives add/remove/reorder operations so
 * React can preserve component state for untouched rows.
 */
type CategoryRow = { clientKey: string; value: string };

/** Generate a stable key for a new/incoming category row. */
const makeCategoryKey = (): string => crypto.randomUUID();

export default function CategoriesInput({
  className,
  style,
  disabled,
  name,
  categories: incomingCategories,
  error,
}: CategoriesInputProps) {
  const [rows, setRows] = useState<CategoryRow[]>(() => {
    const source = incomingCategories.length === 0 ? [""] : incomingCategories;
    return source.map((value) => ({ clientKey: makeCategoryKey(), value }));
  });

  return (
    <div className={tw("w-full", className)} style={style}>
      {rows.map((row, i) => {
        const category = row.value;
        const errorMessage = error(i);

        /** Values of sibling rows (used to exclude already-selected categories). */
        const siblingValues = rows
          .filter((_, index) => index !== i)
          .map((r) => r.value);

        return (
          <div key={row.clientKey} className="mb-3">
            <div className="flex items-center gap-x-2">
              <DynamicSelect
                disabled={disabled}
                fieldName={name(i)}
                defaultValue={category}
                model={{ name: "category", queryKey: "name" }}
                contentLabel="Category"
                initialDataKey="categories"
                countKey="totalCategories"
                placeholder="Select Category"
                className="flex-1"
                excludeItems={siblingValues}
                onChange={(value) => {
                  if (value !== undefined) {
                    setRows((prev) =>
                      prev.map((r, idx) => (idx === i ? { ...r, value } : r))
                    );
                  }
                }}
                extraContent={({ onItemCreated, closePopover }) => (
                  <InlineEntityCreationDialog
                    type="category"
                    title="Create new category"
                    buttonLabel="Create new category"
                    onCreated={(created) => {
                      if (created?.type !== "category") return;

                      const newId = created.entity.id;
                      setRows((prev) =>
                        prev.map((r, idx) =>
                          idx === i ? { ...r, value: newId } : r
                        )
                      );
                      onItemCreated({
                        id: newId,
                        name: created.entity.name,
                        color: created.entity.color,
                        metadata: { ...created.entity },
                      });
                      closePopover();
                    }}
                  />
                )}
              />

              <Button
                icon="x"
                className="py-2"
                variant="outline"
                type="button"
                disabled={rows.length === 1}
                onClick={() => {
                  setRows((prev) => prev.filter((_, idx) => idx !== i));
                }}
              />
            </div>

            <When truthy={!!errorMessage}>
              <p className="mt-1 text-sm text-red-500">{errorMessage}</p>
            </When>
          </div>
        );
      })}

      <Button
        icon="plus"
        className="py-3"
        variant="link"
        type="button"
        onClick={() => {
          setRows((prev) => [
            ...prev,
            { clientKey: makeCategoryKey(), value: "" },
          ]);
        }}
      >
        Add another category
      </Button>
    </div>
  );
}
