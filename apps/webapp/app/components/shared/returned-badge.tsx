import { Check } from "lucide-react";
import { BADGE_COLORS } from "~/utils/badge-colors";
import { Badge } from "./badge";

export function ReturnedBadge() {
  const colors = BADGE_COLORS.gray;
  return (
    <Badge color={colors.bg} textColor={colors.text} withDot={false}>
      <span className="inline-flex items-center">
        <Check className="mr-1 size-3.5" style={{ color: colors.text }} />
        Returned
      </span>
    </Badge>
  );
}
