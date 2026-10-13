const { createServer } = require("node:http");
const { readFileSync, existsSync, mkdtempSync, statSync } = require("node:fs");
const { resolve, extname, join } = require("node:path");
const { tmpdir } = require("node:os");
const { chromium } = require("playwright");

const root = resolve(__dirname, "..");
const fixture = `<!doctype html><script type="importmap">{"imports":{"three":"/html/libs/three/three.module.min.js","three/addons/":"/html/libs/three/addons/","cannon-es":"/html/libs/physics/cannon-es.min.js"}}</script><script src="/html/libs/input/nipplejs.min.js"></script>`;
const mime = {
  ".js": "text/javascript",
  ".html": "text/html",
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
};

async function serve(t, extra = {}) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (path === "/favicon.ico") {
      res.writeHead(204);
      return res.end();
    }
    if (path === "/fixture.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(fixture);
    }
    let file = extra[path] || resolve(root, "." + path);
    if ((!extra[path] && !file.startsWith(root + "/")) || !existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    if (statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, {
      "Content-Type": mime[extname(file)] || "application/octet-stream",
    });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function launch(t) {
  const executablePath =
    process.env.CHROMIUM_PATH ||
    (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  t.after(() => browser.close());
  return browser;
}

function artifacts(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

module.exports = { root, serve, launch, artifacts };
