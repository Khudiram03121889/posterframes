import QRCode from "qrcode";
import fs from "node:fs";
import path from "node:path";

/**
 * Generate an SVG string for a QR code.
 */
export async function generateQrSvg(data, options = {}) {
  const {
    color = { dark: "#000000", light: "#ffffff" },
    margin = 1,
    width = 256
  } = options;

  return await QRCode.toString(data, {
    type: "svg",
    color,
    margin,
    width
  });
}

/**
 * Save a QR code to a file (SVG or PNG).
 */
export async function saveQrToFile(data, outputPath, options = {}) {
  const {
    color = { dark: "#000000", light: "#ffffff" },
    margin = 1,
    width = 512
  } = options;

  const ext = path.extname(outputPath).toLowerCase();
  const dir = path.dirname(path.resolve(outputPath));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (ext === ".svg") {
    const svg = await QRCode.toString(data, {
      type: "svg",
      color,
      margin,
      width
    });
    fs.writeFileSync(outputPath, svg);
  } else {
    await QRCode.toFile(outputPath, data, {
      color,
      margin,
      width
    });
  }

  return path.resolve(outputPath);
}
