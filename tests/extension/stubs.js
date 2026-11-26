// SPDX-License-Identifier: GPL-3.0-or-later
// Minimal stand-ins for the GNOME Shell modules the extension imports, so
// its logic can run under plain gjs. They record what the extension does.

export const calls = {barriers: [], pressure: [], chrome: []};

export const Clutter = {
    ModifierType: {BUTTON1_MASK: 1 << 8, BUTTON2_MASK: 1 << 9, BUTTON3_MASK: 1 << 10},
    InputDeviceType: {POINTER_DEVICE: 0, KEYBOARD_DEVICE: 1},
};

export const Meta = {
    BarrierDirection: {POSITIVE_X: 1, POSITIVE_Y: 2, NEGATIVE_X: 4, NEGATIVE_Y: 8},
    DisplayDirection: {UP: 0, DOWN: 1, LEFT: 2, RIGHT: 3},
    Barrier: class {
        constructor(params) {
            this.params = params;
            calls.barriers.push(params);
        }

        destroy() {}
    },
};

export const Shell = {ActionMode: {NORMAL: 1}};
class Actor {
    constructor(params = {}) {
        Object.assign(this, params);
        this.children = [];
        this.handlers = {};
    }

    connect(signal, cb) {
        this.handlers[signal] = cb;
        return 1;
    }

    emit(signal) {
        this.handlers[signal]?.(this);
    }

    add_child(child) {
        this.children.push(child);
    }

    get_preferred_width() {
        return [200, 200];
    }

    get_preferred_height() {
        return [40, 40];
    }

    set_position(x, y) {
        this.x = x;
        this.y = y;
    }

    destroy() {
        this.destroyed = true;
    }
}

export const St = {Button: class extends Actor {}, BoxLayout: class extends Actor {}};
export const PopupMenu = {};
export const QuickSettings = {};

export const Layout = {
    PressureBarrier: class {
        constructor(threshold, timeout, mode) {
            this.threshold = threshold;
            calls.pressure.push({threshold, timeout, mode});
        }

        addBarrier() {}
        connect(_signal, cb) {
            this.trigger = cb;
        }

        destroy() {}
    },
};

export const Main = {
    layoutManager: {
        // a 5120 x 2160 monitor right of a 1920 x 1080 primary laptop panel
        monitors: [{x: 0, y: 0, width: 1920, height: 1080},
            {x: 1920, y: 0, width: 5120, height: 2160}],
        primaryIndex: 0,
        panelBox: {height: 32},
        connect: () => 1,
        disconnect: () => {},
        addTopChrome: actor => calls.chrome.push(actor),
        removeChrome: actor => {
            calls.chrome = calls.chrome.filter(a => a !== actor);
        },
    },
};

export class Extension {}
export const _ = s => s;

export const state = {x: 0, y: 500, mods: 0, neighbours: {}, connectorIndex: {}};

globalThis.global = {
    get_pointer: () => [state.x, state.y, state.mods],
    backend: {
        get_monitor_manager: () => ({
            get_monitor_for_connector: c => state.connectorIndex[c] ?? -1,
        }),
    },
    display: {
        get_monitor_neighbor_index: (i, dir) => state.neighbours[`${i}:${dir}`] ?? -1,
    },
};
