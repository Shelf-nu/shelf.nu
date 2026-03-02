import { CategoryBadge } from "~/components/assets/category-badge";

type Props = {
  name?: string;
  color?: string;
};

export function CategoryBadgeComponent({ name, color }: Props) {
  return (
    <CategoryBadge
      category={{
        id: "__note-category__",
        name: name ?? "Uncategorized",
        color: color ?? "#575757",
      }}
      className="inline-flex"
    />
  );
}
