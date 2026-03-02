import { useState } from "react";
import { MessageCircleIcon } from "lucide-react";
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from "~/components/layout/sidebar/sidebar";
import FeedbackModal from "./feedback-modal";

export default function FeedbackNavItem() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <SidebarMenuItem>
        <SidebarMenuButton
          className="font-semibold"
          tooltip="Questions/Feedback"
          onClick={() => setIsOpen(true)}
        >
          <MessageCircleIcon className="size-4 text-gray-600" />
          <span>Questions/Feedback</span>
        </SidebarMenuButton>
      </SidebarMenuItem>

      <FeedbackModal open={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
