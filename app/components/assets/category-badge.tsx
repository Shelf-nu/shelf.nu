import type { Category } from "@prisma/client";
import { Badge } from "../shared/badge";

export function CategoryBadge({
  category,
}: {
  category: Pick<Category, "id" | "name" | "color"> | null;
  className?: string;
}) {
  return category ? (
    <Badge color={category.color} withDot={false}>
      {category.name}
    </Badge>
  ) : (
    <Badge color="#575757" withDot={false}>
      Uncategorized
    </Badge>
  );
}
