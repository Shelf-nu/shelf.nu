import { Image } from "image-js";

export const cropImage = async (inputImageBuffer: Buffer) => {
  const img = await Image.load(inputImageBuffer);

  // Get the shorter side of the original image
  const shorterSide = Math.min(img.width, img.height);

  // Crop the image to a square in the center
  const x = (img.width - shorterSide) / 2;
  const y = (img.height - shorterSide) / 2;

  const cropArea = {
    x,
    y,
    width: shorterSide,
    height: shorterSide,
  };

  const croppedImage = img.crop(cropArea).resize({ width: 128, height: 128 });

  const croppedImageBuffer = await croppedImage.toBuffer();

  return croppedImageBuffer;
};
