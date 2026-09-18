import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const files: Record<string, [string, string]> = {
  "/webview.js": ["dist/webview.js", "text/javascript"],
  "/webview.css": ["dist/webview.css", "text/css"],
  "/preview.js": ["dist/preview.js", "text/javascript"],
};
const html =
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lattice Sync Session · Interactive preview</title><link rel="stylesheet" href="/webview.css"></head><body><div id="root"></div><script src="/preview.js"></script><script src="/webview.js"></script></body></html>';
createServer(async (req, res) => {
  try {
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html);
      return;
    }
    const file = files[req.url || ""];
    if (!file) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": file[1] });
    res.end(await readFile(resolve(file[0])));
  } catch {
    res.writeHead(500);
    res.end("Run npm run build first.");
  }
}).listen(Number(process.env.PREVIEW_PORT || 4320), "127.0.0.1", () =>
  console.log(
    "Interactive UI preview: http://127.0.0.1:" +
      (process.env.PREVIEW_PORT || 4320),
  ),
);
