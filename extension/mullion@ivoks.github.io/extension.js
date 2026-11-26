// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ante Karamatic
//
// Mullion GNOME Shell integration
//
// Wayland doesn't let ordinary applications see the pointer position, so
// this small extension puts pressure barriers (like GNOME's hot corner) on
// the outer left and right edges of the monitor Mullion controls.
// Pushing the pointer against one runs `mullion cross <edge>`, which
// decides from the monitor's current layout whether that edge borders the
// other computer and, if so, hands it the keyboard and mouse.
//
// It also exports io.github.ivoks.Mullion.ShowOSD on GNOME Shell's bus
// connection (object /io/github/ivoks/Mullion), so Mullion can show
// GNOME's on-screen pop-up (the one used for volume keys); the Shell's own
// ShowOSD method only accepts calls from GNOME components.
//
// And it adds a "Monitor" tile to Quick Settings (see quickmenu.js).
//
// Settings come from Mullion's config file:
//   ~/.config/mullion/config.json
//   {"edge_switch": true, "quick_settings": true, "connector": "DP-1"}

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {EdgePopup} from './edgepopup.js';
import {createIndicator, mullionPath} from './quickmenu.js';

// How far (px) the pointer must be pushed into the edge within
// PRESSURE_TIMEOUT for a switch; "edge_pressure" in the config overrides it.
// GNOME's hot corner uses 100, which proved too easy to trigger by accident.
const DEFAULT_PRESSURE = 300;
// In "button" mode reaching the edge is enough to offer the pop-up.
const BUTTON_PRESSURE = 30;
const PRESSURE_TIMEOUT = 1000;      // ms
const COOLDOWN_MS = 2000;           // ignore further pushes while switching
// PressureBarrier only measures distance, so a fast flick to the edge
// counts as a full push. In push mode the pointer must then also stay at
// the edge this long before the switch; leaving it earlier cancels.
const DWELL_MS = 500;
const DWELL_POLL_MS = 50;
// After the keyboard and mouse arrive, overshooting while coming across
// shouldn't send them straight back.
const ARRIVAL_GRACE_MS = 3000;
// Keep the edges' ends free: the top panel with the Activities hot corner,
// and the bottom corner (dock, window tiling).
const CORNER_MARGIN = 48;           // px

const DBUS_PATH = '/io/github/ivoks/Mullion';
const DBUS_INTERFACE = `
<node>
  <interface name="io.github.ivoks.Mullion">
    <!-- level: 0…1 shows a level bar, a negative value shows none -->
    <method name="ShowOSD">
      <arg type="s" direction="in" name="icon"/>
      <arg type="s" direction="in" name="label"/>
      <arg type="d" direction="in" name="level"/>
    </method>
  </interface>
</node>`;

export default class MullionExtension extends Extension {
    enable() {
        this._barriers = [];
        this._pressure = [];
        this._lastSwitch = 0;
        this._lastArrival = 0;
        this._checking = false;
        this._dwellId = 0;
        this._popup = new EdgePopup(edge => this._runCross(edge));
        this._configFile = Gio.File.new_for_path(GLib.build_filenamev([
            GLib.get_user_config_dir(), 'mullion', 'config.json']));

        // The app replaces config.json atomically, so watch the directory.
        const dir = this._configFile.get_parent();
        try {
            dir.make_directory_with_parents(null);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
                logError(e, 'Mullion: cannot create config directory');
        }
        this._dirMonitor = dir.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
        this._dirMonitorId = this._dirMonitor.connect('changed', (_m, file, other) => {
            const names = [file?.get_basename(), other?.get_basename()];
            if (names.includes('config.json'))
                this._rebuild();
        });
        this._monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed', () => this._rebuild());

        // The monitor's keyboard and mouse appear as new input devices when
        // the KVM hands them to this computer.
        this._seat = global.stage.context.get_backend().get_default_seat();
        this._deviceAddedId = this._seat.connect('device-added', (_seat, device) => {
            const type = device.get_device_type();
            if (type === Clutter.InputDeviceType.POINTER_DEVICE ||
                type === Clutter.InputDeviceType.KEYBOARD_DEVICE)
                this._lastArrival = GLib.get_monotonic_time() / 1000;
        });

        this._dbus = Gio.DBusExportedObject.wrapJSObject(DBUS_INTERFACE, this);
        this._dbus.export(Gio.DBus.session, DBUS_PATH);

        this._indicator = null;
        this._rebuild();
    }

    disable() {
        if (this._dbus) {
            this._dbus.unexport();
            this._dbus = null;
        }
        this._clear();
        this._removeQuickSettings();
        this._popup?.hide();
        this._popup = null;
        if (this._dirMonitor) {
            this._dirMonitor.disconnect(this._dirMonitorId);
            this._dirMonitor.cancel();
            this._dirMonitor = null;
        }
        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }
        if (this._deviceAddedId) {
            this._seat.disconnect(this._deviceAddedId);
            this._deviceAddedId = 0;
            this._seat = null;
        }
        this._configFile = null;
    }

    // D-Bus: io.github.ivoks.Mullion.ShowOSD
    ShowOSD(icon, label, level) {
        const gicon = icon ? Gio.Icon.new_for_string(icon) : null;
        const value = level >= 0 ? Math.min(level, 1) : null;
        const connector = this._readConfig().connector;
        const index = connector
            ? global.backend.get_monitor_manager().get_monitor_for_connector(connector)
            : -1;
        if (index >= 0)
            Main.osdWindowManager.showOne(index, gicon, label, value, 1);
        else
            Main.osdWindowManager.showAll(gicon, label, value, 1);
    }

    _readConfig() {
        try {
            const [, bytes] = this._configFile.load_contents(null);
            return JSON.parse(new TextDecoder().decode(bytes));
        } catch (e) {
            return {};
        }
    }

    _clear() {
        this._cancelDwell();
        for (const p of this._pressure)
            p.destroy();
        for (const b of this._barriers)
            b.destroy();
        this._pressure = [];
        this._barriers = [];
    }

    _syncQuickSettings(cfg) {
        const wanted = cfg.quick_settings !== false;
        if (wanted && !this._indicator) {
            this._indicator = createIndicator();
            const qs = Main.panel.statusArea.quickSettings;
            qs.addExternalIndicator(this._indicator);
            // Fresh state whenever the Quick Settings panel opens.
            this._qsOpenId = qs.menu.connect('open-state-changed', (_m, open) => {
                if (open)
                    this._indicator?.toggle.refresh();
            });
            this._indicator.toggle.refresh();
        } else if (!wanted && this._indicator) {
            this._removeQuickSettings();
        }
    }

    _removeQuickSettings() {
        if (this._qsOpenId) {
            Main.panel.statusArea.quickSettings.menu.disconnect(this._qsOpenId);
            this._qsOpenId = 0;
        }
        this._indicator?.destroy();
        this._indicator = null;
    }

    _rebuild() {
        this._clear();
        const cfg = this._readConfig();
        this._syncQuickSettings(cfg);
        if (!cfg.edge_switch || !cfg.connector)
            return;

        const index = global.backend.get_monitor_manager()
            .get_monitor_for_connector(cfg.connector);
        const mon = Main.layoutManager.monitors[index];
        if (index < 0 || !mon)
            return;

        this._mode = cfg.edge_mode === 'push' ? 'push' : 'button';
        const pressure = this._mode === 'button' ? BUTTON_PRESSURE
            : Number(cfg.edge_pressure) > 0 ? Number(cfg.edge_pressure)
                : DEFAULT_PRESSURE;
        this._monitor = mon;
        const panel = index === Main.layoutManager.primaryIndex
            ? Main.layoutManager.panelBox.height : 0;
        const y1 = mon.y + panel + CORNER_MARGIN;
        const y2 = mon.y + mon.height - CORNER_MARGIN;
        if (y2 <= y1)
            return;

        // Only outer edges: a barrier between two of this computer's own
        // monitors would get in the way of moving the pointer across.
        const edges = [
            ['left', Meta.DisplayDirection.LEFT, mon.x, Meta.BarrierDirection.POSITIVE_X],
            ['right', Meta.DisplayDirection.RIGHT, mon.x + mon.width, Meta.BarrierDirection.NEGATIVE_X],
        ];
        for (const [edge, direction, x, allowed] of edges) {
            if (global.display.get_monitor_neighbor_index(index, direction) !== -1)
                continue;
            const barrier = new Meta.Barrier({
                backend: global.backend,
                x1: x, x2: x, y1, y2,
                directions: allowed,
            });
            const push = new Layout.PressureBarrier(
                pressure, PRESSURE_TIMEOUT, Shell.ActionMode.NORMAL);
            push.addBarrier(barrier);
            push.connect('trigger', () => this._onEdge(edge));
            this._barriers.push(barrier);
            this._pressure.push(push);
        }
    }

    // The pointer reached `edge`.
    _onEdge(edge) {
        const now = GLib.get_monotonic_time() / 1000;
        const [, y, mods] = global.get_pointer();
        const buttons = Clutter.ModifierType.BUTTON1_MASK |
            Clutter.ModifierType.BUTTON2_MASK | Clutter.ModifierType.BUTTON3_MASK;
        if (mods & buttons) {
            // Dragging a window to the edge to tile it, selecting text…
            console.log(`Mullion: ${edge} edge reached with a button held, ignored`);
            return;
        }
        if (now - this._lastArrival < ARRIVAL_GRACE_MS) {
            console.log(`Mullion: ${edge} edge reached right after the keyboard and mouse arrived, ignored`);
            return;
        }
        if (now - this._lastSwitch < COOLDOWN_MS)
            return;

        if (this._mode === 'push') {
            this._dwell(edge);
            return;
        }
        // "button": offer the pop-up if this edge leads to the other computer.
        if (this._popup.visible || this._checking)
            return;
        this._checking = true;
        this._spawn(['cross', edge, '--check'], (ok, out) => {
            this._checking = false;
            if (!ok || !out || !this._popup || !this._monitor) {
                console.log(`Mullion: ${edge} edge doesn't lead to the other computer`);
                return;
            }
            console.log(`Mullion: ${edge} edge reached, offering to switch to ${out}`);
            this._popup.show(edge, out, this._monitor, y);
        });
    }

    // Push mode: switch once the pointer has stayed at `edge` for DWELL_MS.
    _dwell(edge) {
        if (this._dwellId)
            return;
        const start = GLib.get_monotonic_time() / 1000;
        this._dwellId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DWELL_POLL_MS, () => {
            if (!this._atEdge(edge)) {
                console.log(`Mullion: pointer left the ${edge} edge too soon, not switching`);
                this._dwellId = 0;
                return GLib.SOURCE_REMOVE;
            }
            if (GLib.get_monotonic_time() / 1000 - start < DWELL_MS)
                return GLib.SOURCE_CONTINUE;
            this._dwellId = 0;
            this._runCross(edge);
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelDwell() {
        if (this._dwellId) {
            GLib.source_remove(this._dwellId);
            this._dwellId = 0;
        }
    }

    // Is the pointer against the monitor's `edge`, with no button held?
    _atEdge(edge) {
        const mon = this._monitor;
        if (!mon)
            return false;
        const [x, y, mods] = global.get_pointer();
        const buttons = Clutter.ModifierType.BUTTON1_MASK |
            Clutter.ModifierType.BUTTON2_MASK | Clutter.ModifierType.BUTTON3_MASK;
        if (mods & buttons || y < mon.y || y >= mon.y + mon.height)
            return false;
        return edge === 'left' ? x <= mon.x : x >= mon.x + mon.width - 1;
    }

    _runCross(edge) {
        this._lastSwitch = GLib.get_monotonic_time() / 1000;
        console.log(`Mullion: running "mullion cross ${edge}"`);
        this._spawn(['cross', edge], (_ok, out) =>
            console.log(`Mullion: ${out || 'nothing to do on this edge'}`));
    }

    // Run mullion with args; done(succeeded, trimmed output).
    _spawn(args, done) {
        try {
            const proc = Gio.Subprocess.new([mullionPath(), ...args],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            proc.communicate_utf8_async(null, null, (p, res) => {
                let out = '';
                try {
                    [, out] = p.communicate_utf8_finish(res);
                } catch (e) {
                    logError(e, 'Mullion');
                }
                done(p.get_successful(), (out ?? '').trim());
            });
        } catch (e) {
            logError(e, 'Mullion: cannot run mullion');
            done(false, '');
        }
    }
}
