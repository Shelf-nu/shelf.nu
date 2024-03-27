import { useAtom } from "jotai";
import { tw } from "~/utils/tw";
import { toggleMobileNavAtom } from "./atoms";

const Overlay = () => {
  const [isMobileNavOpen, toggleMobileNav] = useAtom(toggleMobileNavAtom);
  return (
    <div
      onClick={toggleMobileNav}
      className={tw(
        "fixed right-0 top-0 z-10 h-screen w-screen cursor-pointer bg-gray-25/10 backdrop-blur transition duration-300 ease-in-out md:hidden",
        isMobileNavOpen ? "visible" : "invisible opacity-0"
      )}
    ></div>
  );
};

export default Overlay;
