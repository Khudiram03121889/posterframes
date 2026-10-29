# 🎨 Posterframes

> An agentic poster, flyer, and banner design engine for Antigravity, Claude Code, and autonomous AI agents. Built with pure HTML/Tailwind, SVG, and Chromium.

Inspired by the philosophy of **Hyperframes** (which treats video as HTML/DOM rendered over time), **Posterframes** treats print posters, social graphics, and digital flyers as declarative HTML/CSS artboards rendered at crisp 4K / 300 DPI print quality.

---

## ✨ Features

- **Declarative Web Tech**: Design using standard Tailwind CSS, modern typography, SVG graphics, and CSS gradients.
- **Multimodal Feedback Loop**: Agents run `posterframes render` and use their vision to inspect the resulting poster, fix layout glitches, and polish designs autonomously.
- **Full Kannada & Regional Font Suite**:
  - Automatically scans and connects with **350+ local Nudi fonts** (`NudiUni01k`, `NudiParijatha`, etc.) and system fonts (`Nirmala UI`).
  - Native integration with curated modern Google Fonts (`Anek Kannada`, `Baloo Tamma 2`, `Hubballi`, `Noto Sans Kannada`, `Noto Serif Kannada`).
  - Chromium's Blink and HarfBuzz engines guarantee 100% accurate conjuncts, vowel signs, and ligatures.
- **Zero Heavy Setup**: Uses your already-installed Chrome or Edge browser—no massive 300MB downloads.
- **Live Preview with Auto-Reload**: Edit code and see updates in your browser immediately.
- **Export Formats**: High-DPI PNGs (retina/4K) and vector-sharp print PDFs.

---

## 🚀 Quick Start

### 1. View Dimensions & Presets

```bash
posterframes presets
```

### 2. Explore Available Fonts

```bash
# View curated web fonts and scanned local Nudi/system fonts
posterframes fonts

# Get ready-to-paste HTML/CSS code snippet for any font
posterframes font:snippet "Baloo Tamma 2"
posterframes font:snippet "NudiUni01k"
```

### 3. Scaffold a New Project

```bash
# Tech summit poster
posterframes init my-poster --template modern-event --preset instagram-story

# Kannada civic/recruitment flyer with Anek Kannada
posterframes init grama-flyer --template recruitment-announcement --preset flyer-a4-portrait --font "Anek Kannada"
```

Available starter templates:
- `modern-event` — Dark-mode tech summit / hackathon / music festival poster.
- `recruitment-announcement` — Civic / job / exam notification flyer with dual-language Kannada & English font support.
- `minimal-editorial` — High-fashion / gallery exhibition / minimalist typography artboard.

### 4. Live Preview in Browser

```bash
cd my-poster
posterframes preview poster.html
```
Opens `http://localhost:3000` with live reloading on any file edit.

### 5. Render to High-Resolution PNG or PDF

```bash
# Render 2x retina PNG (e.g. 2160 x 3840 px for a 1080x1920 artboard)
posterframes render poster.html --scale 2 --out output.png

# Render vector print PDF
posterframes render poster.html --format pdf --out flyer.pdf
```

---

## 🔤 Kannada Typography Guide

| Design Feel | Recommended Font | Ideal For |
| :--- | :--- | :--- |
| **High-Impact Headline** | `Anek Kannada` / `Noto Sans Kannada Black` | Job vacancies, breaking announcements, bold headers |
| **Friendly & Festive** | `Baloo Tamma 2` | Festivals (Rajyotsava, Ugadi, Deepavali), community events |
| **Government & Formal** | `Noto Sans Kannada` / `Nudi Uni 01 K` | Grama One flyers, official notices, scheme announcements |
| **Artistic & Quotes** | `Hubballi` | Poetry, famous quotes (Kuvempu, Da Ra Bendre), invitations |
| **Classical & Literary** | `Noto Serif Kannada` / `Nudi Parijatha` | Literature summits, classical concerts, book launches |
