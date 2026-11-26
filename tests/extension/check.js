// SPDX-License-Identifier: GPL-3.0-or-later
// Behaviour of the extension's screen-edge switching, run by
// tests/check-extension.sh with GNOME Shell replaced by stubs.js and
// "mullion" by a fake that records its arguments.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {MullionExtension as Ext} from './extension.js';
import {EdgePopup} from './edgepopup.js';
import {createIndicator, mullionPath} from './quickmenu.js';
import {calls, Meta, state} from './stubs.js';

let failures = 0;
function check(what, ok) {
    print(`${ok ? 'ok  ' : 'FAIL'}  ${what}`);
    if (!ok)
        failures++;
}

const dir = GLib.getenv('CHECK_DIR');
const record = `${dir}/calls.txt`;
const configFile = Gio.File.new_for_path(`${dir}/config.json`);
function config(obj) {
    configFile.replace_contents(JSON.stringify(obj), null, false, 0, null);
}
function forget() {
    try {
        GLib.unlink(record);
    } catch (e) {}
}
function settle() {
    // let async subprocesses and their callbacks finish
    const ctx = GLib.MainContext.default();
    const end = GLib.get_monotonic_time() + 1500000;
    while (GLib.get_monotonic_time() < end)
        ctx.iteration(false);
}
function wait(ms) {
    const ctx = GLib.MainContext.default();
    const end = GLib.get_monotonic_time() + ms * 1000;
    while (GLib.get_monotonic_time() < end)
        ctx.iteration(false);
}
function spawned() {
    settle();
    try {
        return new TextDecoder().decode(GLib.file_get_contents(record)[1]).trim();
    } catch (e) {
        return '';
    }
}
function popup() {
    return calls.chrome[0];
}

check('modules load', typeof createIndicator === 'function' &&
    typeof EdgePopup === 'function' && mullionPath().endsWith('mullion'));

const ext = new Ext();
Object.assign(ext, {_barriers: [], _pressure: [], _lastSwitch: 0,
    _lastArrival: 0, _checking: false, _dwellId: 0, _indicator: null,
    _configFile: configFile, _popup: new EdgePopup(e => ext._runCross(e))});

// --- barriers -----------------------------------------------------------
// The Dell (monitor 1) has the laptop to its left.
state.connectorIndex['DP-1'] = 1;
state.neighbours[`1:${Meta.DisplayDirection.LEFT}`] = 0;
config({edge_switch: true, edge_mode: 'push', connector: 'DP-1', quick_settings: false});
ext._rebuild();
check('only the outer (right) edge gets a barrier', calls.barriers.length === 1 &&
    calls.barriers[0].x1 === 1920 + 5120);
check('corners stay free: 48 px top and bottom (no panel on this monitor)',
    calls.barriers[0].y1 === 48 && calls.barriers[0].y2 === 2160 - 48);
check('push mode: default push is 300 px', calls.pressure[0].threshold === 300);

calls.barriers.length = 0;
calls.pressure.length = 0;
state.connectorIndex['DP-1'] = 0;
delete state.neighbours[`1:${Meta.DisplayDirection.LEFT}`];
config({edge_switch: true, edge_mode: 'push', connector: 'DP-1',
    quick_settings: false, edge_pressure: 500});
ext._rebuild();
check('both edges of a lone monitor', calls.barriers.length === 2);
check('top panel and Activities corner excluded', calls.barriers[0].y1 === 32 + 48);
check('push mode: configured push strength used', calls.pressure[0].threshold === 500);

// --- push mode ----------------------------------------------------------
forget();
state.mods = 1 << 8;                        // left button held
ext._onEdge('left');
check('a push with a button held does nothing', spawned() === '');
state.mods = 0;

forget();
ext._lastArrival = GLib.get_monotonic_time() / 1000;
ext._onEdge('left');
check('a push right after arrival does nothing', spawned() === '');
ext._lastArrival = 0;

forget();
ext._onEdge('left');
check('push mode: a push and staying at the edge runs "mullion cross left"',
    spawned() === 'cross left');
ext._lastSwitch = 0;

forget();
ext._onEdge('left');
wait(100);
state.x = 400;                              // flicked to the edge and back
check('push mode: leaving the edge right after the push does nothing',
    spawned() === '' && !ext._dwellId);
state.x = 0;

forget();
ext._onEdge('left');
state.mods = 1 << 8;                        // started dragging at the edge
check('push mode: pressing a button while waiting at the edge does nothing',
    spawned() === '');
state.mods = 0;

forget();
ext._lastSwitch = GLib.get_monotonic_time() / 1000;
ext._onEdge('left');
check('a second push within the cooldown does nothing', spawned() === '');
ext._lastSwitch = 0;

// --- button mode --------------------------------------------------------
calls.pressure.length = 0;
config({edge_switch: true, connector: 'DP-1', quick_settings: false});
ext._rebuild();
check('button mode is the default and needs only a light push',
    ext._mode === 'button' && calls.pressure[0].threshold === 30);

forget();
GLib.setenv('FAKE_CHECK', 'no', true);
ext._onEdge('left');
check('no pop-up when the edge doesn\'t lead to the other computer',
    spawned() === 'cross left --check' && !popup());

forget();
GLib.setenv('FAKE_CHECK', 'Mac', true);
ext._onEdge('left');
check('reaching the edge asks first, without switching', spawned() === 'cross left --check');
const button = popup()?.children[0];
check('…and shows the pop-up with the other computer\'s name',
    button?.label === '←  Switch to Mac');
check('…next to the left edge', popup()?.x === 12);

forget();
ext._onEdge('left');
check('no second check while the pop-up is shown', spawned() === '');

forget();
button.emit('clicked');
check('clicking the button switches', spawned() === 'cross left' && !popup());

if (failures)
    throw new Error(`${failures} extension check(s) failed`);
print('extension checks passed');
