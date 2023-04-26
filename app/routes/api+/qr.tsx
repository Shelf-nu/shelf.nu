import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import QRCode from "qrcode-generator";

export async function loader() {
  // Create a QR code with a URL
  const qr = QRCode(0, "L");
  qr.addData("https://app.shelf.nu/q?c=clgw8cbnu0004naor12fhetbq");
  qr.make();
  const codeBase64 = qr.createDataURL(4);

  const qrInABuffer = Buffer.from(codeBase64.split(",")[1], "base64");

  const bufferSize = Buffer.byteLength(qrInABuffer);
  const qrDataUrl = `data:image/png;base64,${qrInABuffer.toString("base64")}`;

  return json({
    qrInABuffer,
    codeBase64,
    qrDataUrl,
    bufferSize,
  });
}

export default function QRPreview() {
  const data = useLoaderData<typeof loader>();
  return (
    <div>
      <div>Original</div>
      <img src={data.codeBase64} alt="" />

      <div>Re-generated</div>
      <img src={data.qrDataUrl} alt="" />

      <div>Buffer size</div>
      <div>{data.bufferSize / 1024}KB</div>
    </div>
  );
}
