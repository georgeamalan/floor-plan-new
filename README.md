# Floor Plan Editor

Interactive floor plan editor built with React, TypeScript, and Vite.

## Prerequisites

- Node.js 18+ (or newer)
- npm 9+ (or newer)

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the dev server:
   ```bash
   npm run dev
   ```
3. Open the URL shown in the terminal (usually `http://localhost:5173`).

## Build

```bash
npm run build
```

## Preview production build

```bash
npm run preview
```

## Features

- Draw rectangles and polygons on the floor plan.
- Select, multi-select (Shift-click), move, and resize shapes.
- Drag polygon vertices; add polygon points with Alt-click.
- Hold Shift while drawing a polygon to constrain the next segment to horizontal or vertical.
- Snap-to-grid for alignment (toggle in toolbar).
- Pan/zoom with mouse wheel; space+drag or Pan tool.
- Rename, recolor, duplicate, delete areas.
- Divide areas into vertical or horizontal partitions.
- Merge multiple areas (rectangles/polygons) into a single polygon/multipolygon.
- Convert selection to polygon.
- Group selection into named groups.
- Keyboard controls: Delete to remove, arrow keys to nudge (Shift+arrow = 10px).
- Copy/paste areas with Cmd/Ctrl+C and Cmd/Ctrl+V.
- Context menu (right-click/long-press) for quick actions: rename, divide, duplicate, merge, group, convert.
- Undo/redo (Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z) and toolbar buttons.
- Export/import plan JSON.
- Boundary resizing handles for the canvas size.
- "Available" space shading for unused canvas area.
- Unselected areas rendered with engineering-style hatch.

## How to use

### Create and edit areas

- Choose Rectangle or Polygon tool from the toolbar, then click/drag on the canvas.
- Select shapes by clicking; Shift-click to multi-select.
- Drag to move; use handles to resize rectangles.
- For polygons, drag vertices to adjust; Alt-click an edge to insert a point.

### Duplicate and organize

- Right-click (or long-press) an area for quick actions.
- Use Duplicate to copy a selected area.
- Group multiple areas to manage them together.

### Align and navigate

- Toggle Snap-to-grid in the toolbar for alignment.
- Mouse wheel to zoom; space+drag or Pan tool to pan.

### Merge and convert

- Select multiple areas and use Merge to create a single polygon/multipolygon.
- Use Convert to polygon for selected rectangles.

### Export and import

- Use the export/import controls to save or load plan JSON.

### Keyboard shortcuts

- Copy: Command + C (macOS) or Control + C (Windows/Linux).
- Paste: Command + V (macOS) or Control + V (Windows/Linux).
- Undo: Command + Z or Control + Z.
- Redo: Shift + Command + Z or Shift + Control + Z.
- Nudge: Arrow keys (Shift + Arrow = 10px).
- Delete: Delete/Backspace.
