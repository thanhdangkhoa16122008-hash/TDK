const { test } = require("node:test");
const assert = require("node:assert/strict");
const { serve, launch, artifacts } = require("./helpers.cjs");
const { join } = require("node:path");
const fs = require("fs");
test("HTML auxiliary library coverage", async (t) => {
  const base = await serve(t);
  const browser = await launch(t);
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  await page.goto(base + "/html/templates/basic-3d-starter/");
  await page.locator("#play").click();
  for (const src of ["riffwave.js", "sfxr.js", "howler.min.js"])
    await page.addScriptTag({ url: base + "/html/libs/audio/" + src });
  const results = await page.evaluate(async () => {
    const results = [];
    const add = (test, pass, detail) => results.push({ test, pass, detail });
    const wave = jsfxr.sfxr.toWave(jsfxr.sfxr.generate("pickupCoin"));
    add(
      "jsfxr WAV synthesis",
      wave.wav.length > 44 && wave.dataURI.startsWith("data:audio/wav;"),
      { bytes: wave.wav.length },
    );
    const sound = new Howl({ src: [wave.dataURI], format: ["wav"] });
    await new Promise((res, rej) => {
      sound.once("load", res);
      sound.once("loaderror", (_, e) => rej(Error(e)));
    });
    add("howler decode WAV", sound.duration() > 0, {
      duration: sound.duration(),
    });
    await new Promise((r) => {
      sound.once("play", r);
      sound.play();
    });
    add("howler playback", sound.playing());
    sound.stop();
    sound.unload();
    const { GLTFLoader } =
      await import("/html/libs/three/addons/loaders/GLTFLoader.js");
    const gltf = await new Promise((res, rej) =>
      new GLTFLoader().parse(
        JSON.stringify({
          asset: { version: "2.0" },
          scene: 0,
          scenes: [{ nodes: [0] }],
          nodes: [{ name: "audit-node" }],
        }),
        "",
        res,
        rej,
      ),
    );
    add(
      "GLTFLoader minimal scene",
      gltf.scene.children[0].name === "audit-node",
    );
    const THREE = await import("three");
    const { OrbitControls } =
      await import("/html/libs/three/addons/controls/OrbitControls.js");
    const controls = new OrbitControls(
      new THREE.PerspectiveCamera(),
      document.querySelector("canvas"),
    );
    controls.update();
    add("OrbitControls update", !!controls.target);
    controls.dispose();
    const utils =
      await import("/html/libs/three/addons/utils/BufferGeometryUtils.js");
    const merged = utils.mergeGeometries([
      new THREE.BoxGeometry(),
      new THREE.BoxGeometry(),
    ]);
    add("geometry merge", merged.attributes.position.count === 48);
    merged.dispose();
    const { clone } =
      await import("/html/libs/three/addons/utils/SkeletonUtils.js");
    const parent = new THREE.Group();
    parent.add(new THREE.Mesh(new THREE.BoxGeometry()));
    const cloned = clone(parent);
    add(
      "SkeletonUtils clone unskinned group",
      cloned !== parent && cloned.children[0] !== parent.children[0],
    );
    const { createInput } = await import("/html/kit/input.js");
    const input = createInput({ buttons: ["audit"] });
    const button = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "AUDIT",
    );
    button.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 99 }));
    button.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 99 }));
    add("pointercancel clears held", !input.held("audit"));
    return results;
  });
  fs.writeFileSync(
    join(artifacts("tdk-audit-extra-"), "results.json"),
    JSON.stringify(results, null, 2),
  );
  for (const result of results)
    await t.test(result.test, () =>
      assert.equal(result.pass, true, JSON.stringify(result)),
    );
});
