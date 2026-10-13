const { test } = require("node:test");
const assert = require("node:assert/strict");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");
const esbuild = require("esbuild");
const { root, artifacts } = require("./helpers.cjs");
const out = join(artifacts("tdk-lowpoly-"), "lowpoly.cjs");
esbuild.buildSync({
  entryPoints: [join(root, "html/kit/lowpoly.js")],
  bundle: true,
  platform: "node",
  format: "cjs",
  alias: { three: join(root, "html/libs/three/three.module.min.js") },
  outfile: out,
  logLevel: "silent",
});
const LP = require(out);
function scene() {
  return {
    children: [],
    add(o) {
      this.children.push(o);
    },
  };
}

for (const stage of [0, 1, 2, 3]) {
  test(`crop stage ${stage} has finite transforms`, () => {
    const crop = LP.crop({ stage });
    crop.traverse((o) =>
      assert.ok(
        [...o.position.toArray(), ...o.rotation.toArray().slice(0, 3)].every(
          Number.isFinite,
        ),
      ),
    );
  });
}
for (const stage of [-1, 4, 1.5, NaN, Infinity, "2"]) {
  test(`crop rejects invalid stage ${String(stage)}`, () => {
    const literal =
      typeof stage === "string" ? JSON.stringify(stage) : String(stage);
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `const assert=require('node:assert/strict');const LP=require(${JSON.stringify(out)});assert.throws(()=>LP.crop({stage:${literal}}),/stage/);`,
      ],
      { timeout: 1500, encoding: "utf8" },
    );
    assert.equal(
      result.error,
      undefined,
      "crop must terminate without timing out",
    );
    assert.equal(result.status, 0, result.stderr);
  });
}
for (const options of [
  { area: 2, avoid: 4 },
  { area: 2, avoid: Math.SQRT2 },
  { count: -1 },
  { count: 1.5 },
  { count: Infinity },
  { area: 0 },
  { area: NaN },
  { area: Infinity },
  { avoid: -1 },
  { avoid: Infinity },
  { seed: NaN },
  { seed: 1.5 },
]) {
  test(`scatter rejects invalid options ${JSON.stringify(options)}`, () => {
    // Old implementation can hang; isolate every invalid case in a bounded child process.
    const code = `const assert=require('node:assert/strict');const LP=require(${JSON.stringify(out)});assert.throws(()=>LP.scatter({add(){}},()=>LP.coin(),${Object.entries(
      options,
    )
      .map(([k, v]) => `${k}:${String(v)}`)
      .reduce((a, v) => (a ? a + "," + v : v), "")
      .replace(/^/, "{")
      .replace(/$/, "}")}),/scatter/);`;
    const result = spawnSync(process.execPath, ["-e", code], {
      timeout: 1500,
      encoding: "utf8",
    });
    assert.equal(
      result.error,
      undefined,
      "scatter must terminate without timing out",
    );
    assert.equal(result.status, 0, result.stderr);
  });
}
test("scatter preserves existing seeded layout and exclusion radius", () => {
  const actual = LP.scatter(scene(), () => LP.coin(), { seed: 51, count: 12 });
  let seed = 51;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const expected = [];
  for (let i = 0; i < 12; i++) {
    let x, z;
    do {
      x = (rnd() - 0.5) * 40;
      z = (rnd() - 0.5) * 40;
    } while (Math.hypot(x, z) < 4);
    expected.push([x, z, rnd() * Math.PI * 2]);
  }
  assert.deepEqual(
    actual.map((o) => [o.position.x, o.position.z, o.rotation.y]),
    expected,
  );
  assert.ok(actual.every((o) => Math.hypot(o.position.x, o.position.z) >= 4));
});
test("scatter count zero returns no objects without calling factory", () => {
  assert.deepEqual(
    LP.scatter(
      scene(),
      () => {
        throw Error("must not run");
      },
      { count: 0 },
    ),
    [],
  );
});
test("scatter seed zero is normalized into a usable generator", () => {
  const objs = LP.scatter(scene(), () => LP.coin(), { seed: 0, count: 3 });
  assert.equal(
    new Set(objs.map((o) => o.position.toArray().join(","))).size,
    3,
  );
});
test("scatter narrow feasible region terminates before inserting the first object", () => {
  const code = `const assert=require('node:assert/strict');const LP=require(${JSON.stringify(out)});const scene={children:[],add(o){this.children.push(o)}};assert.throws(()=>LP.scatter(scene,()=>LP.coin(),{count:1,area:2,avoid:Math.SQRT2-1e-12}),/scatter/);assert.equal(scene.children.length,0);`;
  const result = spawnSync(process.execPath, ["-e", code], {
    timeout: 1500,
    encoding: "utf8",
  });
  assert.equal(
    result.error,
    undefined,
    "scatter must terminate without timing out",
  );
  assert.equal(result.status, 0, result.stderr);
});
