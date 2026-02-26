import type { Category } from "@prisma/client";
import { Badge } from "../shared/badge";
import { GrayBadge } from "../shared/gray-badge";

export function CategoryBadge({
  category,
  className,
}: {
  category: Pick<Category, "id" | "name" | "color"> | null;
  className?: string;
}) {
  return category ? (
    <Badge color={category.color} withDot={false} className={className}>
      {category.name}
    </Badge>
  ) : (
    <GrayBadge className={className}>Uncategorized</GrayBadge>
  );
}
