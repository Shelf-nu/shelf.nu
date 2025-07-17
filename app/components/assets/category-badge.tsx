import type { Category } from "@prisma/client";
import { useHints } from "~/utils/client-hints";
import { Badge } from "../shared/badge";

export function CategoryBadge({
  category,
  className,
}: {
  category: Pick<Category, "id" | "name" | "color"> | null;
  className?: string;
}) {
  const { theme } = useHints();
  return category ? (
    <Badge color={category.color} withDot={false} className={className}>
      {category.name}
    </Badge>
  ) : (
    <Badge
      color={theme === "light" ? "#575757" : "#D9D9D9"}
      withDot={false}
      className={className}
    >
      Uncategorized
    </Badge>
  );
}
