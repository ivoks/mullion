# Mullion

**Share one monitor between two computers, from GNOME.**

[![CI](https://github.com/ivoks/mullion/actions/workflows/ci.yml/badge.svg)](https://github.com/ivoks/mullion/actions/workflows/ci.yml)

A GTK 4 / libadwaita app and command line tool that does on GNOME what Dell
Display and Peripheral Manager does on macOS, for a Dell U4025QW shared by
two computers: switch inputs, pick a screen layout (side by side or picture
in picture), swap sides, hand the monitor's USB hub (keyboard and mouse) to
the other computer, and set brightness, contrast and volume. A GNOME Shell
extension adds a Quick Settings tile, on-screen feedback and switching the
keyboard and mouse at the screen edge.

It talks to the monitor over **DDC/CI** (VESA MCCS) using `ddcutil`.

*A mullion is the vertical bar that divides a window into panes, like the
line between two computers sharing a monitor side by side.*

## Install

Build and install the Debian package (Ubuntu 26.04):

```sh
sudo apt install build-essential debhelper dh-python gettext python3-gi \
    desktop-file-utils
dpkg-buildpackage -us -uc -b
sudo apt install ../mullion_*_all.deb
```

Or install just for yourself from the source folder:

```sh
sudo apt install ddcutil python3-gi gir1.2-adw-1 gettext make
make install PREFIX=$HOME/.local        # make uninstall PREFIX=… removes it
```

Then log out and back in once, so GNOME Shell finds the extension.

Monitor access works out of the box for the user at the local desktop (the
ddcutil package grants it). Elsewhere, e.g. over SSH, add yourself to the
`i2c` group: `sudo usermod -aG i2c $USER`.

## Use

Launch **Mullion** from the app grid, or use the CLI:

```
mullion status
mullion detect          # which input is this computer plugged into
mullion switch          # two inputs: move KVM; one: flip input
mullion layout list|next|<name>   # see layouts below
mullion pbp on|off|toggle    # last used two-input layout / single
mullion swap            # swap the two inputs
mullion input 0x19      # main (left or full-screen) input
mullion second 0x0f     # second input (right side or inset)
mullion usb here|away|toggle   # keyboard & mouse (KVM)
mullion brightness [N|+N|-N] # also: contrast, volume (0–100)
```

The app can install system-wide GNOME shortcuts that call these commands
(all off by default; change the keys in Settings → Keyboard → Custom
Shortcuts):

| Keys | Action |
|------|--------|
| Super+Ctrl+K | Switch computer |
| Super+Ctrl+U | Move keyboard & mouse |
| Super+Ctrl+P | Toggle side-by-side |
| Super+Ctrl+S | Swap inputs |
| Super+Ctrl+L | Next layout |
| Super+Alt+1 … 7, 9 | Single, Even Split, Wide Left, Wider Left, Wide Right, Wider Right, Small Inset, Large Inset |

The layout keys work on both the number row and the number pad (the app
installs a second GNOME shortcut for the number pad). Super+Ctrl+digit is
taken by GNOME Shell and Super+Alt+8 by the magnifier, so Large Inset uses
Super+Alt+9. The app refuses to enable a shortcut whose keys are already
used elsewhere in GNOME.

## Layouts

| Name | Layout | Left : Right | `E9` |
|------|--------|--------------|------|
| `single` | Single input, full screen | — | `00` |
| `50-50` | Even Split | 50 : 50 | `24` |
| `75-25` | Wide Left | 75 : 25 | `2A` |
| `80-20` | Wider Left | 80 : 20 | `28` |
| `25-75` | Wide Right | 25 : 75 | `29` |
| `20-80` | Wider Right | 20 : 80 | `27` |
| `pip-small` | Small inset (picture in picture) | — | `21` |
| `pip-large` | Large inset (picture in picture) | — | `22` |

The left side (or the full picture) is the input selected with `60`; the
right side (or the inset) is the second input, `E8`. The splits were
measured from the resolution the monitor gives the right-hand source
(1280, 1024, 3840, 4096 of 5120 pixels). Only layouts the monitor lists in
its capabilities are shown.

## VCP codes on the U4025QW

| Code | Config key | Meaning | Values |
|------|------------|---------|--------|
| `60` | `input` | Main input (left side, or full screen) | `0F` DP, `11` HDMI, `19` Thunderbolt |
| `E9` | `layout` | Screen layout | see Layouts |
| `E8` | `second_input` | Second input (right side or inset) | same codes as `60` |
| `E5` | `swap`, `swap_value` | Swap the two inputs | write `F001` (any `F0xx` works) |
| `E7` | `usb`, `usb_toggle_value` | Move the USB hub (KVM) | write `FF00`; the read-back never changes |
| `10` | `brightness` | Brightness | 0–100 |
| `12` | `contrast` | Contrast | 0–100 |
| `62` | `volume` | Speaker volume | 0–100 |

All of these were verified on a U4025QW. For another model, override codes
in `~/.config/mullion/config.json`, e.g.
`{"vcp": {"second_input": "0xE8"}}`; the file only holds settings that
differ from the defaults. The *Advanced → Raw VCP Access* panel reads and
writes any feature for experimenting.

## How KVM state is detected

The monitor doesn't report which computer owns the USB hub over DDC, so the
app looks at USB instead: the U4025QW's switched sub-hubs carry Realtek HID
functions (`0bda:1100`, `0bda:1101`). If they're present, the keyboard and
mouse are on this computer. Change `kvm_marker_usb` in the config for other
models.

## KVM requirements

The monitor can only give Ubuntu the keyboard and mouse if Ubuntu is
connected to its **USB-C upstream** port (not the Thunderbolt
downstream/daisy-chain port: that one only links you to the Mac's
Thunderbolt domain) and the keyboard/mouse are plugged into the monitor's
downstream ports. Assign the upstream to the matching video input in the
monitor's OSD (USB settings / PBP USB switch).

## Quick Settings

The Mullion extension adds a **Monitor** tile to GNOME's Quick
Settings (top-right menu). The tile shows the current layout and turns side
by side on or off; its menu lists the layouts and can move the keyboard and
mouse, swap the inputs or open the app. Turn it off on the Shortcuts tab.
The menu reads the monitor through `mullion state`.

## On-screen feedback

Actions from keyboard shortcuts or the screen edge show GNOME's own
on-screen pop-up (the one used for volume keys) on the monitor, with a level
bar for brightness, contrast and volume. GNOME Shell only lets its own
components use that pop-up, so it is drawn by the Mullion extension;
without it a regular notification is shown. Turn it off on the Shortcuts tab.

## Switching at the screen edge

With two computers side by side, Mullion can hand the keyboard and mouse to
the other computer from the screen edge next to its picture, like Dell
Display and Peripheral Manager's mouse crossing. Turn on **Switch at Screen
Edge** on the Display tab and choose what happens when the pointer reaches
that edge:

- **Show a button** (default): a small pop-up appears at the edge with
  *Switch to …* (your name for the other computer); nothing changes unless
  you click it. It disappears again when you move away.
- **Switch when pushed**: push the pointer into the edge and keep it there
  for half a second to switch; moving away sooner cancels, so a quick
  flick to the edge doesn't switch. **Push Strength** sets how far it must be pushed within a second: Light
  (150 px), Medium (300 px, default) or Firm (500 px).

Wayland doesn't let applications see the pointer, so this is done by the
GNOME Shell extension (`extension/mullion@ivoks.github.io`, installed with
the package). It places pressure barriers, like GNOME's hot corner, on the
outer left and right edges of the monitor and asks
`mullion cross left|right [--check]`, which checks the current layout and
which side this computer is on, so the pop-up only appears, and switching
only happens, on the edge that leads to the other computer. Edges shared
with another monitor of this computer are left alone.

To avoid switching by accident, the edge is ignored while a mouse button is
held (dragging a window to the edge to tile it, selecting text), near the
corners (the top panel and Activities corner, the bottom 48 px) and for
3 seconds after the keyboard and mouse arrive. Every time the edge is
reached is logged:

```sh
journalctl --user -b | grep 'Mullion:'
```

After installing for the first time, log out and back in once so GNOME
Shell finds the extension. The way back is handled by the other computer:
on a Mac, Dell Display and Peripheral Manager's own edge switching.

## Translations

Translations use GNU gettext. The template is `po/mullion.pot`, each
language is `po/<lang>.po`, and `po/LINGUAS` lists the languages that are
built. `make` compiles them into `build/locale` (used when running from the
source folder) and merges the desktop file's translations; `make install`
puts them in `<prefix>/share/locale`.

Add a language:

```sh
msginit -i po/mullion.pot -l de_DE.UTF-8 -o po/de.po
echo de >> po/LINGUAS
# translate po/de.po, keeping {placeholders} unchanged
make && LANGUAGE=de ./mullion
```

After changing strings in the code, `make update-po` regenerates the
template and merges it into every `po/*.po`. `msgfmt --check` (run by
`make`) verifies that placeholders match.

Available: Croatian (`hr`).

## Development

```sh
make check        # unit tests, translation and desktop-file checks
```

The tests need no monitor: DDC/CI output is mocked (with real output
captured from a U4025QW in `tests/data/`) and settings go to a temporary
directory. `dpkg-buildpackage` runs them too.

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and pull
request in an Ubuntu 26.04 container: tests, a load check of the GNOME
Shell extension, the package build and lintian. The built `.deb` is kept
as a downloadable artifact of each run.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE). The application icons in
`data/icons/` are original artwork under the same license; no Dell
trademarks or artwork are used. "Dell" is mentioned only to name the
hardware this works with.
