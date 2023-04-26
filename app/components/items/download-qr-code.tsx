import { motion } from "framer-motion";
import { atom, useAtom } from "jotai";
import { tw } from "~/utils";
import { XIcon } from "../icons";
import { Button } from "../shared";

const sidebarStatusAtom = atom(false);
const toggleSidebarAtom = atom(
  (get) => get(sidebarStatusAtom),
  (get, set) => set(sidebarStatusAtom, !get(sidebarStatusAtom))
);

const DownloadQrCode = () => {
  const [isSidebarOpen, toggleSidebar] = useAtom(toggleSidebarAtom);

  // useEffect(()=>{
  //   if(isSidebarOpen) {
  //     document.body.classList.add("overflow-hidden")
  //   } else{
  //     document.body.classList.remove("overflow-hidden")
  //   }
  // }, [isSidebarOpen]);

  return (
    <div>
      <Button icon="barcode" onClick={toggleSidebar} variant="secondary">
        Download QR Tag
      </Button>
      <div onClick={toggleSidebar} className={tw("fixed right-0 top-0 z-10 h-screen w-screen cursor-pointer bg-gray-25/70 backdrop-blur transition duration-300 ease-in-out", isSidebarOpen ? "visible" : "invisible opacity-0")}></div>
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: isSidebarOpen ? 0 : "100%" }}
        transition={{ duration: 0.5 }}
        className="download-qr-sidebar fixed right-0 top-0 z-50 box-border h-screen w-[392px] border border-solid border-gray-200 bg-white p-6"
      >
        <header className="mb-6 flex items-center justify-between leading-7">
          <h3>Download QR Tag</h3>
          <button onClick={toggleSidebar} className="text-gray-400">
            <XIcon />
          </button>
        </header>
        <div className="borger-gray-200 mb-6 w-full rounded-xl border border-solid p-6">
          <figure className="qr-code mb-6 h-[296px] w-[296px]">
            <img src="/images/qr-code-placeholder.jpg" className="w-full" alt="qr-code" />
          </figure>
          <div className="text-center">
          <h6 className="mb-1 font-semibold leading-5 text-gray-700">Macbook Pro M1 (2021)</h6>
          <span className="block text-[12px] text-gray-600">S349a002e</span>
          </div>
        </div>
        <ul className="description-list">
          <li className="mb-4 flex justify-between text-gray-600">
            <span className="key max-w-[120px] break-words font-medium">Size</span>
            <span className="value max-w-[190px] break-words font-semibold">Small (2cm x 2cm)</span>
          </li>
          <li className="mb-4 flex justify-between text-gray-600">
            <span className="key max-w-[120px] break-words font-medium">File</span>
            <span className="value max-w-[190px] break-words font-semibold">SVG</span>
          </li>
        </ul>
        <Button icon="barcode" variant="secondary" className="w-full">
        Download QR Tag
      </Button>
      </motion.div>
    </div>
  );
};

export default DownloadQrCode;
