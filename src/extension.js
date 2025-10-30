/*
 * Quake Any App for GNOME Shell 45+
 * Copyright 2025 Rustam Astafeev (forked from Quake Terminal by Diego Dario)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * If this extension breaks your desktop you get to keep all of the pieces...
 */

import Meta from "gi://Meta";
import Shell from "gi://Shell";
import {
  Extension,
  gettext as _,
} from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { QuakeMode } from "./quake-mode.js";

export default class QuakeAnyAppExtension extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._appSystem = Shell.AppSystem.get_default();
    this._quakeModes = [null, null, null]; // 3 slots

    // Register keybindings for all 3 slots
    for (let slotId = 1; slotId <= 3; slotId++) {
      Main.wm.addKeybinding(
        `app-shortcut-${slotId}`,
        this._settings,
        Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
        Shell.ActionMode.NORMAL |
          Shell.ActionMode.OVERVIEW |
          Shell.ActionMode.POPUP,
        () =>
          this._handleQuakeModeApp(slotId).catch((reason) => console.log(reason))
      );
    }
  }

  disable() {
    // Remove all keybindings
    for (let slotId = 1; slotId <= 3; slotId++) {
      Main.wm.removeKeybinding(`app-shortcut-${slotId}`);
    }

    // Destroy all QuakeMode instances
    for (let i = 0; i < 3; i++) {
      if (this._quakeModes[i]) {
        this._quakeModes[i].destroy();
      }
    }

    this._settings = null;
    this._appSystem = null;
    this._quakeModes = null;
  }

  _handleQuakeModeApp(slotId) {
    const slotIndex = slotId - 1; // Convert to 0-based index
    const quakeMode = this._quakeModes[slotIndex];

    if (quakeMode) {
      if (
        quakeMode._internalState === QuakeMode.LIFECYCLE.STARTING ||
        quakeMode._internalState === QuakeMode.LIFECYCLE.CREATED_ACTOR
      ) {
        return;
      }
    }

    if (
      !quakeMode ||
      quakeMode._internalState === QuakeMode.LIFECYCLE.DEAD
    ) {
      const appId = this._settings.get_string(`app-id-${slotId}`);

      if (!appId) {
        Main.notify(_(`Select an application for slot ${slotId} in Quake Any App preferences.`));
        return;
      }

      const app = this._appSystem.lookup_app(appId);

      if (!app) {
        Main.notify(_(`No application found with id ${appId}. Skipping ...`));
        return;
      }

      this._quakeModes[slotIndex] = new QuakeMode(app, this._settings, slotId);
      return this._quakeModes[slotIndex].toggle();
    }

    return quakeMode.toggle();
  }
}
