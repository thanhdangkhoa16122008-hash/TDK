const { test } = require("node:test");
const assert = require("node:assert/strict");
const { serve, launch } = require("./helpers.cjs");

test("input regressions in Chromium", async (t) => {
  const base = await serve(
    t,
    process.env.TDK_INPUT_BASELINE
      ? { "/html/kit/input.js": process.env.TDK_INPUT_BASELINE }
      : {},
  );
  const browser = await launch(t);
  async function check(name, fn) {
    await t.test(name, async () => {
      const page = await browser.newPage({ hasTouch: true });
      try {
        await page.goto(base + "/fixture.html");
        await page.evaluate(async () => {
          const { createInput } = await import("/html/kit/input.js");
          window.input = createInput({ buttons: ["jump", "action"] });
          window.key = (type, code) =>
            dispatchEvent(new KeyboardEvent(type, { code }));
          window.pointer = (type, id, name = "jump") => {
            const button = [...document.querySelectorAll("button")].find(
              (b) => b.textContent === name.toUpperCase(),
            );
            button.dispatchEvent(new PointerEvent(type, { pointerId: id }));
          };
        });
        assert.equal(await page.evaluate(fn), true);
      } finally {
        await page.close();
      }
    });
  }
  await check("blur clears movement, held actions and queued presses", () => {
    key("keydown", "KeyW");
    key("keydown", "Space");
    pointer("pointerdown", 1);
    dispatchEvent(new Event("blur"));
    return (
      input.move.x === 0 &&
      input.move.y === 0 &&
      !input.held("jump") &&
      !input.pressed("jump")
    );
  });
  await check("hidden document clears input", () => {
    key("keydown", "KeyD");
    key("keydown", "KeyE");
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    return (
      input.move.x === 0 && !input.held("action") && !input.pressed("action")
    );
  });
  await check("pointercancel clears held action", () => {
    pointer("pointerdown", 1);
    input.pressed("jump");
    pointer("pointercancel", 1);
    return !input.held("jump");
  });
  await check("lostpointercapture clears held action", () => {
    pointer("pointerdown", 1);
    pointer("lostpointercapture", 1);
    return !input.held("jump");
  });
  await check("another mapped key keeps action held", () => {
    key("keydown", "KeyE");
    key("keydown", "KeyF");
    key("keyup", "KeyE");
    const held = input.held("action");
    key("keyup", "KeyF");
    return held && !input.held("action");
  });
  await check("keyboard release preserves a held pointer", () => {
    pointer("pointerdown", 1);
    key("keydown", "Space");
    key("keyup", "Space");
    const held = input.held("jump");
    pointer("pointerup", 1);
    return held && !input.held("jump");
  });
  await check("pointer release preserves a held keyboard key", () => {
    key("keydown", "Space");
    pointer("pointerdown", 1);
    pointer("pointerup", 1);
    const held = input.held("jump");
    key("keyup", "Space");
    return held && !input.held("jump");
  });
  await check("one cancelled finger preserves another finger", () => {
    pointer("pointerdown", 1);
    pointer("pointerdown", 2);
    pointer("pointercancel", 1);
    const held = input.held("jump");
    pointer("pointerup", 2);
    return held && !input.held("jump");
  });
  await check("one released finger preserves another finger", () => {
    pointer("pointerdown", 1);
    pointer("pointerdown", 2);
    pointer("pointerup", 1);
    const held = input.held("jump");
    pointer("pointerup", 2);
    return held && !input.held("jump");
  });
  await check(
    "keyboard diagonal is normalized and press is consumed once",
    () => {
      key("keydown", "KeyW");
      key("keydown", "KeyD");
      key("keydown", "Space");
      const valid =
        Math.abs(Math.hypot(input.move.x, input.move.y) - 1) < 1e-10;
      return valid && input.pressed("jump") && !input.pressed("jump");
    },
  );
  await check("blur clears real nipplejs joystick movement", async () => {
    // Chromium nipplejs selects Pointer Events; exercise the real vendored manager.
    const zone = [...document.querySelectorAll("div")][0];
    const touch = (type, x, y) => {
      zone.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 9,
          pointerType: "touch",
          isPrimary: true,
          buttons: 1,
          clientX: x,
          clientY: y,
        }),
      );
    };
    touch("pointerdown", 100, 200);
    touch("pointermove", 140, 180);
    const moved = Math.hypot(input.move.x, input.move.y) > 0;
    dispatchEvent(new Event("blur"));
    return moved && input.move.x === 0 && input.move.y === 0;
  });
});
