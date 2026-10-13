const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  cpSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
} = require("node:fs");
const { join } = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { root, serve, launch, artifacts } = require("./helpers.cjs");

test("all templates and repeatable standalone builds", async (t) => {
  const output = artifacts("tdk-builds-");
  // The builder runs on a copy: existing dist files and Claude's checkout stay untouched.
  const copy = join(output, "checkout");
  cpSync(join(root, "html"), join(copy, "html"), { recursive: true });
  const aliases = {};
  const hashes = {};
  const templates = readdirSync(join(root, "html/templates")).filter((name) =>
    existsSync(join(root, "html/templates", name, "index.html")),
  );
  assert.ok(templates.length > 0, "at least one template must execute");
  for (const name of templates) {
    const files = [1, 2].map((i) => join(output, `${name}-${i}.html`));
    for (const file of files)
      execFileSync(
        process.execPath,
        [
          join(copy, "html/tools/build-single.mjs"),
          join(copy, "html/templates", name),
          file,
        ],
        {
          env: {
            ...process.env,
            NODE_PATH: [join(root, "node_modules"), process.env.NODE_PATH]
              .filter(Boolean)
              .join(require("node:path").delimiter),
          },
          stdio: "pipe",
          timeout: 60000,
        },
      );
    hashes[name] = files.map((file) =>
      createHash("sha256").update(readFileSync(file)).digest("hex"),
    );
    await t.test(`${name}: two builds are byte-identical`, () =>
      assert.equal(hashes[name][0], hashes[name][1]),
    );
    aliases[`/${name}.html`] = files[0];
  }
  writeFileSync(join(output, "hashes.json"), JSON.stringify(hashes, null, 2));
  console.log("Build artifacts:", output, JSON.stringify(hashes));
  const base = await serve(t, aliases);
  const browser = await launch(t);
  for (const name of Object.keys(hashes)) {
    for (const bundled of [false, true]) {
      await t.test(
        `${name}: ${bundled ? "offline bundle" : "source"} runs and responds to input`,
        async () => {
          const page = await browser.newPage({
            viewport: { width: 844, height: 390 },
            hasTouch: true,
          });
          const errors = [],
            requests = [];
          page.on("pageerror", (e) => errors.push(e.message));
          page.on("console", (m) => {
            if (m.type() === "error") errors.push(m.text());
          });
          page.on("requestfailed", (r) =>
            errors.push("request failed: " + r.url()),
          );
          if (bundled)
            await page.route("**/*", (route) => {
              if (route.request().isNavigationRequest())
                return route.continue();
              requests.push(route.request().url());
              return route.abort();
            });
          try {
            await page.goto(
              base + (bundled ? `/${name}.html` : `/html/templates/${name}/`),
            );
            await page.waitForSelector("canvas");
            if (name === "character-viewer") {
              await page.getByRole("button", { name: "Vẫy tay" }).click();
              assert.equal(
                await page.evaluate(() => window.__game.stats().anim),
                "wave",
              );
              await page.getByRole("button", { name: "Hai bím" }).click();
              assert.equal(
                await page.evaluate(() => window.__game.stats().hair),
                "twintail",
              );
            } else {
              await page.locator("#play").click();
              await page.waitForFunction(
                () => !document.querySelector("#start"),
              );
            }
            const before = await page.evaluate(
              () => window.__game?.stats() || null,
            );
            await page.keyboard.down("w");
            await page.waitForTimeout(800);
            await page.keyboard.up("w");
            await page.keyboard.down("d");
            await page.waitForTimeout(800);
            await page.keyboard.up("d");
            await page.keyboard.press("Space");
            await page.waitForTimeout(300);
            const after = await page.evaluate(
              () => window.__game?.stats() || null,
            );
            assert.equal(await page.locator("canvas").count(), 1);
            assert.deepEqual(errors, []);
            assert.deepEqual(requests, []);
            if (before?.pos && after?.pos)
              assert.notDeepEqual(after.pos, before.pos);
            await page.screenshot({
              path: join(
                output,
                `${name}-${bundled ? "bundle" : "source"}.png`,
              ),
            });
          } finally {
            await page.close();
          }
        },
      );
    }
  }
});
