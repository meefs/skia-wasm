/**
 * Serves this package over http://localhost, which browsers treat as a secure
 * context: WebGPU is not exposed to pages opened from file://.
 */
import fs from "fs";
import http from "http";
import path from "path";

import { PackageRoot } from "./skia";

const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
};

/** Serves the package directory. Resolves once the server listens. */
export const serve = (port: number) =>
  new Promise<http.Server>((resolve) => {
    const server = http.createServer((request, response) => {
      const { pathname } = new URL(request.url ?? "/", "http://localhost");
      const file = path.join(PackageRoot, path.normalize(pathname));
      // normalize() resolves ".." segments; anything still outside is refused.
      if (!file.startsWith(PackageRoot + path.sep) || !fs.existsSync(file)) {
        response.writeHead(404).end();
        return;
      }
      if (fs.statSync(file).isDirectory()) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "Content-Type": types[path.extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
        // Cross-origin isolation: the benchmark needs the 5 microsecond
        // resolution that performance.now() only has on an isolated page.
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      });
      fs.createReadStream(file).pipe(response);
    });
    server.listen(port, "localhost", () => resolve(server));
  });

if (require.main === module) {
  const port = Number(process.env.PORT ?? 8790);
  serve(port).then(() => {
    for (const page of ["tests/display-list.html", "bench/index.html"]) {
      console.log(`http://localhost:${port}/${page}`);
    }
  });
}
