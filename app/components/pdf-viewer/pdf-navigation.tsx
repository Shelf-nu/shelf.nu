import { type TUsePDFSlickStore } from "@pdfslick/react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { Button } from "../shared/button";

type PdfNavigationProps = {
  usePDFSlickStore: TUsePDFSlickStore;
};

export default function PdfNavigation({
  usePDFSlickStore,
}: PdfNavigationProps) {
  const pageNumber = usePDFSlickStore((state) => state.pageNumber);
  const numberOfPages = usePDFSlickStore((state) => state.numPages);
  const pdfSlick = usePDFSlickStore((state) => state.pdfSlick);
  const scale = usePDFSlickStore((state) => state.scale);

  return (
    <div className="absolute bottom-4 right-4 z-50 flex items-center justify-center gap-2 rounded-md border bg-white p-2">
      <Button
        disabled={pageNumber === 1}
        variant="link-gray"
        onClick={() => {
          pdfSlick?.gotoPage(pageNumber - 1);
        }}
      >
        <ChevronLeftIcon className="size-5" />
      </Button>

      <Button
        disabled={!pdfSlick || scale <= 0.25}
        variant="link-gray"
        type="button"
        onClick={() => pdfSlick?.viewer?.decreaseScale()}
      >
        <ZoomOutIcon className="size-5" />
      </Button>

      <Button
        disabled={!pdfSlick || scale >= 5}
        variant="link-gray"
        onClick={() => pdfSlick?.viewer?.increaseScale()}
        type="button"
      >
        <ZoomInIcon className="size-5" />
      </Button>

      <Button
        disabled={numberOfPages <= pageNumber}
        variant="link-gray"
        onClick={() => {
          pdfSlick?.gotoPage(pageNumber + 1);
        }}
      >
        <ChevronRightIcon className="size-5" />
      </Button>
    </div>
  );
}
