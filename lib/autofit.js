/**
 * Posterframes Auto-Fit Engine
 * Automatically scales font size inside elements with [data-fit] using binary search,
 * ensuring text fills its container box without overflowing.
 */

/**
 * Client-side script string that can be evaluated in Puppeteer or embedded in preview HTML.
 */
export const AUTOFIT_CLIENT_SCRIPT = `
(() => {
  function applyPosterframesDataFit() {
    const elements = document.querySelectorAll("[data-fit]");
    if (!elements || elements.length === 0) return [];

    const results = [];

    elements.forEach((el, idx) => {
      const mode = (el.getAttribute("data-fit") || "both").toLowerCase(); // "both", "width", "height", "box"
      const minSize = parseFloat(el.getAttribute("data-fit-min") || "8");
      const maxSize = parseFloat(el.getAttribute("data-fit-max") || "400");
      
      const comp = window.getComputedStyle(el);
      const padLeft = parseFloat(comp.paddingLeft) || 0;
      const padRight = parseFloat(comp.paddingRight) || 0;
      const padTop = parseFloat(comp.paddingTop) || 0;
      const padBottom = parseFloat(comp.paddingBottom) || 0;

      // Find all text elements to receive the computed font size
      const textChildren = el.querySelectorAll("p, span, h1, h2, h3, h4, h5, h6, blockquote, a, div.text-node");
      const targets = textChildren.length > 0 ? Array.from(textChildren) : [el];

      const isLeaf = el.children.length === 0;
      const parent = el.parentElement;

      // Determine measurement function for overflow
      let checkOverflow;

      if (isLeaf && (!comp.height || comp.height === "auto" || parseFloat(comp.height) === 0) && parent) {
        // Heading / text fitting inside its parent boundary
        const parentComp = window.getComputedStyle(parent);
        const parentPadX = (parseFloat(parentComp.paddingLeft) || 0) + (parseFloat(parentComp.paddingRight) || 0);
        const parentPadY = (parseFloat(parentComp.paddingTop) || 0) + (parseFloat(parentComp.paddingBottom) || 0);
        const maxW = parent.clientWidth - parentPadX;
        const maxH = parent.clientHeight - parentPadY;

        checkOverflow = () => {
          if (mode === "width") {
            return el.scrollWidth > maxW + 1.5;
          } else if (mode === "height") {
            return maxH > 0 && el.scrollHeight > maxH + 1.5;
          } else {
            return (el.scrollWidth > maxW + 1.5) || (maxH > 0 && el.scrollHeight > maxH + 1.5);
          }
        };
      } else {
        // Container box fitting its own inner contents
        checkOverflow = () => {
          const clientW = el.clientWidth;
          const clientH = el.clientHeight;
          const scrollW = el.scrollWidth;
          const scrollH = el.scrollHeight;

          if (mode === "width") {
            return scrollW > clientW + 1.5;
          } else if (mode === "height") {
            return clientH > 0 && scrollH > clientH + 1.5;
          } else {
            const overW = scrollW > clientW + 1.5;
            const overH = clientH > 0 && scrollH > clientH + 1.5;
            return overW || overH;
          }
        };
      }

      let low = minSize;
      let high = maxSize;
      let optimal = low;

      // Binary search over 16 iterations gives sub-pixel precision
      for (let i = 0; i < 16; i++) {
        const mid = (low + high) / 2;
        el.style.fontSize = mid + "px";
        targets.forEach((t) => {
          t.style.fontSize = mid + "px";
        });

        if (checkOverflow()) {
          high = mid; // Overflows -> try smaller
        } else {
          optimal = mid; // Fits -> try larger
          low = mid;
        }
      }

      const finalSize = Math.floor(optimal * 10) / 10;
      el.style.fontSize = finalSize + "px";
      targets.forEach((t) => {
        t.style.fontSize = finalSize + "px";
      });

      const idOrClass = el.id ? "#" + el.id : el.className ? "." + el.className.trim().split(/\\s+/)[0] : "box-" + idx;
      results.push({
        element: idOrClass,
        fontSize: finalSize,
        mode: mode
      });
    });

    return results;
  }

  // Expose on window for runtime calls
  window.__posterframesApplyDataFit = applyPosterframesDataFit;

  // Run automatically when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyPosterframesDataFit);
  } else {
    applyPosterframesDataFit();
  }
})();
`;

export const AUTOFIT_SCRIPT_TAG = `<script>${AUTOFIT_CLIENT_SCRIPT}</script>`;
