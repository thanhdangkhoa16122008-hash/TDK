# TDK regression tests

Run from the repository root with Node.js 20+, Chromium, and Godot 4.5+ (validated on Node 24.19.0 and Godot 4.6.3):

```sh
npm ci
npm test
```

`npm run test:html` runs the browser audit, input/audio/model regressions and all current templates (three games and the character viewer). Each template is built twice on a separate copy of `html/`, compared byte for byte, and browser-tested as both source and a standalone bundle. The character viewer is exercised through its animation and hair controls. Bundles are tested with additional resource requests blocked. This does not certify direct `file://` operation or real mobile-device performance.

The browser tests use `/usr/bin/chromium` when present. Else install Playwright Chromium with `npx playwright install chromium`, or select a system executable with `CHROMIUM_PATH=/path/to/chromium npm run test:html`. Rendering uses SwiftShader in headless mode. Input regression tests exercise actual DOM events and the vendored nipplejs manager.

`npm run test:godot` copies the addons to a fresh temporary project, imports assets, enables all five plugins, then executes the 26 runtime checks in `godot/audit.gd`. Select another engine executable with `GODOT_PATH=/path/to/godot`. No checkout addon files or existing user projects are modified. The previously observed editor ObjectDB/UndoRedo shutdown warning is reported separately; unexpected warnings and script/runtime errors fail the runner.

Generated projects, JSON results, screenshots and build outputs are retained in distinct `tdk-*` directories under the OS temporary directory. The runners print their artifact paths and return a nonzero status when checks fail. They do not delete existing work or overwrite the original audit artifacts.

Invalid model inputs now throw `RangeError`: `crop.stage` must be an integer 0–3; `scatter.count` a safe nonnegative integer, `area` finite and positive, `avoid` finite and nonnegative, and `seed` a safe integer. A nonempty scatter request needs `avoid < area / sqrt(2)`; rejection sampling is limited to 10,000 attempts per object. Zero/modulus-zero seeds normalize to 1; ordinary positive seed layouts are preserved. Scatter failure after earlier objects were added is not transactional.

For modern ZzFXM integration:

```js
import { ZZFX } from '../html/libs/audio/zzfx.js';
import { zzfxM } from '../html/kit/zzfxm.js';
const samples = zzfxM(instruments, patterns, sequence, 125);
ZZFX.playSamples(samples);
```

Use paths relative to your game. Classic script callers may still supply legacy `zzfxR`/`zzfxG` globals, or pass the current `ZZFX` engine as the fifth argument to `zzfxM`. Missing engine prerequisites throw a descriptive error rather than returning empty channels.
