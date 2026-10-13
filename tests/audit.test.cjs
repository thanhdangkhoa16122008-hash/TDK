const { test } = require("node:test");
const assert = require("node:assert/strict");
const { serve, launch, artifacts } = require("./helpers.cjs");
const { join } = require("node:path");
const fs = require("fs");
test("HTML audit smoke coverage", async (t) => {
  const base = await serve(t);
  const results = [];
  const browser = await launch(t);
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/html/templates/basic-3d-starter/");
  await page.waitForFunction(() =>
    document.querySelector("#hud")?.textContent.includes("/ 12"),
  );
  await page.locator("#play").click();
  results.push({
    test: "template startup",
    pass:
      (await page.locator("canvas").count()) === 1 &&
      (await page.locator("#start").count()) === 0,
    errors,
  });
  results.push(
    ...(await page.evaluate(async () => {
      const tests = [];
      const add = (test, pass, detail) => tests.push({ test, pass, detail });
      const LP = await import("/html/kit/lowpoly.js");
      const THREE = await import("three");
      const C = await import("cannon-es");
      const { PRESETS, SFX, Music, unlockAudio } =
        await import("/html/kit/sfx.js");
      const { ZZFX } = await import("/html/libs/audio/zzfx.js");
      const { createInput } = await import("/html/kit/input.js");
      for (const name of [
        "tree",
        "roundTree",
        "rock",
        "bush",
        "house",
        "fence",
        "coin",
        "character",
      ]) {
        const obj = LP[name]();
        const box = new THREE.Box3().setFromObject(obj);
        add(
          "model " + name,
          [...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite),
        );
      }
      for (let stage = 0; stage < 4; stage++)
        add(
          "crop " + stage,
          Number.isFinite(
            new THREE.Box3().setFromObject(LP.crop({ stage })).max.y,
          ),
        );
      let rejected = false;
      try {
        LP.crop({ stage: 4 });
      } catch (e) {
        rejected = e instanceof RangeError;
      }
      add("crop out-of-range validation", rejected);
      const character = LP.character();
      character.userData.animate(1 / 60, 1);
      add(
        "walk animation opposite legs",
        character.children[5].rotation.x !== 0 &&
          character.children[5].rotation.x ===
            -character.children[6].rotation.x,
      );
      character.userData.animate(1 / 60, 0);
      add(
        "animation idle reset",
        character.children[5].rotation.x === 0 &&
          character.children[0].position.y === 1,
      );
      const s1 = LP.scatter(new THREE.Scene(), () => LP.coin(), {
        seed: 51,
        count: 12,
      });
      const s2 = LP.scatter(new THREE.Scene(), () => LP.coin(), {
        seed: 51,
        count: 12,
      });
      add(
        "scatter deterministic",
        JSON.stringify(s1.map((o) => o.position.toArray())) ===
          JSON.stringify(s2.map((o) => o.position.toArray())),
      );
      const w = new C.World({ gravity: new C.Vec3(0, -10, 0) });
      const b = new C.Body({ mass: 1, shape: new C.Sphere(0.4) });
      b.position.y = 2;
      w.addBody(b);
      for (let i = 0; i < 60; i++) w.step(1 / 60);
      add("cannon gravity", b.position.y < 0);
      for (const [name, p] of Object.entries(PRESETS)) {
        const samples = ZZFX.buildSamples(...p);
        add(
          "audio " + name,
          samples.length > 0 && samples.every(Number.isFinite),
          {
            samples: samples.length,
            peak: samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0),
          },
        );
        const source = SFX.play(name);
        add("audio playback " + name, !!source.buffer);
        source.stop();
      }
      unlockAudio();
      await ZZFX.audioContext.resume();
      add("audio context resume", ZZFX.audioContext.state === "running");
      for (const mood of ["calm", "happy", "horror"]) {
        Music.start(mood);
        add("music " + mood, Music._nodes.pads.length === 2);
        Music.stop();
        add("music stop " + mood, Music._nodes === null);
      }
      const input = createInput();
      dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
      dispatchEvent(new KeyboardEvent("keydown", { code: "KeyD" }));
      add(
        "keyboard diagonal normalized",
        Math.abs(Math.hypot(input.move.x, input.move.y) - 1) < 1e-10,
      );
      dispatchEvent(new Event("blur"));
      add("keyboard reset on blur", input.move.x === 0 && input.move.y === 0, {
        move: input.move,
      });
      dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" }));
      dispatchEvent(new KeyboardEvent("keyup", { code: "KeyD" }));
      dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
      add(
        "pressed consumed once",
        input.pressed("jump") === true && input.pressed("jump") === false,
      );
      dispatchEvent(new KeyboardEvent("keyup", { code: "Space" }));
      dispatchEvent(new KeyboardEvent("keydown", { code: "KeyE" }));
      dispatchEvent(new KeyboardEvent("keydown", { code: "KeyF" }));
      dispatchEvent(new KeyboardEvent("keyup", { code: "KeyE" }));
      add("shared action remains held", input.held("action"));
      dispatchEvent(new KeyboardEvent("keyup", { code: "KeyF" }));
      const { zzfxM } = await import("/html/kit/zzfxm.js");
      try {
        const song = zzfxM([PRESETS.coin], [[[0, 0, 12]]], [0]);
        add("ZzFXM integration", song.length === 2);
      } catch (e) {
        add("ZzFXM integration", false, e.message);
      }
      try {
        const all = await import("/html/libs/three/three-all.module.min.js");
        add("three all exports", !!all.GLTFLoader && !!all.OrbitControls, {
          revision: all.REVISION,
        });
      } catch (e) {
        add("three all exports", false, e.message);
      }
      return tests;
    })),
  );
  fs.writeFileSync(
    join(artifacts("tdk-audit-"), "results.json"),
    JSON.stringify(results, null, 2),
  );
  for (const result of results)
    await t.test(result.test, () =>
      assert.equal(result.pass, true, JSON.stringify(result)),
    );
  assert.deepEqual(errors, []);
});
