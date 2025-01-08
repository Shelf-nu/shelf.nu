import React, { useRef, useMemo } from "react";
import { changeDpiDataUrl } from "changedpi";
import domtoimage from "dom-to-image";
import { useReactToPrint } from "react-to-print";
import { Button } from "~/components/shared/button";
import { slugify } from "~/utils/slugify";
import { tw } from "~/utils/tw";
type SizeKeys = "cable" | "small" | "medium" | "large";

interface ObjectType {
  className?: string;
  item: {
    name: string;
    type: "asset" | "kit";
  };
  qrObj?: {
    qr?: {
      size: SizeKeys;
      id: string;
      src: string;
    };
  };
}

export const QrPreview = ({ className, qrObj, item }: ObjectType) => {
  const captureDivRef = useRef<HTMLImageElement>(null);
  const downloadQrBtnRef = useRef<HTMLAnchorElement>(null);

  const fileName = useMemo(
    () =>
      `${slugify(item.name || item.type)}-${qrObj?.qr
        ?.size}-shelf-qr-code-${qrObj?.qr?.id}.png`,
    [item, qrObj?.qr?.id, qrObj?.qr?.size]
  );

  function downloadQr(e: React.MouseEvent<HTMLButtonElement, MouseEvent>) {
    const captureDiv = captureDivRef.current;
    const downloadBtn = downloadQrBtnRef.current;
    // making sure that the captureDiv and downloadBtn exists in DOM
    if (captureDiv && downloadBtn) {
      e.preventDefault();
      domtoimage
        .toPng(captureDiv, {
          height: captureDiv.offsetHeight * 2,
          width: captureDiv.offsetWidth * 2,
          style: {
            transform: `scale(${2})`,
            transformOrigin: "top left",
            width: `${captureDiv.offsetWidth}px`,
            height: `${captureDiv.offsetHeight}px`,
          },
        })
        .then((dataUrl: string) => {
          const downloadLink = document.createElement("a");
          downloadLink.href = changeDpiDataUrl(dataUrl, 300);
          downloadLink.download = fileName;
          // Trigger a click event to initiate the download
          downloadLink.click();

          // Clean up the object URL after the download
          URL.revokeObjectURL(downloadLink.href);
        })
        // eslint-disable-next-line no-console
        .catch(console.error);
    }
  }

  const printQr = useReactToPrint({
    content: () => captureDivRef.current,
  });
  return (
    <div
      className={tw(
        "mb-4 w-auto rounded border border-solid bg-white",
        className
      )}
    >
      <div className="flex w-full justify-center pt-6">
        <QrLabel ref={captureDivRef} data={qrObj} title={item.name} />
      </div>
      <div className="mt-8 flex items-center gap-3 border-t-[1.1px] border-[#E3E4E8] px-4 py-3">
        <Button
          icon="download"
          onClick={downloadQr}
          download={`${slugify(item.name)}-${qrObj?.qr
            ?.size}-shelf-qr-code-${qrObj?.qr?.id}.png`}
          ref={downloadQrBtnRef}
          variant="secondary"
          className="w-full"
        >
          Download
        </Button>
        <Button
          icon="print"
          variant="secondary"
          className="w-full"
          onClick={printQr}
        >
          Print
        </Button>
      </div>
    </div>
  );
};

interface QrLabelProps {
  data?: {
    qr?: {
      id: string;
      size: SizeKeys;
      src: string;
    };
  };
  title: string;
}

const QrLabel = React.forwardRef<HTMLDivElement, QrLabelProps>(
  function QrLabel(props, ref) {
    const { data, title } = props ?? {};
    return (
      <div
        className="flex aspect-square w-[300px] flex-col justify-center gap-3 rounded border-[5px] border-[#E3E4E8] bg-white px-6 py-[17px]"
        ref={ref}
      >
        <div className="max-w-full truncate text-center text-[12px] font-semibold text-black">
          {title}
        </div>
        <figure className="qr-code flex justify-center">
          <img
            src={data?.qr?.src}
            alt={`${data?.qr?.size}-shelf-qr-code.png`}
          />
        </figure>
        <div className="w-full text-center text-[12px]">
          <span className="block  font-semibold text-black">
            {data?.qr?.id}
          </span>
          <span className="block text-black">
            Powered by{" "}
            <span className="font-semibold text-black">shelf.nu</span>
          </span>
        </div>
      </div>
    );
  }
);
