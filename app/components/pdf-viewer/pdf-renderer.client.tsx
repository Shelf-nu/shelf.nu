import { usePDFSlick } from "@pdfslick/react";
import PdfNavigation from "./pdf-navigation";
import type { PdfViewerProps } from "./pdf-viewer";

import "@pdfslick/react/dist/pdf_viewer.css";

/**
 * This component handles the actual rendering of the PDF using `@pdfslick/react`.
 * It is in a separate `.client.tsx` file to ensure it only runs in the browser,
 * avoiding SSR issues caused by dependencies that rely on the `window` object.
 */
export function PdfRenderer({ url }: PdfViewerProps) {
  const { viewerRef, usePDFSlickStore, PDFSlickViewer } = usePDFSlick(url);

  return (
    <>
      <PDFSlickViewer
        viewerRef={viewerRef}
        usePDFSlickStore={usePDFSlickStore}
      />

      <PdfNavigation usePDFSlickStore={usePDFSlickStore} />
    </>
  );
}
