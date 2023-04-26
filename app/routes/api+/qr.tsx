import { useRef } from "react";
import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useFetcher, useLoaderData } from "@remix-run/react";
import QRCode from "qrcode-generator";
import { gifToPng } from "~/utils";

export async function loader({ request }: LoaderArgs) {
  // const formData = await request.formData();
  // const size = formData ? formData?.get("size") : "medium";
  // Create a QR code with a URL
  const qr = QRCode(0, "M");
  qr.addData("https://app.shelf.nu/q?c=clgw8cbnu0004naor12fhetbq");
  qr.make();

  const images = {
    cable: await gifToPng(qr.createDataURL(1, 6)), // 45px => 1.2cm(1.19)
    small: qr.createDataURL(2, 14), // 94px => 2.5cm(2.48)
    medium: qr.createDataURL(4, 19), // 170px => 4.5cm(4.49)
    large: qr.createDataURL(6), // 246px => 6.50cm
  };

  const sizes = {
    cable: 1.2,
    small: 2.5,
    medium: 4.5,
    large: 6.5,
  };

  return json({
    qr: {
      size: "medium",
      src: images["medium"],
    },
    sizes,
  });
}

export default function QRPreview() {
  const data = useLoaderData<typeof loader>();
  const formRef = useRef<HTMLFormElement>(null);
  const fetcher = useFetcher();

  const handleChange = (event) => {
    console.log(event.target.value);
    fetcher.submit(formRef.current);
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
