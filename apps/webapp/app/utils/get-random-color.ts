/**
 * The hex color will have a brightness above certain treshold so it looks good on light mode
 * @returns random hex color
 */
export function getRandomColor(): string {
  const minBrightness = 10; // minimum brightness value (out of 255)
  const maxAttempts = 100; // Prevent infinite loop

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Generate random RGB values
    const r = Math.floor(Math.random() * 256);
    const g = Math.floor(Math.random() * 256);
    const b = Math.floor(Math.random() * 256);

    // Calculate brightness value
    const brightness = (r * 299 + g * 587 + b * 114) / 100;

    // If brightness is below minimum threshold, generate a new color
    if (brightness < minBrightness) {
      continue;
    }

    // Convert RGB to HEX
    const hex =
      "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);

    return hex;
  }

  // Fallback color if we can't generate a suitable one
  return "#000000";
}
