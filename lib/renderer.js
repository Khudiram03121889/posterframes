import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { findChromePath } from "./browser.js";
import { AUTOFIT_CLIENT_SCRIPT } from "./autofit.js";

/**
 * Load dimensions from posterframes.json manifest (single source of truth).
 */
function loadManifestDimensions(inputPath) {
  const dir = path.dirname(path.resolve(inputPath));
  const manifest = path.join(dir, "posterframes.json");
  if (fs.existsSync(manifest)) {
    const m = JSON.parse(fs.readFileSync(manifest, "utf-8"));
    if (m.width && m.height) {
      return { width: m.width, height: m.height, source: "posterframes.json" };
    }
  }
  return null;
}

/**
 * Extract artboard dimensions from HTML as fallback only.
 */
function extractDimensionsFromHtml(htmlContent) {
  const matchVarW = htmlContent.match(/--W:\s*(\d+)px/);
  const matchVarH = htmlContent.match(/--H:\s*(\d+)px/);
  if (matchVarW && matchVarH) {
    return {
      width: parseInt(matchVarW[1], 10),
      height: parseInt(matchVarH[1], 10),
      source: "css-variables (--W/--H)"
    };
  }

  const matchDataW = htmlContent.match(/data-width=["'](\d+)["']/);
  const matchDataH = htmlContent.match(/data-height=["'](\d+)["']/);
  if (matchDataW && matchDataH) {
    return {
      width: parseInt(matchDataW[1], 10),
      height: parseInt(matchDataH[1], 10),
      source: "data-attributes"
    };
  }

  const matchCssW = htmlContent.match(/width:\s*(\d+)px/);
  const matchCssH = htmlContent.match(/height:\s*(\d+)px/);
  if (matchCssW && matchCssH) {
    return {
      width: parseInt(matchCssW[1], 10),
      height: parseInt(matchCssH[1], 10),
      source: "inline-css"
    };
  }

  return null;
}

// ponytail: Canonical standard dimension is aidso-a4 (1131x1600) matching raw AIDSO archive posters.
const FALLBACK_WIDTH = 1131;
const FALLBACK_HEIGHT = 1600;

/**
 * Resolve final dimensions with priority: CLI overrides > manifest > HTML extraction > fallback.
 * Warns on mismatches so agents/users can see when sources disagree.
 */
function resolveDimensions(inputPath, rawHtml, overrideWidth, overrideHeight) {
  if (overrideWidth && overrideHeight) {
    return { width: overrideWidth, height: overrideHeight, source: "cli-override" };
  }

  const manifest = loadManifestDimensions(inputPath);
  const extracted = extractDimensionsFromHtml(rawHtml);

  // Warn on mismatch between manifest and HTML
  if (manifest && extracted && (manifest.width !== extracted.width || manifest.height !== extracted.height)) {
    console.warn(
      `⚠️  Size mismatch: posterframes.json says ${manifest.width}×${manifest.height} ` +
      `but HTML ${extracted.source} says ${extracted.width}×${extracted.height}. Using manifest.`
    );
  }

  if (manifest) return manifest;
  if (extracted) return extracted;

  console.warn(
    `⚠️  No dimensions found in posterframes.json or HTML. Falling back to ${FALLBACK_WIDTH}×${FALLBACK_HEIGHT}.`
  );
  return { width: FALLBACK_WIDTH, height: FALLBACK_HEIGHT, source: "fallback" };
}

/**
 * Render a poster HTML file to PNG or PDF with pre-locked viewports.
 * @param {Object} options
 * @param {string} options.input - Path to HTML file
 * @param {string} options.output - Output file path (.png, .jpg, .pdf)
 * @param {number} [options.scale=2] - Device scale factor
 * @param {string} [options.format="png"] - Output format: "png", "jpeg", "pdf"
 * @param {number} [options.width] - Optional override width
 * @param {number} [options.height] - Optional override height
 */
export async function renderPoster(options) {
  const {
    input,
    output,
    scale = 2,
    format = "png",
    width: overrideWidth,
    height: overrideHeight
  } = options;

  if (!fs.existsSync(input)) {
    throw new Error(`Input file not found: ${input}`);
  }

  const rawHtml = fs.readFileSync(input, "utf-8");
  const resolved = resolveDimensions(input, rawHtml, overrideWidth, overrideHeight);
  const targetWidth = resolved.width;
  const targetHeight = resolved.height;

  console.log(`📐 Dimensions: ${targetWidth}×${targetHeight} (from ${resolved.source})`);

  const chromePath = findChromePath();
  const fileUrl = pathToFileURL(path.resolve(input)).href;

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--font-render-hinting=none",
      `--window-size=${targetWidth},${targetHeight}`
    ]
  });

  try {
    const page = await browser.newPage();

    // CRITICAL: Lock viewport to exact poster dimensions BEFORE page loads.
    await page.setViewport({
      width: targetWidth,
      height: targetHeight,
      deviceScaleFactor: Number(scale)
    });

    await page.goto(fileUrl, {
      waitUntil: ["domcontentloaded", "load"],
      timeout: 20000
    });

    // CRITICAL: Force artboard to exact dimensions regardless of what the HTML says.
    // This is the fix — agents can write w-full/h-full or wrong pixel values,
    // the renderer overrides it to the authoritative size.
    await page.addStyleTag({
      content: `
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          width: ${targetWidth}px !important;
          height: ${targetHeight}px !important;
          overflow: hidden !important;
        }
        #poster, .poster-artboard, #canvas {
          width: ${targetWidth}px !important;
          height: ${targetHeight}px !important;
          min-width: ${targetWidth}px !important;
          min-height: ${targetHeight}px !important;
          max-width: ${targetWidth}px !important;
          max-height: ${targetHeight}px !important;
          overflow: hidden !important;
        }
      `
    });

    // Wait for web fonts and images to load completely
    await page.evaluate(async () => {
      if (document.fonts) {
        await document.fonts.ready;
      }
      const images = Array.from(document.querySelectorAll("img"));
      await Promise.all(
        images.map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise((resolve) => {
            img.onload = resolve;
            img.onerror = resolve;
          });
        })
      );
    });

    // Automatically scale text for any elements marked with [data-fit]
    await page.evaluate(AUTOFIT_CLIENT_SCRIPT);

    // Small delay to let any CSS layout transitions settle
    await new Promise((r) => setTimeout(r, 150));

    // Ensure output directory exists
    const outDir = path.dirname(path.resolve(output));
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    const resolvedOutput = path.resolve(output);

    if (format === "pdf") {
      await page.pdf({
        path: resolvedOutput,
        width: `${targetWidth}px`,
        height: `${targetHeight}px`,
        printBackground: true,
        margin: { top: 0, bottom: 0, left: 0, right: 0 }
      });
    } else {
      const artboardEl = await page.$("#poster, .poster-artboard, #canvas");
      if (artboardEl) {
        await artboardEl.screenshot({
          path: resolvedOutput,
          type: format === "jpg" || format === "jpeg" ? "jpeg" : "png",
          quality: format === "jpg" || format === "jpeg" ? 95 : undefined,
          omitBackground: false
        });
      } else {
        await page.screenshot({
          path: resolvedOutput,
          type: format === "jpg" || format === "jpeg" ? "jpeg" : "png",
          quality: format === "jpg" || format === "jpeg" ? 95 : undefined,
          fullPage: false
        });
      }
    }

    const stats = fs.statSync(resolvedOutput);

    return {
      output: resolvedOutput,
      width: targetWidth,
      height: targetHeight,
      scale: Number(scale),
      sizeBytes: stats.size
    };
  } finally {
    await browser.close();
  }
}
