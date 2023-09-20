import { useEffect, useRef, useState } from "react";
import type { Asset } from "@prisma/client";
import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData, useSubmit } from "@remix-run/react";
import html2canvas from "html2canvas";
import { XIcon } from "~/components/icons";
import { Button } from "~/components/shared";
import { useMatchesData } from "~/hooks";
import { requireAuthSession } from "~/modules/auth";
import { createQr, generateCode, getQrByAssetId } from "~/modules/qr";
import { getCurrentSearchParams, slugify } from "~/utils";

type SizeKeys = "cable" | "small" | "medium" | "large";

export async function loader({ request, params }: LoaderArgs) {
  const { userId } = await requireAuthSession(request);
  const { assetId } = params as { assetId: string };
  const searchParams = getCurrentSearchParams(request);
  const size = (searchParams.get("size") || "medium") as SizeKeys;

  let qr = await getQrByAssetId({ assetId });
  if (!qr) {
    /** If for some reason there is no QR, we create one and return it */
    qr = await createQr({ assetId, userId });
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
  const formRef = useRef<HTMLFormElement>(null);
  const qrImageRef = useRef<HTMLImageElement>(null);
  const submit = useSubmit();
  const asset = useMatchesData<{ asset: Asset }>(
    "routes/_layout+/assets.$assetId"
  )?.asset;

  const [qrDataUrl, setQrDataUrl] = useState<string>("");

  const handleChange = () => {
    submit(formRef.current);
  };

  useEffect(() => {
    const captureDiv = qrImageRef.current;
    // making sure that the captureDiv exists in DOM
    if (captureDiv) {
      html2canvas(captureDiv, {
        foreignObjectRendering: true,
      }).then((canvas) => {
        setQrDataUrl(() => canvas.toDataURL("image/png"));
      });
    }
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
        <div
          className="flex h-auto flex-col justify-center gap-1 rounded-md border-[5px] border-[#E3E4E8] p-3"
          ref={qrImageRef}
        >
          <div className="z-50 max-w-full truncate bg-white text-center text-[12px]">
            {asset.title}
          </div>
          <figure className="qr-code z-[49] flex justify-center">
            <img
              src={data.qr.src}
              alt={`${data.qr.size}-shelf-qr-code.png`}
              className="rounded-md"
            />
          </figure>
          <div className="w-full text-center text-[12px]">
            <span className="block  text-gray-600">{data.qr.id}</span>
            <span className="block text-gray-500">
              Powered by{" "}
              <span className="font-semibold text-gray-600">shelf.nu</span>
            </span>
          </div>
        </div>
      </div>
      <ul className="description-list">
        <li className="mb-4 flex justify-between text-gray-600">
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
                onChange={handleChange}
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
        </li>
        <li className="mb-4 flex justify-between text-gray-600">
          <span className="key max-w-[120px] break-words font-medium">
            File
          </span>
          <span className="value max-w-[190px] break-words font-semibold">
            PNG
          </span>
        </li>
      </ul>
      <Button
        icon="barcode"
        to={qrDataUrl}
        download={`${slugify(asset.title)}-${data.qr.size}-shelf-qr-code-${
          data.qr.id
        }.png`}
        variant="secondary"
        className="w-full"
      >
        Download QR Code
      </Button>
    </div>
  ) : null;
}
