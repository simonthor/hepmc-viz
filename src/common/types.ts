export interface FourMomentum {
  px: number;
  py: number;
  pz: number;
  energy: number;
  mass?: number;
}

export interface HepmcParticle {
  id: number;
  productionVertexId: number;
  status: number;
  pdgId: number;
  momentum: FourMomentum;
  rawLine: string;
}

export interface HepmcVertex {
  id: number;
  status: number;
  particleIds: number[];
  outgoingParticleIds: number[];
  position?: {
    x: number;
    y: number;
    z: number;
    t: number;
  };
  rawLine: string;
}

export interface HepmcEvent {
  index: number;
  eventNumber?: number;
  declaredParticleCount?: number;
  declaredVertexCount?: number;
  units?: {
    momentum?: string;
    length?: string;
  };
  weight?: number;
  attributes: Record<string, string>;
  particles: HepmcParticle[];
  vertices: HepmcVertex[];
}

export interface ParsedHepmcFile {
  events: HepmcEvent[];
  warnings: string[];
}

export interface RenderNodeBase {
  id: string;
  x: number;
  y: number;
}

export interface RenderParticleNode extends RenderNodeBase {
  kind: "particle";
  particle: HepmcParticle;
}

export interface RenderVertexNode extends RenderNodeBase {
  kind: "vertex";
  vertex: HepmcVertex;
}

export type RenderNode = RenderParticleNode | RenderVertexNode;

export interface RenderEdge {
  source: string;
  target: string;
  particle?: HepmcParticle;
}

export interface RenderEvent {
  index: number;
  label: string;
  units?: {
    momentum?: string;
    length?: string;
  };
  nodes: RenderNode[];
  edges: RenderEdge[];
  bounds: {
    width: number;
    height: number;
    originX: number;
    originY: number;
  };
}

export interface ViewerState {
  fileName: string;
  events: RenderEvent[];
}
