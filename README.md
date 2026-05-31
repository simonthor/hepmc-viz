# HepMC Visualizer

VS Code extension for viewing HepMC3 ASCII event files (`.hepmc`, `.hepmc3`).

## Features

- Opens HepMC files in a custom editor
- Shows one event at a time with next/previous navigation
- Supports pan and zoom
- Right-click in the graph to save the current event as SVG
- Shows particle hover tooltips with:
  - name
  - PDG ID
  - status
  - mass
  - 4-momentum

## Supported input

The parser handles the common HepMC3 ASCII records used in this project:

- `E` event headers
- `U` units
- `W` event weights
- `A` attributes
- `P` particles
- `V` vertices

## Architecture

- `src/common/` contains the portable HepMC parser, PDG lookup, and render-model preparation.
- `src/webview/` contains the browser-side renderer.
- `src/extension.ts` contains the VS Code custom editor host layer.

## Build

```bash
npm install
npm run build
```

## Notes

- The UI is intentionally browser-native so it can be reused in a standalone website later.
- `d3-selection` and `d3-zoom` are used for the lightweight interactive view layer.
