import { useState } from "react";
import { tw } from "~/utils/tw";
import DynamicSelect from "../dynamic-select/dynamic-select";
import { Button } from "../shared/button";

type CategoriesInputProps = {
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  name: (index: number) => string;
  categories: string[];
};

export default function CategoriesInput({
  className,
  style,
  disabled,
  name,
  categories: incomingCategories,
}: CategoriesInputProps) {
  const [categories, setCategories] = useState<string[]>(
    incomingCategories.length === 0 ? [""] : incomingCategories
  );

  return (
    <div className={tw("w-full", className)} style={style}>
      {categories.map((category, i) => (
        <div key={i} className="mb-3 flex items-center gap-x-2">
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
              categories[i] = value;
              setCategories([...categories]);
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
      ))}

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
