---
name: mullion-development
description: How to develop, test, package and release Mullion — the GTK 4 / libadwaita app, `mullion` CLI and GNOME Shell extension that let two computers share a Dell U4025QW over DDC/CI (inputs, PBP/PIP layouts, KVM keyboard/mouse switching, brightness, Quick Settings tile, screen-edge switching). Use this skill for any work in the Mullion repository, even small changes — new features, bug fixes, UI tweaks, translations, the extension, ddcutil/VCP code questions, tests, CI, Debian packaging or releases — and whenever the user mentions Mullion, the U4025QW, DDC/CI, VCP codes, the KVM, PBP or the monitor's layouts.
---

# Mullion development

Mullion shares one monitor between two computers from GNOME. The user runs
it on Ubuntu 26.04 (GNOME 50) with a Dell U4025QW, side by side with a Mac
that runs Dell Display and Peripheral Manager (DDPM). The session you work
in is usually **over SSH** into that Ubuntu machine: you can drive the real
monitor with `ddcutil`, but you cannot see the screen or GNOME Shell, and
you have no sudo — ask the user to run privileged commands with `! <cmd>`.

## Architecture

```
bin/mullion            launcher: no args → GUI, args → CLI
mullion/               Python package (installed to /usr/share/mullion/mullion)
  ddc.py               ddcutil wrapper: getvcp/setvcp/capabilities, sysfs discovery
  controller.py        everything the GUI and CLI share; config (update_config)
  cli.py               argparse front end; also what shortcuts/extension run
  gui.py               Adw window: Display / Shortcuts / Advanced tabs
  shortcuts.py         GNOME custom keybindings (assign/current/conflicts)
  extension.py         enable/disable the Shell extension over D-Bus
  osd.py               on-screen pop-up via the extension, else notification
  i18n.py              gettext domain "mullion"
extension/mullion@ivoks.github.io/
  extension.js         edge barriers, ShowOSD D-Bus method, Quick Settings hookup
  quickmenu.js         "Monitor" Quick Settings tile (runs `mullion state`)
  edgepopup.js         "Switch to …" pop-up at the screen edge
data/                  desktop file template, icons, man page (mullion.1)
po/                    mullion.pot, hr.po, LINGUAS, POTFILES
debian/                native package; builds/installs through the Makefile
tests/                 unittest suite + tests/extension (gjs behaviour checks)
```

The GUI, CLI, shortcuts, Quick Settings tile and extension all funnel into
`Controller`. The extension never talks DDC itself: it runs the `mullion`
command (`cross <edge> [--check]`, `state`, `usb toggle`, `layout …`), so
monitor logic lives in one place and is unit-testable.

Naming is deliberate and consistent — keep it: **main input** (VCP 60, left
or full screen), **second input** (VCP E8, right side or inset), **layout**
(VCP E9), **multi** (two inputs on screen), **this/other computer**. App ID
`io.github.ivoks.Mullion`; extension UUID `mullion@ivoks.github.io`.

## The monitor is live — be careful with it

Commands you run change the user's real screen. Before anything visible
(swap, layout, input, brightness), say what will happen and for how long.

- **KVM moves take the user's keyboard and mouse away.** Only do it when
  asked, and bring them back in the *same* command (`mullion usb away;
  sleep 5; mullion usb here`). Re-enumeration takes ~5 s.
- **Never write VCP codes blindly.** Standard codes include destructive
  ones (`04` = factory reset). Probing undocumented codes needs the user
  watching/listening and their go-ahead; announce each step.
- Read-only commands are safe: `mullion status`, `mullion state`,
  `mullion cross left --check`, `ddcutil --bus 13 getvcp …`.

`references/hardware.md` has the verified VCP codes, what does *not* work
(audio Main/Sub, E7 read-back), KVM detection, cabling, and the playbook
for discovering an unknown setting by diffing VCP snapshots.

## Everyday workflow

1. **Change the code**, keeping the GUI/CLI/extension paths in mind — a
   new monitor action usually needs a `Controller` method, a CLI command
   (the extension and shortcuts call the CLI), GUI wiring and `man` page.
2. **Settings**: change them with `ctl.update(key=value)` (or
   `update_config`), never `cfg[...] = …; save`. It re-reads the file under
   a lock so the app, shortcut commands and threads don't overwrite each
   other, and stores only non-default values. Consequence: if the extension
   also has a default for a setting, it must equal `DEFAULTS` — add a check
   to `tests/test_release.py` (see `edge_pressure`).
3. **Strings**: wrap every user-visible string in `_()` (Python) or `_()`
   from the extension module (JS); use named placeholders
   (`_("Switched to {input}").format(input=…)`, JS `.replace('{name}', …)`).
   Adw row titles/subtitles are Pango markup — escape `&` with
   `GLib.markup_escape_text()` in code, never put `&amp;` in a msgid.
   Then run the translation steps in `references/workflow.md`.
4. **Tests**: add/extend unittest cases. Tests must never touch hardware —
   `tests/__init__.py` makes `ddc._run` raise; use `FakeMonitor` from
   `tests/test_controller.py`. Tests run in CI without GTK, so don't import
   `mullion.gui` in them. Extension logic goes in `tests/extension/check.js`
   with the stubs in `tests/extension/stubs.js`.
5. **Verify**: `make check` (tests, translations, desktop file, extension
   checks). For UI changes run the headless GUI smoke test; for packaging
   or release changes build the .deb in a clean copy. Scripts below.
6. **Hand over**: tell the user how to try it (install the .deb; extension
   changes need a log out/in). Commit only when the user asks.

## Helper scripts (in this skill's `scripts/`)

- `gui-smoke.py <repo> [--screenshot out.png] [--tab shortcuts]` — opens
  the real window headlessly (gtk4-broadwayd) against the real monitor with
  a throwaway config and in-memory GSettings, prints the key widget state
  and optionally saves a PNG you can look at with the Read tool.
- `build-deb.sh <repo> [outdir]` — builds the package from a clean copy of
  the tracked + new files (never in-tree: in-tree builds leave
  `debian/mullion/` etc. behind), runs lintian with warnings as errors.
- `ci-replay.sh <repo>` — runs `.github/workflows/ci.yml`'s steps in a
  fresh `ubuntu:26.04` container, then cleans up its root-owned files.
  Use before pushing CI or dependency changes.

## GNOME Shell extension

The extension is the only way to do pointer-related things on Wayland.
Read `references/gnome-shell.md` before changing it: how to check APIs
against the GNOME 50 sources on this machine, why module load must not
touch Shell-only APIs, restrictions such as `org.gnome.Shell.ShowOSD`, and
that new extension code only loads after the user logs out and back in —
you can't test it in the live Shell from SSH, which is why its behaviour is
covered by `tests/extension/check.js`.

## Commits, CI and releases

- Commit only when asked; push to `main` (there is no `master`). Message:
  short imperative subject, a body explaining *why* and listing changes,
  then the `Co-Authored-By:` trailer the session specifies.
- After pushing, watch CI through the public API (no auth needed):
  `curl -s "https://api.github.com/repos/ivoks/mullion/actions/runs?per_page=1&head_sha=$(git rev-parse HEAD)"`.
  `gh` is logged in to the user's GitHub account (`gh auth status`), so
  `gh run view <id> --log-failed -R ivoks/mullion` shows a failed job's
  log; `ci-replay.sh` reproduces it locally.
- Releases only when asked. Version lives in `mullion/__init__.py`,
  `debian/changelog` and the man page header; `tests/test_release.py`
  checks they agree. You tag and push, build the assets from the tag
  (`git archive`), write release notes, and publish the GitHub release
  with `gh release create … -R ivoks/mullion`, then verify the public
  downloads against `SHA256SUMS`.

`references/workflow.md` has the exact commands for translations,
packaging, CI replay and releases.
