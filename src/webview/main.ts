import { select } from "d3-selection";
import { zoom, type D3ZoomEvent } from "d3-zoom";
import type { RenderEvent, RenderNode, RenderVertexNode, ViewerState } from "../common/types.js";
import { formatParticleLabel, formatParticleTooltipWithUnit } from "../common/hepmc.js";

declare global {
  interface Window {
    __HEPMC_INITIAL_STATE__?: ViewerState;
  }

  const MathJax:
    | {
        typesetPromise: (elements?: HTMLElement[]) => Promise<void>;
      }
    | undefined;
}

interface WebviewMessage {
  type: "update";
  state: ViewerState;
  currentIndex?: number;
}

interface SelectionMessage {
  type: "selection";
  index: number;
}

interface SaveSvgMessage {
  type: "saveSvg";
}

const vscode = acquireVsCodeApi();
const root = document.getElementById("app")!;

let state = window.__HEPMC_INITIAL_STATE__;
let currentIndex = 0;

render();

window.addEventListener("message", (event: MessageEvent<WebviewMessage>) => {
  const message = event.data;
  if (message.type === "update") {
    state = message.state;
    currentIndex = Math.min(message.currentIndex ?? currentIndex, Math.max(0, state.events.length - 1));
    render();
  }
});

async function mathJaxTypeset(elements?: HTMLElement[]): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (typeof MathJax !== "undefined") {
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (typeof MathJax !== "undefined") {
    try {
      await MathJax.typesetPromise(elements);
    } catch {
      // MathJax typesetting failed silently
    }
  }
}

function render(): void {
  document.querySelectorAll(".hepmc-tooltip").forEach((node) => node.remove());
  document.querySelectorAll(".hepmc-context-menu").forEach((node) => node.remove());
  root.replaceChildren();

  const viewerState = state;
  if (!viewerState || viewerState.events.length === 0) {
    root.appendChild(createEmptyState());
    return;
  }

  const shell = document.createElement("div");
  shell.style.width = "100%";
  shell.style.height = "100%";
  shell.style.display = "grid";
  shell.style.gridTemplateRows = "auto 1fr";
  shell.style.background = "var(--vscode-editor-background)";
  shell.style.color = "var(--vscode-editor-foreground)";
  root.appendChild(shell);

  const toolbar = document.createElement("div");
  toolbar.style.display = "flex";
  toolbar.style.alignItems = "center";
  toolbar.style.gap = "0.5rem";
  toolbar.style.padding = "0.5rem 0.75rem";
  toolbar.style.borderBottom = "1px solid var(--vscode-editorWidget-border)";
  toolbar.style.background = "var(--vscode-sideBar-background)";

  const prev = document.createElement("button");
  prev.textContent = "Previous";
  prev.disabled = currentIndex <= 0;
  prev.onclick = () => {
    currentIndex = Math.max(0, currentIndex - 1);
    render();
  };

  const next = document.createElement("button");
  next.textContent = "Next";
  next.disabled = currentIndex >= viewerState.events.length - 1;
  next.onclick = () => {
    currentIndex = Math.min(viewerState.events.length - 1, currentIndex + 1);
    render();
  };

  const counter = document.createElement("span");
  counter.textContent = `${currentIndex + 1} / ${viewerState.events.length}`;

  const title = document.createElement("strong");
  title.textContent = `${viewerState.fileName} — ${viewerState.events[currentIndex].label}`;

  toolbar.append(prev, next, counter, title);
  shell.appendChild(toolbar);

  const canvas = document.createElement("div");
  canvas.style.position = "relative";
  canvas.style.overflow = "hidden";
  shell.appendChild(canvas);

  const tooltip = document.createElement("div");
  tooltip.style.position = "fixed";
  tooltip.style.pointerEvents = "none";
  tooltip.style.display = "none";
  tooltip.style.padding = "0.5rem 0.75rem";
  tooltip.style.borderRadius = "6px";
  tooltip.style.background = "var(--vscode-editorHoverWidget-background)";
  tooltip.style.border = "1px solid var(--vscode-editorHoverWidget-border)";
  tooltip.style.boxShadow = "0 4px 12px rgba(0,0,0,0.3)";
  tooltip.style.whiteSpace = "pre";
  tooltip.style.zIndex = "1000";
  tooltip.className = "hepmc-tooltip";
  document.body.appendChild(tooltip);
  const contextMenu = createContextMenu();
  document.body.appendChild(contextMenu);

  const event = viewerState.events[currentIndex];
  const { svg, labels } = createSvg(canvas, event, tooltip, contextMenu);
  canvas.appendChild(svg);
  void mathJaxTypeset(labels);
  vscode.postMessage({ type: "selection", index: currentIndex } satisfies SelectionMessage);
}

function createEmptyState(): HTMLElement {
  const container = document.createElement("div");
  container.style.display = "grid";
  container.style.placeItems = "center";
  container.style.height = "100%";
  container.textContent = "No HepMC events found in this file.";
  return container;
}

function createSvg(
  canvas: HTMLElement,
  event: RenderEvent,
  tooltip: HTMLDivElement,
  contextMenu: HTMLDivElement
): { svg: SVGSVGElement; labels: HTMLElement[] } {
  const width = canvas.clientWidth || window.innerWidth;
  const height = canvas.clientHeight || window.innerHeight;
  const bounds = event.bounds;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
  svg.style.width = "100%";
  svg.style.height = "100%";

  const content = document.createElementNS("http://www.w3.org/2000/svg", "g");
  svg.appendChild(content);

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
  marker.setAttribute("id", "arrow");
  marker.setAttribute("markerWidth", "8");
  marker.setAttribute("markerHeight", "8");
  marker.setAttribute("refX", "6");
  marker.setAttribute("refY", "3");
  marker.setAttribute("orient", "auto");
  const arrowPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  arrowPath.setAttribute("d", "M0,0 L0,6 L6,3 z");
  arrowPath.setAttribute("fill", "currentColor");
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
  svg.appendChild(defs);

  const zoomBehavior = zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.2, 5])
    .on("zoom", (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
      select(content).attr("transform", event.transform.toString());
    });

  select(svg).call(zoomBehavior);

  const positions = new Map(event.nodes.map((node) => [node.id, node]));
  const edgeLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  edgeLayer.setAttribute("fill", "none");
  content.appendChild(edgeLayer);

  const labelDivs: HTMLElement[] = [];

  // Render edges (particles)
  for (const edge of event.edges) {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) {
      continue;
    }

    const src = toAbsPoint(source, bounds.originX, bounds.originY);
    const tgt = toAbsPoint(target, bounds.originX, bounds.originY);
    const midX = (src.x + tgt.x) / 2;

    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");

    // Stroke width proportional to energy
    const energy = edge.particle?.momentum.energy ?? 0;
    const strokeWidth = Math.max(0.5, Math.min(6, energy / 150));

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${src.x} ${src.y} C ${midX} ${src.y}, ${midX} ${tgt.y}, ${tgt.x} ${tgt.y}`);
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-opacity", "0.45");
    path.setAttribute("stroke-width", String(strokeWidth));
    path.setAttribute("marker-end", "url(#arrow)");
    group.appendChild(path);

    // Label — use foreignObject so MathJax can render $...$ LaTeX
    if (edge.particle) {
      const label = formatParticleLabel(edge.particle, event.units?.momentum);
      const labelY = (src.y + tgt.y) / 2;
      const foW = 300;
      const foH = 24;
      const foreign = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
      foreign.setAttribute("x", String(midX - foW / 2));
      foreign.setAttribute("y", String(labelY - 4 - foH / 2));
      foreign.setAttribute("width", String(foW));
      foreign.setAttribute("height", String(foH));
      foreign.setAttribute("overflow", "visible");
      foreign.style.overflow = "visible";
      foreign.style.pointerEvents = "none";

      const div = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
      div.style.cssText = [
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "height:100%",
        "font-size:11px",
        "font-family:sans-serif",
        "color:currentColor",
        "pointer-events:none",
        "white-space:nowrap",
      ].join(";");
      div.textContent = label;
      foreign.appendChild(div);
      group.appendChild(foreign);
      labelDivs.push(div);

      // Tooltip on hover
      const lines = formatParticleTooltipWithUnit(edge.particle, event.units?.momentum);
      const showTooltip = (clientX: number, clientY: number) => {
        tooltip.innerHTML = lines.join("<br>");
        tooltip.style.left = `${clientX + 12}px`;
        tooltip.style.top = `${clientY + 12}px`;
        tooltip.style.display = "block";
      };
      group.addEventListener("mouseenter", (e) => showTooltip(e.clientX, e.clientY));
      group.addEventListener("mousemove", (e) => showTooltip(e.clientX, e.clientY));
      group.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
      });
    }

    edgeLayer.appendChild(group);
  }

  // Render vertex nodes (small dots, skip in:/out: pseudo-nodes)
  const nodeLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  content.appendChild(nodeLayer);

  for (const node of event.nodes) {
    // Skip pseudo-nodes - they are just edge anchors
    if (node.id.startsWith("in:") || node.id.startsWith("out:")) {
      continue;
    }
    const point = toAbsPoint(node, bounds.originX, bounds.originY);

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", String(point.x));
    circle.setAttribute("cy", String(point.y));
    circle.setAttribute("r", "3.5");
    circle.setAttribute("fill", "currentColor");
    circle.setAttribute("stroke", "none");
    nodeLayer.appendChild(circle);
  }

  svg.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    showContextMenu(contextMenu, event.clientX, event.clientY);
  });

  return { svg, labels: labelDivs };
}

function toAbsPoint(node: { x: number; y: number }, originX: number, originY: number): { x: number; y: number } {
  return {
    x: originX + node.x,
    y: originY + node.y
  };
}

function createContextMenu(): HTMLDivElement {
  const menu = document.createElement("div");
  menu.className = "hepmc-context-menu";
  menu.style.position = "fixed";
  menu.style.display = "none";
  menu.style.minWidth = "180px";
  menu.style.padding = "4px";
  menu.style.border = "1px solid var(--vscode-editorWidget-border)";
  menu.style.borderRadius = "6px";
  menu.style.background = "var(--vscode-editorHoverWidget-background)";
  menu.style.boxShadow = "0 8px 24px rgba(0,0,0,0.24)";
  menu.style.zIndex = "2000";

  const item = document.createElement("button");
  item.type = "button";
  item.textContent = "Save graph as SVG";
  item.style.display = "block";
  item.style.width = "100%";
  item.style.border = "0";
  item.style.background = "transparent";
  item.style.color = "inherit";
  item.style.textAlign = "left";
  item.style.padding = "6px 10px";
  item.style.cursor = "pointer";
  item.onmouseenter = () => {
    item.style.background = "var(--vscode-list-hoverBackground)";
  };
  item.onmouseleave = () => {
    item.style.background = "transparent";
  };
  item.onclick = () => {
    hideContextMenu(menu);
    vscode.postMessage({ type: "saveSvg" } satisfies SaveSvgMessage);
  };

  menu.appendChild(item);
  document.addEventListener("click", () => hideContextMenu(menu), { once: true });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideContextMenu(menu);
    }
  });

  return menu;
}

function showContextMenu(menu: HTMLDivElement, x: number, y: number): void {
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.style.display = "block";
}

function hideContextMenu(menu: HTMLDivElement): void {
  menu.style.display = "none";
}

declare function acquireVsCodeApi(): {
  postMessage(message: SelectionMessage | WebviewMessage | SaveSvgMessage): void;
};
