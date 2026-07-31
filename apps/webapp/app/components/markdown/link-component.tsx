import { Button } from "~/components/shared/button";
import { isInternalPath } from "~/utils/safe-internal-path";

interface LinkComponentProps {
  to: string;
  text: string;
}

/**
 * Generic component for rendering links in markdown content that open in new tabs
 * Can be used for users, bookings, assets, or any other entity links
 *
 * SECURITY: `to` arrives from stored note content, which is assembled from
 * user-controlled values (booking names, asset titles, …). A value containing
 * `{% … %}` can therefore reach the renderer as a live tag with an attacker-
 * chosen target. Every link this app legitimately writes is a root-relative
 * in-app path, so anything else is dropped and the label renders as plain
 * text: the note still reads correctly, minus the destination.
 *
 * This guard is what protects notes ALREADY stored in the database —
 * sanitizing at write time cannot reach those. Do not remove it in favour of
 * write-side stripping alone.
 *
 * @param to - Link target; rendered only when it is an internal path
 * @param text - Display text, rendered either way
 */
export function LinkComponent({ to, text }: LinkComponentProps) {
  if (!isInternalPath(to)) {
    return <span>{text}</span>;
  }

  return (
    <Button
      variant="link"
      to={to}
      target="_blank"
      className="h-auto p-0 font-semibold text-black underline hover:text-primary"
    >
      {text}
    </Button>
  );
}
