import { Check } from "lucide-react";
import { GrayBadge } from "./gray-badge";

export function ReturnedBadge() {
  return (
    <GrayBadge>
      <Check className="mr-1 size-3.5 text-gray-500" />
      Returned
    </GrayBadge>
  );
}
