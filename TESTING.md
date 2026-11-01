# Test the fork without installing it

The ScrollOverview change is entirely in Quickshell. Run that shell from a separate
checkout rather than running the fork's `setup`, copying files into `~/.config`,
changing the upstream remote, or cherry-picking the PR into your normal checkout.

## On the test machine

1. Keep your existing upstream checkout and installation as they are. Clone the
   fork separately (or use an existing separate clone):

   ```sh
   git clone --recurse-submodules https://github.com/NeoPlayer13/dots-hyprland.git dots-hyprland-fork
   cd dots-hyprland-fork
   git submodule update --init --recursive
   ```

   Check out the branch/commit you want to test in **this fork checkout** before
   launching. The helper runs its current files, including uncommitted edits.

2. Use a terminal inside the working Hyprland session. The installed `ii` shell
   must be running, with its usual dependencies and environment (including
   `ILLOGICAL_IMPULSE_VIRTUAL_ENV`). `qs`, `hyprctl`, and `flock` must
   be available. The environment variable must point to an existing working shell
   environment. Use one installed shell instance, without a service supervisor
   that automatically restarts it.

   For the native overview, the session also needs a compatible Hyprland with
   Lua dispatchers, a scrolling workspace, and ScrollOverview already installed
   and loaded. The helper does **not** install plugins, update Hyprland, or change
   compositor configuration. An older session can test fallback, not native routing.

   Inspect the session without changing it:

   ```sh
   hyprctl version
   hyprctl activeworkspace -j
   hyprctl plugin list
   ```

3. Start the temporary test:

   ```sh
   ./test-shell
   ```

   For a nonstandard installed shell location, pass the path it was launched from:

   ```sh
   ./test-shell --installed "$HOME/.config/quickshell/ii/shell.qml"
   ```

   The helper checks prerequisites, stops only that configuration, and runs the
   fork with `qs -p`. Logs stay in the terminal. Installed Quickshell files,
   Hyprland configuration, installation records, and both repositories' Git
   settings are untouched by the helper.

4. Press **Ctrl+C** to stop testing. Normal exit, startup failure, SIGTERM, and
   terminal hangup also trigger cleanup: stop the test shell, close any native
   overview, and restart the installed shell. Nothing needs to be uninstalled.

## What to check

- On a workspace whose `hyprctl activeworkspace -j` reports
  `"tiledLayout": "scrolling"`, **Super+Tab**, the bar's overview button/workspace
  area, and the dock overview action should open ScrollOverview, not QML previews.
- On `dwindle` or `master`, those actions should open the Quickshell overview.
- Switch between scrolling and non-scrolling workspaces and try again. Routing
  should follow the current workspace, not the previous one.
- Try rapid toggles, selecting a window, and Escape. No stale overlay should remain.
- Search (**Super**), clipboard (**Super+V**), and emoji (**Super+Period**) should
  still use Quickshell, including after opening the native overview.
- With ScrollOverview absent/unloaded in a test session, the scrolling overview
  should fall back to Quickshell. Do not unload plugins on a session you depend on.
- Repeat using the waffle panel family/task-view button if you use that UI.

For explicit IPC tests, from the fork directory in another terminal:

```sh
qs -p "$PWD/dots/.config/quickshell/ii" ipc show
qs -p "$PWD/dots/.config/quickshell/ii" ipc call overview open
qs -p "$PWD/dots/.config/quickshell/ii" ipc call overview close
qs -p "$PWD/dots/.config/quickshell/ii" ipc call overview toggle
```

## Limits and recovery

This is a **live-shell test, not a sandbox**. The fork shares your preferences,
cache, notifications, clipboard, and desktop services. Settings changes and
normal shell startup side effects can persist. Back up personal settings first
if needed; do not test unrelated settings/theme/update actions. Use a disposable
user/session or VM if you need complete isolation.

Global shortcuts still reach the temporary shell. Commands hardcoded to
`qs -c ii` (including the installed clipboard watcher), settings/welcome launchers,
and **Ctrl+Super+R** still target the installed configuration. Do not use the
shell-restart shortcut or run an updater during the test. Use `qs -p` as above
for fork IPC; this deliberately avoids persistent keybind or clipboard-watcher edits.

SIGKILL, power loss, or a compositor crash cannot run cleanup. After a killed
helper, recover from a terminal in the same graphical session (substitute paths
if needed):

```sh
qs -p /absolute/path/to/dots-hyprland-fork/dots/.config/quickshell/ii kill
hyprctl dispatch 'hl.plugin.scrolloverview.overview("close")'
qs -c ii --no-duplicate --daemonize
```

A missing test instance or unloaded plugin may report an error; continue with
the remaining commands. Logging out and back in also launches your unchanged
installed shell. If a terminal hangup prevents automatic restart, use the final
command above.

After testing, update upstream using your normal upstream checkout and workflow.
If the PR is rejected, stop the test and remove the separate fork checkout when
no longer needed. There is no installed patch, symlink, alternate remote, or
update hook to undo. Future fork tests likewise need no reinstall: update the
fork checkout and rerun `./test-shell`.

## Automated checks (no desktop required)

With Node.js installed:

```sh
bash -n test-shell
node --test tests/*.test.cjs
```

The controller tests cover routing and fallback. The launcher tests mock
Quickshell/Hyprland to check restoration, failure handling, signals, and
non-modification of installed files. They do not replace a real compositor test.
