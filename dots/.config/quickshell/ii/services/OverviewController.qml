pragma Singleton
pragma ComponentBehavior: Bound

import qs
import qs.modules.common
import QtQuick
import Quickshell
import Quickshell.Io

Singleton {
    id: root

    property var pendingActions: []
    property string currentAction: ""
    property bool showShellAfterDispatch: false
    property string dispatchedAction: ""
    property var searchCallback: null

    function toggle() {
        request("toggle");
    }

    function open() {
        request("open");
    }

    function close() {
        request("close");
    }

    // Search is still provided by Quickshell, even on scrolling workspaces.
    function prepareSearch(callback) {
        request("search", callback);
    }

    function request(action, callback) {
        root.pendingActions.push({ action: action, callback: callback });
        processNext();
    }

    function processNext() {
        if (root.currentAction !== "" || root.pendingActions.length === 0)
            return;

        const next = root.pendingActions.shift();
        root.currentAction = next.action;
        root.searchCallback = next.callback ?? null;
        root.showShellAfterDispatch = false;
        if (root.currentAction === "search") {
            dispatchOverview("close");
        } else if (root.currentAction === "close" || (root.currentAction === "toggle" && GlobalStates.overviewOpen)) {
            GlobalStates.overviewOpen = false;
            dispatchOverview("close");
        } else {
            getWorkspace.running = true;
        }
    }

    function workspaceReceived(text) {
        let workspace = null;
        try {
            workspace = JSON.parse(text);
        } catch (error) {
            console.warn("[OverviewController] Cannot read active workspace:", error);
        }

        if (workspace?.tiledLayout === "scrolling" && (Config.options.overview.enable ?? true)) {
            GlobalStates.overviewOpen = false;
            dispatchOverview(root.currentAction);
        } else {
            // Close any native overview left on another workspace before showing QML.
            root.showShellAfterDispatch = true;
            dispatchOverview("close");
        }
    }

    function dispatchOverview(action) {
        // This configuration uses Hyprland's Lua dispatcher syntax.
        root.dispatchedAction = action;
        dispatchProcess.command = ["hyprctl", "dispatch", `hl.plugin.scrolloverview.overview("${action}")`];
        dispatchProcess.running = true;
    }

    function dispatchFinished(exitCode, text) {
        const opening = root.currentAction === "toggle" || root.currentAction === "open";
        const failed = exitCode !== 0 || text.trim() !== "ok";
        if (root.showShellAfterDispatch || (opening && root.dispatchedAction !== "close" && failed)) {
            if (!root.showShellAfterDispatch)
                console.warn("[OverviewController] ScrollOverview unavailable; using the shell overview:", text.trim());
            GlobalStates.overviewOpen = true;
        }
        if (root.searchCallback)
            root.searchCallback();
        root.searchCallback = null;
        root.currentAction = "";
        Qt.callLater(root.processNext);
    }

    Process {
        id: getWorkspace
        command: ["hyprctl", "activeworkspace", "-j"]
        stdout: StdioCollector { id: workspaceOutput }
        onExited: (exitCode, exitStatus) => root.workspaceReceived(exitCode === 0 ? workspaceOutput.text : "")
    }

    Process {
        id: dispatchProcess
        stdout: StdioCollector { id: dispatchOutput }
        onExited: (exitCode, exitStatus) => root.dispatchFinished(exitCode, dispatchOutput.text)
    }
}
