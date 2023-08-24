import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
} from "react";
import { loadImage } from "~/utils/load-image";
import {
  FONT_SIZE_MAP,
  MARGINS,
  LOGO_SIZE_MAP,
  CANVAS_DIMENSIONS_MAP,
  QR_DIMENSIONS_MAP,
} from "./measures";
import type {
  ImagePreviewProps,
  ImagePreviewState,
  ImagePreviewRef,
} from "./types";

// NOTE: Do not trim the space at the end.
// It used for spacing between the logo and the text.
const POWERED_BY = "Powered by  ";

const drawQr = (ctx: CanvasRenderingContext2D, state: ImagePreviewState) => {
  const { size, logoSize, fontSize, qrSize, qrImg, logoImg } = state;

  if (!qrImg) return;

  ctx.fillStyle = "#F2F4F7";
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  if (state.canvasSize === qrImg.naturalHeight || !logoImg) {
    ctx.drawImage(qrImg, 0, 0);
    return;
  }

  const ctxHalfWidth = ctx.canvas.width / 2;
  ctx.roundRect(
    ctxHalfWidth - qrSize / 2,
    ctxHalfWidth - qrSize / 2,
    qrSize,
    qrSize,
    4
  );
  ctx.save();
  ctx.clip();
  ctx.drawImage(
    qrImg,
    ctxHalfWidth - qrSize / 2,
    ctxHalfWidth - qrSize / 2,
    qrSize,
    qrSize
  );
  ctx.restore();

  ctx.fillStyle = "#9ba5b5";
  ctx.font = `${fontSize}px Inter`;
  let metrics = ctx.measureText(POWERED_BY);
  let textWidth = metrics.width;
  let halfTextWidth = textWidth / 2;
  let textX = ctxHalfWidth - halfTextWidth - logoSize / 2;
  let textY =
    ctx.canvas.height - CANVAS_DIMENSIONS_MAP[size] * 0.05 - MARGINS[size][0];
  ctx.fillText(POWERED_BY, textX, textY);

  const imgX = textX + textWidth;
  let imgY =
    ctx.canvas.height -
    CANVAS_DIMENSIONS_MAP[size] * 0.05 -
    logoSize / 2 -
    MARGINS[size][1];
  ctx.drawImage(logoImg, imgX, imgY, logoSize, logoSize);
};

export const ImagePreview = forwardRef<ImagePreviewRef, ImagePreviewProps>(
  function ImagePreview({ qr, size, logo }: ImagePreviewProps, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [state, setState] = useState<ImagePreviewState>({
      size,
      logoSize: LOGO_SIZE_MAP[size],
      fontSize: FONT_SIZE_MAP[size],
      canvasSize: CANVAS_DIMENSIONS_MAP[size],
      qrSize: QR_DIMENSIONS_MAP[size],
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
              size,
              qrImg,
              logoImg,
              fontSize: 0,
              logoSize: 0,
              qrSize: 0,
              canvasSize: qrImg.naturalHeight,
            })
          : setState({
              size,
              qrImg,
              logoImg,
              fontSize: FONT_SIZE_MAP[size],
              logoSize: LOGO_SIZE_MAP[size],
              qrSize: QR_DIMENSIONS_MAP[size],
              canvasSize: CANVAS_DIMENSIONS_MAP[size],
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
