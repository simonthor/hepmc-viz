import { build } from "esbuild";

await Promise.all([
  build({
    bundle: true,
    sourcemap: true,
    platform: "node",
    target: "node18",
    logLevel: "info",
    entryPoints: ["src/extension.ts"],
    outfile: "out/extension.js",
    external: ["vscode"]
  }),
  build({
    bundle: true,
    sourcemap: true,
    platform: "browser",
    target: "es2020",
    format: "iife",
    globalName: "hepmcViewer",
    logLevel: "info",
    entryPoints: ["src/webview/main.ts"],
    outfile: "out/webview.js"
  })
]);
