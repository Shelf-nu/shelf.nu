/**
 * The scanner drawer's notice for a save that got no answer.
 *
 * Rendered by the shared drawer for every scanner. It shows only when the
 * route's action data carries a transport failure, which happens on routes
 * that export `keepScanListOnSubmitFailure` as their `clientAction`.
 *
 * The wording is deliberately not "the save failed". A request cut off in
 * transit may still have been carried out by the server, so the notice tells
 * the operator the list is safe and to look before confirming again.
 *
 * @see {@link file://./../../../utils/scan-submit-failure.ts}
 */
import { useActionData, useNavigation } from "react-router";
import { Button } from "~/components/shared/button";
import type { ScanSubmitFailureKind } from "~/utils/scan-submit-failure";
import { getScanSubmitFailure } from "~/utils/scan-submit-failure";

/** Where the operator can look to see whether the save went through. */
export type ScanSavedCheck = {
  /** The page that shows the result of the save, e.g. the booking. */
  to: string;
  /** The link text, e.g. "Open the booking". */
  label: string;
};

/** What happened, in the operator's words. One line per failure kind. */
const HEADLINES: Record<ScanSubmitFailureKind, string> = {
  timeout: "The save took too long to answer.",
  server: "The save could not be confirmed.",
  network: "The connection dropped during the save.",
};

/**
 * Tells the operator their scanned list is intact after a save that could not
 * be confirmed, and where to check whether it went through.
 *
 * Hidden while a new submission is in flight, so an old notice never sits
 * beside a save that is being retried.
 *
 * @param props.savedCheck - Optional link to the page that shows the result.
 *   Opens in a new tab so the scanner, and its list, stay where they are.
 * @returns The notice, or `null` when the last save had an answer
 */
export function ScanSubmitFailureAlert({
  savedCheck,
}: {
  savedCheck?: ScanSavedCheck;
}) {
  const failure = getScanSubmitFailure(useActionData());
  const navigation = useNavigation();

  if (!failure || navigation.state !== "idle") {
    return null;
  }

  return (
    <div
      role="alert"
      className="mx-3 mt-2 rounded border border-warning-300 bg-warning-25 px-3 py-2 text-[13px] text-warning-800"
    >
      <p className="font-semibold">{HEADLINES[failure.kind]}</p>
      <p>
        Your scanned list is still here. The save may have gone through anyway,
        so check before you confirm again.
        {savedCheck ? (
          <>
            {" "}
            <Button
              variant="link"
              to={savedCheck.to}
              target="_blank"
              rel="noreferrer"
              className="inline text-[13px] font-semibold text-warning-800 underline"
            >
              {savedCheck.label}
            </Button>
          </>
        ) : null}
      </p>
    </div>
  );
}
