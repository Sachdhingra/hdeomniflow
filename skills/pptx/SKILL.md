---
name: pptx
description: Create and export Microsoft PowerPoint presentations (.pptx files) from this React app. Use for generating slides, pitch decks, reports, and visual content with text, bullets, tables, and charts.
allowed-tools: Read, Write, Bash
---

# PowerPoint (PPTX) Skill

Generate `.pptx` files from the hdeomniflow app using the `pptxgenjs` library (already installed as a project dependency).

## When to Use

Invoke this skill when the user:
- Asks to export data or content as a PowerPoint / `.pptx` file
- Wants to create a presentation, pitch deck, or slideshow
- Needs slides generated from application data (tables, charts, reports)
- Asks to "download as PowerPoint" or "export to slides"

## Library

Uses **pptxgenjs** (`import PptxGenJS from 'pptxgenjs'`). Docs: https://gitbrent.github.io/PptxGenJS/

## Quick-Start Pattern (React)

```ts
import PptxGenJS from 'pptxgenjs';

export function exportToPptx(title: string, rows: string[][]) {
  const pptx = new PptxGenJS();

  // Title slide
  const titleSlide = pptx.addSlide();
  titleSlide.addText(title, {
    x: 1, y: 1.5, w: 8, h: 1.5,
    fontSize: 36, bold: true, align: 'center',
  });

  // Content slides — one table per slide
  const slide = pptx.addSlide();
  slide.addTable(rows, { x: 0.5, y: 0.5, w: 9, colW: [3, 3, 3] });

  pptx.writeFile({ fileName: `${title}.pptx` });
}
```

Call `pptx.writeFile()` in the browser to trigger a download, or `pptx.writeFile({ fileName })` in Node.

## Slide Types

| Type | How to add |
|------|-----------|
| Title slide | `slide.addText(text, { fontSize: 36, bold: true })` |
| Bullet list | `slide.addText([{text:'Item', options:{bullet:true}}], opts)` |
| Table | `slide.addTable(rows2DArray, opts)` |
| Image | `slide.addImage({ path | data, x, y, w, h })` |
| Chart | `slide.addChart(pptx.ChartType.bar, data, opts)` |

## Styling Defaults for This Project

Use the brand colors where possible:

```ts
const BRAND = { primary: '2563EB', accent: 'F59E0B', text: '1E293B' };
```

Apply with `color: BRAND.primary` inside text/shape options.

## File Placement

Export helpers live in `src/lib/exportPptx.ts`. Import and call from page components or toolbar buttons.

## Common Pitfalls

- `writeFile` is async — always `await` it or chain `.then()`.
- `pptxgenjs` is an ESM/CJS dual package; the Vite bundler handles it automatically.
- Tables expect `{ text, options }` cell objects for per-cell formatting, or plain strings for simple grids.
