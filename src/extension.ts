import * as path from "node:path";
import * as vscode from "vscode";
import { buildViewerState, renderEventSvg } from "./common/hepmc.js";
import type { ViewerState } from "./common/types.js";

const VIEW_TYPE = "hepmc-viz.viewer";
const SAVE_SVG_COMMAND = "hepmc-viz.saveSvg";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new HepmcViewerProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      webviewOptions: {
        retainContextWhenHidden: true
      },
      supportsMultipleEditorsPerDocument: false
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hepmc-viz.openViewer", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }

      await vscode.commands.executeCommand("vscode.openWith", editor.document.uri, VIEW_TYPE);
    }),
    vscode.commands.registerCommand(SAVE_SVG_COMMAND, async () => {
      const uri = provider.getActiveCustomEditorUri();
      if (!uri) {
        vscode.window.showErrorMessage("Open a HepMC viewer tab first.");
        return;
      }

      await provider.saveCurrentGraphAsSvg(uri);
    })
  );
}

class HepmcViewerProvider implements vscode.CustomTextEditorProvider {
  private readonly currentIndexByUri = new Map<string, number>();

  public constructor(private readonly context: vscode.ExtensionContext) {}

  public getActiveCustomEditorUri(): vscode.Uri | undefined {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === VIEW_TYPE) {
      return tab.input.uri;
    }

    return undefined;
  }

  public async saveCurrentGraphAsSvg(uri: vscode.Uri): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    const state = await loadDocument(document);
    const index = this.clampIndex(uri, state);
    const event = state.events[index];

    if (!event) {
      vscode.window.showErrorMessage("No HepMC event was found to export.");
      return;
    }

    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(defaultSvgName(document.fileName, index)),
      filters: {
        SVG: ["svg"]
      }
    });

    if (!target) {
      return;
    }

    const svg = renderEventSvg(event);
    await vscode.workspace.fs.writeFile(target, Buffer.from(svg, "utf8"));
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const uriKey = document.uri.toString();

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    const state = await loadDocument(document);
    this.currentIndexByUri.set(uriKey, 0);
    panel.webview.html = this.getHtml(panel.webview, state);

    const refresh = async () => {
      const updated = await loadDocument(document);
      const currentIndex = this.clampIndex(document.uri, updated);
      this.currentIndexByUri.set(uriKey, currentIndex);
      panel.webview.postMessage({ type: "update", state: updated, currentIndex });
    };

    const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() === uriKey) {
        void refresh();
      }
    });

    const saveSubscription = vscode.workspace.onDidSaveTextDocument((saved) => {
      if (saved.uri.toString() === uriKey) {
        void refresh();
      }
    });

    const messageSubscription = panel.webview.onDidReceiveMessage((message) => {
      if (message?.type === "selection" && Number.isInteger(message.index)) {
        this.currentIndexByUri.set(uriKey, Math.max(0, message.index));
      }
    });

    panel.onDidDispose(() => {
      changeSubscription.dispose();
      saveSubscription.dispose();
      messageSubscription.dispose();
      this.currentIndexByUri.delete(uriKey);
    });
  }

  private getHtml(webview: vscode.Webview, state: ViewerState): string {
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

  private clampIndex(uri: vscode.Uri, state: ViewerState): number {
    const current = this.currentIndexByUri.get(uri.toString()) ?? 0;
    return Math.min(Math.max(0, current), Math.max(0, state.events.length - 1));
  }
}

async function loadDocument(document: vscode.TextDocument): Promise<ViewerState> {
  return buildViewerState(path.basename(document.fileName), document.getText());
}

function defaultSvgName(fileName: string, index: number): string {
  const base = fileName.replace(/\.(hepmc3?|txt)$/i, "");
  return `${base || "hepmc"}-event-${index + 1}.svg`;
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let index = 0; index < 32; index += 1) {
    nonce += chars[Math.floor(Math.random() * chars.length)];
  }
  return nonce;
}

function sanitizeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function deactivate(): void {}
