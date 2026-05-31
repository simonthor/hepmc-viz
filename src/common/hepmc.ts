import type {
  HepmcEvent,
  HepmcParticle,
  HepmcVertex,
  ParsedHepmcFile,
  RenderEvent,
  RenderNode,
  RenderVertexNode,
  RenderEdge,
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
  if (parts.length < 10) {
    return null;
  }

  const id = parseMaybeNumber(parts[1]);
  const prodVtxId = parseMaybeNumber(parts[2]);
  const pdgId = parseMaybeNumber(parts[3]);
  const px = Number(parts[4]);
  const py = Number(parts[5]);
  const pz = Number(parts[6]);
  const energy = Number(parts[7]);
  const mass = Number(parts[8]);
  const status = parseMaybeNumber(parts[9]);

  if (
    id === undefined ||
    prodVtxId === undefined ||
    pdgId === undefined ||
    status === undefined ||
    !Number.isFinite(px) ||
    !Number.isFinite(py) ||
    !Number.isFinite(pz) ||
    !Number.isFinite(energy)
  ) {
    return null;
  }

  return {
    id,
    productionVertexId: prodVtxId,
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
    outgoingParticleIds: [],
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
  // Step 1: Build map of particle → end vertex from V lines
  const particleEndVtx = new Map<number, number>();
  for (const vtx of event.vertices) {
    for (const pid of vtx.particleIds) {
      particleEndVtx.set(pid, vtx.id);
    }
  }

  // Step 2: Find implicit vertex relationships
  // A particle with productionVertexId > 0 has a parent particle.
  // The implicit vertex sits between parent and child.
  const parentToChildren = new Map<number, number[]>();
  for (const p of event.particles) {
    if (p.productionVertexId > 0) {
      const parentId = p.productionVertexId;
      if (!parentToChildren.has(parentId)) {
        parentToChildren.set(parentId, []);
      }
      parentToChildren.get(parentId)!.push(p.id);
    }
  }

  // Step 3: Assign IDs to implicit vertices (non-overlapping with explicit vertex IDs)
  const explicitVtxIds = new Set(event.vertices.map((v) => v.id));
  const parentToImpVtxId = new Map<number, number>();
  let impId = 1;
  for (const parentId of parentToChildren.keys()) {
    while (explicitVtxIds.has(-impId)) {
      impId++;
    }
    const vtxId = -impId;
    impId++;
    parentToImpVtxId.set(parentId, vtxId);
  }

  // Step 4: Build the set of vertex nodes
  const nodes: RenderNode[] = [];
  const vertexNodes = new Map<string, RenderVertexNode>();
  const inPseudo = new Set<number>();
  const outPseudo = new Set<number>();

  // Collect all unique vertex IDs referenced by particles
  const neededVtxIds = new Set<number>();

  // Explicit vertices
  for (const vtx of event.vertices) {
    neededVtxIds.add(vtx.id);
  }

  // Implicit vertices
  for (const vtxId of parentToImpVtxId.values()) {
    neededVtxIds.add(vtxId);
  }

  // Create vertex render nodes
  for (const vtxId of neededVtxIds) {
    const isExplicit = event.vertices.find((v) => v.id === vtxId);
    if (isExplicit) {
      const node: RenderVertexNode = {
        kind: "vertex",
        id: vertexNodeId(vtxId),
        x: 0,
        y: 0,
        vertex: isExplicit
      };
      nodes.push(node);
      vertexNodes.set(node.id, node);
    } else {
      // Find which parent particle creates this implicit vertex
      let parentId = 0;
      for (const [pid, vid] of parentToImpVtxId) {
        if (vid === vtxId) {
          parentId = pid;
          break;
        }
      }
      const children = parentToChildren.get(parentId) || [];
      const impVtx: HepmcVertex = {
        id: vtxId,
        status: 0,
        particleIds: [parentId],
        outgoingParticleIds: children,
        rawLine: `# Implicit vertex for particle ${parentId}`
      };
      const node: RenderVertexNode = {
        kind: "vertex",
        id: vertexNodeId(vtxId),
        x: 0,
        y: 0,
        vertex: impVtx
      };
      nodes.push(node);
      vertexNodes.set(node.id, node);
    }
  }

  // Step 5: Build edges (each particle becomes one edge from start to end vertex)
  const edges: RenderEdge[] = [];
  const seenStartVtx = new Set<string>();
  const seenEndVtx = new Set<string>();

  for (const p of event.particles) {
    // Determine start vertex
    let startId: string;
    if (p.productionVertexId === 0) {
      startId = `in:${p.id}`;
      inPseudo.add(p.id);
    } else if (p.productionVertexId > 0) {
      const impVtxId = parentToImpVtxId.get(p.productionVertexId);
      if (impVtxId === undefined) {
        startId = `in:${p.id}`;
        inPseudo.add(p.id);
      } else {
        startId = vertexNodeId(impVtxId);
      }
    } else {
      startId = vertexNodeId(p.productionVertexId);
    }

    // Determine end vertex
    let endId: string;
    if (particleEndVtx.has(p.id)) {
      endId = vertexNodeId(particleEndVtx.get(p.id)!);
    } else if (parentToImpVtxId.has(p.id)) {
      endId = vertexNodeId(parentToImpVtxId.get(p.id)!);
    } else {
      endId = `out:${p.id}`;
      outPseudo.add(p.id);
    }

    edges.push({
      source: startId,
      target: endId,
      particle: p
    });
  }

  // Step 6: Topological sort to compute depth of each vertex node
  // in* pseudo-nodes are at depth 0
  // out* pseudo-nodes get depth after all other nodes
  const depth = new Map<string, number>();

  // Initialize depths
  for (const id of inPseudo) {
    depth.set(`in:${id}`, 0);
  }
  for (const node of nodes) {
    depth.set(node.id, 0);
  }

  // Iterative depth assignment
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      const srcDepth = depth.get(edge.source);
      const tgtDepth = depth.get(edge.target);
      if (srcDepth !== undefined && tgtDepth !== undefined) {
        const newDepth = srcDepth + 1;
        if (tgtDepth < newDepth) {
          depth.set(edge.target, newDepth);
          changed = true;
        }
      }
    }
  }

  // Assign depth for out* pseudo-nodes: place them all at max vertex depth + 1
  const maxVertexDepth = Math.max(0, ...[...depth.entries()]
    .filter(([k]) => !k.startsWith("in:") && !k.startsWith("out:"))
    .map(([, v]) => v));
  for (const id of outPseudo) {
    depth.set(`out:${id}`, maxVertexDepth + 1);
  }

  // Step 7: Compute Y positions using layered DAG layout
  const yPositions = new Map<string, number>();
  const nodesAtDepth = new Map<number, string[]>();

  for (const [id, d] of depth) {
    if (!nodesAtDepth.has(d)) {
      nodesAtDepth.set(d, []);
    }
    nodesAtDepth.get(d)!.push(id);
  }

  const sortedDepths = [...nodesAtDepth.keys()].sort((a, b) => a - b);
  const levelGap = 180;
  const rowGap = 100;

  // Initialize y to 0 for all nodes
  for (const id of depth.keys()) {
    yPositions.set(id, 0);
  }

  // Group edges by target (incoming) and source (outgoing)
  const incomingEdges = new Map<string, RenderEdge[]>();
  const outgoingEdges = new Map<string, RenderEdge[]>();
  for (const edge of edges) {
    if (!incomingEdges.has(edge.target)) {
      incomingEdges.set(edge.target, []);
    }
    incomingEdges.get(edge.target)!.push(edge);
    if (!outgoingEdges.has(edge.source)) {
      outgoingEdges.set(edge.source, []);
    }
    outgoingEdges.get(edge.source)!.push(edge);
  }

  // Forward pass: compute y for non-pseudo vertex nodes
  for (const d of sortedDepths) {
    if (d === 0) continue;
    const nodesHere = nodesAtDepth.get(d) || [];
    for (const nodeId of nodesHere) {
      if (nodeId.startsWith("in:") || nodeId.startsWith("out:")) continue;
      const inEdges = incomingEdges.get(nodeId) || [];
      const srcYs = inEdges
        .map((e) => yPositions.get(e.source))
        .filter((y): y is number => y !== undefined);
      if (srcYs.length > 0) {
        const avgY = srcYs.reduce((a, b) => a + b, 0) / srcYs.length;
        yPositions.set(nodeId, avgY);
      }
    }
  }

  // Spread vertex nodes within each depth to avoid overlaps
  for (const d of sortedDepths) {
    const nodesHere = nodesAtDepth.get(d) || [];
    const realNodes = nodesHere.filter((n) => !n.startsWith("in:") && !n.startsWith("out:"));
    if (realNodes.length <= 1) continue;

    const sortedReal = [...realNodes].sort(
      (a, b) => (yPositions.get(a) ?? 0) - (yPositions.get(b) ?? 0)
    );
    const yValues = sortedReal.map((id) => yPositions.get(id) ?? 0);

    const adjusted = [...yValues];
    for (let i = 1; i < adjusted.length; i++) {
      if (adjusted[i] - adjusted[i - 1] < rowGap) {
        adjusted[i] = adjusted[i - 1] + rowGap;
      }
    }

    const origAvg = yValues.reduce((a, b) => a + b, 0) / yValues.length;
    const newAvg = adjusted.reduce((a, b) => a + b, 0) / adjusted.length;
    const shift = origAvg - newAvg;
    const finalYs = adjusted.map((y) => y + shift);

    for (let i = 0; i < sortedReal.length; i++) {
      yPositions.set(sortedReal[i], finalYs[i]);
    }
  }

  // Compute y for in-nodes (depth 0): align with the centroid of their targets at depth 1
  for (const id of inPseudo) {
    const key = `in:${id}`;
    const outEdges = outgoingEdges.get(key) || [];
    const tgtYs = outEdges
      .map((e) => yPositions.get(e.target))
      .filter((y): y is number => y !== undefined);
    if (tgtYs.length > 0) {
      yPositions.set(key, tgtYs.reduce((a, b) => a + b, 0) / tgtYs.length);
    }
  }

  // Compute y for out-nodes: fan out per source vertex
  const sourceToOutNodes = new Map<string, string[]>();
  for (const id of outPseudo) {
    const key = `out:${id}`;
    const inEdge = incomingEdges.get(key);
    if (inEdge && inEdge.length > 0) {
      const srcId = inEdge[0].source;
      if (!sourceToOutNodes.has(srcId)) {
        sourceToOutNodes.set(srcId, []);
      }
      sourceToOutNodes.get(srcId)!.push(key);
    }
  }

  const outRawY = new Map<string, number>();
  for (const [srcId, outKeys] of sourceToOutNodes) {
    const srcY = yPositions.get(srcId) ?? 0;
    if (outKeys.length === 1) {
      outRawY.set(outKeys[0], srcY);
    } else {
      const halfSpan = ((outKeys.length - 1) * rowGap) / 2;
      for (let i = 0; i < outKeys.length; i++) {
        outRawY.set(outKeys[i], srcY - halfSpan + i * rowGap);
      }
    }
  }

  // Resolve collisions: sort by raw y, enforce minimum gap
  const sortedOut = [...outRawY.entries()].sort((a, b) => a[1] - b[1]);
  const outMinGap = rowGap * 0.6;
  for (let i = 0; i < sortedOut.length; i++) {
    const [key] = sortedOut[i];
    let finalY = outRawY.get(key) ?? 0;
    if (i > 0) {
      const prevY = yPositions.get(sortedOut[i - 1][0]) ?? 0;
      if (finalY - prevY < outMinGap) {
        finalY = prevY + outMinGap;
      }
    }
    yPositions.set(key, finalY);
  }

  // Step 8: Assign x = depth * levelGap, y from computed positions
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  // Pseudo nodes (in/out) aren't shown as dots, so we include them in layout
  // but we only create actual render nodes for vertices.
  // We'll use the depth/Y maps for edge layout.
  for (const node of nodes) {
    const d = depth.get(node.id) ?? 0;
    const y = yPositions.get(node.id) ?? 0;
    node.x = d * levelGap;
    node.y = y;
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y);
  }

  // We also need to store positions for in/out pseudo-nodes for edge routing
  // We'll add them as vertex nodes with a special marker
  for (const id of inPseudo) {
    const key = `in:${id}`;
    const d = depth.get(key) ?? 0;
    const y = yPositions.get(key) ?? 0;
    const pseudoVtx: HepmcVertex = {
      id: -1000 - id,
      status: 0,
      particleIds: [],
      outgoingParticleIds: [],
      rawLine: `# Beam entry for particle ${id}`
    };
    const node: RenderVertexNode = {
      kind: "vertex",
      id: key,
      x: d * levelGap,
      y,
      vertex: pseudoVtx
    };
    // Store but don't draw as dot (handled in rendering via ID prefix)
    nodes.push(node);
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y);
  }

  for (const id of outPseudo) {
    const key = `out:${id}`;
    const d = depth.get(key) ?? 0;
    const y = yPositions.get(key) ?? 0;
    const pseudoVtx: HepmcVertex = {
      id: -2000 - id,
      status: 0,
      particleIds: [],
      outgoingParticleIds: [],
      rawLine: `# Final state for particle ${id}`
    };
    const node: RenderVertexNode = {
      kind: "vertex",
      id: key,
      x: d * levelGap,
      y,
      vertex: pseudoVtx
    };
    nodes.push(node);
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y);
  }

  // Also adjust depth for nodes that had no depth set
  for (const node of nodes) {
    if (!depth.has(node.id)) {
      node.x = 0;
      node.y = 0;
    }
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = 0;
    minY = 0;
    maxY = 0;
  }

  const paddingX = 160;
  const paddingY = 140;
  const width = Math.max(320, maxX - minX + paddingX * 2);
  const height = Math.max(320, maxY - minY + paddingY * 2);
  const originX = paddingX - minX;
  const originY = paddingY - minY;

  return {
    index: event.index,
    label: event.eventNumber !== undefined ? `Event ${event.eventNumber}` : `Event ${event.index + 1}`,
    units: event.units,
    nodes,
    edges,
    bounds: {
      width,
      height,
      originX,
      originY
    }
  };
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
  return formatParticleTooltipWithUnit(particle, undefined);
}

export function formatParticleTooltipWithUnit(particle: HepmcParticle, momentumUnit?: string): string[] {
  const name = particleName(particle.pdgId);
  const unit = formatMomentumUnit(momentumUnit);
  const momentumText = `4-momentum: (${formatNumber(particle.momentum.px)}, ${formatNumber(particle.momentum.py)}, ${formatNumber(particle.momentum.pz)}, ${formatNumber(particle.momentum.energy)})`;
  return [
    `Name: $${name}$`,
    `PDG ID: ${particle.pdgId}`,
    `Status: ${particle.status}`,
    `Mass: ${formatNumber(particle.momentum.mass ?? 0)}`,
    unit ? `${momentumText} ${unit}` : momentumText
  ];
}

export function formatParticleLabel(particle: HepmcParticle, momentumUnit?: string): string {
  const name = particleName(particle.pdgId);
  const unit = formatMomentumUnit(momentumUnit);
  const label = formatNumber(particle.momentum.energy);
  return unit ? `$${name}~$(${label} ${unit})` : `$${name}~$ (${label})`;
}

function formatMomentumUnit(unit?: string): string {
  if (!unit) {
    return "";
  }
  const normalized = unit.toUpperCase();
  if (normalized === "GEV") {
    return "GeV";
  }
  if (normalized === "MEV") {
    return "MeV";
  }
  if (normalized === "TEV") {
    return "TeV";
  }
  return unit;
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
  const originX = event.bounds.originX;
  const originY = event.bounds.originY;
  const lines: string[] = [];

  lines.push(`<?xml version="1.0" encoding="UTF-8" standalone="no"?>`);
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(event.label)}">`
  );
  lines.push(
    `<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="#444"/></marker></defs>`
  );
  lines.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`);

  const positions = new Map(event.nodes.map((node) => [node.id, node]));

  // Edge layer
  for (const edge of event.edges) {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) {
      continue;
    }

    const src = toAbsPoint(source, originX, originY);
    const tgt = toAbsPoint(target, originX, originY);
    const midX = (src.x + tgt.x) / 2;

    // Compute stroke width proportional to energy
    const energy = edge.particle?.momentum.energy ?? 0;
    const strokeWidth = Math.max(0.5, Math.min(6, energy / 150));

    // Escape tooltip content
    const tooltipText = edge.particle ? escapeXml(formatParticleTooltipWithUnit(edge.particle, event.units?.momentum).join("\n")) : "";

    lines.push(
      `<g>`
    );
    lines.push(
      `<path d="M ${fmt(src.x)} ${fmt(src.y)} C ${fmt(midX)} ${fmt(src.y)}, ${fmt(midX)} ${fmt(tgt.y)}, ${fmt(tgt.x)} ${fmt(tgt.y)}" fill="none" stroke="#444" stroke-opacity="0.5" stroke-width="${fmt(strokeWidth)}" marker-end="url(#arrow)"/>`
    );

    // Edge label
    if (edge.particle) {
      const label = formatParticleLabel(edge.particle, event.units?.momentum);
      const labelY = (src.y + tgt.y) / 2;
      lines.push(
        `<text text-anchor="middle" x="${fmt(midX)}" y="${fmt(labelY - 4)}" font-family="sans-serif" font-size="11" fill="#222">${escapeXml(label)}</text>`
      );
    }

    // Tooltip
    if (tooltipText) {
      lines.push(
        `<title>${tooltipText}</title>`
      );
    }

    lines.push(`</g>`);
  }

  // Vertex node layer (small dots only for non-pseudo vertices)
  for (const node of event.nodes) {
    // Skip pseudo-nodes (in:/out:)
    if (node.id.startsWith("in:") || node.id.startsWith("out:")) {
      continue;
    }
    const point = toAbsPoint(node, originX, originY);
    lines.push(
      `<circle cx="${fmt(point.x)}" cy="${fmt(point.y)}" r="3.5" fill="#222"/>`
    );
  }

  lines.push(`</svg>`);
  return lines.join("\n");
}

function toAbsPoint(node: { x: number; y: number }, originX: number, originY: number): { x: number; y: number } {
  return {
    x: originX + node.x,
    y: originY + node.y
  };
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
