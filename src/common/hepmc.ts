import type {
  HepmcEvent,
  HepmcParticle,
  HepmcVertex,
  ParsedHepmcFile,
  RenderEvent,
  RenderNode,
  RenderParticleNode,
  RenderVertexNode,
  ViewerState
} from "./types.js";
import { particleName } from "./pdg.js";

const NUMERIC_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

export function parseHepmcFile(text: string): ParsedHepmcFile {
  const events: HepmcEvent[] = [];
  const warnings: string[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  let current: HepmcEvent | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    if (line.startsWith("E ")) {
      if (current) {
        events.push(current);
      }

      current = parseEventHeader(line, events.length);
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith("U ")) {
      const parts = line.split(/\s+/);
      current.units = {
        momentum: parts[1],
        length: parts[2]
      };
      continue;
    }

    if (line.startsWith("W ")) {
      const value = Number(line.split(/\s+/)[1]);
      if (Number.isFinite(value)) {
        current.weight = value;
      }
      continue;
    }

    if (line.startsWith("A ")) {
      const parts = line.split(/\s+/);
      const key = parts[2];
      if (key) {
        current.attributes[key] = parts.slice(3).join(" ");
      }
      continue;
    }

    if (line.startsWith("P ")) {
      const particle = parseParticleLine(line);
      if (particle) {
        current.particles.push(particle);
      } else {
        warnings.push(`Could not parse particle line: ${line}`);
      }
      continue;
    }

    if (line.startsWith("V ")) {
      const vertex = parseVertexLine(line);
      if (vertex) {
        current.vertices.push(vertex);
      } else {
        warnings.push(`Could not parse vertex line: ${line}`);
      }
      continue;
    }
  }

  if (current) {
    events.push(current);
  }

  return { events, warnings };
}

export function buildViewerState(fileName: string, text: string): ViewerState {
  const parsed = parseHepmcFile(text);
  return {
    fileName,
    events: parsed.events.map((event) => renderEvent(event))
  };
}

function parseEventHeader(line: string, index: number): HepmcEvent {
  const parts = line.split(/\s+/);
  const eventNumber = parseMaybeNumber(parts[1]);
  const declaredParticleCount = parseMaybeNumber(parts[2]);
  const declaredVertexCount = parseMaybeNumber(parts[3]);

  return {
    index,
    eventNumber,
    declaredParticleCount,
    declaredVertexCount,
    attributes: {},
    particles: [],
    vertices: []
  };
}

function parseParticleLine(line: string): HepmcParticle | null {
  const parts = line.split(/\s+/);
  if (parts.length < 9) {
    return null;
  }

  const id = parseMaybeNumber(parts[1]);
  const status = parseMaybeNumber(parts[2]);
  const pdgId = parseMaybeNumber(parts[3]);
  const px = Number(parts[4]);
  const py = Number(parts[5]);
  const pz = Number(parts[6]);
  const energy = Number(parts[7]);
  const mass = Number(parts[8]);

  if (
    id === undefined ||
    status === undefined ||
    pdgId === undefined ||
    !Number.isFinite(px) ||
    !Number.isFinite(py) ||
    !Number.isFinite(pz) ||
    !Number.isFinite(energy)
  ) {
    return null;
  }

  return {
    id,
    status,
    pdgId,
    momentum: {
      px,
      py,
      pz,
      energy,
      mass: Number.isFinite(mass) ? mass : undefined
    },
    rawLine: line
  };
}

function parseVertexLine(line: string): HepmcVertex | null {
  const match = /^V\s+(-?\d+)\s+(-?\d+)\s+\[([^\]]*)\](?:\s+@\s+(.+))?$/.exec(line);
  if (!match) {
    return null;
  }

  const id = Number(match[1]);
  const status = Number(match[2]);
  const particleIds = match[3]
    .split(/[,\s]+/)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  const position = match[4] ? parsePosition(match[4]) : undefined;

  return {
    id,
    status,
    particleIds,
    position,
    rawLine: line
  };
}

function parsePosition(input: string): HepmcVertex["position"] | undefined {
  const values = input
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (values.length < 4) {
    return undefined;
  }

  return {
    x: values[0],
    y: values[1],
    z: values[2],
    t: values[3]
  };
}

function renderEvent(event: HepmcEvent): RenderEvent {
  const nodes: RenderNode[] = [];
  const edges: { source: string; target: string }[] = [];
  const incoming = new Set<number>();
  const outgoing = new Set<number>();

  for (const particle of event.particles) {
    const node: RenderParticleNode = {
      kind: "particle",
      id: particleNodeId(particle.id),
      x: 0,
      y: 0,
      particle
    };
    nodes.push(node);
  }

  for (const vertex of event.vertices) {
    const node: RenderVertexNode = {
      kind: "vertex",
      id: vertexNodeId(vertex.id),
      x: 0,
      y: 0,
      vertex
    };
    nodes.push(node);
  }

  for (const vertex of event.vertices) {
    if (vertex.particleIds.length > 1) {
      const upstream = vertex.particleIds[0];
      const downstream = vertex.particleIds.slice(1);
      incoming.add(upstream);
      for (const id of downstream) {
        outgoing.add(id);
        edges.push({
          source: vertexNodeId(vertex.id),
          target: particleNodeId(id)
        });
      }
      edges.push({
        source: particleNodeId(upstream),
        target: vertexNodeId(vertex.id)
      });
    }
  }

  const upstreamParticles = event.particles.filter((particle) => !incoming.has(particle.id) && !outgoing.has(particle.id));
  const nodeLevels = new Map<string, number>();

  for (const particle of upstreamParticles) {
    nodeLevels.set(particleNodeId(particle.id), 0);
  }

  const sortedNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  for (let pass = 0; pass < sortedNodes.length; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const sourceLevel = nodeLevels.get(edge.source);
      if (sourceLevel === undefined) {
        continue;
      }
      const nextLevel = sourceLevel + 1;
      if ((nodeLevels.get(edge.target) ?? -1) < nextLevel) {
        nodeLevels.set(edge.target, nextLevel);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }

  const grouped = new Map<number, RenderNode[]>();
  for (const node of nodes) {
    const level = nodeLevels.get(node.id) ?? 0;
    const list = grouped.get(level) ?? [];
    list.push(node);
    grouped.set(level, list);
  }

  const levelGap = 180;
  const rowGap = 110;
  let maxX = 0;
  let maxY = 0;

  for (const [level, list] of [...grouped.entries()].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => a.id.localeCompare(b.id));
    list.forEach((node, index) => {
      node.x = level * levelGap;
      node.y = index * rowGap - ((Math.max(1, list.length) - 1) * rowGap) / 2;
      maxX = Math.max(maxX, node.x);
      maxY = Math.max(maxY, Math.abs(node.y));
    });
  }

  return {
    index: event.index,
    label: event.eventNumber !== undefined ? `Event ${event.eventNumber}` : `Event ${event.index + 1}`,
    nodes,
    edges,
    bounds: {
      width: maxX + 220,
      height: maxY * 2 + 220
    }
  };
}

function particleNodeId(id: number): string {
  return `p:${id}`;
}

function vertexNodeId(id: number): string {
  return `v:${id}`;
}

function parseMaybeNumber(value: string | undefined): number | undefined {
  if (!value || !NUMERIC_RE.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function formatParticleTooltip(particle: HepmcParticle): string[] {
  const name = particleName(particle.pdgId);
  return [
    `Name: ${name}`,
    `PDG ID: ${particle.pdgId}`,
    `Status: ${particle.status}`,
    `Mass: ${formatNumber(particle.momentum.mass ?? 0)}`,
    `4-momentum: (${formatNumber(particle.momentum.px)}, ${formatNumber(particle.momentum.py)}, ${formatNumber(particle.momentum.pz)}, ${formatNumber(particle.momentum.energy)})`
  ];
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  if (value === 0) {
    return "0";
  }
  if (Math.abs(value) >= 10000 || Math.abs(value) < 0.001) {
    return value.toExponential(4);
  }
  return Number(value.toFixed(4)).toString();
}

export function renderEventSvg(event: RenderEvent): string {
  const width = Math.max(320, Math.ceil(event.bounds.width));
  const height = Math.max(320, Math.ceil(event.bounds.height));
  const lines: string[] = [];

  lines.push(`<?xml version="1.0" encoding="UTF-8" standalone="no"?>`);
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(event.label)}">`
  );
  lines.push(
    `<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="#666"/></marker></defs>`
  );
  lines.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`);
  lines.push(`<g transform="translate(${width / 2} ${height / 2})">`);

  const positions = new Map(event.nodes.map((node) => [node.id, node]));

  for (const edge of event.edges) {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) {
      continue;
    }

    const sourcePoint = toAbsPoint(source, width, height);
    const targetPoint = toAbsPoint(target, width, height);
    const midX = (sourcePoint.x + targetPoint.x) / 2;
    lines.push(
      `<path d="M ${fmt(sourcePoint.x)} ${fmt(sourcePoint.y)} C ${fmt(midX)} ${fmt(sourcePoint.y)}, ${fmt(midX)} ${fmt(targetPoint.y)}, ${fmt(targetPoint.x)} ${fmt(targetPoint.y)}" fill="none" stroke="#888" stroke-opacity="0.35" marker-end="url(#arrow)"/>`
    );
  }

  for (const node of event.nodes) {
    if (node.kind === "particle") {
      lines.push(renderParticleNodeSvg(node, width, height));
    } else {
      lines.push(renderVertexNodeSvg(node, width, height));
    }
  }

  lines.push(`</g>`);
  lines.push(`</svg>`);
  return lines.join("\n");
}

function renderParticleNodeSvg(node: RenderParticleNode, width: number, height: number): string {
  const point = toAbsPoint(node, width, height);
  const tooltip = formatParticleTooltip(node.particle).join("\n");
  return [
    `<g transform="translate(${fmt(point.x)} ${fmt(point.y)})">`,
    `<circle r="16" fill="${statusColor(node.particle.status)}" stroke="#222" stroke-width="1.2"/>`,
    `<text text-anchor="middle" dominant-baseline="central" font-size="10" fill="#111">${escapeXml(String(node.particle.pdgId))}</text>`,
    `<title>${escapeXml(tooltip)}</title>`,
    `</g>`
  ].join("");
}

function renderVertexNodeSvg(node: RenderVertexNode, width: number, height: number): string {
  const point = toAbsPoint(node, width, height);
  return [
    `<g transform="translate(${fmt(point.x)} ${fmt(point.y)})">`,
    `<rect x="-8" y="-8" width="16" height="16" transform="rotate(45)" fill="#f5f5f5" stroke="#222" stroke-width="1"/>`,
    `<title>Vertex ${escapeXml(String(node.vertex.id))}</title>`,
    `</g>`
  ].join("");
}

function toAbsPoint(node: { x: number; y: number }, width: number, height: number): { x: number; y: number } {
  return {
    x: width / 2 + node.x,
    y: height / 2 + node.y
  };
}

function statusColor(status: number): string {
  if (status <= 0) {
    return "#a0a0a0";
  }
  if (status === 1) {
    return "#64b5f6";
  }
  if (status >= 60) {
    return "#ffa726";
  }
  return "#81c784";
}

function fmt(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "0";
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
