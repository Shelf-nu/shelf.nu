export const blobFromBuffer = (buffer: Buffer | null) => {
  /** We build the blob needed to render the image */
  let imageAsBlob = null;
  if (buffer) {
    const imageBuffer = Buffer.from(buffer);

    const base64String = imageBuffer.toString("base64");
    const blobString = `data:image/png;base64,${base64String}`;
    imageAsBlob = blobString as string;
  }
  return imageAsBlob;
};
