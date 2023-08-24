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
  small: 4.96,
  medium: 7.44,
  large: 9.92,
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
const SPACING = {
  cable: 0,
  small: 10,
  medium: 13,
  large: 10,
};

const drawQr = (ctx: CanvasRenderingContext2D, state: ImagePreviewState) => {
  const negativeMargin = -1 * ctx.canvas.width * 0.05;
  const { size, logoSize, fontSize, qrSize, qrImg, logoImg } = state;

  if (!qrImg) return;

  // ctx.fillStyle = "#F2F4F7";
  ctx.fillStyle = "#FF4507";
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

  const x = ctxHalfWidth / 2;
  let y = 0;
  ctx.fillStyle = "#000";

  let distance = 0;

  // for (;;) {
  //   const pixel = ctx.getImageData(x, y, 1, 1).data;
  //   console.log({pixel})
  //
  //   if (pixel[0] === 255 && pixel[1] === 255 && pixel[2] === 255) {
  //     distance += 1;
  //     continue;
  //   }
  //   if (pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0) {
  //     break;
  //   }
  //   y += 1;
  // }

  ctx.fillStyle = "#9ba5b5";
  ctx.font = `${fontSize}px Inter`;
  let metrics = ctx.measureText(POWERED_BY);
  let textHeight =
    metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  let textWidth = metrics.width;
  let halfTextWidth = textWidth / 2;
  let textX = ctxHalfWidth - halfTextWidth - logoSize / 2;
  let textY = CANVAS_DIMENSIONS_MAP[size] * 0.05 + qrSize;
  textY -= SPACING[size];
  textY += SPACING[size] / 2;
  textY -= textHeight / 2;
  // textY += logoSize / 2;
  // textY += logoSize / 2 - textHeight / 2;
  ctx.fillText(POWERED_BY, textX, textY);

  const imgX = textX + textWidth;
  let imgY = 0;

  if (textHeight / 2 >= logoSize / 2) {
    const diff = textHeight / 2 - logoSize / 2;
    imgY = textY + diff;
  } else {
    const diff = logoSize / 2 - textHeight / 2;
    imgY = textY - diff;
  }
  // let imgY = CANVAS_DIMENSIONS_MAP[size] * 0.05 + qrSize;
  // imgY -= SPACING[size];

  ctx.drawImage(logoImg, imgX, imgY, logoSize, logoSize);
};

export const ImagePreview = forwardRef < ImagePreviewRef, ImagePreviewProps> (
  function ImagePreview({ qr, size, logo }: ImagePreviewProps, ref) {
    const canvasRef = useRef < HTMLCanvasElement > (null);
    const [state, setState] = useState < ImagePreviewState > ({
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
