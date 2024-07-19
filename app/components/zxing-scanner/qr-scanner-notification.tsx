import { AnimatePresence, motion } from "framer-motion";
import { useAtomValue, useSetAtom } from "jotai";
import {
  qrScannerNotificationAtom,
  removeQrScannerNotificationAtom,
} from "~/atoms/qr-scanner";
import { Button } from "../shared/button";

export default function QrScannerNotification() {
  const qrScannerNotification = useAtomValue(qrScannerNotificationAtom);
  const removeQrScannerNotification = useSetAtom(
    removeQrScannerNotificationAtom
  );

  return (
    <AnimatePresence>
      {qrScannerNotification ? (
        <motion.div
          initial={{ opacity: 0, left: "-100%" }}
          animate={{ opacity: 1, left: "50%" }}
          exit={{ opacity: 0, left: "-100%" }}
          className="absolute left-1/2 top-2 z-50 flex w-full -translate-x-1/2 items-center justify-between gap-2 rounded bg-white px-3 py-2 text-gray-500 md:max-w-96"
        >
          <p>{qrScannerNotification.message}</p>
          <Button
            variant="ghost"
            icon="x"
            className="border-none p-0"
            onClick={() => {
              removeQrScannerNotification();
            }}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
