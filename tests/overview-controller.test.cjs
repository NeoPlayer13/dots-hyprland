const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const shellPath = path.join(__dirname, "../dots/.config/quickshell/ii");
const source = fs.readFileSync(path.join(shellPath, "services/OverviewController.qml"), "utf8");

// Exercise the controller's actual JavaScript with the QML process objects mocked.
function controller() {
    const deferred = [];
    const context = vm.createContext({
        pendingActions: [],
        currentAction: "",
        showShellAfterDispatch: false,
        dispatchedAction: "",
        searchCallback: null,
        GlobalStates: { overviewOpen: false },
        Config: { options: { overview: { enable: true } } },
        getWorkspace: { running: false },
        dispatchProcess: { running: false, command: [] },
        Qt: { callLater: callback => deferred.push(callback) },
        console: { warn() {} },
    });
    context.root = context;
    const functions = source.match(/^    function \w+\([^\n]*\) \{[\s\S]*?^    \}/gm);
    assert.ok(functions?.length, "QML controller functions found");
    vm.runInContext(functions.join("\n"), context);
    context.workspace = data => {
        context.getWorkspace.running = false;
        context.workspaceReceived(typeof data === "string" ? data : JSON.stringify(data));
    };
    context.complete = (code = 0, text = "ok\n") => {
        context.dispatchProcess.running = false;
        context.dispatchFinished(code, text);
        while (deferred.length) deferred.shift()();
    };
    return context;
}

function dispatched(c, action) {
    assert.deepEqual(Array.from(c.dispatchProcess.command), [
        "hyprctl", "dispatch", `hl.plugin.scrolloverview.overview("${action}")`,
    ]);
}

test("scrolling uses the native toggle without opening a QML panel", () => {
    const c = controller();
    c.toggle();
    assert.equal(c.getWorkspace.running, true);
    c.workspace({ id: 3, tiledLayout: "scrolling" });
    dispatched(c, "toggle");
    c.complete();
    assert.equal(c.GlobalStates.overviewOpen, false);
    // Native selection/Escape need no local open-state synchronization.
    c.toggle();
    c.workspace({ id: 3, tiledLayout: "scrolling" });
    dispatched(c, "toggle");
});

test("each request rechecks the active workspace, including named workspaces", () => {
    const c = controller();
    c.open();
    c.workspace({ name: "web", tiledLayout: "scrolling" });
    dispatched(c, "open");
    c.complete();
    c.open();
    assert.equal(c.getWorkspace.running, true);
    c.workspace({ id: 4, tiledLayout: "dwindle" });
    dispatched(c, "close");
    c.complete();
    assert.equal(c.GlobalStates.overviewOpen, true);
});

for (const workspace of [{ tiledLayout: "dwindle" }, { tiledLayout: "master" }, {}, null, "invalid JSON", ""]) {
    test(`non-scrolling or unreadable workspace keeps the shell: ${JSON.stringify(workspace)}`, () => {
        const c = controller();
        c.toggle();
        c.workspace(workspace);
        dispatched(c, "close");
        c.complete(1, "plugin not loaded");
        assert.equal(c.GlobalStates.overviewOpen, true);
        c.toggle();
        assert.equal(c.GlobalStates.overviewOpen, false);
        dispatched(c, "close");
        c.complete(1, "plugin not loaded");
        assert.equal(c.GlobalStates.overviewOpen, false);
    });
}

for (const [code, text] of [[1, "plugin not loaded"], [0, "Lua error: plugin unavailable"], [0, ""]]) {
    test(`failed native dispatch falls back (${code}, ${JSON.stringify(text)})`, () => {
        const c = controller();
        c.open();
        c.workspace({ tiledLayout: "scrolling" });
        c.complete(code, text);
        assert.equal(c.GlobalStates.overviewOpen, true);
    });
}

test("disabled workspace previews do not invoke the native overview", () => {
    const c = controller();
    c.Config.options.overview.enable = false;
    c.open();
    c.workspace({ tiledLayout: "scrolling" });
    dispatched(c, "close");
    c.complete();
    assert.equal(c.GlobalStates.overviewOpen, true);
});

test("rapid toggles are serialized rather than dropped", () => {
    const c = controller();
    c.toggle();
    c.toggle();
    assert.equal(c.pendingActions.length, 1);
    c.workspace({ tiledLayout: "scrolling" });
    c.complete();
    assert.equal(c.getWorkspace.running, true);
    c.workspace({ tiledLayout: "scrolling" });
    dispatched(c, "toggle");
    c.complete();
    assert.equal(c.currentAction, "");
    assert.equal(c.pendingActions.length, 0);
});

test("close after an in-flight open closes the native overview", () => {
    const c = controller();
    c.open();
    c.close();
    c.workspace({ tiledLayout: "scrolling" });
    c.complete();
    dispatched(c, "close");
    c.complete();
    assert.equal(c.GlobalStates.overviewOpen, false);
});

test("search waits for native close and remains available without the plugin", () => {
    const c = controller();
    c.open();
    c.prepareSearch(() => { c.GlobalStates.overviewOpen = true; });
    c.workspace({ tiledLayout: "scrolling" });
    c.complete();
    dispatched(c, "close");
    assert.equal(c.GlobalStates.overviewOpen, false);
    c.complete(1, "plugin not loaded");
    assert.equal(c.GlobalStates.overviewOpen, true);
});

for (const file of [
    "modules/ii/bar/Workspaces.qml",
    "modules/ii/bar/BarContent.qml",
    "modules/ii/verticalBar/VerticalBarContent.qml",
    "modules/ii/dock/Dock.qml",
    "modules/waffle/bar/TaskViewButton.qml",
]) {
    test(`${file} routes overview clicks through the controller`, () => {
        const qml = fs.readFileSync(path.join(shellPath, file), "utf8");
        assert.match(qml, /import qs\.services/);
        assert.match(qml, /OverviewController\.toggle\(\)/);
        assert.doesNotMatch(qml, /GlobalStates\.overviewOpen = !GlobalStates\.overviewOpen/);
    });
}
