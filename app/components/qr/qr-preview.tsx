import React, { useRef, useMemo } from "react";
import { changeDpiDataUrl } from "changedpi";
import { toPng } from "html-to-image";
import { useReactToPrint } from "react-to-print";
import { Button } from "~/components/shared/button";
import { slugify } from "~/utils/slugify";
import { tw } from "~/utils/tw";
import When from "../when/when";

type SizeKeys = "cable" | "small" | "medium" | "large";

interface ObjectType {
  className?: string;
  style?: React.CSSProperties;
  hideButton?: boolean;
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

export const QrPreview = ({
  className,
  style,
  qrObj,
  item,
  hideButton = false,
}: ObjectType) => {
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
      toPng(captureDiv, {
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

  const printQr = useReactToPrint({ content: () => captureDivRef.current });

  return (
    <div
      className={tw("mb-4 w-auto rounded border bg-white", className)}
      style={style}
    >
      <div className="flex w-full justify-center pt-6">
        <QrLabel ref={captureDivRef} data={qrObj} title={item.name} />
      </div>

      <When truthy={!hideButton}>
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
      </When>
    </div>
  );
};

export type QrDef = {
  id: string;
  size: SizeKeys;
  src: string;
};

interface QrLabelProps {
  data?: { qr?: QrDef };
  title: string;
}

export const QrLabel = React.forwardRef<HTMLDivElement, QrLabelProps>(
  function QrLabel(props, ref) {
    const { data, title } = props ?? {};

    return (
      <div
        /**
         * We are using inline style here and not tailwind because we are using this component for
         * bulk download qr codes. And bulk download qr code uses `renderToStaticMarkup` which does not
         * compile tailwindcss.
         */
        style={{
          width: "300px",
          aspectRatio: 1 / 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: "12px",
          borderRadius: "4px",
          border: "5px solid #E3E4E8",
          padding: "24px 17px 24px 17px",
          backgroundColor: "white",
        }}
        ref={ref}
      >
        <div
          style={{
            fontSize: "12px",
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: "100%",
            color: "black",
            textAlign: "center",
          }}
        >
          {title}
        </div>
        <figure className="qr-code flex justify-center">
          <img
            src={data?.qr?.src}
            alt={`${data?.qr?.size}-shelf-qr-code.png`}
          />
        </figure>
        <div style={{ width: "100%", textAlign: "center", fontSize: "12px" }}>
          <div style={{ fontWeight: 600 }}>{data?.qr?.id}</div>
          <div>
            Powered by{" "}
            <span style={{ fontWeight: 600, color: "black" }}>shelf.nu</span>
          </div>
        </div>
      </div>
    );
  }
);
