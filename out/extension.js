"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var path = __toESM(require("node:path"));
var vscode = __toESM(require("vscode"));

// src/common/hepmc.ts
var NUMERIC_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
function parseHepmcFile(text) {
  const events = [];
  const warnings = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let current = null;
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
function buildViewerState(fileName, text) {
  const parsed = parseHepmcFile(text);
  return {
    fileName,
    events: parsed.events.map((event) => renderEvent(event))
  };
}
function parseEventHeader(line, index) {
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
function parseParticleLine(line) {
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
  if (id === void 0 || status === void 0 || pdgId === void 0 || !Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz) || !Number.isFinite(energy)) {
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
      mass: Number.isFinite(mass) ? mass : void 0
    },
    rawLine: line
  };
}
function parseVertexLine(line) {
  const match = /^V\s+(-?\d+)\s+(-?\d+)\s+\[([^\]]*)\](?:\s+@\s+(.+))?$/.exec(line);
  if (!match) {
    return null;
  }
  const id = Number(match[1]);
  const status = Number(match[2]);
  const particleIds = match[3].split(/[,\s]+/).map((value) => Number(value)).filter((value) => Number.isFinite(value));
  const position = match[4] ? parsePosition(match[4]) : void 0;
  return {
    id,
    status,
    particleIds,
    position,
    rawLine: line
  };
}
function parsePosition(input) {
  const values = input.split(/\s+/).map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (values.length < 4) {
    return void 0;
  }
  return {
    x: values[0],
    y: values[1],
    z: values[2],
    t: values[3]
  };
}
function renderEvent(event) {
  const nodes = [];
  const edges = [];
  const incoming = /* @__PURE__ */ new Set();
  const outgoing = /* @__PURE__ */ new Set();
  for (const particle of event.particles) {
    const node = {
      kind: "particle",
      id: particleNodeId(particle.id),
      x: 0,
      y: 0,
      particle
    };
    nodes.push(node);
  }
  for (const vertex of event.vertices) {
    const node = {
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
  const nodeLevels = /* @__PURE__ */ new Map();
  for (const particle of upstreamParticles) {
    nodeLevels.set(particleNodeId(particle.id), 0);
  }
  const sortedNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  for (let pass = 0; pass < sortedNodes.length; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const sourceLevel = nodeLevels.get(edge.source);
      if (sourceLevel === void 0) {
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
  const grouped = /* @__PURE__ */ new Map();
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
      node.y = index * rowGap - (Math.max(1, list.length) - 1) * rowGap / 2;
      maxX = Math.max(maxX, node.x);
      maxY = Math.max(maxY, Math.abs(node.y));
    });
  }
  return {
    index: event.index,
    label: event.eventNumber !== void 0 ? `Event ${event.eventNumber}` : `Event ${event.index + 1}`,
    nodes,
    edges,
    bounds: {
      width: maxX + 220,
      height: maxY * 2 + 220
    }
  };
}
function particleNodeId(id) {
  return `p:${id}`;
}
function vertexNodeId(id) {
  return `v:${id}`;
}
function parseMaybeNumber(value) {
  if (!value || !NUMERIC_RE.test(value)) {
    return void 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : void 0;
}

// src/extension.ts
var VIEW_TYPE = "hepmc-viz.viewer";
function activate(context) {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      VIEW_TYPE,
      new HepmcViewerProvider(context),
      {
        webviewOptions: {
          retainContextWhenHidden: true
        },
        supportsMultipleEditorsPerDocument: false
      }
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("hepmc-viz.openViewer", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      await vscode.commands.executeCommand("vscode.openWith", editor.document.uri, VIEW_TYPE);
    })
  );
}
var HepmcViewerProvider = class {
  constructor(context) {
    this.context = context;
  }
  async resolveCustomTextEditor(document, panel, _token) {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };
    const state = await loadDocument(document);
    panel.webview.html = this.getHtml(panel.webview, state);
    const refresh = async () => {
      const updated = await loadDocument(document);
      panel.webview.postMessage({ type: "update", state: updated });
    };
    const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() === document.uri.toString()) {
        void refresh();
      }
    });
    const saveSubscription = vscode.workspace.onDidSaveTextDocument((saved) => {
      if (saved.uri.toString() === document.uri.toString()) {
        void refresh();
      }
    });
    panel.onDidDispose(() => {
      changeSubscription.dispose();
      saveSubscription.dispose();
    });
  }
  getHtml(webview, state) {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "out", "webview.js"));
    const nonce = getNonce();
    const serialized = sanitizeJson(state);
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style nonce="${nonce}">
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      overflow: hidden;
      font-family: var(--vscode-font-family);
    }
    #app {
      width: 100%;
      height: 100%;
    }
  </style>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">
    window.__HEPMC_INITIAL_STATE__ = ${serialized};
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
};
async function loadDocument(document) {
  const text = document.getText();
  return buildViewerState(path.basename(document.fileName), text);
}
function getNonce() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let index = 0; index < 32; index += 1) {
    nonce += chars[Math.floor(Math.random() * chars.length)];
  }
  return nonce;
}
function sanitizeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
