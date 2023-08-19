import { useEffect, useRef, useState } from "react";

interface ImagePreviewProps {
  qr: string;
  size: "cable" | "small" | "medium" | "large";
}

// NOTE: Do not trim the space at the end.
// It is used for spacing.
const PROPERTY_OF = "Property of ";

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.src = src;
    img.onload = () => {
      resolve(img);
    };
    img.onerror = reject;
  });

export const ImagePreview = (props: ImagePreviewProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState(190);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const negativeMargin = -10;
    const logoSize = 28;

    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    const ctxHalfWidth = ctx.canvas.width / 2;

    loadImage(props.qr).then((img) => {
      ctx.drawImage(img, ctxHalfWidth - img.naturalWidth / 2, 0);

      ctx.fillStyle = "#999";
      ctx.font = "bold 16px Inter";
      let metrics = ctx.measureText(PROPERTY_OF);
      let textHeight =
        metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
      let textWidth = metrics.width;
      let halfTextWidth = textWidth / 2;
      let textX = ctxHalfWidth - halfTextWidth - logoSize / 2;
      let textY = img.naturalHeight + logoSize / 2;
      textY += logoSize / 2 - textHeight / 2;
      textY += negativeMargin;
      ctx.fillText(PROPERTY_OF, textX, textY);

      loadImage("https://www.kirupa.com/canvas/images/orange.svg").then(
        (logo) => {
          ctx.drawImage(
            logo,
            textX + textWidth,
            img.naturalHeight + negativeMargin,
            logoSize,
            logoSize
          );
        }
      );
    });
  }, [props]);

  return <canvas ref={canvasRef} height={canvasSize} width={canvasSize} />;
};
