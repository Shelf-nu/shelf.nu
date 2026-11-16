import { ScannerScreen } from "@/components/scanner/scanner-screen";

/**
 * The Scan tab: always the plain scanner.
 *
 * It reads no route params, because a tab screen keeps the params it was
 * last opened with. Booking scanning is its own screen in the Bookings stack
 * (`app/(tabs)/bookings/scan.tsx`, see `lib/booking-scan-route.ts`).
 *
 * @see {@link file://../../components/scanner/scanner-screen.tsx} the screen
 * @returns the plain scanner
 */
export default function ScanTabScreen() {
  return <ScannerScreen booking={null} />;
}
