import { useState } from "react";
import { tw } from "~/utils/tw";
import DynamicSelect from "../dynamic-select/dynamic-select";
import { Button } from "../shared/button";
import When from "../when/when";

type CategoriesInputProps = {
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  name: (index: number) => string;
  categories: string[];
  error: (index: number) => string | undefined;
};

export default function CategoriesInput({
  className,
  style,
  disabled,
  name,
  categories: incomingCategories,
  error,
}: CategoriesInputProps) {
  const [categories, setCategories] = useState<string[]>(
    incomingCategories.length === 0 ? [""] : incomingCategories
  );

  return (
    <div className={tw("w-full", className)} style={style}>
      {categories.map((category, i) => {
        const errorMessage = error(i);

        return (
          <div key={i} className="mb-3">
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
                excludeItems={categories}
                onChange={(value) => {
                  if (value !== undefined) {
                    categories[i] = value;
                    setCategories([...categories]);
                  }
                }}
              />

              <Button
                icon="x"
                className="py-2"
                variant="outline"
                type="button"
                onClick={() => {
                  categories.splice(i, 1);
                  setCategories([...categories]);
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
          setCategories((prev) => [...prev, ""]);
        }}
      >
        Add another category
      </Button>
    </div>
  );
}
