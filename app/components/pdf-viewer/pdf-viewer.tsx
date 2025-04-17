import { ClientOnly } from "remix-utils/client-only";
import { PdfRenderer } from "./pdf-renderer.client";

export type PdfViewerProps = {
  url: string;
};

/**
 * This component ensures that the PDF viewer is only rendered on the client side.
 * Since `@pdfslick/react` relies on the `window` object, we wrap the PdfRenderer
 * with `ClientOnly` from remix-utils to prevent server-side rendering errors.
 */
export default function PdfViewer(props: PdfViewerProps) {
  return (
    <ClientOnly fallback={null}>{() => <PdfRenderer {...props} />}</ClientOnly>
  );
}
