const { test } = require("node:test");
const assert = require("node:assert/strict");
const { serve, launch } = require("./helpers.cjs");

test("ZzFXM integration in Chromium", async (t) => {
  const base = await serve(t);
  const browser = await launch(t);
  await t.test(
    "missing sample rate reports an actionable error instead of empty channels",
    async () => {
      const page = await browser.newPage();
      try {
        await page.goto(base + "/fixture.html");
        await page.addScriptTag({ url: base + "/html/libs/audio/zzfxm.js" });
        const message = await page.evaluate(async () => {
          const { ZZFX } = await import("/html/libs/audio/zzfx.js");
          window.zzfxG = (...args) => ZZFX.buildSamples(...args);
          try {
            zzfxM([[1, 0, 440]], [[[0, 0, 12]]], [0]);
            return null;
          } catch (error) {
            return error.message;
          }
        });
        assert.match(message || "", /ZzFXM.*(engine|zzfxR)/);
      } finally {
        await page.close();
      }
    },
  );
  await t.test(
    "missing sample builder reports an actionable error",
    async () => {
      const page = await browser.newPage();
      try {
        await page.goto(base + "/fixture.html");
        await page.addScriptTag({ url: base + "/html/libs/audio/zzfxm.js" });
        const message = await page.evaluate(() => {
          window.zzfxR = 44100;
          try {
            zzfxM([[1, 0, 440]], [[[0, 0, 12]]], [0]);
            return null;
          } catch (error) {
            return error.message;
          }
        });
        assert.match(message || "", /ZzFXM.*(engine|zzfxG)/);
      } finally {
        await page.close();
      }
    },
  );
  await t.test(
    "classic renderer accepts current ZzFX without legacy globals",
    async () => {
      const page = await browser.newPage();
      try {
        await page.goto(base + "/fixture.html");
        await page.addScriptTag({ url: base + "/html/libs/audio/zzfxm.js" });
        assert.equal(
          await page.evaluate(async () => {
            const { ZZFX } = await import("/html/libs/audio/zzfx.js");
            return zzfxM([[1, 0, 440]], [[[0, 0, 12]]], [0], 125, ZZFX).every(
              (c) => c.length > 0 && c.every(Number.isFinite),
            );
          }),
          true,
        );
      } finally {
        await page.close();
      }
    },
  );
  await t.test(
    "renders and plays finite stereo samples with current ZzFX",
    async () => {
      const page = await browser.newPage();
      try {
        await page.goto(base + "/fixture.html");
        const result = await page.evaluate(async () => {
          const { zzfxM } = await import("/html/kit/zzfxm.js");
          const { ZZFX } = await import("/html/libs/audio/zzfx.js");
          const samples = zzfxM(
            [[1, 0, 440, 0, 0.05, 0.1]],
            [[[0, -0.5, 12, 14, 16]]],
            [0],
          );
          const source = ZZFX.playSamples(samples);
          const result = {
            lengths: samples.map((c) => c.length),
            finite: samples.every((c) => c.every(Number.isFinite)),
            nonzero: samples.every((c) => c.some((v) => v !== 0)),
            stereo: source.buffer.numberOfChannels,
          };
          source.stop();
          return result;
        });
        assert.equal(result.finite, true);
        assert.equal(result.nonzero, true);
        assert.equal(result.stereo, 2);
        assert.ok(result.lengths[0] > 0);
        assert.equal(result.lengths[0], result.lengths[1]);
      } finally {
        await page.close();
      }
    },
  );
  await t.test(
    "classic script still accepts legacy zzfxR and zzfxG globals",
    async () => {
      const page = await browser.newPage();
      try {
        await page.goto(base + "/fixture.html");
        await page.evaluate(async () => {
          const { ZZFX } = await import("/html/libs/audio/zzfx.js");
          window.zzfxR = ZZFX.sampleRate;
          window.zzfxG = (...args) => ZZFX.buildSamples(...args);
        });
        await page.addScriptTag({ url: base + "/html/libs/audio/zzfxm.js" });
        assert.equal(
          await page.evaluate(() =>
            zzfxM([[1, 0, 440]], [[[0, 0, 12]]], [0]).every(
              (c) => c.length > 0 && c.every(Number.isFinite),
            ),
          ),
          true,
        );
      } finally {
        await page.close();
      }
    },
  );
});
