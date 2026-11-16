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
import { useAtomValue } from "jotai";
import { useActionData } from "react-router";
import { Button } from "~/components/shared/button";
import { useDisabled } from "~/hooks/use-disabled";
import {
  retiredScanSubmitFailureAtom,
  unconfirmedScanSaveAtom,
} from "~/hooks/use-scan-draft";
import type { ScanSubmitFailureKind } from "~/utils/scan-submit-failure";
import { getScanSubmitFailure } from "~/utils/scan-submit-failure";

/** Where the operator can look to see whether the save went through. */
export type ScanSavedCheck = {
  /** The page that shows the result of the save, e.g. the booking. */
  to: string;
  /** The link text, e.g. "Open the booking". */
  label: string;
};

/**
 * The check for every booking scanner: the booking page shows what was saved.
 *
 * @param bookingId - The booking the scanner saves into
 * @returns The link the failure notice offers
 */
export function bookingSavedCheck(bookingId: string): ScanSavedCheck {
  return { to: `/bookings/${bookingId}`, label: "Open the booking" };
}

/** What happened, in the operator's words. One line per failure kind. */
const HEADLINES: Record<ScanSubmitFailureKind, string> = {
  timeout: "The save took too long to answer.",
  server: "The save could not be confirmed.",
  network: "The connection dropped during the save.",
  rejected: "The save was not accepted.",
};

/**
 * What to do about it. A save that got no answer may still have been carried
 * out, so the operator is told to look first. One a gateway turned away was
 * never carried out, and saying it "may have gone through" would be untrue.
 */
const UNCONFIRMED_ADVICE =
  "Your scanned list is still here. The save may have gone through anyway, so check before you confirm again.";
const ADVICE: Record<ScanSubmitFailureKind, string> = {
  timeout: UNCONFIRMED_ADVICE,
  server: UNCONFIRMED_ADVICE,
  network: UNCONFIRMED_ADVICE,
  rejected:
    "Your scanned list is still here and nothing was saved. Wait a moment, then confirm again.",
};

/**
 * Shown for a list put back from a scan draft that was sent in a save that
 * got no answer. The failure itself went with the page, so all that is known
 * is that this list may already be saved.
 */
const RESTORED_UNCONFIRMED_HEADLINE =
  "An earlier save of this list got no answer.";
const RESTORED_UNCONFIRMED_ADVICE =
  "The save may have gone through, so check before you confirm again.";

/** Added to a refusal when an earlier save of the same list got no answer. */
const EARLIER_UNCONFIRMED_ADVICE =
  "An earlier save of this list got no answer and may have gone through, so check before you confirm again.";

/** HTTP 413: the request was larger than the gateway accepts. */
const TOO_LARGE_STATUS = 413;

/**
 * Advice for a submission the gateway found too large. Waiting does not help:
 * the same submission is refused again until it is made smaller.
 */
const TOO_LARGE_ADVICE =
  "Your scanned list is still here and nothing was saved, because the submission was too large. Remove some photos or items, then confirm again.";

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
  const answered = getScanSubmitFailure(useActionData());
  const retired = useAtomValue(retiredScanSubmitFailureAtom);
  // A failure whose list was emptied belongs to no list on screen.
  const failure = answered !== null && answered !== retired ? answered : null;
  const unconfirmedSave = useAtomValue(unconfirmedScanSaveAtom);
  const submitting = useDisabled();

  if (submitting) {
    return null;
  }

  // A refused retry says nothing was saved by that attempt only. An earlier
  // one that got no answer may still have gone through, so its warning and
  // check link stay beside the refusal.
  const earlierSaveUnconfirmed =
    unconfirmedSave && failure?.kind === "rejected";

  if (!failure) {
    // The failure went with the page (a reload, an error page), but the list
    // came back from a draft that remembers it may already be saved.
    return unconfirmedSave ? (
      <div
        role="alert"
        className="mx-3 mt-2 rounded border border-warning-300 bg-warning-25 px-3 py-2 text-[13px] text-warning-800"
      >
        <p className="font-semibold">{RESTORED_UNCONFIRMED_HEADLINE}</p>
        <p>
          {RESTORED_UNCONFIRMED_ADVICE}
          {savedCheck ? <SavedCheckLink savedCheck={savedCheck} /> : null}
        </p>
      </div>
    ) : null;
  }

  return (
    <div
      role="alert"
      className="mx-3 mt-2 rounded border border-warning-300 bg-warning-25 px-3 py-2 text-[13px] text-warning-800"
    >
      <p className="font-semibold">{HEADLINES[failure.kind]}</p>
      <p>
        {failure.status === TOO_LARGE_STATUS
          ? TOO_LARGE_ADVICE
          : ADVICE[failure.kind]}
        {savedCheck &&
        !earlierSaveUnconfirmed &&
        failure.kind !== "rejected" ? (
          <SavedCheckLink savedCheck={savedCheck} />
        ) : null}
      </p>
      {earlierSaveUnconfirmed ? (
        <p>
          {EARLIER_UNCONFIRMED_ADVICE}
          {savedCheck ? <SavedCheckLink savedCheck={savedCheck} /> : null}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The link to the page that shows whether a save went through. Opens in a
 * new tab so the scanner, and its list, stay where they are.
 */
function SavedCheckLink({ savedCheck }: { savedCheck: ScanSavedCheck }) {
  return (
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
  );
}
