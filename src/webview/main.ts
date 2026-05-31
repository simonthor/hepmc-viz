import { select } from "d3-selection";
import { zoom, type D3ZoomEvent } from "d3-zoom";
import type { RenderEvent, RenderNode, ViewerState } from "../common/types.js";
import { formatParticleTooltip } from "../common/hepmc.js";

declare global {
  interface Window {
    __HEPMC_INITIAL_STATE__?: ViewerState;
  }
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

function render(): void {
  document.querySelectorAll(".hepmc-tooltip").forEach((node) => node.remove());
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

  const event = viewerState.events[currentIndex];
  const svg = createSvg(canvas, event, tooltip);
  canvas.appendChild(svg);
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

function createSvg(canvas: HTMLElement, event: RenderEvent, tooltip: HTMLDivElement): SVGSVGElement {
  const width = canvas.clientWidth || window.innerWidth;
  const height = canvas.clientHeight || window.innerHeight;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
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
  edgeLayer.setAttribute("stroke", "currentColor");
  edgeLayer.setAttribute("fill", "none");
  edgeLayer.setAttribute("opacity", "0.35");
  content.appendChild(edgeLayer);

  for (const edge of event.edges) {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) {
      continue;
    }

    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const sourcePoint = toAbsPoint(source, width, height);
    const targetPoint = toAbsPoint(target, width, height);
    const midX = (sourcePoint.x + targetPoint.x) / 2;
    line.setAttribute("d", `M ${sourcePoint.x} ${sourcePoint.y} C ${midX} ${sourcePoint.y}, ${midX} ${targetPoint.y}, ${targetPoint.x} ${targetPoint.y}`);
    line.setAttribute("marker-end", "url(#arrow)");
    edgeLayer.appendChild(line);
  }

  const nodeLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  content.appendChild(nodeLayer);

  for (const node of event.nodes) {
    nodeLayer.appendChild(renderNode(node, width, height, tooltip));
  }

  return svg;
}

function renderNode(node: RenderNode, width: number, height: number, tooltip: HTMLDivElement): SVGGElement {
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("transform", `translate(${width / 2 + node.x}, ${height / 2 + node.y})`);

  if (node.kind === "particle") {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("r", "16");
    circle.setAttribute("fill", statusColor(node.particle.status));
    circle.setAttribute("stroke", "var(--vscode-editor-foreground)");
    circle.setAttribute("stroke-width", "1.2");
    group.appendChild(circle);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "central");
    label.setAttribute("font-size", "10");
    label.setAttribute("fill", "var(--vscode-editor-foreground)");
    label.textContent = String(node.particle.pdgId);
    group.appendChild(label);

    const lines = formatParticleTooltip(node.particle);
    const showTooltip = (clientX: number, clientY: number) => {
      tooltip.textContent = lines.join("\n");
      tooltip.style.left = `${clientX + 12}px`;
      tooltip.style.top = `${clientY + 12}px`;
      tooltip.style.display = "block";
    };

    group.addEventListener("mouseenter", (event) => showTooltip(event.clientX, event.clientY));
    group.addEventListener("mousemove", (event) => showTooltip(event.clientX, event.clientY));
    group.addEventListener("mouseleave", () => {
      tooltip.style.display = "none";
    });
  } else {
    const diamond = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    diamond.setAttribute("x", "-8");
    diamond.setAttribute("y", "-8");
    diamond.setAttribute("width", "16");
    diamond.setAttribute("height", "16");
    diamond.setAttribute("fill", "var(--vscode-editorWidget-background)");
    diamond.setAttribute("stroke", "var(--vscode-editor-foreground)");
    diamond.setAttribute("transform", "rotate(45)");
    group.appendChild(diamond);
  }

  return group;
}

function toAbsPoint(node: { x: number; y: number }, width: number, height: number): { x: number; y: number } {
  return {
    x: width / 2 + node.x,
    y: height / 2 + node.y
  };
}

function statusColor(status: number): string {
  if (status <= 0) {
    return "rgba(128, 128, 128, 0.6)";
  }
  if (status === 1) {
    return "rgba(100, 181, 246, 0.8)";
  }
  if (status >= 60) {
    return "rgba(255, 167, 38, 0.8)";
  }
  return "rgba(129, 199, 132, 0.8)";
}

declare function acquireVsCodeApi(): {
  postMessage(message: SelectionMessage | WebviewMessage): void;
};
