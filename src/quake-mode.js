/*
 * Quake Any App for GNOME Shell 45+
 * Copyright 2025 Rustam Qua (forked from Quake Terminal by Diego Dario)
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
 */

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Shell from "gi://Shell";
import Meta from "gi://Meta";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

const STARTUP_TIMER_IN_SECONDS = 5;

/**
 * Quake Mode Module
 *
 * This module provides a Quake mode for managing application windows with animations and specific behavior.
 * It allows showing and hiding application windows with animation effects from any screen edge.
 *
 * @module QuakeMode
 */
export const QuakeMode = class {
  static LIFECYCLE = {
    READY: "READY",
    STARTING: "STARTING",
    CREATED_ACTOR: "CREATED_ACTOR",
    RUNNING: "RUNNING",
    DEAD: "DEAD",
  };

  /**
   * Creates a new QuakeMode instance.
   *
   * @param {Shell.App} app - The application instance.
   * @param {Gio.Settings} settings - The Gio.Settings object for configuration.
   */
  constructor(app, settings) {
    console.log(
      `*** QuakeAnyApp@constructor - IsWayland = ${Meta.is_wayland_compositor()} ***`
    );
    console.log(
      `*** QuakeAnyApp@constructor - App = ${app.get_name()} ***`
    );

    /**
     *@type {Shell.App}
     */
    this._app = app;
    this._settings = settings;
    this._internalState = QuakeMode.LIFECYCLE.READY;

    this._sourceTimeoutLoopId = null;
    this._appWindowUnmanagedId = null;
    this._appWindowFocusId = null;
    this._wmMapSignalId = null;
    this._appChangedId = null;
    this._actorStageViewChangedId = null;

    /**
     *@type {Meta.Window}
     */
    this._appWindow = null;
    this._isTaskbarConfigured = null;

    /** We will monkey-patch this method. Let's store the original one. */
    // @ts-ignore
    this._original_shouldAnimateActor = Main.wm._shouldAnimateActor;

    // Enhance the close animation behavior when exiting
    this._configureActorCloseAnimation();

    /**
     * Stores the IDs of settings signal handlers.
     *
     * @type {number[]}
     */
    this._settingsWatchingListIds = [];

    ["vertical-size", "horizontal-size", "horizontal-alignment", "vertical-size-unit", "horizontal-size-unit", "screen-edge"].forEach(
      (prefAdjustment) => {
        const settingsId = settings.connect(
          `changed::${prefAdjustment}`,
          () => {
            this._fitWindowToMonitor();
          }
        );

        this._settingsWatchingListIds.push(settingsId);
      }
    );

    const alwaysOnTopSettingsId = settings.connect(
      "changed::always-on-top",
      () => {
        this._handleAlwaysOnTop();
      }
    );

    this._settingsWatchingListIds.push(alwaysOnTopSettingsId);

    const skipTaskbarSettingsId = settings.connect(
      "changed::skip-taskbar",
      () => {
        this._configureSkipTaskbarProperty();
      }
    );

    this._settingsWatchingListIds.push(skipTaskbarSettingsId);
  }

  get appWindow() {
    if (!this._app) {
      console.log(
        `*** QuakeAnyApp@appWindow - There's no application ***`
      );
      console.log(
        `*** QuakeAnyApp@appWindow - Current state ${this._internalState}  ***`
      );
      return null;
    }

    if (!this._appWindow) {
      console.log(
        `*** QuakeAnyApp@appWindow - There's no WindowActor, finding one ... ***`
      );
      let ourWindow = this._app.get_windows().find((w) => {
        /**
         * The window actor for this application window.
         *
         * @type {Meta.WindowActor & { ease: Function }}
         */
        const actor = w.get_compositor_private();
        return actor.get_name() === "quake-any-app" && w.is_alive;
      });

      if (!ourWindow) {
        return null;
      }

      this._appWindow = ourWindow;
      if (!this._appWindowUnmanagedId) {
        this._appWindowUnmanagedId = this._appWindow.connect(
          "unmanaged",
          () => {
            console.log(
              `*** QuakeAnyApp@Unmanaged Called unmanaged after suspend or lockscreen ***`
            );
            this.destroy();
          }
        );
      }
    }

    return this._appWindow;
  }

  get actor() {
    if (!this.appWindow) {
      console.log(`*** QuakeAnyApp@actor - There's no appWindow ***`);
      return null;
    }

    /**
     * The window actor for this application window.
     *
     * @type {Meta.WindowActor & { ease: Function }}
     */
    const actor = this.appWindow.get_compositor_private();

    if (!actor) {
      console.log(`*** QuakeAnyApp@actor - There's no actor ***`);
      return null;
    }

    if ("clip_y" in actor) {
      return actor;
    }

    Object.defineProperty(actor, "clip_y", {
      get() {
        return this.clip_rect.origin.y;
      },
      set(y) {
        const rect = this.clip_rect;
        this.set_clip(rect.origin.x, y, rect.size.width, rect.size.height);
      },
    });

    return actor;
  }

  get monitorDisplayScreenIndex() {
    if (this._settings.get_boolean("render-on-current-monitor")) {
      return Shell.Global.get().display.get_current_monitor();
    }

    if (this._settings.get_boolean("render-on-primary-monitor")) {
      return Shell.Global.get().display.get_primary_monitor();
    }

    const userSelectionDisplayIndex = this._settings.get_int("monitor-screen");
    const availableDisplaysIndexes =
      Shell.Global.get().display.get_n_monitors() - 1;

    if (
      userSelectionDisplayIndex >= 0 &&
      userSelectionDisplayIndex <= availableDisplaysIndexes
    ) {
      return userSelectionDisplayIndex;
    }

    return Shell.Global.get().display.get_primary_monitor();
  }

  destroy() {
    console.log(`*** QuakeAnyApp@destroy - Starting destroy action ***`);
    if (this._sourceTimeoutLoopId) {
      GLib.Source.remove(this._sourceTimeoutLoopId);
      this._sourceTimeoutLoopId = null;
    }

    if (this._settingsWatchingListIds.length && this._settings) {
      this._settingsWatchingListIds.forEach((id) => {
        this._settings.disconnect(id);
      });
    }

    if (this.actor && this._actorStageViewChangedId) {
      this.actor.disconnect(this._actorStageViewChangedId);
      this._actorStageViewChangedId = null;
    }

    if (this._appWindowUnmanagedId && this.appWindow) {
      this.appWindow.disconnect(this._appWindowUnmanagedId);
      this._appWindowUnmanagedId = null;
    }

    if (this._appChangedId && this._app) {
      this._app.disconnect(this._appChangedId);
      this._appChangedId = null;
    }

    if (this._appWindowFocusId) {
      Shell.Global.get().display.disconnect(this._appWindowFocusId);
      this._appWindowFocusId = null;
    }

    if (this._wmMapSignalId) {
      Shell.Global.get().window_manager.disconnect(this._wmMapSignalId);
      this._wmMapSignalId = null;
    }

    this._settingsWatchingListIds = [];
    this._app = null;
    this._appWindow = null;
    this._internalState = QuakeMode.LIFECYCLE.DEAD;
    this._isTaskbarConfigured = null;
    // @ts-ignore
    Main.wm._shouldAnimateActor = this._original_shouldAnimateActor;
  }

  /**
   * Toggles the visibility of the application window with animations.
   *
   * @returns {Promise<void>} A promise that resolves when the toggle operation is complete.
   */
  async toggle() {
    if (!this.appWindow) {
      try {
        await this._launchAppWindow();
        this._adjustAppWindowPosition();
      } catch (error) {
        console.log(`*** QuakeAnyApp@toggle - Catch error ${error} ***`);
        this.destroy();
        return;
      }
    }

    if (!this._isTaskbarConfigured) {
      this._configureSkipTaskbarProperty();
    }

    if (this.appWindow.has_focus()) {
      return this._hideWindowWithAnimation();
    }

    this._fitWindowToMonitor();
    if (this.appWindow.is_hidden()) {
      return this._showWindowWithAnimation();
    }

    Main.activateWindow(this.appWindow);
  }

  /**
   * Launches the terminal window and sets up event handlers.
   *
   * @returns {Promise<boolean>} A promise that resolves when the terminal window is ready.
   */
  _launchAppWindow() {
    this._internalState = QuakeMode.LIFECYCLE.STARTING;

    if (!this._app) {
      return Promise.reject(Error("Quake-AnyApp - Application is null"));
    }

    const info = this._app.get_app_info();
    console.log(
      `*** QuakeAnyApp@_launchAppWindow - launching a new window for app ${info.get_name()}  ***`
    );
    const launchArgsMap =
      this._settings.get_value("launch-args-map").deep_unpack() || {};

    const launchArgs = launchArgsMap[info.get_id()] || "";
    const cancellable = new Gio.Cancellable();

    const promiseTerminalWindowInLessThanFiveSeconds = new Promise(
      (resolve, reject) => {
        const shellAppWindowsChangedHandler = () => {
          GLib.Source.remove(this._sourceTimeoutLoopId);
          this._sourceTimeoutLoopId = null;

          if (!this._app) {
            return reject(
              Error(
                "Quake-AnyApp - Something destroyed the internal reference of terminal app"
              )
            );
          }

          if (this._internalState !== QuakeMode.LIFECYCLE.STARTING) {
            console.log(
              `*** QuakeAnyApp@_launchAppWindow - Not in STARTING state, ignoring windows-changed signal ***`
            );

            this._app.disconnect(this._appChangedId);
            return;
          }

          if (this._app.get_n_windows() < 1) {
            return reject(
              Error(
                `Quake-AnyApp - App '${this._app.id}' is launched but no windows`
              )
            );
          }

          const ourWindow = this._app.get_windows()[0];
          /**
           * The window actor for this terminal window.
           *
           * @type {Meta.WindowActor & { ease: Function }}
           */
          const actor = ourWindow.get_compositor_private();
          actor.set_name("quake-any-app");
          this._appWindow = ourWindow;
          this._internalState = QuakeMode.LIFECYCLE.CREATED_ACTOR;

          // Keeps the Terminal out of Overview mode and Alt-Tab window switching
          this._configureSkipTaskbarProperty();

          this._handleAlwaysOnTop();

          this._appWindowUnmanagedId = this.appWindow.connect(
            "unmanaged",
            () => {
              console.log(`*** QuakeAnyApp@Unmanaged Called unmanaged ***`);
              this.destroy();
            }
          );

          this._appWindowFocusId = Shell.Global.get().display.connect(
            "notify::focus-window",
            (source) => {
              this._handleHideOnFocusLoss(source);
            }
          );
          resolve(true);
        };

        this._appChangedId = this._app.connect(
          "windows-changed",
          shellAppWindowsChangedHandler
        );

        const exec = info.get_string("Exec");
        const cleanedExec = this._cleanDesktopFileExec(exec);
        let fullCommand = `${cleanedExec} ${launchArgs}`;

        try {
          const [success, argv] = GLib.shell_parse_argv(fullCommand);
          if (success) {
            this._spawn(argv, cancellable).catch((e) => reject(e));
          } else {
            reject(Error(`Failed to parse command line args: ${fullCommand}`));
          }
        } catch (e) {
          reject(e);
        }

        this._sourceTimeoutLoopId = GLib.timeout_add_seconds(
          GLib.PRIORITY_DEFAULT,
          STARTUP_TIMER_IN_SECONDS,
          () => {
            cancellable.cancel();
            reject(
              Error(
                `Quake-AnyApp: Timeout reached after ${STARTUP_TIMER_IN_SECONDS} seconds while trying to open the Quake terminal`
              )
            );
            return GLib.SOURCE_REMOVE;
          }
        );
      }
    );

    return promiseTerminalWindowInLessThanFiveSeconds;
  }

  /**
   * Adjusts the terminal window's initial position and handles signal connections related
   * to window mapping and sizing.
   */
  _adjustAppWindowPosition() {
    if (!this.appWindow || !this.actor) {
      console.log(
        `*** QuakeAnyApp@_adjustAppWindowPosition - No appWindow || actor ***`
      );
      return;
    }

    this.appWindow.stick();

    const mapSignalHandler = (
      /** @type {Shell.WM} */ wm,
      /** @type {Meta.WindowActor} */ metaWindowActor
    ) => {
      if (metaWindowActor !== this.actor) {
        console.log(
          `*** QuakeAnyApp@mapSignalHandler - ${metaWindowActor.get_name()} is not our actor, skipping. ***`
        );
        return;
      }
      this.actor.opacity = 0;

      // This code should run exclusively during the initial creation of the terminal application
      // to ensure an immediate disconnection, we turn off the signal.
      Shell.Global.get().window_manager.disconnect(this._wmMapSignalId);
      this._wmMapSignalId = null;

      // Since our terminal application has his own "drop-down" showing animation, we must get rid of any other effect
      // that the windows have when they are created.
      wm.emit("kill-window-effects", this.actor);

      /**
       * Listens once for the `Clutter.Actor::stage-views-changed` signal, which should be emitted
       * right before the terminal resizing is complete. Even if the terminal does not need to be
       * resized, this signal should be emitted correctly by Mutter.
       *
       * @see https://mutter.gnome.org/clutter/signal.Actor.stage-views-changed.html
       */
      this._actorStageViewChangedId = this.actor.connect(
        "stage-views-changed",
        () => {
          console.log(
            `*** QuakeAnyApp@_adjustAppWindowPosition - State ${this._internalState} ***`
          );

          if (this._internalState !== QuakeMode.LIFECYCLE.CREATED_ACTOR) {
            console.log(
              `*** QuakeAnyApp@_adjustAppWindowPosition - Not in CREATED_ACTOR state, ignoring stage-views-changed signal ***`
            );
            this.actor.disconnect(this._actorStageViewChangedId);
            this._actorStageViewChangedId = null;
            return;
          }

          this._internalState = QuakeMode.LIFECYCLE.RUNNING;
          this._showWindowWithAnimation();
        }
      );

      this._fitWindowToMonitor();
    };

    this._wmMapSignalId = Shell.Global.get().window_manager.connect(
      "map",
      mapSignalHandler
    );
  }

  _shouldAvoidAnimation() {
    if (!this.actor) {
      return true;
    }

    return false;
  }

  _showWindowWithAnimation() {
    if (this._shouldAvoidAnimation()) {
      return;
    }

    const parent = this.actor.get_parent();

    if (!parent) {
      return;
    }

    parent.set_child_above_sibling(this.actor, null);

    const screenEdge = this._settings.get_string("screen-edge");

    // Set initial position based on screen edge
    switch (screenEdge) {
      case "top":
        this.actor.translation_y = this.actor.height * -1;
        this.actor.translation_x = 0;
        break;
      case "bottom":
        this.actor.translation_y = this.actor.height;
        this.actor.translation_x = 0;
        break;
      case "left":
        this.actor.translation_x = this.actor.width * -1;
        this.actor.translation_y = 0;
        break;
      case "right":
        this.actor.translation_x = this.actor.width;
        this.actor.translation_y = 0;
        break;
    }

    Main.wm.skipNextEffect(this.actor);
    Main.activateWindow(this.actor.meta_window);

    this.actor.ease({
      mode: Clutter.AnimationMode.EASE_IN_QUAD,
      translation_x: 0,
      translation_y: 0,
      opacity: 255,
      duration: this._settings.get_int("animation-time"),
      onComplete: () => {
        this._isTransitioning = false;
      },
    });
  }

  _hideWindowWithAnimation() {
    if (this._shouldAvoidAnimation()) {
      return;
    }

    const screenEdge = this._settings.get_string("screen-edge");
    const easeParams = {
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      duration: this._settings.get_int("animation-time"),
      onComplete: () => {
        Main.wm.skipNextEffect(this.actor);
        this.actor.meta_window.minimize();
        this.actor.translation_x = 0;
        this.actor.translation_y = 0;
      },
    };

    // Set hide direction based on screen edge
    switch (screenEdge) {
      case "top":
        easeParams.translation_y = this.actor.height * -1;
        easeParams.translation_x = 0;
        break;
      case "bottom":
        easeParams.translation_y = this.actor.height;
        easeParams.translation_x = 0;
        break;
      case "left":
        easeParams.translation_x = this.actor.width * -1;
        easeParams.translation_y = 0;
        break;
      case "right":
        easeParams.translation_x = this.actor.width;
        easeParams.translation_y = 0;
        break;
    }

    this.actor.ease(easeParams);
  }

  _fitWindowToMonitor() {
    if (!this.appWindow) {
      return;
    }
    const monitorDisplayScreenIndex = this.monitorDisplayScreenIndex;
    const area = this.appWindow.get_work_area_for_monitor(
      monitorDisplayScreenIndex
    );

    const screenEdge = this._settings.get_string("screen-edge");
    const verticalSettingsValue = this._settings.get_int("vertical-size");
    const horizontalSettingsValue = this._settings.get_int("horizontal-size");
    const verticalSizeUnit = this._settings.get_string("vertical-size-unit");
    const horizontalSizeUnit = this._settings.get_string("horizontal-size-unit");
    const alignmentValue = this._settings.get_int("horizontal-alignment");

    // Calculate window dimensions based on unit type
    let windowHeight, windowWidth;

    if (verticalSizeUnit === "pixels") {
      windowHeight = Math.min(verticalSettingsValue, area.height);
    } else {
      windowHeight = Math.round((verticalSettingsValue * area.height) / 100);
    }

    if (horizontalSizeUnit === "pixels") {
      windowWidth = Math.min(horizontalSettingsValue, area.width);
    } else {
      windowWidth = Math.round((horizontalSettingsValue * area.width) / 100);
    }

    // Calculate window position based on edge and alignment
    let windowX, windowY;

    if (screenEdge === "top" || screenEdge === "bottom") {
      // Horizontal edges: use horizontal alignment
      // 0 = left, 1 = right, 2 = center
      if (alignmentValue === 0) {
        windowX = area.x;
      } else if (alignmentValue === 1) {
        windowX = area.x + area.width - windowWidth;
      } else {
        windowX = area.x + Math.round((area.width - windowWidth) / 2);
      }

      if (screenEdge === "top") {
        windowY = area.y;
      } else {
        windowY = area.y + area.height - windowHeight;
      }
    } else {
      // Vertical edges: use vertical alignment (smart behavior)
      // 0 = top, 1 = bottom, 2 = center
      if (alignmentValue === 0) {
        windowY = area.y;
      } else if (alignmentValue === 1) {
        windowY = area.y + area.height - windowHeight;
      } else {
        windowY = area.y + Math.round((area.height - windowHeight) / 2);
      }

      if (screenEdge === "left") {
        windowX = area.x;
      } else {
        windowX = area.x + area.width - windowWidth;
      }
    }

    this.appWindow.move_to_monitor(monitorDisplayScreenIndex);

    this.appWindow.move_resize_frame(
      false,
      windowX,
      windowY,
      windowWidth,
      windowHeight
    );
  }

  _configureSkipTaskbarProperty() {
    const appWindow = this.appWindow;
    const shouldSkipTaskbar = this._settings.get_boolean("skip-taskbar");

    Object.defineProperty(appWindow, "skip_taskbar", {
      get() {
        if (appWindow && shouldSkipTaskbar) {
          return true;
        }

        return this.is_skip_taskbar();
      },
      configurable: true,
    });

    this._isTaskbarConfigured = true;
  }

  _configureActorCloseAnimation() {
    /** We will use `self` to refer to the extension inside the patched method. */
    const self = this;

    // @ts-ignore
    Main.wm._shouldAnimateActor = function (
      /**
       * @type {Meta.WindowActor & { ease: Function }}
       */
      actor,
      /** @type {any} */ types
    ) {
      const stack = new Error().stack;
      const forClosing = stack.includes("_destroyWindow@");

      /**
       * We specifically handle window closing events, but only when our actor is the target.
       * For all other cases, the original behavior remains in effect.
       */
      if (!forClosing || actor !== self.actor) {
        return self._original_shouldAnimateActor.apply(this, [actor, types]);
      }

      /** Store the original ease() method of the terminal actor. */
      const originalActorAnimate = actor.ease;

      /**
       * Intercept the next call to actor.animate() to perform a custom close animation
       * based on screen edge. Afterward, immediately restore the original behavior.
       */
      actor.ease = function () {
        actor.ease = originalActorAnimate;

        const screenEdge = self._settings.get_string("screen-edge");
        const easeParams = {
          mode: Clutter.AnimationMode.EASE_OUT_QUAD,
          duration: self._settings.get_int("animation-time"),
          onComplete: () => {
            // @ts-ignore
            Main.wm._destroyWindowDone(Main.wm._shellwm, actor);
          },
        };

        // Set animation direction based on screen edge
        switch (screenEdge) {
          case "top":
            easeParams.translation_y = actor.height * -1;
            easeParams.translation_x = 0;
            break;
          case "bottom":
            easeParams.translation_y = actor.height;
            easeParams.translation_x = 0;
            break;
          case "left":
            easeParams.translation_x = actor.width * -1;
            easeParams.translation_y = 0;
            break;
          case "right":
            easeParams.translation_x = actor.width;
            easeParams.translation_y = 0;
            break;
        }

        originalActorAnimate.call(actor, easeParams);
      };

      return true;
    };
  }

  /**
   * Hides the terminal when it loses focus.
   *
   * @param {Meta.Display} source - The display object.
   */
  _handleHideOnFocusLoss(source) {
    const shouldAutoHide = this._settings.get_boolean("auto-hide-window");

    if (!shouldAutoHide) {
      return;
    }

    if (!source) {
      return;
    }

    if (source.focus_window === this.appWindow) {
      return;
    }

    this._hideWindowWithAnimation();
  }

  _handleAlwaysOnTop() {
    const shouldAlwaysOnTop = this._settings.get_boolean("always-on-top");

    if (!shouldAlwaysOnTop && !this.appWindow.is_above()) {
      return;
    }

    if (!shouldAlwaysOnTop && this.appWindow.is_above()) {
      this.appWindow.unmake_above();
      return;
    }

    this.appWindow.make_above();
  }

  /**
   * Execute a command asynchronously and check the exit status.
   *
   * If given, @cancellable can be used to stop the process before it finishes.
   *
   * @param {string[]} argv - a list of string arguments
   * @param {Gio.Cancellable} [cancellable] - optional cancellable object
   * @returns {Promise<void>} - The process success
   */
  async _spawn(argv, cancellable = null) {
    let cancelId = 0;
    const proc = new Gio.Subprocess({
      argv,
      flags: Gio.SubprocessFlags.NONE,
    });
    proc.init(cancellable);

    if (cancellable instanceof Gio.Cancellable)
      cancelId = cancellable.connect(() => proc.force_exit());

    try {
      const success = await proc.wait_check_async(null);

      if (!success) {
        const status = proc.get_exit_status();

        throw new Gio.IOErrorEnum({
          code: Gio.IOErrorEnum.FAILED,
          message: `Command '${argv}' failed with exit code ${status}`,
        });
      }
    } finally {
      if (cancelId > 0) cancellable.disconnect(cancelId);
    }
  }

  /**
   * Cleans desktop file Exec field by removing field codes that are not applicable
   * for terminal launching in quake mode.
   *
   * According to Desktop Entry Specification, field codes include:
   * %f - single file name
   * %F - multiple file names
   * %u - single URL
   * %U - multiple URLs
   * %d - deprecated (single directory name)
   * %D - deprecated (multiple directory names)
   * %n - deprecated (single filename without path)
   * %N - deprecated (multiple filenames without path)
   * %i - icon field prefixed by --icon
   * %c - translated name of the application
   * %k - location of desktop file
   * %v - deprecated (device)
   * %% - literal percent sign
   *
   * For terminal applications in quake mode, we don't pass any files or URLs,
   * so we remove these field codes except for %%.
   *
   * @param {string} exec - The Exec field from the desktop file
   * @returns {string} The cleaned Exec command
   */
  _cleanDesktopFileExec(exec) {
    if (!exec) {
      return "";
    }

    // Handle %% first (literal percent sign) by temporarily replacing it
    const tempReplacement = "___PERCENT_PLACEHOLDER___";
    let cleaned = exec.replace(/%%/g, tempReplacement);

    // Remove all standard desktop file field codes
    // Match % followed by a letter (case insensitive)
    cleaned = cleaned.replace(/%[fFuUdDnNickv]/g, "");

    // Restore literal percent signs
    cleaned = cleaned.replace(new RegExp(tempReplacement, "g"), "%");

    // Clean up any extra whitespace that might be left
    cleaned = cleaned.replace(/\s+/g, " ").trim();

    return cleaned;
  }
};
