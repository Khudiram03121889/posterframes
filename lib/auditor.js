import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { pathToFileURL } from "node:url";
import { findChromePath } from "./browser.js";

/**
 * Client-side script evaluated inside Chromium to audit DOM layout and alpha collisions.
 */
export const AUDIT_BROWSER_SCRIPT = `
(function auditPosterInBrowser(options = {}) {
  const { debugBoxes = false } = options;

  const artboard = document.querySelector("#poster, .poster-artboard, #canvas") || document.body;
  const artRect = artboard.getBoundingClientRect();
  const artWidth = artRect.width || 1131;
  const artHeight = artRect.height || 1600;

  // ---------------------------------------------------------------------------
  // 1. AUTO-FIT TEXT PRE-PASS (autoFitText)
  // ---------------------------------------------------------------------------
  const autofitCandidates = Array.from(document.querySelectorAll('[data-layer="content"], [data-autofit], [data-fit]'));
  for (const el of autofitCandidates) {
    let comp = window.getComputedStyle(el);
    let fontSize = parseFloat(comp.fontSize);
    if (!fontSize || isNaN(fontSize)) continue;

    // Check if element or parent has constrained bounds
    const isHeightConstrained = (el.style.height || el.style.maxHeight || (comp.maxHeight && comp.maxHeight !== 'none') || (el.clientHeight > 0 && comp.overflow === 'hidden'));
    const isWidthConstrained = (el.style.width || el.style.maxWidth || (comp.maxWidth && comp.maxWidth !== 'none') || (el.clientWidth > 0 && comp.overflow === 'hidden'));

    let parent = el.parentElement;
    let parentComp = parent ? window.getComputedStyle(parent) : null;
    let parentConstrainedH = parent && parent.clientHeight > 0 && (parentComp.overflow === 'hidden' || parent.style.height || parent.style.maxHeight);
    let parentConstrainedW = parent && parent.clientWidth > 0 && (parentComp.overflow === 'hidden' || parent.style.width || parent.style.maxWidth);

    let iterations = 0;
    while (iterations < 100 && fontSize > 12) {
      const overflowsSelfH = isHeightConstrained && (el.scrollHeight > el.clientHeight + 2);
      const overflowsSelfW = isWidthConstrained && (el.scrollWidth > el.clientWidth + 2);
      const overflowsParentH = parentConstrainedH && (el.getBoundingClientRect().bottom > parent.getBoundingClientRect().bottom + 2);
      const overflowsParentW = parentConstrainedW && (el.getBoundingClientRect().right > parent.getBoundingClientRect().right + 2);

      if (overflowsSelfH || overflowsSelfW || overflowsParentH || overflowsParentW) {
        fontSize -= 1;
        el.style.fontSize = fontSize + "px";
        iterations++;
      } else {
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 2. 3-TIER LAYER CLASSIFICATION (Infer missing data-layer attributes)
  // ---------------------------------------------------------------------------
  const allElements = Array.from(artboard.querySelectorAll("*"));
  
  for (const el of allElements) {
    if (el.hasAttribute("data-layer")) continue;

    const tagName = el.tagName.toLowerCase();
    const comp = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    // Check images
    if (tagName === "img") {
      const src = (el.getAttribute("src") || "").toLowerCase();
      if (src.includes("portrait") || src.includes("che") || src.includes("feathered") || src.includes("grabcut") || src.includes("photo") || src.includes("hero")) {
        el.setAttribute("data-layer", "subject");
      } else if (src.includes("emblem") || src.includes("logo") || src.includes("aidso") || src.includes("students") || src.includes("icon") || src.includes("qr")) {
        el.setAttribute("data-layer", "content");
      }
      continue;
    }

    // Check full-bleed background divs
    if (tagName === "div" || tagName === "section") {
      const isFullBleed = (rect.width >= artWidth * 0.95 && rect.height >= artHeight * 0.95) || 
                          el.classList.contains("inset-0") || 
                          el.classList.contains("absolute-fill");
      const zIndex = parseInt(comp.zIndex, 10) || 0;
      if (isFullBleed && zIndex <= 5) {
        el.setAttribute("data-layer", "background");
        continue;
      }

      // Check containers (cards, ribbons, badges, footer bars)
      if (el.classList.contains("quote-box") || el.classList.contains("badge") || 
          el.hasAttribute("data-box") || comp.borderRadius !== "0px" || 
          (comp.backgroundColor && comp.backgroundColor !== "rgba(0, 0, 0, 0)" && comp.backgroundColor !== "transparent") ||
          (comp.borderWidth && parseFloat(comp.borderWidth) > 0)) {
        el.setAttribute("data-layer", "container");
        continue;
      }
    }

    // Check text leaf nodes
    const isTextTag = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "blockquote", "label", "b", "strong", "em"].includes(tagName);
    if (isTextTag && el.textContent && el.textContent.trim().length > 0) {
      // Leaf or near-leaf text element
      const blockChildren = el.querySelectorAll("h1, h2, h3, h4, h5, h6, p, blockquote, div");
      if (blockChildren.length === 0) {
        el.setAttribute("data-layer", "content");
      }
    }
  }

  // Helpers
  function getSelector(el) {
    if (el.id) return "#" + el.id;
    let sel = el.tagName.toLowerCase();
    if (el.className && typeof el.className === "string") {
      const classes = el.className.split(/\\s+/).filter(c => c && !c.startsWith("debug-") && !c.includes(":"));
      if (classes.length > 0) sel += "." + classes.slice(0, 2).join(".");
    }
    return sel;
  }

  function getTextSnippet(el) {
    if (el.tagName.toLowerCase() === "img") {
      const src = el.getAttribute("src") || "";
      return "[img: " + src.split("/").pop() + "]";
    }
    const t = (el.innerText || el.textContent || "").trim().replace(/\\s+/g, " ");
    return t.length > 32 ? t.slice(0, 32) + "..." : t;
  }

  // ---------------------------------------------------------------------------
  // 3. COLLECT AUDIT CANDIDATES
  // ---------------------------------------------------------------------------
  let rawContentElements = Array.from(artboard.querySelectorAll('[data-layer="content"]'));
  
  // Filter visible content elements
  let contentElements = rawContentElements.filter(el => {
    const comp = window.getComputedStyle(el);
    if (comp.display === "none" || comp.visibility === "hidden" || parseFloat(comp.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    // Don't audit empty non-img elements
    if (el.tagName.toLowerCase() !== "img" && (!el.textContent || el.textContent.trim().length === 0)) return false;
    return true;
  });

  // Filter out parent content elements whose children are also tagged content
  contentElements = contentElements.filter(el => {
    const childContent = el.querySelectorAll('[data-layer="content"]');
    for (const child of childContent) {
      if (contentElements.includes(child)) return false; // Parent of another content element
    }
    return true;
  });

  const subjectElements = Array.from(artboard.querySelectorAll('[data-layer="subject"]'));
  const containerElements = Array.from(artboard.querySelectorAll('[data-layer="container"]'));
  const backgroundElements = Array.from(artboard.querySelectorAll('[data-layer="background"]'));

  const errors = [];
  const warnings = [];
  const overlapsDetected = [];
  const spacingRulers = [];

  // ---------------------------------------------------------------------------
  // CHECK A: ZERO-TOLERANCE CONTENT-TO-CONTENT OVERLAP
  // ---------------------------------------------------------------------------
  for (let i = 0; i < contentElements.length; i++) {
    for (let j = i + 1; j < contentElements.length; j++) {
      const elA = contentElements[i];
      const elB = contentElements[j];

      // Exclude parent-child nested elements
      if (elA.contains(elB) || elB.contains(elA)) continue;

      const rA = elA.getBoundingClientRect();
      const rB = elB.getBoundingClientRect();

      const interLeft = Math.max(rA.left, rB.left);
      const interRight = Math.min(rA.right, rB.right);
      const interTop = Math.max(rA.top, rB.top);
      const interBottom = Math.min(rA.bottom, rB.bottom);

      const overlapX = interRight - interLeft;
      const overlapY = interBottom - interTop;

      if (overlapX > 2 && overlapY > 2) {
        const overlapObj = {
          type: "CONTENT_OVERLAP",
          elementA: getSelector(elA),
          textA: getTextSnippet(elA),
          elementB: getSelector(elB),
          textB: getTextSnippet(elB),
          overlapX: Math.round(overlapX),
          overlapY: Math.round(overlapY),
          rectA: { left: Math.round(rA.left), top: Math.round(rA.top), width: Math.round(rA.width), height: Math.round(rA.height) },
          rectB: { left: Math.round(rB.left), top: Math.round(rB.top), width: Math.round(rB.width), height: Math.round(rB.height) },
          intersection: { left: Math.round(interLeft), top: Math.round(interTop), width: Math.round(overlapX), height: Math.round(overlapY) },
          message: 'Content overlap (' + Math.round(overlapX) + 'x' + Math.round(overlapY) + 'px) between "' + getTextSnippet(elA) + '" and "' + getTextSnippet(elB) + '"'
        };
        errors.push(overlapObj);
        overlapsDetected.push(overlapObj);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // CHECK B: CANVAS ALPHA-CHANNEL HIT-TESTING FOR PORTRAIT (subject) vs TEXT/LOGOS (content)
  // ---------------------------------------------------------------------------
  const subjectImages = [];
  for (const sEl of subjectElements) {
    const imgs = sEl.tagName.toLowerCase() === "img" ? [sEl] : Array.from(sEl.querySelectorAll("img"));
    for (const img of imgs) {
      if (!subjectImages.includes(img)) subjectImages.push(img);
    }
  }

  for (const img of subjectImages) {
    if (!img.complete || img.naturalWidth === 0) continue;
    const sRect = img.getBoundingClientRect();
    if (sRect.width <= 0 || sRect.height <= 0) continue;

      // Draw subject to offscreen canvas
      const offCanvas = document.createElement("canvas");
      offCanvas.width = Math.round(sRect.width);
      offCanvas.height = Math.round(sRect.height);
      const ctx = offCanvas.getContext("2d", { willReadFrequently: true });
      
      try {
        ctx.drawImage(img, 0, 0, offCanvas.width, offCanvas.height);
      } catch (err) {
        console.warn("Could not draw subject image to canvas:", err);
        continue;
      }

      for (const cEl of contentElements) {
        const cRect = cEl.getBoundingClientRect();

        const interLeft = Math.max(cRect.left, sRect.left);
        const interRight = Math.min(cRect.right, sRect.right);
        const interTop = Math.max(cRect.top, sRect.top);
        const interBottom = Math.min(cRect.bottom, sRect.bottom);

        const overlapW = interRight - interLeft;
        const overlapH = interBottom - interTop;

        if (overlapW > 2 && overlapH > 2) {
          const localX = Math.max(0, Math.floor(interLeft - sRect.left));
          const localY = Math.max(0, Math.floor(interTop - sRect.top));
          const localW = Math.min(offCanvas.width - localX, Math.ceil(overlapW));
          const localH = Math.min(offCanvas.height - localY, Math.ceil(overlapH));

          if (localW > 0 && localH > 0) {
            let imgData;
            try {
              imgData = ctx.getImageData(localX, localY, localW, localH);
            } catch (e) {
              console.warn("Canvas getImageData failed:", e);
              continue;
            }

            const pixels = imgData.data;
            let opaqueCount = 0;
            let maxAlpha = 0;
            let firstHit = null;

            // Sample every 2px in x and y
            const step = 2;
            for (let py = 0; py < localH; py += step) {
              for (let px = 0; px < localW; px += step) {
                const idx = (py * localW + px) * 4 + 3;
                const alpha = pixels[idx];
                if (alpha > maxAlpha) maxAlpha = alpha;
                if (alpha > 40) {
                  opaqueCount++;
                  if (!firstHit) {
                    firstHit = {
                      x: Math.round(interLeft + px),
                      y: Math.round(interTop + py),
                      alpha
                    };
                  }
                }
              }
            }

            if (opaqueCount > 0) {
              const cCenterX = cRect.left + cRect.width / 2;
              const sCenterX = sRect.left + sRect.width / 2;
              const cCenterY = cRect.top + cRect.height / 2;
              const sCenterY = sRect.top + sRect.height / 2;

              let shiftDir = "";
              let shiftPx = 0;
              if (Math.abs(cCenterX - sCenterX) > Math.abs(cCenterY - sCenterY)) {
                if (cCenterX < sCenterX) {
                  shiftDir = "left";
                  shiftPx = Math.round(interRight - sRect.left + 8);
                } else {
                  shiftDir = "right";
                  shiftPx = Math.round(sRect.right - interLeft + 8);
                }
              } else {
                if (cCenterY < sCenterY) {
                  shiftDir = "up";
                  shiftPx = Math.round(interBottom - sRect.top + 8);
                } else {
                  shiftDir = "down";
                  shiftPx = Math.round(sRect.bottom - interTop + 8);
                }
              }

              const collisionObj = {
                type: "PORTRAIT_COLLISION",
                contentElement: getSelector(cEl),
                contentText: getTextSnippet(cEl),
                subjectElement: getSelector(img),
                maxAlpha,
                opaqueSamples: opaqueCount,
                overlapX: Math.round(overlapW),
                overlapY: Math.round(overlapH),
                shiftDirection: shiftDir,
                shiftAmountPx: shiftPx,
                hitPoint: firstHit,
                intersection: { left: Math.round(interLeft), top: Math.round(interTop), width: Math.round(overlapW), height: Math.round(overlapH) },
                message: 'Portrait collision: "' + getTextSnippet(cEl) + '" collides with subject portrait (max alpha ' + maxAlpha + ', ' + opaqueCount + ' opaque samples). Shift ' + shiftDir + ' by ~' + shiftPx + 'px.'
              };
              errors.push(collisionObj);
              overlapsDetected.push(collisionObj);
            }
          }
        }
      }
    }

  // ---------------------------------------------------------------------------
  // CHECK C: RAY-CAST OCCLUSION CHECK (elementFromPoint)
  // ---------------------------------------------------------------------------
  for (const cEl of contentElements) {
    const r = cEl.getBoundingClientRect();
    const insetX = Math.min(4, Math.max(1, r.width / 4));
    const insetY = Math.min(4, Math.max(1, r.height / 4));

    const testPoints = [
      { x: r.left + r.width / 2, y: r.top + r.height / 2, name: "center" },
      { x: r.left + insetX, y: r.top + insetY, name: "top-left" },
      { x: r.right - insetX, y: r.top + insetY, name: "top-right" },
      { x: r.left + insetX, y: r.bottom - insetY, name: "bottom-left" },
      { x: r.right - insetX, y: r.bottom - insetY, name: "bottom-right" }
    ];

    for (const pt of testPoints) {
      if (pt.x < 0 || pt.x > artWidth || pt.y < 0 || pt.y > artHeight) continue;
      
      const hit = document.elementFromPoint(pt.x, pt.y);
      if (!hit) continue;

      if (hit === cEl || cEl.contains(hit) || hit.contains(cEl)) {
        continue; // Correct element hit
      }

      // Check if hit element is blocking
      const hitComp = window.getComputedStyle(hit);
      if (hitComp.pointerEvents === "none") continue;

      const hitLayer = hit.getAttribute("data-layer") || "";
      const hitZ = parseInt(hitComp.zIndex, 10) || 0;
      const cZ = parseInt(window.getComputedStyle(cEl).zIndex, 10) || 0;

      // If foreground image, decorative element or container has higher z-index and sits over the text
      if (hitLayer === "background" && hitZ <= 5) continue; // standard background

      if (hitZ >= cZ) {
        errors.push({
          type: "OCCLUSION_ERROR",
          contentElement: getSelector(cEl),
          contentText: getTextSnippet(cEl),
          blockingElement: getSelector(hit),
          blockingLayer: hitLayer,
          point: { x: Math.round(pt.x), y: Math.round(pt.y), location: pt.name },
          message: 'Occlusion error: "' + getTextSnippet(cEl) + '" is blocked at ' + pt.name + ' (' + Math.round(pt.x) + ', ' + Math.round(pt.y) + ') by <' + hit.tagName.toLowerCase() + ' ' + (hit.className || "") + '>'
        });
        break; // One occlusion error per element is enough
      }
    }
  }

  // ---------------------------------------------------------------------------
  // CHECK D: SAFE MARGIN & VERTICAL RHYTHM / SPACING AUDIT
  // ---------------------------------------------------------------------------
  const safeMarginX = artWidth * 0.03;
  const safeMarginY = artHeight * 0.03;

  for (const cEl of contentElements) {
    const r = cEl.getBoundingClientRect();

    // Check canvas boundaries
    const leftViolated = r.left < safeMarginX - 1;
    const topViolated = r.top < safeMarginY - 1;
    const rightViolated = r.right > (artWidth - safeMarginX + 1);
    const bottomViolated = r.bottom > (artHeight - safeMarginY + 1);

    if (leftViolated || topViolated || rightViolated || bottomViolated) {
      errors.push({
        type: "SAFE_ZONE_VIOLATION",
        element: getSelector(cEl),
        text: getTextSnippet(cEl),
        bounds: { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) },
        canvasLimits: { minX: Math.round(safeMarginX), minY: Math.round(safeMarginY), maxX: Math.round(artWidth - safeMarginX), maxY: Math.round(artHeight - safeMarginY) },
        message: 'Safe zone violation: "' + getTextSnippet(cEl) + '" is closer than 3% to canvas boundary (rect: [' + Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.right) + ',' + Math.round(r.bottom) + '])'
      });
    }
  }

  // Spacing rhythm within containers / flex columns
  const candidateContainers = Array.from(artboard.querySelectorAll(".flex-col, [data-layer='container'], .quote-box, .lockup"));
  for (const cont of candidateContainers) {
    const innerContents = Array.from(cont.querySelectorAll('[data-layer="content"]')).filter(el => contentElements.includes(el));
    if (innerContents.length < 2) continue;

    // Sort by vertical position
    innerContents.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

    for (let k = 0; k < innerContents.length - 1; k++) {
      const prevEl = innerContents[k];
      const nextEl = innerContents[k + 1];

      const rPrev = prevEl.getBoundingClientRect();
      const rNext = nextEl.getBoundingClientRect();

      // Ensure they are vertically stacked
      if (rNext.top >= rPrev.bottom - 2) {
        const gap = rNext.top - rPrev.bottom;
        spacingRulers.push({
          prevEl: getSelector(prevEl),
          nextEl: getSelector(nextEl),
          gap: Math.round(gap),
          y1: Math.round(rPrev.bottom),
          y2: Math.round(rNext.top),
          x: Math.round(Math.min(rPrev.left, rNext.left))
        });

        const isExplicitlyTight = prevEl.hasAttribute("data-tight") || nextEl.hasAttribute("data-tight") || cont.hasAttribute("data-tight");

        if (gap < 8 && !isExplicitlyTight) {
          errors.push({
            type: "SPACING_TOO_TIGHT",
            elementA: getSelector(prevEl),
            textA: getTextSnippet(prevEl),
            elementB: getSelector(nextEl),
            textB: getTextSnippet(nextEl),
            gapPx: Math.round(gap),
            message: 'Spacing too tight (' + Math.round(gap) + 'px < 8px) between "' + getTextSnippet(prevEl) + '" and "' + getTextSnippet(nextEl) + '"'
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 4. DRAW DEBUG BOXES OVERLAY (If --debug-boxes is requested)
  // ---------------------------------------------------------------------------
  if (debugBoxes) {
    const existingOverlay = document.getElementById("__posterframes_debug_overlay");
    if (existingOverlay) existingOverlay.remove();

    const overlay = document.createElement("div");
    overlay.id = "__posterframes_debug_overlay";
    overlay.style.cssText = "position:absolute;top:0;left:0;width:" + artWidth + "px;height:" + artHeight + "px;pointer-events:none;z-index:999999;";

    // Draw Content boxes (Green)
    for (const cEl of contentElements) {
      const r = cEl.getBoundingClientRect();
      const box = document.createElement("div");
      box.style.cssText = "position:absolute;left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px;border:2px solid #22c55e;background:rgba(34,197,94,0.12);box-sizing:border-box;";
      const label = document.createElement("span");
      label.style.cssText = "position:absolute;top:-16px;left:0;background:#22c55e;color:#000;font-size:10px;font-family:sans-serif;font-weight:bold;padding:1px 4px;border-radius:2px;white-space:nowrap;";
      label.textContent = getTextSnippet(cEl);
      box.appendChild(label);
      overlay.appendChild(box);
    }

    // Draw Subject boxes (Cyan dashed)
    for (const sEl of subjectElements) {
      const r = sEl.getBoundingClientRect();
      const box = document.createElement("div");
      box.style.cssText = "position:absolute;left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px;border:2px dashed #06b6d4;background:rgba(6,182,212,0.06);box-sizing:border-box;";
      const label = document.createElement("span");
      label.style.cssText = "position:absolute;bottom:0;right:0;background:#06b6d4;color:#000;font-size:11px;font-family:sans-serif;font-weight:bold;padding:2px 6px;";
      label.textContent = "[SUBJECT: " + getSelector(sEl) + "]";
      box.appendChild(label);
      overlay.appendChild(box);
    }

    // Draw Overlaps & Collisions (Red)
    for (const ov of overlapsDetected) {
      const inter = ov.intersection;
      if (!inter) continue;
      const box = document.createElement("div");
      box.style.cssText = "position:absolute;left:" + inter.left + "px;top:" + inter.top + "px;width:" + inter.width + "px;height:" + inter.height + "px;border:3px solid #ef4444;background:rgba(239,68,68,0.45);box-sizing:border-box;";
      const label = document.createElement("span");
      label.style.cssText = "position:absolute;top:0;left:0;background:#ef4444;color:#fff;font-size:10px;font-family:sans-serif;font-weight:bold;padding:2px 4px;";
      label.textContent = "COLLISION: " + ov.overlapX + "x" + ov.overlapY + "px";
      box.appendChild(label);
      overlay.appendChild(box);
    }

    // Draw Spacing Rulers (Yellow)
    for (const ruler of spacingRulers) {
      const line = document.createElement("div");
      const h = Math.max(1, ruler.y2 - ruler.y1);
      line.style.cssText = "position:absolute;left:" + (ruler.x + 20) + "px;top:" + ruler.y1 + "px;width:3px;height:" + h + "px;background:#eab308;";
      const label = document.createElement("span");
      label.style.cssText = "position:absolute;left:8px;top:0;background:#eab308;color:#000;font-size:9px;font-family:sans-serif;font-weight:bold;padding:1px 3px;";
      label.textContent = ruler.gap + "px";
      line.appendChild(label);
      overlay.appendChild(line);
    }

    artboard.appendChild(overlay);
  }

  return {
    passed: errors.length === 0,
    artboard: { width: Math.round(artWidth), height: Math.round(artHeight) },
    summary: {
      errors: errors.length,
      warnings: warnings.length,
      contentOverlaps: errors.filter(e => e.type === "CONTENT_OVERLAP").length,
      portraitCollisions: errors.filter(e => e.type === "PORTRAIT_COLLISION").length,
      occlusions: errors.filter(e => e.type === "OCCLUSION_ERROR").length,
      boundaryViolations: errors.filter(e => e.type === "SAFE_ZONE_VIOLATION").length,
      spacingErrors: errors.filter(e => e.type === "SPACING_TOO_TIGHT").length
    },
    counts: {
      content: contentElements.length,
      subject: subjectElements.length,
      container: containerElements.length,
      background: backgroundElements.length
    },
    errors,
    warnings
  };
})
`;

/**
 * Format audit results into human-readable terminal output.
 * @param {Object} auditResult
 * @returns {string}
 */
export function formatAuditReport(auditResult) {
  const lines = [];
  const { passed, artboard, summary, counts, errors, warnings } = auditResult;

  if (passed) {
    lines.push(`\x1b[32m✅ LAYOUT AUDIT PASSED (0 overlaps, 0 occlusions, 0 boundary violations)\x1b[0m`);
    lines.push(`   📐 Canvas: ${artboard.width}×${artboard.height} px`);
    lines.push(`   🔍 Audited elements: ${counts.content} content, ${counts.subject} subject, ${counts.container} containers, ${counts.background} background`);
    return lines.join("\n");
  }

  lines.push(`\x1b[31m❌ LAYOUT AUDIT FAILED (${summary.errors} error(s), ${summary.warnings} warning(s))\x1b[0m`);
  lines.push(`   📐 Canvas: ${artboard.width}×${artboard.height} px (Safe Margins: 3% = minX: ${Math.round(artboard.width * 0.03)}px, minY: ${Math.round(artboard.height * 0.03)}px)`);
  lines.push("-".repeat(76));

  const grouped = {};
  for (const err of errors) {
    if (!grouped[err.type]) grouped[err.type] = [];
    grouped[err.type].push(err);
  }

  for (const [type, errs] of Object.entries(grouped)) {
    lines.push(`\x1b[33m[${type}]\x1b[0m (${errs.length} occurrence${errs.length > 1 ? "s" : ""}):`);
    for (const e of errs) {
      lines.push(`  • ${e.message}`);
    }
    lines.push("");
  }

  if (warnings.length > 0) {
    lines.push(`\x1b[33m[WARNINGS]\x1b[0m:`);
    for (const w of warnings) {
      lines.push(`  • ${w.message}`);
    }
    lines.push("");
  }

  lines.push("-".repeat(76));
  lines.push(`\x1b[31mAction Required:\x1b[0m Adjust CSS layout, bounding boxes, or margins so all elements pass cleanly.`);

  return lines.join("\n");
}

/**
 * Execute the DOM + Alpha collision audit on an active Puppeteer page.
 * @param {import("puppeteer-core").Page} page
 * @param {Object} options
 * @param {boolean} [options.debugBoxes=false]
 * @returns {Promise<Object>}
 */
export async function auditPosterLayout(page, options = {}) {
  const auditResult = await page.evaluate(
    new Function("options", `return (${AUDIT_BROWSER_SCRIPT})(options);`),
    options
  );
  return auditResult;
}

/**
 * Run a full standalone headless audit on a poster HTML file.
 * @param {string} inputPath
 * @param {Object} options
 */
export async function runStandaloneAudit(inputPath, options = {}) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`File not found: ${inputPath}`);
  }

  // Load manifest or dimensions
  let width = options.width;
  let height = options.height;

  const dir = path.dirname(path.resolve(inputPath));
  const manifestPath = path.join(dir, "posterframes.json");
  if (!width && !height && fs.existsSync(manifestPath)) {
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      width = m.width;
      height = m.height;
    } catch (_) {}
  }

  if (!width || !height) {
    const raw = fs.readFileSync(inputPath, "utf-8");
    const mW = raw.match(/--W:\s*(\d+)px/) || raw.match(/data-width=["'](\d+)["']/);
    const mH = raw.match(/--H:\s*(\d+)px/) || raw.match(/data-height=["'](\d+)["']/);
    width = mW ? parseInt(mW[1], 10) : 1131;
    height = mH ? parseInt(mH[1], 10) : 1600;
  }

  const chromePath = findChromePath();
  const fileUrl = pathToFileURL(path.resolve(inputPath)).href;

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-web-security",
      "--font-render-hinting=none",
      `--window-size=${width},${height}`
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({
      width,
      height,
      deviceScaleFactor: 1
    });

    await page.goto(fileUrl, {
      waitUntil: ["domcontentloaded", "load"],
      timeout: 30000
    });

    // Lock dimensions
    await page.addStyleTag({
      content: `
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          width: ${width}px !important;
          height: ${height}px !important;
          overflow: hidden !important;
        }
        #poster, .poster-artboard, #canvas {
          width: ${width}px !important;
          height: ${height}px !important;
          min-width: ${width}px !important;
          min-height: ${height}px !important;
          max-width: ${width}px !important;
          max-height: ${height}px !important;
          overflow: hidden !important;
        }
      `
    });

    // Wait for fonts & images
    await page.evaluate(async () => {
      if (document.fonts) await document.fonts.ready;
      const images = Array.from(document.querySelectorAll("img"));
      await Promise.all(
        images.map(img => {
          if (img.complete) return Promise.resolve();
          return new Promise(res => {
            img.onload = res;
            img.onerror = res;
          });
        })
      );
    });

    const result = await auditPosterLayout(page, { debugBoxes: options.debugBoxes });
    return result;
  } finally {
    await browser.close();
  }
}
