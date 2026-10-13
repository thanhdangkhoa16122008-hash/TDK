const { cpSync, mkdirSync, writeFileSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");
const { root, artifacts } = require("./helpers.cjs");

const output = artifacts("tdk-godot-");
const project = join(output, "project");
mkdirSync(project);
cpSync(join(root, "godot/addons"), join(project, "addons"), {
  recursive: true,
});
cpSync(join(root, "tests/godot/audit.gd"), join(project, "audit.gd"));
writeFileSync(
  join(project, "project.godot"),
  'config_version=5\n[application]\nconfig/name="TDK Regression Audit"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n',
);
const env = { ...process.env };
for (const [variable, dir] of [
  ["XDG_DATA_HOME", "data"],
  ["XDG_CONFIG_HOME", "config"],
  ["XDG_CACHE_HOME", "cache"],
]) {
  env[variable] = join(output, dir);
  mkdirSync(env[variable]);
}
function run(label, args, allowEditorLeak = false) {
  const result = spawnSync(process.env.GODOT_PATH || "godot", args, {
    env,
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const log = (result.stdout || "") + (result.stderr || "");
  writeFileSync(join(output, `${label}.log`), log);
  console.log(label, "exit", result.status);
  if (result.error || result.status !== 0 || /SCRIPT ERROR|ERROR:/.test(log))
    throw Error(`${label} failed: ${result.error || log}`);
  if (/WARNING:/.test(log)) {
    const warnings = log
      .split("\n")
      .filter((line) => line.includes("WARNING:"));
    const expected =
      allowEditorLeak &&
      warnings.every((line) =>
        line.includes("ObjectDB instances leaked at exit"),
      );
    if (!expected) throw Error(`${label} unexpected warning: ${log}`);
    console.log(
      "Known audit warning: editor UndoRedo instances leaked at exit; see",
      join(output, `${label}.log`),
    );
  }
  return log;
}
console.log("Godot artifacts:", output);
run("import", ["--headless", "--editor", "--path", project, "--import"]);
const plugins = [
  "beehave",
  "dialogic",
  "godot_sfxr",
  "phantom_camera",
  "virtual_joystick",
];
writeFileSync(
  join(project, "project.godot"),
  readFileSync(join(project, "project.godot"), "utf8") +
    "\n[editor_plugins]\nenabled=PackedStringArray(" +
    plugins.map((p) => `"res://addons/${p}/plugin.cfg"`).join(",") +
    ")\n",
);
run(
  "plugins",
  ["--headless", "--editor", "--path", project, "--import", "--verbose"],
  true,
);
const log = run("runtime", [
  "--headless",
  "--path",
  project,
  "--script",
  "res://audit.gd",
]);
const result = log.match(/RESULT: passed=(\d+) failed=(\d+)/);
if (!result || Number(result[1]) !== 26 || Number(result[2]) !== 0)
  throw Error("Godot audit did not execute all 26 checks successfully");
console.log(result[0]);
