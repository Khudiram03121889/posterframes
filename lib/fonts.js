import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Curated registry of high-quality fonts for Posterframes,
 * with first-class support for Kannada, English, and regional typography.
 */
export const CURATED_FONTS = {
  kannada: [
    {
      name: "Anek Kannada",
      category: "Bold Headline / Modern",
      weights: ["400", "600", "700", "800"],
      source: "google",
      googleFontUrl: "https://fonts.googleapis.com/css2?family=Anek+Kannada:wght@400;600;700;800&display=swap",
      cssFamily: "'Anek Kannada', sans-serif",
      description: "Extremely punchy, high-impact modern headline font, perfect for big recruitment & event titles."
    },
    {
      name: "Baloo Tamma 2",
      category: "Display / Friendly / Rounded",
      weights: ["500", "700", "800"],
      source: "google",
      googleFontUrl: "https://fonts.googleapis.com/css2?family=Baloo+Tamma+2:wght@500;700;800&display=swap",
      cssFamily: "'Baloo Tamma 2', cursive",
      description: "Vibrant, friendly, rounded display typography for festivals, celebrations, and cultural events."
    },
    {
      name: "Hubballi",
      category: "Handwritten / Calligraphic",
      weights: ["400"],
      source: "google",
      googleFontUrl: "https://fonts.googleapis.com/css2?family=Hubballi&display=swap",
      cssFamily: "'Hubballi', cursive",
      description: "Artistic, flowing calligraphic style for poetry, quotes, and cultural literature posters."
    },
    {
      name: "Noto Sans Kannada",
      category: "Clean / Government / Corporate",
      weights: ["400", "600", "700", "900"],
      source: "google",
      googleFontUrl: "https://fonts.googleapis.com/css2?family=Noto+Sans+Kannada:wght@400;600;700;900&display=swap",
      cssFamily: "'Noto Sans Kannada', sans-serif",
      description: "Rock-solid, highly readable civic/governmental font with complete glyph coverage."
    },
    {
      name: "Noto Serif Kannada",
      category: "Traditional / Editorial / Classical",
      weights: ["400", "600", "700"],
      source: "google",
      googleFontUrl: "https://fonts.googleapis.com/css2?family=Noto+Serif+Kannada:wght@400;600;700&display=swap",
      cssFamily: "'Noto Serif Kannada', serif",
      description: "Elegant book serif font suitable for historical, academic, and literary posters."
    }
  ],
  english: [
    {
      name: "Syne",
      category: "Futuristic / Ultra-Wide Display",
      weights: ["700", "800"],
      source: "google",
      googleFontUrl: "https://fonts.googleapis.com/css2?family=Syne:wght@700;800&display=swap",
      cssFamily: "'Syne', sans-serif"
    },
    {
      name: "Plus Jakarta Sans",
      category: "Geometric Sans / Clean UI",
      weights: ["400", "500", "600", "700"],
      source: "google",
      googleFontUrl: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap",
      cssFamily: "'Plus Jakarta Sans', sans-serif"
    },
    {
      name: "Space Grotesk",
      category: "Tech / Monospace Accents",
      weights: ["500", "700"],
      source: "google",
      googleFontUrl: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&display=swap",
      cssFamily: "'Space Grotesk', sans-serif"
    },
    {
      name: "Italiana",
      category: "High-Fashion / Luxury Editorial",
      weights: ["400"],
      source: "google",
      googleFontUrl: "https://fonts.googleapis.com/css2?family=Italiana&display=swap",
      cssFamily: "'Italiana', serif"
    }
  ]
};

/**
 * Scan local machine for installed Nudi and Kannada font files (.ttf, .otf).
 */
export function scanLocalKannadaFonts() {
  const found = [];
  const searchDirs = [];

  if (os.platform() === "win32") {
    searchDirs.push("C:\\Windows\\Fonts");
    if (process.env.LOCALAPPDATA) {
      searchDirs.push(path.join(process.env.LOCALAPPDATA, "Microsoft\\Windows\\Fonts"));
    }
  }

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const lower = file.toLowerCase();
        if (
          lower.includes("nudi") ||
          lower.includes("kannada") ||
          lower.includes("tunga") ||
          lower.includes("kedage") ||
          lower.includes("mallige") ||
          lower.includes("nirmala")
        ) {
          const fullPath = path.join(dir, file);
          const baseName = path.parse(file).name;
          found.push({
            name: baseName,
            fileName: file,
            path: fullPath,
            source: "local-system",
            isNudi: lower.includes("nudi")
          });
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  return found;
}

/**
 * Generate CSS @font-face or <link> snippet for a given font name.
 */
export function getFontSnippet(fontQuery) {
  const query = fontQuery.toLowerCase().trim();

  // 1. Check curated Google Fonts
  for (const list of Object.values(CURATED_FONTS)) {
    for (const f of list) {
      if (f.name.toLowerCase().includes(query)) {
        return {
          type: "google",
          font: f,
          htmlSnippet: `<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link href="${f.googleFontUrl}" rel="stylesheet">`,
          cssSnippet: `font-family: ${f.cssFamily};`
        };
      }
    }
  }

  // 2. Check local fonts (Nudi / System)
  const localFonts = scanLocalKannadaFonts();
  const match = localFonts.find((f) => f.name.toLowerCase().includes(query));
  if (match) {
    const fileUrl = "file:///" + match.path.replace(/\\/g, "/");
    return {
      type: "local",
      font: match,
      htmlSnippet: `<style>\n@font-face {\n  font-family: '${match.name}';\n  src: url('${fileUrl}');\n}\n</style>`,
      cssSnippet: `font-family: '${match.name}', sans-serif;`
    };
  }

  return null;
}
