import { useEffect, useRef, useState } from "react";

interface ImagePreviewProps {
  qr: string;
  size: "cable" | "small" | "medium" | "large";
}

// NOTE: Do not trim the space at the end.
// It is used for spacing.
const PROPERTY_OF = "Property of ";
const FONT_SIZE_MAP = {
  cable: 0,
  small: 12,
  medium: 15,
  large: 18,
};
const LOGO_SIZE_MAP = {
  cable: 0,
  small: 24,
  medium: 28,
  large: 32,
};

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.src = src;
    img.onload = () => {
      resolve(img);
    };
    img.onerror = reject;
  });

export const ImagePreview = ({ qr, size }: ImagePreviewProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState({
    fontSize: 15,
    canvasSize: 190,
    img: null,
  } as {
    fontSize: number;
    canvasSize: number;
    logoSize: number;
    img: HTMLImageElement | null;
  });

  useEffect(() => {
    loadImage(qr).then((img) => {
      size === "cable"
        ? setState({
            img,
            canvasSize: img.naturalHeight,
            fontSize: 0,
            logoSize: 0,
          })
        : setState({
            img,
            canvasSize: img.naturalHeight + (15 / 100) * img.naturalHeight,
            fontSize: FONT_SIZE_MAP[size],
            logoSize: LOGO_SIZE_MAP[size],
          });
    });
  }, [qr, size]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const negativeMargin = -10;
    const logoSize = state.logoSize;
    const fontSize = state.fontSize;
    const img = state.img;

    if (!ctx || !img) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // NOTE: We don't add text for cable size
    if (state.canvasSize === img.naturalHeight) {
      ctx.drawImage(img, 0, 0);
      return;
    }

    const ctxHalfWidth = ctx.canvas.width / 2;
    ctx.drawImage(img, ctxHalfWidth - img.naturalWidth / 2, 0);

    ctx.fillStyle = "#999";
    ctx.font = `bold ${fontSize}px Inter`;
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
  }, [state]);

  return (
    <canvas
      style={{ border: "1.5px solid black" }}
      ref={canvasRef}
      height={state.canvasSize}
      width={state.canvasSize}
    />
  );
};
