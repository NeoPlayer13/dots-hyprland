const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { test } = require("node:test");

const launcher = path.join(__dirname, "../test-shell");
const mock = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const env = process.env;
const tool = path.basename(process.argv[1]);
fs.appendFileSync(env.MOCK_LOG, JSON.stringify({ tool, args }) + "\\n");
if (tool === "hyprctl") process.exit(env.MOCK_HYPR_FAIL === "1" ? 1 : 0);
if (env.QS_CONFIG_PATH || env.QS_CONFIG_NAME || env.QS_MANIFEST) process.exit(90);
if (args[0] !== "-p") process.exit(91);
const installed = args[1] === env.MOCK_INSTALLED;
const state = path.join(env.XDG_RUNTIME_DIR, installed ? "installed-running" : "fork-running");
const exists = () => fs.existsSync(state);
if (args.includes("ipc")) process.exit(exists() ? 0 : 1);
if (args.includes("kill")) {
    if (installed && env.MOCK_STOP_FAIL === "1") process.exit(7);
    if (installed && env.MOCK_STOP_STUCK === "1") process.exit(0);
    if (!exists()) process.exit(1);
    if (!installed) {
        try { process.kill(Number(fs.readFileSync(state)), "SIGTERM"); } catch {}
    }
    fs.rmSync(state, { force: true });
    process.exit(0);
}
if (installed) {
    if (!args.includes("--daemonize") || !args.includes("--no-duplicate")) process.exit(92);
    try {
        const fd = fs.fstatSync(9);
        const lock = fs.statSync(path.join(env.XDG_RUNTIME_DIR, "ii-test-shell.lock"));
        if (fd.ino === lock.ino && fd.dev === lock.dev) process.exit(93);
    } catch {}
    if (env.MOCK_RESTORE_FAIL === "1") process.exit(8);
    if (exists()) process.exit(0);
    fs.writeFileSync(state, "restored");
    process.exit(0);
}
if (env.MOCK_HOLD !== "1") process.exit(Number(env.MOCK_EXIT || 0));
fs.writeFileSync(state, String(process.pid));
process.on("SIGTERM", () => { fs.rmSync(state, { force: true }); process.exit(0); });
console.log("MOCK_FORK_READY");
setInterval(() => {}, 1000);
`;

function fixture(t, overrides = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ii-test-shell-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const repo = path.join(root, "fork checkout");
    const shell = path.join(repo, "dots/.config/quickshell/ii/shell.qml");
    const installed = path.join(root, "config/quickshell/ii/shell.qml");
    const shapes = path.join(path.dirname(shell), "modules/common/widgets/shapes/ShapeCanvas.qml");
    const bin = path.join(root, "bin");
    const runtime = path.join(root, "runtime");
    for (const file of [shell, installed, shapes]) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, "original\n");
    }
    fs.mkdirSync(bin);
    fs.mkdirSync(runtime);
    fs.mkdirSync(path.join(root, "venv"));
    fs.copyFileSync(launcher, path.join(repo, "test-shell"));
    for (const tool of ["qs", "hyprctl"]) {
        fs.writeFileSync(path.join(bin, tool), mock, { mode: 0o755 });
    }
    fs.writeFileSync(path.join(runtime, "installed-running"), "original");
    const env = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        HOME: root,
        XDG_CONFIG_HOME: path.join(root, "config"),
        XDG_RUNTIME_DIR: runtime,
        HYPRLAND_INSTANCE_SIGNATURE: "test-session",
        WAYLAND_DISPLAY: "wayland-test",
        MOCK_LOG: path.join(root, "commands.jsonl"),
        MOCK_INSTALLED: installed,
        QS_CONFIG_PATH: "must-not-override-explicit-path",
        QS_CONFIG_NAME: "must-not-override-explicit-path",
        QS_MANIFEST: "must-not-override-explicit-path",
        ILLOGICAL_IMPULSE_VIRTUAL_ENV: path.join(root, "venv"),
        ...overrides,
    };
    return {
        root, repo, shell, installed, shapes, runtime, env,
        run(args = []) {
            return spawnSync("bash", [path.join(repo, "test-shell"), ...args], {
                cwd: root, env, encoding: "utf8", timeout: 15000,
            });
        },
        calls() {
            if (!fs.existsSync(env.MOCK_LOG)) return [];
            return fs.readFileSync(env.MOCK_LOG, "utf8").trim().split("\n").map(JSON.parse);
        },
        restored(expected = "restored") {
            assert.equal(fs.readFileSync(path.join(runtime, "installed-running"), "utf8"), expected);
            assert.equal(fs.readFileSync(installed, "utf8"), "original\n");
            assert.equal(fs.readFileSync(shell, "utf8"), "original\n");
        },
    };
}

async function running(f, t) {
    const child = spawn("bash", [path.join(f.repo, "test-shell")], {
        cwd: f.root, env: { ...f.env, MOCK_HOLD: "1" }, timeout: 15000,
    });
    t.after(() => { if (child.exitCode === null) child.kill("SIGTERM"); });
    let output = "";
    const done = new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code, signal) => resolve({ code, signal, output }));
    });
    await new Promise((resolve, reject) => {
        child.stdout.on("data", data => {
            output += data;
            if (output.includes("MOCK_FORK_READY")) resolve();
        });
        child.stderr.on("data", data => { output += data; });
        child.on("error", reject);
        child.on("close", code => reject(new Error(`Exited before readiness: ${code}\n${output}`)));
    });
    return { child, done };
}

for (const code of [0, 17]) {
    test(`exit ${code} restores the installed shell without copying files`, t => {
        const f = fixture(t, { MOCK_EXIT: String(code) });
        const result = f.run();
        assert.equal(result.status, code, result.stderr);
        f.restored();
        const calls = f.calls();
        const stop = calls.findIndex(c => c.args[1] === f.installed && c.args.includes("kill"));
        const launch = calls.findIndex(c => c.tool === "qs" && c.args.length === 2 && c.args[1] === f.shell);
        const restore = calls.findIndex(c => c.args.includes("--daemonize"));
        assert.ok(stop >= 0 && launch > stop && restore > launch);
        assert.ok(calls.some(c => c.args[1] === 'hl.plugin.scrolloverview.overview("close")'));
        // A second launch must not inherit a stale session lock.
        assert.equal(f.run().status, code);
    });
}

for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) {
    test(`${signal} stops the fork and restores upstream`, async t => {
        const f = fixture(t);
        const { child, done } = await running(f, t);
        child.kill(signal);
        const result = await done;
        assert.equal(result.code, code, result.output);
        assert.equal(fs.existsSync(path.join(f.runtime, "fork-running")), false);
        f.restored();
    });
}

test("concurrent tests are rejected without stopping either shell", async t => {
    const f = fixture(t);
    const { child, done } = await running(f, t);
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /already running/);
    assert.equal(f.calls().filter(c => c.args.includes("kill")).length, 1);
    child.kill("SIGTERM");
    assert.equal((await done).code, 143);
    f.restored();
});

for (const [scenario, message] of [
    ["no session", /inside Hyprland/],
    ["no virtual environment", /ILLOGICAL_IMPULSE_VIRTUAL_ENV/],
    ["no installed instance", /No installed shell responding/],
    ["missing submodule", /Missing shapes submodule/],
    ["same checkout", /already points at this checkout/],
    ["fork running", /checkout is already running/],
    ["hyprctl failure", /Cannot contact Hyprland/],
]) {
    test(`${scenario} fails before stopping the installed shell`, t => {
        const f = fixture(t);
        if (scenario === "no session") f.env.HYPRLAND_INSTANCE_SIGNATURE = "";
        if (scenario === "no virtual environment") f.env.ILLOGICAL_IMPULSE_VIRTUAL_ENV = "";
        if (scenario === "no installed instance") fs.unlinkSync(path.join(f.runtime, "installed-running"));
        if (scenario === "missing submodule") fs.unlinkSync(f.shapes);
        if (scenario === "same checkout") {
            fs.unlinkSync(f.installed);
            fs.symlinkSync(f.shell, f.installed);
        }
        if (scenario === "fork running") fs.writeFileSync(path.join(f.runtime, "fork-running"), "existing");
        if (scenario === "hyprctl failure") f.env.MOCK_HYPR_FAIL = "1";
        const result = f.run();
        assert.equal(result.status, 1, result.stderr);
        assert.match(result.stderr, message);
        assert.equal(f.calls().some(c => c.args.includes("kill") || c.args.includes("--daemonize")), false);
    });
}

test("a failed stop never starts the fork and attempts a nonduplicating restart", t => {
    const f = fixture(t, { MOCK_STOP_FAIL: "1" });
    const result = f.run();
    assert.equal(result.status, 7, result.stderr);
    assert.equal(f.calls().some(c => c.tool === "qs" && c.args.length === 2), false);
    f.restored("original");
});

test("a shell that does not stop prevents a second shell from starting", t => {
    const f = fixture(t, { MOCK_STOP_STUCK: "1" });
    const result = f.run();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Installed shell did not stop/);
    assert.equal(f.calls().some(c => c.tool === "qs" && c.args.length === 2), false);
    f.restored("original");
});

test("a failed restore reports the manual recovery command", t => {
    const f = fixture(t, { MOCK_RESTORE_FAIL: "1" });
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Restart failed\. Run: qs -p .* --no-duplicate --daemonize/);
});

test("an explicit installed directory with spaces is supported", t => {
    const f = fixture(t);
    const directory = path.join(f.root, "custom installed shell");
    fs.mkdirSync(directory);
    fs.renameSync(f.installed, path.join(directory, "shell.qml"));
    f.env.MOCK_INSTALLED = path.join(directory, "shell.qml");
    const result = f.run(["--installed", directory]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(f.calls().some(c => c.args[1] === f.env.MOCK_INSTALLED && c.args.includes("--daemonize")));
});

test("relative installed paths retain their symlink spelling for instance selection", t => {
    const f = fixture(t);
    fs.symlinkSync(path.join(f.root, "config"), path.join(f.root, "config link"));
    f.env.MOCK_INSTALLED = path.join(f.root, "config link/quickshell/ii/shell.qml");
    const result = f.run(["--installed", "config link/quickshell/ii"]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(f.calls().some(c => c.args[1] === f.env.MOCK_INSTALLED && c.args.includes("--daemonize")));
    f.restored();
});

test("help and invalid arguments do not contact the desktop", t => {
    const f = fixture(t);
    assert.equal(f.run(["--help"]).status, 0);
    for (const args of [["--installed"], ["--unknown"], [""]]) {
        assert.equal(f.run(args).status, 1);
    }
    assert.deepEqual(f.calls(), []);
});
