/**
 * Wait for all images in a container to load and decode
 * This is critical for Safari/iPad which doesn't wait for data URL images
 * to fully render before operations like html-to-image or printing
 */
export async function waitForImagesToLoad(
  container: HTMLElement
): Promise<void> {
  const images = Array.from(container.querySelectorAll("img"));
  if (images.length === 0) {
    return;
  }

  // Wait for each image to load
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) {
            resolve();
          } else {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          }
        })
    )
  );

  // Force decode for Safari (ensures data URLs are actually rendered)
  await Promise.all(
    images.map((img) =>
      img.decode().catch(() => {
        // Ignore decode errors, image might already be decoded
      })
    )
  );

  // Final delay to ensure Safari has painted the images
  await new Promise<void>((resolve) => setTimeout(resolve, 300));
}
