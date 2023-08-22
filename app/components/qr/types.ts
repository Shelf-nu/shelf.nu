export interface ImagePreviewProps {
  qr: string;
  logo: string;
  size: "cable" | "small" | "medium" | "large";
}

export interface ImagePreviewState {
  fontSize: number;
  canvasSize: number;
  qrSize: number;
  logoSize: number;
  qrImg: HTMLImageElement | null;
  logoImg: HTMLImageElement | null;
}

export interface ImagePreviewRef {
  exportToPNG(): string;
}
