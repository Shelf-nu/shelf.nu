import { atom } from "jotai";

/** This atom keeps track of the qrIds scanned */
export const scannedQrIdsAtom = atom<string[]>([]);

/** This atom adds a qrId into scannedQrIdsAtom */
export const addScannedQrIdAtom = atom<null, string[], unknown>(
  null,
  (_, set, update) => {
    set(scannedQrIdsAtom, (prev) => [...prev, update]);
  }
);

/** This atom is used to remove a qrId from scannedQrIdsAtom */
export const removeScannedQrIdAtom = atom<null, string[], unknown>(
  null,
  (_, set, update) => {
    set(scannedQrIdsAtom, (prev) => prev.filter((qr) => qr !== update));
  }
);

/** This atom is used to show the notification specifically for Qr Scanner */
type QrScannerNotification = { message: string };

export const qrScannerNotificationAtom = atom<
  QrScannerNotification | undefined
>(undefined);

/** This atom is used to display a qr notification */
export const displayQrScannerNotificationAtom = atom<
  null,
  QrScannerNotification[],
  unknown
>(null, (_, set, update) => {
  /** Only one notification is displayed at a time, so we are overriding the current message with older one  */
  set(qrScannerNotificationAtom, update);

  /** Remove the notification after a certain time */
  setTimeout(() => {
    set(qrScannerNotificationAtom, undefined);
  }, 2000);
});

/** This atom is used to remove the notification immediately */
export const removeQrScannerNotificationAtom = atom(null, (_, set) => {
  set(qrScannerNotificationAtom, undefined);
});
