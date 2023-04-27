import { useRef } from "react";
import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData, useSubmit } from "@remix-run/react";
import QRCode from "qrcode-generator";
import { requireAuthSession } from "~/modules/auth";
import { getCurrentSearchParams, gifToPng } from "~/utils";

type SizeKeys = "cable" | "small" | "medium" | "large";

export async function loader({ request }: LoaderArgs) {
  const authSession = await requireAuthSession(request);
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
  });
}

export default function QRPreview() {
  const data = useLoaderData<typeof loader>();
  const formRef = useRef<HTMLFormElement>(null);
  const submit = useSubmit();

  const handleChange = () => {
    submit(formRef.current);
  };

  return (
    <div className="">
      <div>
        <p>{data.qr.size}</p>
        <img src={data.qr.src} alt={`${data.qr.size}-shelf-qr-code.png`} />
        <a href={data.qr.src} download={`${data.qr.size}-shelf-qr-code.png`}>
          Download image
        </a>
      </div>

      <div className="mt-10">
        <Form method="get" ref={formRef}>
          <select name="size" value={data.qr.size} onChange={handleChange}>
            {Object.keys(data.sizes).map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </Form>
      </div>
    </div>
  );
}
