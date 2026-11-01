const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const shell = path.join(__dirname, "../dots/.config/quickshell/ii");
const read = file => fs.readFileSync(path.join(shell, file), "utf8");
function binding(source, name) {
    const match = source.match(new RegExp(`^\\s*(?:property [\\w<>]+ )?${name}: (.+)$`, "m"));
    assert.ok(match, `Binding ${name} exists`);
    return match[1];
}
const evaluate = (expression, context) => vm.runInNewContext(expression, context);

test("audio sliders tolerate missing devices and guard writes", () => {
    const source = read("modules/ii/sidebarRight/QuickSliders.qml");
    for (const device of ["sink", "source"]) {
        const expression = source.match(new RegExp(`value: (Audio\\.${device}[^\\n]+)`))[1];
        assert.equal(evaluate(expression, { Audio: { [device]: null } }), 0);
        assert.equal(evaluate(expression, { Audio: { [device]: {} } }), 0);
        const audio = { volume: 0.42 };
        assert.equal(evaluate(expression, { Audio: { [device]: { audio } } }), 0.42);
        const handler = source.match(new RegExp(`onMoved: \\{\\s*(const audio = Audio\\.${device}[\\s\\S]*?)\\n                \\}`))[1];
        evaluate(handler, { Audio: { [device]: null }, value: 0.6 });
        evaluate(handler, { Audio: { [device]: { audio } }, value: 0.6 });
        assert.equal(audio.volume, 0.6);
    }
});

test("AI tool list tolerates absent and unsupported models", () => {
    const expression = binding(read("services/Ai.qml"), "availableTools");
    for (const models of [{}, { selected: { api_format: "unknown" } }]) {
        assert.equal(evaluate(expression, { root: { tools: {} }, models, currentModelId: "selected" }).length, 0);
    }
    const tools = evaluate(expression, {
        root: { tools: { gemini: { search: [], none: [] } } },
        models: { selected: { api_format: "gemini" } }, currentModelId: "selected",
    });
    assert.deepEqual(Array.from(tools), ["search", "none"]);
});

test("AI model indicator tolerates missing saved or not-yet-loaded models", () => {
    const source = read("modules/ii/sidebarLeft/AiChat.qml");
    const expression = source.match(/text: (Ai\.getModel\(\)[^\n]+)/)[1];
    const Translation = { tr: text => text };
    assert.equal(evaluate(expression, { Ai: { getModel: () => undefined }, Translation }), "No model selected");
    assert.equal(evaluate(expression, { Ai: { getModel: () => ({ name: "Test model" }) }, Translation }), "Test model");
    assert.doesNotMatch(source, /Ai\.getModel\(\)\.name/);
});

test("notification UI uses the monitor field defined in the config schema", () => {
    const config = read("modules/common/Config.qml");
    assert.match(config, /property JsonObject notifications: JsonObject \{\s*property int timeout: \d+\s*property JsonObject monitor:/);
    for (const file of ["modules/ii/notificationPopup/NotificationPopup.qml", "modules/settings/InterfaceConfig.qml"]) {
        const source = read(file);
        assert.doesNotMatch(source, /notifications\.forceMonitor/);
        assert.match(source, /notifications\.monitor\.enable/);
        assert.match(source, /notifications\.monitor\.name/);
    }
});

test("workspace group retains its defined default padding", () => {
    assert.doesNotMatch(read("modules/ii/bar/BarContent.qml"), /workspacesWidget\.widgetPadding/);
    assert.match(read("modules/ii/bar/BarGroup.qml"), /property real padding: 5/);
});

test("tab indicator handles empty models and selects actual repeater items", () => {
    const source = read("modules/common/widgets/ToolbarTabBar.qml");
    const target = binding(source, "targetItem");
    assert.equal(evaluate(target, { tabButtons: { count: 0 }, root: { currentIndex: -1 } }), null);
    const item = { x: 20, width: 50 };
    assert.deepEqual(evaluate(target, { tabButtons: { count: 1, itemAt: () => item }, root: { currentIndex: 0 } }), item);
    for (const expression of [...source.matchAll(/^\s*index: (activeIndicator[^\n]+|\(activeIndicator[^\n]+)$/gm)].map(match => match[1])) {
        assert.equal(evaluate(expression, { activeIndicator: { targetItem: null } }), 0);
    }
    assert.doesNotMatch(source, /contentItem\.children\[root.currentIndex\]/);
});

test("only generated translations allow a missing file; other failures remain visible", () => {
    const source = read("services/Translation.qml");
    assert.match(source, /id: generatedTranslationFileView\s*optional: true/);
    assert.match(source, /printErrors: !optional/);
    assert.match(source, /translationReader.optional && error !== FileViewError.FileNotFound/);
    assert.match(source, /console.warn\("\[Translation\] Failed to load translations:/);
});
