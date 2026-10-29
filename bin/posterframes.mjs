#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { renderPoster } from "../lib/renderer.js";
import { startPreviewServer } from "../lib/preview.js";
import { CURATED_FONTS, scanLocalKannadaFonts, getFontSnippet } from "../lib/fonts.js";
import { saveQrToFile } from "../lib/qr.js";
import { lintPoster } from "../lib/linter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const PRESETS_PATH = path.join(ROOT_DIR, "presets.json");
const TEMPLATES_DIR = path.join(ROOT_DIR, "templates");

function loadPresets() {
  return JSON.parse(fs.readFileSync(PRESETS_PATH, "utf-8"));
}

function printHelp() {
  console.log(`
🎨 Posterframes — Agentic Poster & Flyer Design Engine for Antigravity & AI Agents

Usage:
  posterframes <command> [options]

Commands:
  init [name]          Scaffold a new poster project from a template and preset
  render [file]        Render poster HTML to high-resolution PNG or PDF via Chromium
  preview [file]       Launch local live-reloading preview server in browser
  lint [file]          Audit poster layout (box fill ratio, empty bands, safe margins, hierarchy)
  presets              List all supported artboard dimensions & aspect ratios
  templates            List available starter templates
  fonts                List curated web fonts & scanned local system/Nudi fonts
  font:snippet <name>  Print ready-to-paste HTML/CSS font snippet for a font
  qr <data-or-url>     Generate a clean SVG or PNG QR code for the poster

Options:
  --preset, -p <name>  Artboard size preset (default: "aidso-a4" 1131x1600)
  --template, -t <name> Starter template (e.g. "aidso-split-red", "aidso-solid-color-block", "aidso-parchment-overlay")
  --font <name>        Default font to inject during init (e.g. "anek-kannada", "baloo", "nudi")
  --out, -o <path>     Output file path for render (default: "poster.png")
  --scale, -s <num>    DPI scale factor for render (1 = 72-96 DPI, 2 = 2x retina, 3-4 = 300 DPI print)
  --format, -f <fmt>   Render format: "png", "jpeg", or "pdf" (default: "png")
  --width <num>        Override artboard width in pixels (overrides manifest and HTML)
  --height <num>       Override artboard height in pixels (overrides manifest and HTML)
  --port <num>         Preview server port (default: 3000)
  --no-open            Do not automatically open browser on preview
  --help, -h           Show this help message

Examples:
  posterframes init my-event-poster --template aidso-split-red --preset aidso-a4
  posterframes init grama-one-flyer --template recruitment-announcement --font "Anek Kannada"
  posterframes render poster.html --scale 2 --out dist/event-flyer.png
  posterframes fonts
  posterframes font:snippet "Baloo Tamma 2"
`);
}

async function handleInit(args, options) {
  const targetDirName = args[0] || "my-poster";
  const targetDir = path.resolve(process.cwd(), targetDirName);
  const selectedTemplate = options.template || "aidso-split-red";
  const selectedPreset = options.preset || "aidso-a4";
  const selectedFont = options.font;

  const templateSrc = path.join(TEMPLATES_DIR, selectedTemplate);
  if (!fs.existsSync(templateSrc)) {
    console.error(`❌ Template not found: "${selectedTemplate}"`);
    console.log(`Available templates: ${fs.readdirSync(TEMPLATES_DIR).join(", ")}`);
    process.exit(1);
  }

  const presets = loadPresets();
  const presetConfig = presets[selectedPreset];
  if (!presetConfig) {
    console.error(`❌ Unknown preset: "${selectedPreset}"`);
    console.log(`Run "posterframes presets" to see valid sizes.`);
    process.exit(1);
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Copy template assets if they exist
  const templateAssetsDir = path.join(templateSrc, "assets");
  const targetAssetsDir = path.join(targetDir, "assets");
  if (fs.existsSync(templateAssetsDir)) {
    fs.cpSync(templateAssetsDir, targetAssetsDir, { recursive: true });
  }

  let templateHtml = fs.readFileSync(path.join(templateSrc, "poster.html"), "utf-8");

  // Adjust dimensions for preset if different
  templateHtml = templateHtml
    .replace(/data-width="\d+"/g, `data-width="${presetConfig.width}"`)
    .replace(/data-height="\d+"/g, `data-height="${presetConfig.height}"`)
    .replace(/data-preset="[^"]*"/g, `data-preset="${selectedPreset}"`)
    .replace(/width:\s*\d+px;/g, `width: ${presetConfig.width}px;`)
    .replace(/height:\s*\d+px;/g, `height: ${presetConfig.height}px;`);

  // Inject font snippet if requested
  if (selectedFont) {
    const fontInfo = getFontSnippet(selectedFont);
    if (fontInfo) {
      if (templateHtml.includes("</head>")) {
        templateHtml = templateHtml.replace(
          "</head>",
          `  <!-- Injected Font: ${selectedFont} -->\n  ${fontInfo.htmlSnippet}\n</head>`
        );
      }
      console.log(`🔤 Injected font: "${fontInfo.font.name}" (${fontInfo.type})`);
    } else {
      console.warn(`⚠️ Font "${selectedFont}" not found in registry. Using template default.`);
    }
  }

  fs.writeFileSync(path.join(targetDir, "poster.html"), templateHtml);

  // Write a posterframes.json manifest
  const manifest = {
    name: targetDirName,
    template: selectedTemplate,
    preset: selectedPreset,
    font: selectedFont || "default",
    width: presetConfig.width,
    height: presetConfig.height,
    ratio: presetConfig.ratio,
    createdAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(targetDir, "posterframes.json"), JSON.stringify(manifest, null, 2));

  console.log(`\n✨ Poster project created successfully at: ${targetDir}`);
  console.log(`📐 Preset: ${selectedPreset} (${presetConfig.width}x${presetConfig.height} px, ${presetConfig.ratio})`);
  console.log(`🎨 Template: ${selectedTemplate}`);
  console.log(`\nNext steps:`);
  console.log(`  1. cd ${targetDirName}`);
  console.log(`  2. posterframes preview poster.html`);
  console.log(`  3. posterframes render poster.html --scale 2 --out poster.png\n`);
}

async function handleRender(args, options) {
  let inputFile = args[0] || "poster.html";
  if (!fs.existsSync(inputFile)) {
    if (fs.existsSync(path.join(process.cwd(), "poster.html"))) {
      inputFile = path.join(process.cwd(), "poster.html");
    } else {
      console.error(`❌ Poster HTML file not found: ${inputFile}`);
      process.exit(1);
    }
  }

  const format = options.format || (options.out?.endsWith(".pdf") ? "pdf" : "png");
  const defaultExt = format === "pdf" ? ".pdf" : ".png";
  const outputFile = options.out || path.join(path.dirname(inputFile), `rendered-poster${defaultExt}`);
  const scale = Number(options.scale || (format === "pdf" ? 1 : 2));

  console.log(`⏳ Rendering poster with local Chromium engine...`);
  console.log(`   Source: ${inputFile}`);
  console.log(`   Target: ${outputFile} (scale: ${scale}x, format: ${format})`);

  try {
    const result = await renderPoster({
      input: inputFile,
      output: outputFile,
      scale,
      format,
      width: options.width ? Number(options.width) : undefined,
      height: options.height ? Number(options.height) : undefined
    });

    console.log(`\n✅ Render completed successfully!`);
    console.log(`🖼️  File: ${result.output}`);
    console.log(`📏 Dimensions: ${result.width * result.scale} x ${result.height * result.scale} px`);
    console.log(`📦 Size: ${(result.sizeBytes / 1024).toFixed(1)} KB\n`);
  } catch (err) {
    console.error(`\n❌ Render failed:`, err.message);
    process.exit(1);
  }
}

async function handlePreview(args, options) {
  let target = args[0] || "poster.html";
  if (!fs.existsSync(target)) {
    if (fs.existsSync(path.join(process.cwd(), "poster.html"))) {
      target = path.join(process.cwd(), "poster.html");
    } else {
      console.error(`❌ Poster target not found: ${target}`);
      process.exit(1);
    }
  }

  const port = Number(options.port || 3000);
  const autoOpen = options.open !== false;
  startPreviewServer(target, port, autoOpen);
}

function handlePresets() {
  const presets = loadPresets();
  console.log(`\n📐 Supported Poster & Flyer Dimensions:\n`);
  console.log(
    `${"Preset Name".padEnd(24)} | ${"Dimensions".padEnd(16)} | ${"Ratio".padEnd(10)} | Description`
  );
  console.log("-".repeat(88));
  for (const [key, val] of Object.entries(presets)) {
    console.log(
      `${key.padEnd(24)} | ${(val.width + "x" + val.height + " px").padEnd(16)} | ${val.ratio.padEnd(10)} | ${val.description}`
    );
  }
  console.log();
}

function handleTemplates() {
  console.log(`\n🎨 Available Starter Templates:\n`);
  const dirs = fs.readdirSync(TEMPLATES_DIR);
  for (const dir of dirs) {
    console.log(`  • ${dir}`);
  }
  console.log(`\nUse with: posterframes init <name> --template <template-name>\n`);
}

function handleFonts() {
  console.log(`\n🔤 Curated Google Fonts for Posters:\n`);
  console.log(`--- Kannada Typography ---`);
  for (const f of CURATED_FONTS.kannada) {
    console.log(`  • ${f.name.padEnd(20)} [${f.category}] — ${f.description}`);
  }

  console.log(`\n--- English / Display Typography ---`);
  for (const f of CURATED_FONTS.english) {
    console.log(`  • ${f.name.padEnd(20)} [${f.category}]`);
  }

  console.log(`\n💻 Local System & Nudi Fonts Detected:\n`);
  const local = scanLocalKannadaFonts();
  if (local.length === 0) {
    console.log(`  (No local Kannada/Nudi fonts found in system font directory)`);
  } else {
    const nudiList = local.filter((f) => f.isNudi);
    const otherList = local.filter((f) => !f.isNudi);

    console.log(`  Found ${nudiList.length} Nudi fonts installed locally:`);
    console.log(`  Samples: ${nudiList.slice(0, 8).map((f) => f.name).join(", ")}...`);
    if (otherList.length > 0) {
      console.log(`  Other Kannada/Indic fonts: ${otherList.map((f) => f.name).join(", ")}`);
    }
  }

  console.log(`\nTo get font snippet for any font: posterframes font:snippet <font-name>\n`);
}

function handleFontSnippet(args) {
  const fontName = args[0];
  if (!fontName) {
    console.error("Please specify a font name, e.g. posterframes font:snippet 'Anek Kannada'");
    process.exit(1);
  }

  const snippet = getFontSnippet(fontName);
  if (!snippet) {
    console.error(`Font "${fontName}" not found in curated list or local fonts.`);
    process.exit(1);
  }

  console.log(`\n🔤 Font Snippet for "${snippet.font.name}":\n`);
  console.log(`HTML Inclusion:`);
  console.log(snippet.htmlSnippet);
  console.log(`\nCSS Family:`);
  console.log(snippet.cssSnippet);
  console.log();
}

async function handleQr(args, options) {
  const data = args[0];
  if (!data) {
    console.error("Please provide data or a URL for the QR code, e.g. posterframes qr 'https://example.com'");
    process.exit(1);
  }

  const outPath = options.out || "qr.svg";
  console.log(`Generating QR code for: ${data}`);
  const savedPath = await saveQrToFile(data, outPath);
  console.log(`✅ Saved QR code to: ${savedPath}\n`);
}

async function handleLint(args, options) {
  let inputFile = args[0] || "poster.html";
  if (!fs.existsSync(inputFile)) {
    if (fs.existsSync(path.join(process.cwd(), "poster.html"))) {
      inputFile = path.join(process.cwd(), "poster.html");
    } else {
      console.error(`❌ Poster HTML file not found: ${inputFile}`);
      process.exit(1);
    }
  }

  console.log(`\n🔍 Running Posterframes Layout Linter...`);
  console.log(`📁 Target: ${inputFile}`);

  try {
    const result = await lintPoster(inputFile, {
      width: options.width ? Number(options.width) : undefined,
      height: options.height ? Number(options.height) : undefined
    });

    console.log(`📐 Canvas: ${result.width}×${result.height} px (1u = ${result.u}px, from ${result.source})\n`);

    let failureCount = 0;
    let passCount = 0;

    for (const check of result.checks) {
      if (check.status === "FAIL") {
        failureCount++;
        console.log(`\x1b[31m[FAIL]\x1b[0m ${check.message}`);
      } else if (check.status === "PASS") {
        passCount++;
        console.log(`\x1b[32m[PASS]\x1b[0m ${check.message}`);
      } else {
        console.log(`\x1b[33m[INFO]\x1b[0m ${check.message}`);
      }
    }

    console.log(`\n------------------------------------------------------------`);
    if (failureCount > 0) {
      console.error(`\x1b[31m❌ Lint failed with ${failureCount} error(s).\x1b[0m Fix issues to ensure professional composition.\n`);
      process.exit(1);
    } else {
      console.log(`\x1b[32m✅ All ${passCount} layout checks passed cleanly! Poster is production-ready.\x1b[0m\n`);
      process.exit(0);
    }
  } catch (err) {
    console.error(`\n❌ Linter execution failed:`, err.message);
    process.exit(1);
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      preset: { type: "string", short: "p" },
      template: { type: "string", short: "t" },
      font: { type: "string" },
      out: { type: "string", short: "o" },
      scale: { type: "string", short: "s" },
      format: { type: "string", short: "f" },
      width: { type: "string" },
      height: { type: "string" },
      port: { type: "string" },
      open: { type: "boolean", default: true },
      help: { type: "boolean", short: "h" }
    },
    allowPositionals: true
  });

  const command = positionals[0];
  const commandArgs = positionals.slice(1);

  if (values.help || !command) {
    printHelp();
    return;
  }

  switch (command) {
    case "init":
      await handleInit(commandArgs, values);
      break;
    case "render":
      await handleRender(commandArgs, values);
      break;
    case "preview":
      await handlePreview(commandArgs, values);
      break;
    case "lint":
      await handleLint(commandArgs, values);
      break;
    case "presets":
      handlePresets();
      break;
    case "templates":
      handleTemplates();
      break;
    case "fonts":
      handleFonts();
      break;
    case "font:snippet":
      handleFontSnippet(commandArgs);
      break;
    case "qr":
      await handleQr(commandArgs, values);
      break;
    default:
      console.error(`Unknown command: "${command}"\n`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
