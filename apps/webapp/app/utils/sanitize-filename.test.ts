import { describe, expect, test } from "vitest";
import { sanitizeFilename } from "./sanitize-filename";

describe("sanitizeFilename", () => {
  test("sanitizes problematic filename with base64 and special characters", () => {
    const problematicFilename =
      "L2ltYWdlcy9wcm9kdWN0L21haW4vUy0wMTk1NDRfMDEuanBlZw==_H_SH480_MW480.png";
    const result = sanitizeFilename(problematicFilename);

    // Should not contain problematic characters
    expect(result).not.toMatch(/[=+/]/);
    expect(result).not.toMatch(/[^a-zA-Z0-9.\-_]/);
    expect(result).toMatch(/\.png$/); // Should preserve file extension
    expect(result.length).toBeLessThanOrEqual(104); // 100 + ".png"
  });

  test("preserves clean filenames", () => {
    const cleanFilename = "normal-file-name.jpg";
    const result = sanitizeFilename(cleanFilename);
    expect(result).toBe(cleanFilename);
  });

  test("handles empty filename", () => {
    const result = sanitizeFilename("");
    expect(result).toBe("file");
  });

  test("handles filename without extension", () => {
    const result = sanitizeFilename("L2ltYWdlcy9wcm9kdWN0L21haW4=");
    expect(result).not.toMatch(/[=+/]/);
    expect(result).toBe("L2ltYWdlcy9wcm9kdWN0L21haW4"); // The trailing = is removed by the trailing special chars cleanup
  });

  test("handles filename with multiple dots", () => {
    const result = sanitizeFilename("file.backup.image.jpg");
    expect(result).toMatch(/\.jpg$/);
    expect(result).toBe("file.backup.image.jpg"); // Dots in the middle are preserved as they're allowed
  });

  test("handles very long filenames", () => {
    const longFilename = "a".repeat(200) + ".png";
    const result = sanitizeFilename(longFilename);
    expect(result.length).toBeLessThanOrEqual(104); // 100 + ".png"
    expect(result).toMatch(/\.png$/);
  });

  test("removes leading and trailing special characters", () => {
    const result = sanitizeFilename("___file___name___.jpg");
    expect(result).toBe("file_name.jpg"); // Multiple consecutive underscores are collapsed
  });

  test("collapses multiple consecutive separators", () => {
    const result = sanitizeFilename("file---___name.jpg");
    expect(result).toBe("file_name.jpg");
  });

  describe("extension sanitization", () => {
    test("sanitizes malicious extension with quotes", () => {
      const result = sanitizeFilename('photo.png"');
      expect(result).toBe("photo.png");
      expect(result).not.toContain('"');
    });

    test("sanitizes extension with slashes", () => {
      const result = sanitizeFilename("avatar.png/..");
      expect(result).toBe("avatar.png");
      expect(result).not.toContain("/");
      // The dot should still be present as part of the valid extension
      expect(result).toContain(".");
    });

    test("sanitizes extension with semicolons", () => {
      const result = sanitizeFilename("file.jpg;rm -rf /");
      expect(result).toBe("file.jpgrmrf");
      expect(result).not.toContain(";");
      expect(result).not.toContain(" ");
    });

    test("sanitizes extension with special characters", () => {
      const result = sanitizeFilename("image.png@#$%^&*()");
      expect(result).toBe("image.png");
      expect(result).not.toMatch(/[@#$%^&*()]/);
    });

    test("handles extension with only special characters", () => {
      const result = sanitizeFilename("file.@#$%");
      expect(result).toBe("file");
      expect(result).not.toContain(".");
    });

    test("preserves valid extension characters", () => {
      const result = sanitizeFilename("file.jpeg2");
      expect(result).toBe("file.jpeg2");
    });

    test("handles multiple malicious characters in extension", () => {
      const result = sanitizeFilename('document.pdf";\\/malicious');
      expect(result).toBe("document.pdfmalicious");
      expect(result).not.toMatch(/[";\\/]/);
    });
  });
});
