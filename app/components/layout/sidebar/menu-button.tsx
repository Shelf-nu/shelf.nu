import { useAtom } from "jotai";
import { tw } from "~/utils/tw";
import { toggleMobileNavAtom } from "./atoms";

const MenuButton = () => {
  const [isMobileNavOpen, toggleMobileNav] = useAtom(toggleMobileNavAtom);
  return (
    <button className="menu-btn relative z-50 pt-1.5" onClick={toggleMobileNav}>
      <span
        className={tw(
          "mb-1 block h-[2px] w-[19px] rounded-full bg-gray-500 transition-all",
          isMobileNavOpen ? "translate-y-[6px] rotate-45" : ""
        )}
      ></span>
      <span
        className={tw(
          "mb-1 block h-[2px] w-[14px] rounded-full bg-gray-500 transition-all",
          isMobileNavOpen ? "invisible opacity-0" : "opacity-1"
        )}
      ></span>
      <span
        className={tw(
          "mb-1 block h-[2px] w-[19px] rounded-full bg-gray-500 transition-all",
          isMobileNavOpen ? "translate-y-[-6px] -rotate-45" : ""
        )}
      ></span>
    </button>
  );
};

export default MenuButton;
