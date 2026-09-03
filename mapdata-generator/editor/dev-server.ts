import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { mapEditorApiPlugin } from "./server-plugin.js";

const editorRoot = resolve(dirname(fileURLToPath(import.meta.url)));

const vite = await createViteServer({
  root: editorRoot,
  configFile: false,
  server: { middlewareMode: true },
  appType: "spa",
  plugins: [mapEditorApiPlugin()],
  resolve: {
    alias: {
      "@economic-simulator/map-runtime": resolve(editorRoot, "../../packages/map-runtime/src/index.ts")
    }
  },
  optimizeDeps: {
    include: ["three", "earcut"]
  }
});

const server = createServer((req, res) => {
  vite.middlewares(req, res, () => {
    res.statusCode = 404;
    res.end("Not found");
  });
});

const port = Number(process.env.PORT ?? 5177);
server.listen(port, "127.0.0.1", () => {
  console.log(`Map editor: http://127.0.0.1:${port}/`);
});
