import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  forwardRef,
} from "react";

export interface ImagePreviewProps {
  qr: string;
  size: "cable" | "small" | "medium" | "large";
  logo: string;
}

export interface ImagePreviewState {
  fontSize: number;
  canvasSize: number;
  logoSize: number;
  qrImg: HTMLImageElement | null;
  logoImg: HTMLImageElement | null;
}

export interface ImagePreviewRef {
  exportToPNG(): string;
}

// NOTE: Do not trim the space at the end.
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

const loadImage = (src: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve, reject) => {
    if (src) {
      const img = new Image();
      img.src = src;
      img.onload = () => {
        resolve(img);
      };
      img.onerror = reject;
    } else {
      resolve(null);
    }
  });

export const ImagePreview = forwardRef<ImagePreviewRef, ImagePreviewProps>(
  function ImagePreview({ qr, size, logo }: ImagePreviewProps, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [state, setState] = useState({
      fontSize: 15,
      canvasSize: 190,
      qrImg: null,
      logoImg: null,
    } as ImagePreviewState);

    useImperativeHandle(
      ref,
      (): ImagePreviewRef => ({
        exportToPNG() {
          const canvas = canvasRef.current;
          return canvas?.toDataURL("image/png") ?? "";
        },
      }),
      [canvasRef]
    );

    useEffect(() => {
      const loadImages = Promise.all([loadImage(qr), loadImage(logo)]);

      loadImages.then(([qrImg, logoImg]) => {
        size === "cable" || !logo
          ? setState({
              qrImg,
              logoImg,
              fontSize: 0,
              logoSize: 0,
              canvasSize: qrImg!.naturalHeight,
            })
          : setState({
              qrImg,
              logoImg,
              fontSize: FONT_SIZE_MAP[size],
              logoSize: LOGO_SIZE_MAP[size],
              canvasSize:
                qrImg!.naturalHeight + (15 / 100) * qrImg!.naturalHeight,
            });
      });
    }, [qr, size, logo]);

    useEffect(() => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      const negativeMargin = -10;
      const logoSize = state.logoSize;
      const fontSize = state.fontSize;
      const qrImg = state.qrImg;
      const logoImg = state.logoImg;

      if (!ctx || !qrImg) return;

      ctx.fillStyle = "#fff";
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

      if (state.canvasSize === qrImg.naturalHeight || !logoImg) {
        ctx.drawImage(qrImg, 0, 0);
        return;
      }

      const ctxHalfWidth = ctx.canvas.width / 2;
      ctx.drawImage(qrImg, ctxHalfWidth - qrImg.naturalWidth / 2, 0);

      ctx.fillStyle = "#9ba5b5";
      ctx.font = `bold ${fontSize}px Inter`;
      let metrics = ctx.measureText(PROPERTY_OF);
      let textHeight =
        metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
      let textWidth = metrics.width;
      let halfTextWidth = textWidth / 2;
      let textX = ctxHalfWidth - halfTextWidth - logoSize / 2;
      let textY = qrImg.naturalHeight + logoSize / 2;
      textY += logoSize / 2 - textHeight / 2;
      textY += negativeMargin;
      ctx.fillText(PROPERTY_OF, textX, textY);

      ctx.drawImage(
        logoImg,
        textX + textWidth,
        qrImg.naturalHeight + negativeMargin,
        logoSize,
        logoSize
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
  }
);
