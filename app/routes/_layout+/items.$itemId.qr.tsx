import { useRef } from "react";
import type { Item } from "@prisma/client";
import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData, useSubmit } from "@remix-run/react";
import QRCode from "qrcode-generator";
import { XIcon } from "~/components/icons";
import { Button } from "~/components/shared";
import { useMatchesData } from "~/hooks";
import { requireAuthSession } from "~/modules/auth";
import { getCurrentSearchParams, gifToPng } from "~/utils";

type SizeKeys = "cable" | "small" | "medium" | "large";

export async function loader({ request }: LoaderArgs) {
  await requireAuthSession(request);
  const searchParams = getCurrentSearchParams(request);
  const size = (searchParams.get("size") || "medium") as SizeKeys;
  // Create a QR code with a URL
  const qr = QRCode(0, "M");
  qr.addData("https://app.shelf.nu/q?c=clgw8cbnu0004naor12fhetbq");
  qr.make();

  const sizes = {
    cable: [1, 6], // 45px => 1.2cm(1.19)
    small: [2, 14], // 94px => 2.5cm(2.48)
    medium: [4, 19], // 170px => 4.5cm(4.49)
    large: [6], // 246px => 6.50cm
  };
  const src = await gifToPng(qr.createDataURL(...sizes[size]));

  return json({
    qr: {
      size: size,
      src,
    },
    sizes,
    showSidebar: true,
  });
}

export default function QRPreview() {
  const data = useLoaderData<typeof loader>();
  const formRef = useRef<HTMLFormElement>(null);
  const submit = useSubmit();
  const item = useMatchesData<{ item: Item }>(
    "routes/_layout+/items.$itemId"
  )?.item;

  const handleChange = () => {
    submit(formRef.current);
  };

  return item ? (
    <div className="">
      <header className="mb-6 flex items-center justify-between leading-7">
        <h3>Download QR Tag</h3>
        <Link to=".." className="text-gray-400">
          <XIcon />
        </Link>
      </header>
      <div className="mb-4 w-full rounded-xl border border-solid p-6">
        <figure className="qr-code mb-6 flex  justify-center">
          <img src={data.qr.src} alt={`${data.qr.size}-shelf-qr-code.png`} />
        </figure>
        <div className="text-center">
          <h6 className="mb-1 font-semibold leading-5 text-gray-700">
            {item.title}
          </h6>
          <span className="block text-[12px] text-gray-600">{item.id}</span>
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
        to={data.qr.src}
        download={`${data.qr.size}-shelf-qr-code.png`}
        variant="secondary"
        className="w-full"
      >
        Download QR Tag
      </Button>
    </div>
  ) : null;
}
