import puppeteer from "puppeteer-core";
import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { findChromePath } from "./browser.js";
import { AUTOFIT_CLIENT_SCRIPT } from "./autofit.js";

/**
 * Load dimensions from posterframes.json manifest or HTML fallback.
 */
function resolveDimensionsForLint(inputPath, overrideWidth, overrideHeight) {
  if (overrideWidth && overrideHeight) {
    return { width: overrideWidth, height: overrideHeight, source: "cli-override" };
  }

  const dir = path.dirname(path.resolve(inputPath));
  const manifest = path.join(dir, "posterframes.json");
  if (fs.existsSync(manifest)) {
    const m = JSON.parse(fs.readFileSync(manifest, "utf-8"));
    if (m.width && m.height) {
      return { width: m.width, height: m.height, source: "posterframes.json" };
    }
  }

  const rawHtml = fs.readFileSync(inputPath, "utf-8");
  const matchVarW = rawHtml.match(/--W:\s*(\d+)px/);
  const matchVarH = rawHtml.match(/--H:\s*(\d+)px/);
  if (matchVarW && matchVarH) {
    return {
      width: parseInt(matchVarW[1], 10),
      height: parseInt(matchVarH[1], 10),
      source: "css-variables (--W/--H)"
    };
  }

  const matchDataW = rawHtml.match(/data-width=["'](\d+)["']/);
  const matchDataH = rawHtml.match(/data-height=["'](\d+)["']/);
  if (matchDataW && matchDataH) {
    return {
      width: parseInt(matchDataW[1], 10),
      height: parseInt(matchDataH[1], 10),
      source: "data-attributes"
    };
  }

  return { width: 1080, height: 1920, source: "default-fallback" };
}

/**
 * Run deterministic headless layout audit on a poster HTML file.
 */
export async function lintPoster(inputPath, options = {}) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const resolved = resolveDimensionsForLint(inputPath, options.width, options.height);
  const targetWidth = resolved.width;
  const targetHeight = resolved.height;

  const chromePath = findChromePath();
  const fileUrl = pathToFileURL(path.resolve(inputPath)).href;

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

    await page.setViewport({
      width: targetWidth,
      height: targetHeight,
      deviceScaleFactor: 1
    });

    await page.goto(fileUrl, {
      waitUntil: ["domcontentloaded", "networkidle0"],
      timeout: 30000
    });

    // Enforce exact canvas dimensions
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

    // Wait for fonts & images to settle
    await page.evaluate(async () => {
      if (document.fonts) {
        await document.fonts.ready;
      }
      const images = Array.from(document.querySelectorAll("img"));
      await Promise.all(
        images.map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise((res) => {
            img.onload = res;
            img.onerror = res;
          });
        })
      );
    });

    // Run data-fit engine inside the page first
    await page.evaluate(AUTOFIT_CLIENT_SCRIPT);

    // Give DOM 100ms to settle after autofit
    await new Promise((r) => setTimeout(r, 100));

    // Run deterministic measurements inside the DOM
    const lintResults = await page.evaluate((targetW, targetH) => {
      const artboard = document.querySelector("#canvas, #poster, .poster-artboard") || document.body;
      const artRect = artboard.getBoundingClientRect();

      const shortSide = Math.min(targetW, targetH);
      const u = shortSide / 100;
      const safeMargin = 5 * u;
      const maxAllowedGap = 4 * u;

      const checks = [];

      // -------------------------------------------------------------
      // 1. Box Fill Ratio Checks
      // -------------------------------------------------------------
      const boxCandidates = Array.from(
        artboard.querySelectorAll(
          "[data-box], [data-min-fill], .quote-box, [class*='quote'], [class*='card'], [class*='message-card'], [class*='box']"
        )
      ).filter((el) => {
        // Exclude full artboard or background layers
        if (el === artboard || el.id === "canvas") return false;
        const comp = window.getComputedStyle(el);
        const w = el.clientWidth;
        const h = el.clientHeight;
        // Box must have visible dimensions and contain text
        return w > 50 && h > 40 && el.innerText.trim().length > 0;
      });

      if (boxCandidates.length === 0) {
        checks.push({
          type: "box-fill",
          status: "INFO",
          message: "No explicit box/card containers found for fill-ratio check (use class 'quote-box' or [data-min-fill])"
        });
      } else {
        boxCandidates.forEach((box, i) => {
          const comp = window.getComputedStyle(box);
          const padY = (parseFloat(comp.paddingTop) || 0) + (parseFloat(comp.paddingBottom) || 0);
          const availH = box.clientHeight - padY;

          // Compute inner text/content height
          const textChildren = Array.from(box.querySelectorAll("p, span, h1, h2, h3, h4, blockquote, div"));
          let contentH = box.scrollHeight - padY;

          if (textChildren.length > 0) {
            const tops = textChildren.map((c) => c.getBoundingClientRect().top);
            const bottoms = textChildren.map((c) => c.getBoundingClientRect().bottom);
            const spanH = Math.max(...bottoms) - Math.min(...tops);
            if (spanH > 0) contentH = spanH;
          }

          const fillRatio = availH > 0 ? Math.round((contentH / availH) * 100) : 100;
          const minFill = parseFloat(box.getAttribute("data-min-fill") || "75");

          const identifier = box.id
            ? `#${box.id}`
            : box.className
              ? `.${box.className.trim().split(/\s+/)[0]}`
              : `box[${i}]`;

          if (fillRatio < minFill) {
            checks.push({
              type: "box-fill",
              status: "FAIL",
              element: identifier,
              ratio: fillRatio,
              threshold: minFill,
              message: `${identifier} fill ${fillRatio}%, minimum ${minFill}%`
            });
          } else {
            checks.push({
              type: "box-fill",
              status: "PASS",
              element: identifier,
              ratio: fillRatio,
              threshold: minFill,
              message: `${identifier} fill ${fillRatio}% (target >= ${minFill}%)`
            });
          }
        });
      }

      // -------------------------------------------------------------
      // 2. Empty Vertical Region / Dead Space Check
      // -------------------------------------------------------------
      const allElements = Array.from(artboard.querySelectorAll("*"));
      const foregroundIntervals = [];

      allElements.forEach((el) => {
        if (el === artboard || el.id === "canvas") return;
        const comp = window.getComputedStyle(el);

        // Ignore invisible or background elements
        if (comp.display === "none" || comp.visibility === "hidden" || parseFloat(comp.opacity) < 0.05) return;
        if (parseInt(comp.zIndex, 10) < 0) return;

        const isFullBleedBg =
          el.clientWidth >= targetW * 0.95 && el.clientHeight >= targetH * 0.95 && (comp.position === "absolute" || comp.position === "fixed");
        if (isFullBleedBg && !el.innerText.trim()) return;

        const r = el.getBoundingClientRect();
        if (r.width > 20 && r.height > 10) {
          const relTop = r.top - artRect.top;
          const relBottom = r.bottom - artRect.top;
          // Only include elements that have text, an image, svg, or styled card backgrounds
          const hasContent = el.innerText.trim().length > 0 || el.tagName === "IMG" || el.tagName === "SVG" || comp.borderWidth !== "0px";
          if (hasContent) {
            foregroundIntervals.push([Math.max(0, relTop), Math.min(targetH, relBottom)]);
          }
        }
      });

      // Merge overlapping intervals
      foregroundIntervals.sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const [start, end] of foregroundIntervals) {
        if (!merged.length || merged[merged.length - 1][1] < start) {
          merged.push([start, end]);
        } else {
          merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], end);
        }
      }

      // Scan for empty gaps taller than maxAllowedGap (4u) inside safe margins
      const emptyGaps = [];
      let lastBottom = safeMargin;

      for (const [start, end] of merged) {
        if (start > lastBottom) {
          const gapSize = start - lastBottom;
          if (gapSize > maxAllowedGap && lastBottom < targetH - safeMargin) {
            emptyGaps.push({
              start: Math.round(lastBottom),
              end: Math.round(start),
              size: Math.round(gapSize),
              sizeU: (gapSize / u).toFixed(1)
            });
          }
        }
        lastBottom = Math.max(lastBottom, end);
      }

      if (emptyGaps.length > 0) {
        emptyGaps.forEach((g) => {
          checks.push({
            type: "dead-space",
            status: "FAIL",
            gap: g,
            message: `Empty vertical band of ${g.size}px (${g.sizeU}u) at y=${g.start}px..${g.end}px (maximum allowed is 4u / ${Math.round(maxAllowedGap)}px)`
          });
        });
      } else {
        checks.push({
          type: "dead-space",
          status: "PASS",
          message: `No empty vertical band > 4u found (threshold: ${Math.round(maxAllowedGap)}px / 4u)`
        });
      }

      // -------------------------------------------------------------
      // 3. Safe Margin Breach Check (P8)
      // -------------------------------------------------------------
      const textElements = Array.from(
        artboard.querySelectorAll("h1, h2, h3, h4, h5, h6, p, span, blockquote, a, label")
      ).filter((el) => el.innerText.trim().length > 0 && !el.closest("[data-bleed]"));

      let marginBreaches = 0;
      textElements.forEach((el) => {
        const r = el.getBoundingClientRect();
        const relL = r.left - artRect.left;
        const relR = r.right - artRect.left;
        const relT = r.top - artRect.top;
        const relB = r.bottom - artRect.top;

        // Allow 2px tolerance for subpixel anti-aliasing
        const leftBreach = relL < safeMargin - 2;
        const rightBreach = relR > targetW - safeMargin + 2;
        const topBreach = relT < safeMargin - 2;
        const bottomBreach = relB > targetH - safeMargin + 2;

        if (leftBreach || rightBreach || topBreach || bottomBreach) {
          marginBreaches++;
          const snippet = el.innerText.trim().slice(0, 24);
          checks.push({
            type: "safe-margin",
            status: "FAIL",
            message: `Text "${snippet}..." breaches 5u safe margin (${Math.round(safeMargin)}px) at [x=${Math.round(relL)}, y=${Math.round(relT)}]`
          });
        }
      });

      if (marginBreaches === 0) {
        checks.push({
          type: "safe-margin",
          status: "PASS",
          message: `All text elements respect the 5u safe margin (${Math.round(safeMargin)}px)`
        });
      }

      // -------------------------------------------------------------
      // 4. Typographic Hierarchy Check (P1)
      // -------------------------------------------------------------
      const fontSizes = textElements
        .map((el) => parseFloat(window.getComputedStyle(el).fontSize) || 0)
        .filter((sz) => sz > 0);

      if (fontSizes.length > 0) {
        const maxFont = Math.max(...fontSizes);
        const minFont = Math.min(...fontSizes);
        const ratio = Math.round((maxFont / minFont) * 10) / 10;

        if (ratio < 3.0) {
          checks.push({
            type: "hierarchy",
            status: "FAIL",
            ratio,
            maxFont,
            minFont,
            message: `Typographic hierarchy ratio is ${ratio}x (headline ${maxFont}px / body ${minFont}px), minimum required is 3.0x`
          });
        } else {
          checks.push({
            type: "hierarchy",
            status: "PASS",
            ratio,
            maxFont,
            minFont,
            message: `Typographic hierarchy ratio is ${ratio}x (headline ${maxFont}px vs body ${minFont}px)`
          });
        }
      }

      return {
        width: targetW,
        height: targetH,
        u: Math.round(u * 10) / 10,
        checks
      };
    }, targetWidth, targetHeight);

    return {
      file: inputPath,
      width: targetWidth,
      height: targetHeight,
      source: resolved.source,
      u: lintResults.u,
      checks: lintResults.checks,
      passed: lintResults.checks.every((c) => c.status !== "FAIL")
    };
  } finally {
    await browser.close();
  }
}
