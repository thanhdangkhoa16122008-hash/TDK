const { test } = require("node:test");
const assert = require("node:assert/strict");
const { serve, launch } = require("./helpers.cjs");

test("createInput lifecycle in Chromium", async (t) => {
  const base = await serve(t);
  const browser = await launch(t);
  async function check(name, fn) {
    await t.test(name, async () => {
      const page = await browser.newPage({ hasTouch: true });
      try {
        await page.goto(base + "/fixture.html");
        await page.evaluate(async () => {
          const { createInput } = await import("/html/kit/input.js");
          window.createInput = createInput;
        });
        await fn(page);
      } finally {
        await page.close();
      }
    });
  }
  async function countListeners(session, expression, types) {
    const result = await session.send("Runtime.evaluate", { expression });
    const { listeners } = await session.send("DOMDebugger.getEventListeners", {
      objectId: result.result.objectId,
    });
    return listeners.filter((listener) => types.includes(listener.type)).length;
  }
  await check(
    "destroy removes actual window/document and detached-button listeners",
    async (page) => {
      const session = await page.context().newCDPSession(page);
      const windowTypes = ["keydown", "keyup", "blur"];
      const docTypes = ["visibilitychange"];
      const beforeWindow = await countListeners(session, "window", windowTypes);
      const beforeDoc = await countListeners(session, "document", docTypes);
      await page.evaluate(() => {
        window.input = createInput();
        window.button = document.querySelector("button");
      });
      assert.equal(
        await countListeners(session, "window", windowTypes),
        beforeWindow + 3,
      );
      assert.equal(
        await countListeners(session, "document", docTypes),
        beforeDoc + 1,
      );
      assert.equal(
        await countListeners(session, "button", [
          "pointerdown",
          "pointerup",
          "pointerleave",
          "pointercancel",
          "lostpointercapture",
        ]),
        5,
      );
      await page.evaluate(() => input.destroy());
      assert.equal(
        await countListeners(session, "window", windowTypes),
        beforeWindow,
      );
      assert.equal(
        await countListeners(session, "document", docTypes),
        beforeDoc,
      );
      assert.equal(
        await countListeners(session, "button", [
          "pointerdown",
          "pointerup",
          "pointerleave",
          "pointercancel",
          "lostpointercapture",
        ]),
        0,
      );
    },
  );
  await check(
    "destroy resets state and prevents detached controls from reacting",
    async (page) => {
      assert.equal(
        await page.evaluate(() => {
          const input = createInput();
          const button = document.querySelector("button");
          dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
          button.dispatchEvent(
            new PointerEvent("pointerdown", { pointerId: 1 }),
          );
          input.destroy();
          dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
          dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
          button.dispatchEvent(
            new PointerEvent("pointerdown", { pointerId: 2 }),
          );
          return (
            input.move.x === 0 &&
            input.move.y === 0 &&
            !input.held("jump") &&
            !input.pressed("jump")
          );
        }),
        true,
      );
    },
  );
  await check(
    "destroy is idempotent and removes only its own DOM",
    async (page) => {
      assert.equal(
        await page.evaluate(() => {
          const other = document.createElement("button");
          other.textContent = "other";
          document.body.appendChild(other);
          const input = createInput();
          input.destroy();
          input.destroy();
          return (
            other.isConnected &&
            document.querySelectorAll("button").length === 1 &&
            document.querySelectorAll("div").length === 0
          );
        }),
        true,
      );
    },
  );
  await check(
    "destroying one instance leaves another keyboard/pointer instance working",
    async (page) => {
      assert.equal(
        await page.evaluate(() => {
          const first = createInput({ buttons: ["jump"] });
          const second = createInput({ buttons: ["action"] });
          const button = [...document.querySelectorAll("button")].find(
            (b) => b.textContent === "ACTION",
          );
          first.destroy();
          dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
          button.dispatchEvent(
            new PointerEvent("pointerdown", { pointerId: 3 }),
          );
          const active =
            second.move.y === 1 &&
            second.held("action") &&
            second.pressed("action") &&
            first.move.y === 0;
          second.destroy();
          return active && document.querySelectorAll("button").length === 0;
        }),
        true,
      );
    },
  );
  await check(
    "destroying an active joystick leaves another active joystick responding",
    async (page) => {
      assert.equal(
        await page.evaluate(() => {
          const first = createInput();
          const second = createInput();
          const zones = [...document.querySelectorAll("div")].filter(
            (div) => div.style.width === "50%",
          );
          const touch = (zone, type, id, x, y) =>
            zone.dispatchEvent(
              new PointerEvent(type, {
                bubbles: true,
                pointerId: id,
                pointerType: "touch",
                buttons: 1,
                clientX: x,
                clientY: y,
              }),
            );
          touch(zones[0], "pointerdown", 9, 100, 200);
          touch(zones[0], "pointermove", 9, 140, 180);
          touch(zones[1], "pointerdown", 10, 200, 200);
          touch(zones[1], "pointermove", 10, 240, 180);
          const bothMoved = first.move.x > 0 && second.move.x > 0;
          const before = second.move.x;
          first.destroy();
          touch(zones[1], "pointermove", 10, 260, 200);
          const responsive = second.move.x > before && first.move.x === 0;
          second.destroy();
          return bothMoved && responsive;
        }),
        true,
      );
    },
  );
  await check("destroy works without nipplejs", async (page) => {
    assert.equal(
      await page.evaluate(() => {
        window.nipplejs = undefined;
        const input = createInput();
        input.destroy();
        input.destroy();
        return (
          input.move.y === 0 &&
          document.querySelectorAll("button,div").length === 0
        );
      }),
      true,
    );
  });
  await check(
    "active joystick destruction does not leave document pointer handlers",
    async (page) => {
      const session = await page.context().newCDPSession(page);
      const before = await countListeners(session, "document", [
        "pointermove",
        "pointerup",
        "pointercancel",
        "pointerleave",
      ]);
      await page.evaluate(() => {
        window.input = createInput();
        window.zone = document.querySelector("div");
        for (const [type, x, y] of [
          ["pointerdown", 100, 200],
          ["pointermove", 140, 180],
        ])
          zone.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              pointerId: 9,
              pointerType: "touch",
              buttons: 1,
              clientX: x,
              clientY: y,
            }),
          );
        if (Math.hypot(input.move.x, input.move.y) === 0)
          throw Error("joystick must move before destruction");
        input.destroy();
      });
      assert.equal(
        await countListeners(session, "document", [
          "pointermove",
          "pointerup",
          "pointercancel",
          "pointerleave",
        ]),
        before,
      );
      assert.equal(
        await page.evaluate(() => input.move.x === 0 && input.move.y === 0),
        true,
      );
    },
  );
  await check(
    "repeated create/destroy restores listener and DOM baseline",
    async (page) => {
      const session = await page.context().newCDPSession(page);
      const before = await countListeners(session, "window", [
        "keydown",
        "keyup",
        "blur",
      ]);
      assert.equal(
        await page.evaluate(() => {
          for (let i = 0; i < 10; i++) createInput().destroy();
          return document.querySelectorAll("button,div").length === 0;
        }),
        true,
      );
      assert.equal(
        await countListeners(session, "window", ["keydown", "keyup", "blur"]),
        before,
      );
    },
  );
});
