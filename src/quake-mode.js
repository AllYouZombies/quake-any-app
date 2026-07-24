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
 */

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

const STARTUP_TIMER_IN_SECONDS = 5;

/**
 * How long (seconds) to wait for `stage-views-changed` after the actor is
 * created before giving up and positioning the window anyway (CREATED_ACTOR
 * → RUNNING fallback). Without it a missed signal would leave the slot stuck
 * in CREATED_ACTOR, where extension.js silently drops every shortcut press.
 */
const CREATED_ACTOR_TIMEOUT_IN_SECONDS = 5;

const ACTOR_NAME_PREFIX = "quake-any-app-";

/**
 * Live QuakeMode instances. The close-animation patch below is installed on
 * `Main.wm` once for all of them, so it needs to know which actor belongs to
 * which slot.
 *
 * @type {Set<QuakeMode>}
 */
const quakeModeInstances = new Set();

/** The untouched `Main.wm._shouldAnimateActor`, captured on first install. */
let originalShouldAnimateActor = null;

/** Our replacement, kept so we only restore what we actually installed. */
let patchedShouldAnimateActor = null;

/**
 * Whether our replacement should still do anything. Cleared on uninstall so
 * that a copy another extension holds on to degrades into a plain pass-through
 * instead of continuing to change GNOME's behavior after we are disabled.
 */
let closeAnimationPatchActive = false;

/**
 * Finds the QuakeMode instance that owns the given window actor.
 *
 * @param {Meta.WindowActor} actor - The actor being animated.
 * @returns {QuakeMode | null} The owning instance, or null when it is not ours.
 */
function findInstanceForActor(actor) {
  for (const instance of quakeModeInstances) {
    if (instance.actor === actor) {
      return instance;
    }
  }

  return null;
}

/**
 * Builds the close animation parameters for the given slot and actor.
 *
 * @param {QuakeMode} instance - The slot that owns the actor.
 * @param {Meta.WindowActor} actor - The actor being destroyed.
 * @returns {object} Parameters for `actor.ease()`.
 */
function buildCloseAnimationParams(instance, actor) {
  const screenEdge = instance._settings.get_string(
    `screen-edge-${instance._slotId}`
  );

  const easeParams = {
    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    duration: instance._settings.get_int("animation-time"),
    /**
     * `onStopped` rather than `onComplete`: GNOME only considers the window
     * destroyed once `_destroyWindowDone` runs, and `onComplete` is skipped
     * when the animation gets interrupted, which would leave Mutter waiting
     * forever for the effect to finish.
     */
    onStopped: () => {
      // @ts-ignore
      Main.wm._destroyWindowDone(Main.wm._shellwm, actor);
    },
  };

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

  return easeParams;
}

/**
 * Installs the shared close-animation patch on `Main.wm`.
 *
 * This used to be done per instance, where each slot stored whatever was in
 * `Main.wm._shouldAnimateActor` at construction time. With several slots that
 * chained the patches together: destroying one slot restored a stale closure
 * and disabled the animation of the others. A single shared patch keyed by
 * actor avoids that entirely.
 */
function installCloseAnimationPatch() {
  if (patchedShouldAnimateActor) {
    return;
  }

  /**
   * Captured in a local const, and deliberately not read from module scope.
   * Another extension patching the same method stores our function as its own
   * "original" and keeps calling it, so this closure can outlive our teardown.
   * Reading module state here meant it either called into null once disable()
   * cleared it, or, after a reinstall, called straight back into itself.
   */
  // @ts-ignore
  const previous = Main.wm._shouldAnimateActor;

  originalShouldAnimateActor = previous;

  patchedShouldAnimateActor = function (
    /** @type {Meta.WindowActor & { ease: Function }} */ actor,
    /** @type {any} */ types
  ) {
    const stack = new Error().stack;
    const forClosing = closeAnimationPatchActive && stack.includes("_destroyWindow@");
    const instance = forClosing ? findInstanceForActor(actor) : null;

    /**
     * We specifically handle window closing events, but only when one of our
     * actors is the target. For all other cases, the original behavior remains
     * in effect.
     */
    if (!instance) {
      /**
       * Installed as a method on `Main.wm`, so `this` is the window manager.
       * Passing it on keeps whatever receiver the caller used, which matters
       * when another extension wraps this same method.
       */
      // eslint-disable-next-line no-invalid-this
      return previous.apply(this, [actor, types]);
    }

    /** Store the original ease() method of the window actor. */
    const originalActorAnimate = actor.ease;

    /**
     * Intercept the next call to actor.ease() to perform a custom close
     * animation based on screen edge. Afterward, immediately restore the
     * original behavior.
     */
    actor.ease = function () {
      actor.ease = originalActorAnimate;
      originalActorAnimate.call(
        actor,
        buildCloseAnimationParams(instance, actor)
      );
    };

    return true;
  };

  // @ts-ignore
  Main.wm._shouldAnimateActor = patchedShouldAnimateActor;
  closeAnimationPatchActive = true;
}

/**
 * Restores `Main.wm._shouldAnimateActor`, but only if it is still ours.
 */
function uninstallCloseAnimationPatch() {
  if (!patchedShouldAnimateActor) {
    return;
  }

  /** Cleared first: whatever happens below, we stop changing any behavior. */
  closeAnimationPatchActive = false;

  // @ts-ignore
  if (Main.wm._shouldAnimateActor !== patchedShouldAnimateActor) {
    /**
     * Another extension patched on top of us and holds our function as its own
     * "original". Restoring would cut it out of its chain and break it, and
     * forgetting our function would let the next install build a second one
     * that calls this one. So it stays reachable, but with the flag above
     * cleared it is now a plain pass-through to the implementation it wrapped.
     */
    return;
  }

  // @ts-ignore
  Main.wm._shouldAnimateActor = originalShouldAnimateActor;
  originalShouldAnimateActor = null;
  patchedShouldAnimateActor = null;
}

/**
 * Checks whether the given window is a wl-clipboard helper window.
 *
 * Under Wayland `wl-copy` / `wl-paste` briefly create a window that takes the
 * keyboard focus. Without this check, copying from the quake window makes it
 * hide itself right under the user.
 *
 * @param {Meta.Window} win - The window that just took focus.
 * @returns {boolean} True when the window belongs to wl-clipboard.
 */
function isWlClipboard(win) {
  if (!win) {
    return false;
  }

  if (win.get_client_type() !== Meta.WindowClientType.WAYLAND) {
    return false;
  }

  return win.title === "wl-clipboard";
}

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
   * @param {number} slotId - The slot identifier (1, 2, or 3).
   */
  constructor(app, settings, slotId) {
    /**
     *@type {Shell.App}
     */
    this._app = app;
    this._settings = settings;
    this._slotId = slotId;
    this._internalState = QuakeMode.LIFECYCLE.READY;

    this._sourceTimeoutLoopId = null;
    this._stageViewFallbackTimeoutId = null;
    this._appWindowUnmanagedId = null;
    this._appWindowFocusId = null;
    this._workspaceChangedId = null;
    this._wmMapSignalId = null;
    this._appChangedId = null;
    this._actorStageViewChangedId = null;
    this._overviewHidingId = null;
    this._overviewHiddenId = null;
    this._overviewShowRetryId = null;
    this._shouldBeHidden = false;

    /**
     *@type {Meta.Window}
     */
    this._appWindow = null;
    this._isTaskbarConfigured = null;

    // Enhance the close animation behavior when exiting
    quakeModeInstances.add(this);
    installCloseAnimationPatch();

    /**
     * Stores the IDs of settings signal handlers.
     *
     * @type {number[]}
     */
    this._settingsWatchingListIds = [];

    ["vertical-size", "horizontal-size", "horizontal-alignment", "vertical-size-unit", "horizontal-size-unit", "screen-edge"].forEach(
      (prefAdjustment) => {
        const settingsId = settings.connect(
          `changed::${prefAdjustment}-${slotId}`,
          () => {
            this._fitWindowToMonitor();
          }
        );

        this._settingsWatchingListIds.push(settingsId);
      }
    );

    const alwaysOnTopSettingsId = settings.connect(
      `changed::always-on-top-${slotId}`,
      () => {
        this._handleAlwaysOnTop();
      }
    );

    this._settingsWatchingListIds.push(alwaysOnTopSettingsId);

    const skipTaskbarSettingsId = settings.connect(
      `changed::skip-taskbar-${slotId}`,
      () => {
        this._configureSkipTaskbarProperty();
      }
    );

    this._settingsWatchingListIds.push(skipTaskbarSettingsId);
  }

  get appWindow() {
    if (!this._app) {
      return null;
    }

    if (!this._appWindow) {
      let ourWindow = this._app.get_windows().find((w) => {
        /**
         * The window actor for this application window.
         *
         * @type {Meta.WindowActor & { ease: Function }}
         */
        const actor = w.get_compositor_private();
        return actor.get_name() === `${ACTOR_NAME_PREFIX}${this._slotId}` && w.is_alive;
      });

      if (!ourWindow) {
        return null;
      }

      this._appWindow = ourWindow;

      /**
       * We are adopting a window that outlived the previous instance, which
       * happens on every disable/enable cycle - the screen lock being the
       * common one. Its signals died with that instance, so reconnect them
       * here, otherwise auto hide and the overview handling stay silently
       * broken until the application itself is restarted.
       */
      if (this._internalState !== QuakeMode.LIFECYCLE.DEAD) {
        this._connectWindowSignals();

        if (this._internalState === QuakeMode.LIFECYCLE.READY) {
          this._internalState = QuakeMode.LIFECYCLE.RUNNING;
        }
      }
    }

    return this._appWindow;
  }

  get actor() {
    if (!this.appWindow) {
      return null;
    }

    /**
     * The window actor for this application window.
     *
     * @type {Meta.WindowActor & { ease: Function }}
     */
    const actor = this.appWindow.get_compositor_private();

    if (!actor) {
      return null;
    }

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
    /**
     * Set first: the getters below can adopt a window, and adopting one while
     * tearing down would connect a fresh set of signals nobody disconnects.
     */
    this._internalState = QuakeMode.LIFECYCLE.DEAD;

    if (this._sourceTimeoutLoopId) {
      GLib.Source.remove(this._sourceTimeoutLoopId);
      this._sourceTimeoutLoopId = null;
    }

    if (this._stageViewFallbackTimeoutId) {
      GLib.Source.remove(this._stageViewFallbackTimeoutId);
      this._stageViewFallbackTimeoutId = null;
    }

    if (this._settingsWatchingListIds.length && this._settings) {
      this._settingsWatchingListIds.forEach((id) => {
        this._settings.disconnect(id);
      });
    }

    if (this._actorStageViewChangedId && this.actor) {
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

    this._restoreSkipTaskbarProperty();

    if (this._appWindowFocusId) {
      Shell.Global.get().display.disconnect(this._appWindowFocusId);
      this._appWindowFocusId = null;
    }

    if (this._workspaceChangedId) {
      Shell.Global.get().workspace_manager.disconnect(this._workspaceChangedId);
      this._workspaceChangedId = null;
    }

    if (this._wmMapSignalId) {
      Shell.Global.get().window_manager.disconnect(this._wmMapSignalId);
      this._wmMapSignalId = null;
    }

    if (this._overviewHidingId) {
      Main.overview.disconnect(this._overviewHidingId);
      this._overviewHidingId = null;
    }

    if (this._overviewHiddenId) {
      Main.overview.disconnect(this._overviewHiddenId);
      this._overviewHiddenId = null;
    }

    if (this._overviewShowRetryId) {
      Main.overview.disconnect(this._overviewShowRetryId);
      this._overviewShowRetryId = null;
    }

    this._settingsWatchingListIds = [];
    this._app = null;
    this._appWindow = null;
    this._isTaskbarConfigured = null;

    quakeModeInstances.delete(this);

    if (!quakeModeInstances.size) {
      uninstallCloseAnimationPatch();
    }
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

        /**
         * When the `map` signal was missed, _adjustAppWindowPosition() advances
         * straight to RUNNING and shows the window synchronously. Running the
         * focus/hide/show logic below on top of that would immediately undo the
         * show, since the window is now focused.
         */
        if (this._adjustAppWindowPosition()) {
          return;
        }
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
    const launchArgsMap =
      this._settings.get_value("launch-args-map").deep_unpack() || {};

    const launchArgs = launchArgsMap[info.get_id()] || "";
    const cancellable = new Gio.Cancellable();

    const promiseTerminalWindowInLessThanFiveSeconds = new Promise(
      (resolve, reject) => {
        const shellAppWindowsChangedHandler = () => {
          if (!this._app) {
            return reject(
              Error(
                "Quake-AnyApp - Something destroyed the internal reference of terminal app"
              )
            );
          }

          /**
           * The application keeps emitting `windows-changed` for every window
           * it opens or closes afterwards. Bail out before touching the startup
           * timeout, whose source is already gone by then.
           */
          if (this._internalState !== QuakeMode.LIFECYCLE.STARTING) {
            if (this._appChangedId) {
              this._app.disconnect(this._appChangedId);
              this._appChangedId = null;
            }
            return;
          }

          if (this._sourceTimeoutLoopId) {
            GLib.Source.remove(this._sourceTimeoutLoopId);
            this._sourceTimeoutLoopId = null;
          }

          if (this._app.get_n_windows() < 1) {
            return reject(
              Error(
                `Quake-AnyApp - App '${this._app.id}' is launched but no windows`
              )
            );
          }

          /**
           * Pick a window that no other slot has claimed yet. Taking
           * `get_windows()[0]` blindly lets two slots pointing at the same
           * application steal each other's window, since that list is ordered
           * by user time and not by creation.
           */
          const ourWindow = this._app.get_windows().find((w) => {
            const candidate = w.get_compositor_private();
            return (
              candidate && !candidate.get_name()?.startsWith(ACTOR_NAME_PREFIX)
            );
          });

          if (!ourWindow) {
            return reject(
              Error(
                `Quake-AnyApp - App '${this._app.id}' has no unclaimed window`
              )
            );
          }

          /**
           * The window actor for this terminal window.
           *
           * @type {Meta.WindowActor & { ease: Function }}
           */
          const actor = ourWindow.get_compositor_private();
          actor.set_name(`${ACTOR_NAME_PREFIX}${this._slotId}`);
          this._appWindow = ourWindow;
          this._internalState = QuakeMode.LIFECYCLE.CREATED_ACTOR;

          // Keeps the Terminal out of Overview mode and Alt-Tab window switching
          this._configureSkipTaskbarProperty();

          this._handleAlwaysOnTop();

          this._connectWindowSignals();

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
            this._sourceTimeoutLoopId = null;
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
   * Connects every signal that tracks the managed window.
   *
   * Called both when the window is launched and when an existing one is
   * adopted after a disable/enable cycle. Each connection is guarded so it is
   * safe to call more than once.
   */
  _connectWindowSignals() {
    const appWindow = this._appWindow;

    if (!appWindow) {
      return;
    }

    if (!this._appWindowUnmanagedId) {
      this._appWindowUnmanagedId = appWindow.connect("unmanaged", () => {
        this.destroy();
      });
    }

    if (!this._appWindowFocusId) {
      this._appWindowFocusId = Shell.Global.get().display.connect(
        "notify::focus-window",
        (source) => {
          this._handleFocusChange(source);
        }
      );
    }

    if (!this._workspaceChangedId) {
      this._workspaceChangedId = Shell.Global.get().workspace_manager.connect(
        "active-workspace-changed",
        () => {
          if (!this.appWindow) {
            return;
          }
          const activeWorkspace =
            Shell.Global.get().workspace_manager.get_active_workspace();
          if (this.appWindow.is_hidden()) {
            // Move hidden window to new workspace so it's accessible from there
            this.appWindow.change_workspace(activeWorkspace);
            return;
          }
          // Same state the hide animation leaves behind, so keep the flag in
          // sync - the overview guard below relies on it.
          this._shouldBeHidden = true;
          if (this.actor) {
            Main.wm.skipNextEffect(this.actor);
            this.actor.translation_x = 0;
            this.actor.translation_y = 0;
            this.actor.opacity = 0;
            this.actor.hide();
          }
          this.appWindow.minimize();
          this.appWindow.unstick();
          this.appWindow.change_workspace(activeWorkspace);
        }
      );
    }

    // When Overview exits, GNOME Shell may call actor.show() on all window actors
    // or restore opacity — even for minimized windows. We intercept both
    // "hiding" (animation starts) and "hidden" (animation ends) to keep our
    // window invisible throughout the entire transition.
    const enforceHiddenState = () => {
      if (!this.appWindow || !this.actor || !this._shouldBeHidden) {
        return;
      }
      this.actor.remove_all_transitions();
      this.actor.translation_x = 0;
      this.actor.translation_y = 0;
      this.actor.opacity = 0;
      // Use Clutter-level hide so GNOME Shell cannot accidentally reveal
      // this actor during overview transitions or workspace animations.
      this.actor.hide();
      if (!this.appWindow.is_hidden()) {
        Main.wm.skipNextEffect(this.actor);
        this.appWindow.minimize();
      }
    };

    if (!this._overviewHidingId) {
      this._overviewHidingId = Main.overview.connect(
        "hiding",
        enforceHiddenState
      );
    }

    if (!this._overviewHiddenId) {
      this._overviewHiddenId = Main.overview.connect(
        "hidden",
        enforceHiddenState
      );
    }
  }

  /**
   * Adjusts the app window's initial position and handles signal connections
   * related to window mapping and sizing.
   *
   * @returns {boolean} True when the window was advanced to RUNNING immediately.
   */
  _adjustAppWindowPosition() {
    if (!this.appWindow || !this.actor) {
      return false;
    }

    this.appWindow.stick();

    /**
     * Defined at this scope so both the `stage-views-changed` handler and the
     * fallback timer below can reach it. Whichever fires first cancels the
     * other and performs the CREATED_ACTOR → RUNNING transition.
     */
    const advanceToRunning = () => {
      if (this._stageViewFallbackTimeoutId) {
        GLib.Source.remove(this._stageViewFallbackTimeoutId);
        this._stageViewFallbackTimeoutId = null;
      }

      if (this._actorStageViewChangedId && this.actor) {
        this.actor.disconnect(this._actorStageViewChangedId);
        this._actorStageViewChangedId = null;
      }

      if (this._wmMapSignalId) {
        Shell.Global.get().window_manager.disconnect(this._wmMapSignalId);
        this._wmMapSignalId = null;
      }

      if (this._internalState !== QuakeMode.LIFECYCLE.CREATED_ACTOR) {
        return;
      }

      this._internalState = QuakeMode.LIFECYCLE.RUNNING;
      this._fitWindowToMonitor();
      this._showWindowWithAnimation();
    };

    if (this.actor.is_mapped()) {
      /**
       * The `map` signal already fired before we could connect to it. By the
       * time the actor is mapped its stage views have settled as well, so
       * `stage-views-changed` will never fire again for it and waiting would
       * leave this slot stuck in CREATED_ACTOR forever.
       */
      this.actor.opacity = 0;
      Shell.Global.get().window_manager.emit("kill-window-effects", this.actor);
      advanceToRunning();
      return true;
    }

    const mapSignalHandler = (
      /** @type {Shell.WM} */ wm,
      /** @type {Meta.WindowActor} */ metaWindowActor
    ) => {
      if (metaWindowActor !== this.actor) {
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
          advanceToRunning();
        }
      );

      this._fitWindowToMonitor();
    };

    this._wmMapSignalId = Shell.Global.get().window_manager.connect(
      "map",
      mapSignalHandler
    );

    this._stageViewFallbackTimeoutId = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      CREATED_ACTOR_TIMEOUT_IN_SECONDS,
      () => {
        this._stageViewFallbackTimeoutId = null;
        advanceToRunning();
        return GLib.SOURCE_REMOVE;
      }
    );

    return false;
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

    // Mark window as intentionally visible before any overview checks
    this._shouldBeHidden = false;

    // Re-stick the window so it's visible on all workspaces while open
    this.appWindow.stick();

    if (Main.overview.visible) {
      if (!this._overviewShowRetryId) {
        this._overviewShowRetryId = Main.overview.connect("hidden", () => {
          Main.overview.disconnect(this._overviewShowRetryId);
          this._overviewShowRetryId = null;
          this._showWindowWithAnimation();
        });
      }
      Main.overview.hide();
      return;
    }

    const parent = this.actor.get_parent();

    if (!parent) {
      return;
    }

    // Restore Clutter-level visibility (we called actor.hide() when hiding).
    this.actor.show();

    parent.set_child_above_sibling(this.actor, null);

    const screenEdge = this._settings.get_string(`screen-edge-${this._slotId}`);

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

    const screenEdge = this._settings.get_string(`screen-edge-${this._slotId}`);
    const easeParams = {
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      duration: this._settings.get_int("animation-time"),
      onComplete: () => {
        if (!this.actor) {
          return;
        }
        this._shouldBeHidden = true;
        Main.wm.skipNextEffect(this.actor);
        this.actor.meta_window.minimize();
        this.actor.translation_x = 0;
        this.actor.translation_y = 0;
        this.actor.opacity = 0;
        // Explicitly hide via Clutter so GNOME Shell cannot restore this actor
        // during overview or workspace transitions (skipNextEffect alone does not
        // call actor.hide() when it skips the minimize animation).
        this.actor.hide();
        // Unstick the window so it doesn't appear in workspace switch animations
        if (this.appWindow) {
          this.appWindow.unstick();
          const activeWorkspace =
            Shell.Global.get().workspace_manager.get_active_workspace();
          this.appWindow.change_workspace(activeWorkspace);
        }
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

    const screenEdge = this._settings.get_string(`screen-edge-${this._slotId}`);
    const verticalSettingsValue = this._settings.get_int(`vertical-size-${this._slotId}`);
    const horizontalSettingsValue = this._settings.get_int(`horizontal-size-${this._slotId}`);
    const verticalSizeUnit = this._settings.get_string(`vertical-size-unit-${this._slotId}`);
    const horizontalSizeUnit = this._settings.get_string(`horizontal-size-unit-${this._slotId}`);
    const alignmentValue = this._settings.get_int(`horizontal-alignment-${this._slotId}`);

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

    if (!appWindow) {
      return;
    }

    const shouldSkipTaskbar = this._settings.get_boolean(`skip-taskbar-${this._slotId}`);

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

  /**
   * Hands `skip_taskbar` back to GNOME.
   *
   * The override above is an own, configurable property shadowing the one the
   * window inherits, so deleting it leaves the window exactly as we found it.
   */
  _restoreSkipTaskbarProperty() {
    const appWindow = this._appWindow;

    if (!this._isTaskbarConfigured || !appWindow) {
      return;
    }

    delete appWindow.skip_taskbar;
    this._isTaskbarConfigured = null;
  }

  /**
   * Reacts to focus moving around: hides the window when it loses focus, and
   * makes it visible again when something else brought it up.
   *
   * @param {Meta.Display} source - The display object.
   */
  _handleFocusChange(source) {
    if (!source || !this.appWindow) {
      return;
    }

    if (source.focus_window === this.appWindow) {
      /**
       * Focused while we still believe it is hidden, so it was brought up by
       * something other than our shortcut: Alt+Tab, a click in the overview,
       * another application activating it. Hiding leaves the actor fully
       * transparent and Clutter-hidden and GNOME restores neither, which used
       * to leave a focused but invisible window.
       *
       * This deliberately keys off focus rather than `notify::minimized`. That
       * signal also fires for GNOME's own bookkeeping, so restoring there made
       * the window flash wherever the unminimize animation happened to start
       * and then get hidden again by the branch below, over and over.
       */
      if (this._shouldBeHidden) {
        this._shouldBeHidden = false;

        if (this.actor) {
          this.actor.remove_all_transitions();
          this.actor.translation_x = 0;
          this.actor.translation_y = 0;
          this.actor.opacity = 255;
          this.actor.show();
        }
      }

      return;
    }

    const shouldAutoHide = this._settings.get_boolean(`auto-hide-window-${this._slotId}`);

    if (!shouldAutoHide) {
      return;
    }

    /**
     * Already hidden - every focus change between other windows would
     * otherwise replay the hide animation and its workspace bookkeeping.
     */
    if (this._shouldBeHidden || this.appWindow.is_hidden()) {
      return;
    }

    if (isWlClipboard(source.focus_window)) {
      return;
    }

    this._hideWindowWithAnimation();
  }

  _handleAlwaysOnTop() {
    const appWindow = this.appWindow;

    if (!appWindow) {
      return;
    }

    const shouldAlwaysOnTop = this._settings.get_boolean(`always-on-top-${this._slotId}`);

    if (!shouldAlwaysOnTop && !appWindow.is_above()) {
      return;
    }

    if (!shouldAlwaysOnTop && appWindow.is_above()) {
      appWindow.unmake_above();
      return;
    }

    appWindow.make_above();
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
