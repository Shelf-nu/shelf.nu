import { useState } from "react";
import { MessageCircleIcon } from "lucide-react";
import {
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "~/components/layout/sidebar/sidebar";
import FeedbackModal from "./feedback-modal";

export default function FeedbackNavItem() {
  const [isOpen, setIsOpen] = useState(false);
  const { isMobile, setOpenMobile } = useSidebar();

  const handleOpen = () => {
    // On mobile the sidebar is a Radix UI Sheet. Its DismissableLayer intercepts
    // pointer events outside the Sheet DOM. The FeedbackModal portals to body
    // (outside the Sheet DOM), so taps on the modal trigger the Sheet's outside-
    // click handler, causing click-through to the sidebar buttons beneath.
    // Closing the Sheet first removes this conflict.
    if (isMobile) {
      setOpenMobile(false);
    }
    setIsOpen(true);
  };

  return (
    <>
      <SidebarMenuItem>
        <SidebarMenuButton
          className="font-semibold"
          tooltip="Questions/Feedback"
          onClick={handleOpen}
        >
          <MessageCircleIcon className="size-4 text-gray-600" />
          <span>Questions/Feedback</span>
        </SidebarMenuButton>
      </SidebarMenuItem>

      <FeedbackModal open={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
