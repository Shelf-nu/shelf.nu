import React, { useMemo, useRef } from "react";
import type { Asset } from "@prisma/client";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { changeDpiDataUrl } from "changedpi";
import domtoimage from "dom-to-image";
import { useReactToPrint } from "react-to-print";
import { XIcon } from "~/components/icons";
import { Button } from "~/components/shared";
import { useMatchesData } from "~/hooks";
import { requireAuthSession } from "~/modules/auth";
import { requireOrganisationId } from "~/modules/organization/context.server";
import { createQr, generateCode, getQrByAssetId } from "~/modules/qr";
import { getCurrentSearchParams, slugify } from "~/utils";
type SizeKeys = "cable" | "small" | "medium" | "large";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request);
  const { organizationId } = await requireOrganisationId(authSession, request);
  const { userId } = authSession;

  const { assetId } = params as { assetId: string };
  const searchParams = getCurrentSearchParams(request);
  const size = (searchParams.get("size") || "medium") as SizeKeys;

  let qr = await getQrByAssetId({ assetId });
  if (!qr) {
    /** If for some reason there is no QR, we create one and return it */
    qr = await createQr({ assetId, userId, organizationId });
  }

  // Create a QR code with a URL
  const { sizes, code } = await generateCode({
    version: qr.version as TypeNumber,
    errorCorrection: qr.errorCorrection as ErrorCorrectionLevel,
    size,
    qr,
  });

  return json({
    qr: code,
    sizes,
    showSidebar: true,
  });
}

export default function QRPreview() {
  const data = useLoaderData<typeof loader>();
  const captureDivRef = useRef<HTMLImageElement>(null);
  const downloadQrBtnRef = useRef<HTMLAnchorElement>(null);
  const asset = useMatchesData<{ asset: Asset }>(
    "routes/_layout+/assets.$assetId"
  )?.asset;

  const fileName = useMemo(
    () =>
      `${slugify(asset?.title || "asset")}-${data.qr.size}-shelf-qr-code-${
        data.qr.id
      }.png`,
    [asset, data.qr.id, data.qr.size]
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
        });
    }
  }

  const printQr = useReactToPrint({
    content: () => captureDivRef.current,
  });

  return asset ? (
    <div className="">
      <header className="mb-6 flex items-center justify-between leading-7">
        <h3>Download QR Code</h3>
        <Link to=".." className="text-gray-400">
          <XIcon />
        </Link>
      </header>
      <div className="mb-4 w-auto rounded-xl border border-solid p-6">
        <QrLabel ref={captureDivRef} data={data} title={asset.title} />
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
        <li className="mb-4 flex justify-between text-gray-600">
          <span className="key max-w-[120px] break-words font-medium">
            File
          </span>
          <span className="value max-w-[190px] break-words font-semibold">
            PNG
          </span>
        </li>
      </ul>
      {/* using this button to convert html to png and download image using the a tag below */}
      <div className="flex items-center gap-3">
        <Button
          icon="download"
          onClick={downloadQr}
          download={`${slugify(asset.title)}-${data.qr.size}-shelf-qr-code-${
            data.qr.id
          }.png`}
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
  ) : null;
}

interface QrLabelProps {
  data: {
    qr: {
      id: string;
      size: SizeKeys;
      src: string;
    };
  };
  title: string;
}

const QrLabel = React.forwardRef<HTMLDivElement, QrLabelProps>((props, ref) => {
  const { data, title } = props;
  return (
    <div
      className="flex h-auto max-w-[244px] flex-col justify-center gap-3 rounded-md border-[5px] border-[#E3E4E8] bg-white px-3 py-[17px]"
      ref={ref}
    >
      <div className="z-50 max-w-full truncate  text-center text-[12px] font-semibold text-black">
        {title}
      </div>
      <figure className="qr-code z-[49] flex justify-center">
        <img src={data.qr.src} alt={`${data.qr.size}-shelf-qr-code.png`} />
      </figure>
      <div className="w-full text-center text-[12px]">
        <span className="block  font-semibold text-black">{data.qr.id}</span>
        <span className="block text-black">
          Powered by <span className="font-semibold text-black">shelf.nu</span>
        </span>
      </div>
    </div>
  );
});
