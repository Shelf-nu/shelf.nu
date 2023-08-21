export const loadImage = (src: string): Promise<HTMLImageElement | null> =>
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
