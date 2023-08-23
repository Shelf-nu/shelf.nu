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
  small: 4,
  medium: 5,
  large: 8,
};
const LOGO_SIZE_MAP = {
  cable: 0,
  small: 4.9606,
  medium: 7.4409,
  large: 9.9213,
};
const CANVAS_DIMENSIONS_MAP = {
  cable: 0,
  small: 75.6,
  medium: 113.38,
  large: 151.18,
};
const QR_DIMENSIONS_MAP = Object.keys(CANVAS_DIMENSIONS_MAP).reduce(
  (acc, size) => ({
    [size]: CANVAS_DIMENSIONS_MAP[size as never] * 0.95,
    ...acc,
  }),
  {} as typeof CANVAS_DIMENSIONS_MAP
);

const drawQr = (ctx: CanvasRenderingContext2D, state: ImagePreviewState) => {
  const negativeMargin = -1 * ctx.canvas.width * 0.05;
  const { logoSize, fontSize, qrSize, qrImg, logoImg } = state;

  if (!qrImg) return;

  ctx.fillStyle = "#F2F4F7";
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  if (state.canvasSize === qrImg.naturalHeight || !logoImg) {
    ctx.drawImage(qrImg, 0, 0);
    return;
  }

  const ctxHalfWidth = ctx.canvas.width / 2;
  ctx.roundRect(ctxHalfWidth - qrSize / 2, ctxHalfWidth - qrSize / 2, qrSize, qrSize, 4);
  ctx.save();
  ctx.clip();
  ctx.drawImage(qrImg, ctxHalfWidth - qrSize / 2, ctxHalfWidth - qrSize / 2, qrSize, qrSize);
  ctx.restore();

  ctx.fillStyle = "#9ba5b5";
  ctx.font = `${fontSize}px Inter`;
  let metrics = ctx.measureText(POWERED_BY);
  let textHeight =
    metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  let textWidth = metrics.width;
  let halfTextWidth = textWidth / 2;
  let textX = ctxHalfWidth - halfTextWidth - logoSize / 2;
  let textY = qrSize + logoSize / 2;
  textY += logoSize / 2 - textHeight / 2;
  textY += negativeMargin;
  ctx.fillText(POWERED_BY, textX, textY);

  ctx.drawImage(
    logoImg,
    textX + textWidth,
    qrSize + negativeMargin,
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
              qrImg,
              logoImg,
              fontSize: 0,
              logoSize: 0,
              qrSize: 0,
              canvasSize: qrImg.naturalHeight,
            })
          : setState({
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
