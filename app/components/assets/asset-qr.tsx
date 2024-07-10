import React, { useRef, useMemo } from "react";
import { changeDpiDataUrl } from "changedpi";
import domtoimage from "dom-to-image";
import { useReactToPrint } from "react-to-print";
import { Button } from "~/components/shared/button";
import { slugify } from "~/utils/slugify";
type SizeKeys = "cable" | "small" | "medium" | "large";

interface AssetType {
  asset: {
    title: string;
  };
  qrObj?: {
    qr?: {
      size: SizeKeys;
      id: string;
      src: string;
    };
  };
}

const AssetQR = ({ qrObj, asset }: AssetType) => {
  const captureDivRef = useRef<HTMLImageElement>(null);
  const downloadQrBtnRef = useRef<HTMLAnchorElement>(null);

  const fileName = useMemo(
    () =>
      `${slugify(asset?.title || "asset")}-${qrObj?.qr
        ?.size}-shelf-qr-code-${qrObj?.qr?.id}.png`,
    [asset, qrObj?.qr?.id, qrObj?.qr?.size]
  );

  // const handleSizeChange = () => {
  //   submit(formRef.current);
  // };

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
    <div className="">
      <div className="mb-4 flex w-auto justify-center rounded border border-solid bg-white p-6">
        <QrLabel ref={captureDivRef} data={qrObj} title={asset.title} />
      </div>
      <ul className="description-list">
        {/* <li className="mb-4 flex justify-between text-gray-600">
            <label
              htmlFor="size"
              className="key max-w-[120px] break-words font-medium"
            >
              Size
            </label>
            <span className="value max-w-[190px] break-words font-semibold">
              <Form method="get" ref={formRef}>
                <select
                  name="size"
                  value={data.qr.size}
                  onChange={handleSizeChange}
                  className=" border-none py-0 pr-6"
                  style={{ backgroundPosition: "right center" }}
                >
                  {Object.keys(data.sizes).map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </Form>
            </span>
          </li> */}
        {/* <li className="mb-4 flex justify-between text-gray-600">
            <span className="key max-w-[120px] break-words font-medium">
              File
            </span>
            <span className="value max-w-[190px] break-words font-semibold">
              PNG
            </span>
          </li> */}
      </ul>
      {/* using this button to convert html to png and download image using the a tag below */}
      <div className="flex items-center gap-3">
        <Button
          icon="download"
          onClick={downloadQr}
          download={`${slugify(asset.title)}-${qrObj?.qr
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
export default AssetQR;
