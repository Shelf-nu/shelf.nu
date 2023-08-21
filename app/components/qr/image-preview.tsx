import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
} from "react";
import { loadImage } from "~/utils/load-image";
import type {
  ImagePreviewProps,
  ImagePreviewState,
  ImagePreviewRef,
} from "./types";

// NOTE: Do not trim the space at the end.
// It used for spacing between the logo and the text.
const POWERED_BY = "Powered by  ";
const FONT_SIZE_MAP = {
  cable: 0,
  small: 8,
  medium: 12,
  large: 16,
};
const LOGO_SIZE_MAP = {
  cable: 0,
  small: 20,
  medium: 24,
  large: 28,
};

const drawQr = (ctx: CanvasRenderingContext2D, state: ImagePreviewState) => {
  const negativeMargin = -10;
  const { logoSize, fontSize, qrImg, logoImg } = state;

  if (!qrImg) return;

  ctx.fillStyle = "#fff";
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  if (state.canvasSize === qrImg.naturalHeight || !logoImg) {
    ctx.drawImage(qrImg, 0, 0);
    return;
  }

  const ctxHalfWidth = ctx.canvas.width / 2;
  ctx.drawImage(qrImg, ctxHalfWidth - qrImg.naturalWidth / 2, 0);

  ctx.fillStyle = "#9ba5b5";
  ctx.font = `${fontSize}px Inter`;
  let metrics = ctx.measureText(POWERED_BY);
  let textHeight =
    metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  let textWidth = metrics.width;
  let halfTextWidth = textWidth / 2;
  let textX = ctxHalfWidth - halfTextWidth - logoSize / 2;
  let textY = qrImg.naturalHeight + logoSize / 2;
  textY += logoSize / 2 - textHeight / 2;
  textY += negativeMargin;
  ctx.fillText(POWERED_BY, textX, textY);

  ctx.drawImage(
    logoImg,
    textX + textWidth,
    qrImg.naturalHeight + negativeMargin,
    logoSize,
    logoSize
  );
};

export const ImagePreview = forwardRef<ImagePreviewRef, ImagePreviewProps>(
  function ImagePreview({ qr, size, logo }: ImagePreviewProps, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [state, setState] = useState<ImagePreviewState>({
      logoSize: LOGO_SIZE_MAP[size],
      fontSize: FONT_SIZE_MAP[size],
      canvasSize: 190,
      qrImg: null,
      logoImg: null,
    });

    useImperativeHandle(
      ref,
      () => ({
        exportToPNG() {
          const canvas = canvasRef.current;
          return canvas?.toDataURL("image/png") ?? "";
        },
      }),
      [canvasRef]
    );

    useEffect(() => {
      const loadImages = Promise.all([qr, logo].map(loadImage));
      loadImages.then(([qrImg, logoImg]) => {
        if (!qrImg) return;

        size === "cable" || !logo
          ? setState({
              qrImg,
              logoImg,
              fontSize: 0,
              logoSize: 0,
              canvasSize: qrImg.naturalHeight,
            })
          : setState({
              qrImg,
              logoImg,
              fontSize: FONT_SIZE_MAP[size],
              logoSize: LOGO_SIZE_MAP[size],
              canvasSize:
                qrImg.naturalHeight + (16 / 100) * qrImg.naturalHeight,
            });
      });
    }, [qr, size, logo]);

    useEffect(() => {
      const ctx = canvasRef.current?.getContext("2d");

      if (ctx) drawQr(ctx, state);
    }, [state]);

    return (
      <canvas
        ref={canvasRef}
        height={state.canvasSize}
        width={state.canvasSize}
      />
    );
  }
);
