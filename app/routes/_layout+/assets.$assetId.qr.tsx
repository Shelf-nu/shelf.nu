import { useCallback, useEffect, useRef, useState } from "react";
import type { Asset } from "@prisma/client";
import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData, useSubmit } from "@remix-run/react";
import Input from "~/components/forms/input";
import { XIcon } from "~/components/icons";
import {
  ImagePreview,
  type ImagePreviewRef,
} from "~/components/qr/image-preview";
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
  const [logo, setLogo] = useState<string>("");
  const [logoInput, setLogoInput] = useState<File | null>(null);
  const imagePreviewRef = useRef<ImagePreviewRef>(null);
  const submit = useSubmit();
  const asset = useMatchesData<{ asset: Asset }>(
    "routes/_layout+/assets.$assetId"
  )?.asset;

  const handleChange = () => {
    submit(formRef.current);
  };

  const downloadQr = useCallback(() => {
    const imageData = imagePreviewRef.current?.exportToPNG();
    if (!imageData) return;
    const link = document.createElement("a");
    link.download = `${slugify(asset?.title ?? "")}-${
      data.qr.size
    }-shelf-qr-code-${data.qr.id}.png`;
    link.href = imageData;
    link.click();
  }, [asset?.title, data.qr.id, data.qr.size]);

  useEffect(() => {
    if (logoInput) {
      const reader = new FileReader();
      reader.onload = () => setLogo(reader.result as string);
      reader.readAsDataURL(logoInput);
    }
  }, [logoInput]);

  return asset ? (
    <div className="">
      <header className="mb-6 flex items-center justify-between leading-7">
        <h3>Download QR Code</h3>
        <Link to=".." className="text-gray-400">
          <XIcon />
        </Link>
      </header>
      <div className="mb-4 w-full rounded-xl border border-solid p-6">
        <div className="text-center">
          <h6 className="mb-1 font-semibold leading-5 text-gray-700">
            {asset.title}
          </h6>
        </div>
        <figure className="qr-code flex  justify-center">
          <ImagePreview
            ref={imagePreviewRef}
            qr={data.qr.src}
            size={data.qr.size}
            logo={logo}
          />
        </figure>
        <div className="text-center">
          <span className="block text-[12px] text-gray-600">{data.qr.id}</span>
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
            Logo
          </span>
          <span className="value max-w-[190px] break-words font-semibold">
            <Input
              name="logo"
              label=""
              type="file"
              accept="image/png,image/webp,image/svg"
              className="w-full"
              onChange={(e) => setLogoInput((e.target as any).files?.[0])}
            />
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
        onClick={() => downloadQr()}
        variant="secondary"
        className="w-full"
      >
        Download QR Code
      </Button>
    </div>
  ) : null;
}
