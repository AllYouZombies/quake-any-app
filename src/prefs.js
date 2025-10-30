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

import Adw from "gi://Adw";
import GObject from "gi://GObject";
import GLib from "gi://GLib";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk";
import {
    ExtensionPreferences,
    gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

// Use GioUnix on GNOME 49+, but fallback to plain Gio for older versions
const GioUnix = await import("gi://GioUnix")
    .then((module) => module.default)
    .catch(() => Gio);

const ABOUT_APPLICATION_HELP_DIALOG = `
<markup>
  <span font_desc='11'>When this row is activated, the system searches for installed apps based on specific criteria that each app must meet:</span>

  <span font_desc='10'> - A valid <a href="https://developer.gnome.org/documentation/tutorials/application-id.html">Application ID</a>.</span>
  <span font_desc='10'> - Should not be hidden.</span>

  <small>This allows you to select any application to display in Quake mode. For help and more information, refer to <a href="https://github.com/AllYouZombies/quake-any-app">Quake Any App</a>.</small>
</markup>
`;

/**
 *
 * @returns GdkMonitor[]
 */
const getConnectedMonitorsList = () => {
    const monitors = [];

    const display = Gdk.Display.get_default();
    if (display && "get_monitors" in display) {
        const monitorsAvailable = display.get_monitors();

        for (let idx = 0; idx < monitorsAvailable.get_n_items(); idx++) {
            const monitor = monitorsAvailable.get_item(idx);
            monitors.push(monitor);
        }
    } else {
        console.warn(`Could not get monitor list from Display of type ${display}`);
    }

    return monitors;
};

const isValidAccel = (
    /** @type {number | Gdk.ModifierType} */ mask,
    /** @type {number} */ keyval
) => {
    return (
        Gtk.accelerator_valid(keyval, mask) ||
        (keyval === Gdk.KEY_Tab && mask !== 0)
    );
};

/**
 * @param {Gio.DesktopAppInfo} app - Selected application
 */
function getAppIconImage(app) {
    const appIconString = app?.get_icon()?.to_string() ?? "icon-missing";

    return new Gtk.Image({
        gicon: Gio.icon_new_for_string(appIconString),
        iconSize: Gtk.IconSize.LARGE,
    });
}

const GenericObjectModel = GObject.registerClass(
    {
        Properties: {
            name: GObject.ParamSpec.string(
                "name",
                "name",
                "name",
                GObject.ParamFlags.READWRITE,
                null
            ),
            value: GObject.ParamSpec.int(
                "value",
                "value",
                "value",
                GObject.ParamFlags.READWRITE,
                0,
                100,
                0
            ),
        },
    },
    class GenericObjectModel extends GObject.Object {
        /**
         * @param {string} name - Object name
         * @param {number} value - Object value
         */
        _init(name, value) {
            super._init({ name, value });
        }
    }
);

/** Dialog window used for selecting application from given list of apps
 *  Emits `app-selected` signal with application id
 */
const AppChooserDialog = GObject.registerClass(
    {
        Properties: {},
        Signals: { "app-selected": { param_types: [GObject.TYPE_STRING] } },
    },
    class AppChooserDialog extends Adw.PreferencesWindow {
        /**
         * @param {Gio.DesktopAppInfo[]} apps list of apps to display in dialog
         * @param {{ defaultWidth: number; defaultHeight: number; }} parent parent window, dialog will be transient for parent
         */
        _init(apps, parent) {
            super._init({
                modal: true,
                transientFor: parent,
                destroyWithParent: false,
                title: "Select application",
            });

            this.set_default_size(
                0.7 * parent.defaultWidth,
                0.7 * parent.defaultHeight
            );
            this._group = new Adw.PreferencesGroup();
            const page = new Adw.PreferencesPage();
            page.add(this._group);
            this.add(page);
            apps.forEach((app) => this._addAppRow(app));
        }

        /**
         * @param {Gio.DesktopAppInfo} app - The application
         */
        _addAppRow(app) {
            const row = new Adw.ActionRow({
                title: app.get_display_name(),
                subtitle: app.get_description(),
                activatable: true,
            });

            row.add_prefix(getAppIconImage(app));
            this._group.add(row);

            row.connect("activated", () => {
                this.emit("app-selected", app.get_id());
                this.close();
            });
        }
    }
);

export default class QuakeTerminalPreferences extends ExtensionPreferences {
    /**
     * Fills the preferences window with extension settings UI.
     *
     * @param {Adw.PreferencesWindow} window - The preferences window to populate.
     * @returns {Promise<void>}
     */
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Create pages for each slot
        for (let slotId = 1; slotId <= 3; slotId++) {
            const page = this._createSlotPage(settings, window, slotId);
            window.add(page);
        }

        // Create global settings page
        const globalPage = this._createGlobalPage(settings, window);
        window.add(globalPage);

        return Promise.resolve();
    }

    /**
     * Creates a page for a specific slot
     * @param {Gio.Settings} settings - Settings object
     * @param {Adw.PreferencesWindow} window - Parent window
     * @param {number} slotId - Slot identifier (1-3)
     * @returns {Adw.PreferencesPage}
     */
    _createSlotPage(settings, window, slotId) {
        const page = new Adw.PreferencesPage();
        page.set_title(_(`Slot ${slotId}`));
        page.set_name(`slot-${slotId}-preferences`);
        page.set_icon_name("applications-system-symbolic");

        // Application Settings Group
        const applicationSettingsGroup = new Adw.PreferencesGroup();
        applicationSettingsGroup.set_title(_("Application"));
        applicationSettingsGroup.set_name(`application-settings-group-${slotId}`);
        page.add(applicationSettingsGroup);

        // Application ID
        const applicationApplicationId = settings.get_string(`app-id-${slotId}`);
        const defaultTerminalApplicationId = settings
            .get_default_value(`app-id-${slotId}`)
            .deep_unpack();

        const applicationIDRow = new Adw.ActionRow({
            title: _("Application"),
        });

        let selectedTerminalEmulator = GioUnix.DesktopAppInfo.new(
            applicationApplicationId
        );

        if (!selectedTerminalEmulator && applicationApplicationId) {
            console.warn(
                `Unable to locate application with ID (${applicationApplicationId}). Falling back to default.`
            );
            selectedTerminalEmulator = GioUnix.DesktopAppInfo.new(
                defaultTerminalApplicationId
            );
        }

        if (!selectedTerminalEmulator) {
            applicationIDRow.set_subtitle(
                applicationApplicationId || `Not configured`
            );
        } else {
            applicationIDRow.set_subtitle(selectedTerminalEmulator.get_id());
        }

        const gtkIcon = getAppIconImage(selectedTerminalEmulator);
        applicationSettingsGroup.add(applicationIDRow);

        const helpButton = Gtk.Button.new_from_icon_name("help-about-symbolic");
        helpButton.set_valign(Gtk.Align.CENTER);
        helpButton.add_css_class("flat");

        helpButton.connect("clicked", () => {
            const helpDialogLabel = new Gtk.Label({
                margin_start: 24,
                margin_end: 24,
                margin_bottom: 24,
                wrap: true,
                useMarkup: true,
                justify: Gtk.Justification.FILL,
                label: ABOUT_APPLICATION_HELP_DIALOG,
            });

            const helpDialogScrolledWindow = new Gtk.ScrolledWindow({
                propagate_natural_height: true,
                vscrollbar_policy: Gtk.PolicyType.NEVER,
            });

            helpDialogScrolledWindow.set_child(helpDialogLabel);

            const helpButtonToolbarView = new Adw.ToolbarView({
                content: helpDialogScrolledWindow,
            });

            helpButtonToolbarView.add_top_bar(new Adw.HeaderBar());

            const helpDialog = new Adw.Window({
                title: "About application",
                modal: true,
                // @ts-ignore
                transient_for: page.get_root(),
                hide_on_close: true,
                width_request: 360,
                height_request: 300,
                default_width: 420,
                resizable: false,
                content: helpButtonToolbarView,
            });

            helpDialog.present();
        });

        applicationIDRow.add_prefix(gtkIcon);
        applicationIDRow.add_suffix(helpButton);
        applicationIDRow.activatable_widget = gtkIcon;

        // Custom application arguments
        const launchArgsMap =
            settings.get_value("launch-args-map").deep_unpack() || {};
        const currentAppArgs = launchArgsMap[applicationApplicationId] || "";

        const launchArgRow = new Adw.EntryRow({
            title: _("Launch Options"),
            tooltip_text: _(
                "Optional command-line arguments. For example: -o font_size=18"
            ),
            text: currentAppArgs,
            show_apply_button: true,
        });

        launchArgRow.connect("apply", () => {
            const applyTerminalApplicationId = settings.get_string(`app-id-${slotId}`);
            const applyLaunchArgsMap =
                settings.get_value("launch-args-map").deep_unpack() || {};

            const updatedMap = { ...applyLaunchArgsMap };
            updatedMap[applyTerminalApplicationId] = launchArgRow.text;
            settings.set_value(
                "launch-args-map",
                new GLib.Variant("a{ss}", updatedMap)
            );
            launchArgRow.get_root().set_focus(null);
        });

        applicationSettingsGroup.add(launchArgRow);
        applicationIDRow.connect("activated", () => {
            const allApps = Gio.app_info_get_all();

            const selectableApps = allApps
                .filter((app) => {
                    const appId = app.get_id();
                    if (!appId) return false;
                    if (!app.should_show()) return false;
                    return true;
                })
                .sort((a, b) => a.get_id().localeCompare(b.get_id()));

            // @ts-ignore
            const appChooserDialog = new AppChooserDialog(selectableApps, window);

            appChooserDialog.connect("app-selected", (_source, appId) => {
                settings.set_string(`app-id-${slotId}`, appId);

                const newSelectedTerminalEmulator = GioUnix.DesktopAppInfo.new(appId);
                applicationIDRow.set_subtitle(newSelectedTerminalEmulator.get_id());

                const appIconString =
                    newSelectedTerminalEmulator.get_icon()?.to_string() ?? "icon-missing";

                gtkIcon.clear();
                gtkIcon.set_from_gicon(Gio.icon_new_for_string(appIconString));

                const settingsArgsMap =
                    settings.get_value("launch-args-map").deep_unpack() || {};

                const currentSelectedAppArgs = settingsArgsMap[appId] || "";
                launchArgRow.text = currentSelectedAppArgs;
            });

            appChooserDialog.present();
        });

        // General Settings Group
        const generalSettingsGroup = new Adw.PreferencesGroup();
        generalSettingsGroup.set_title(_("General"));
        generalSettingsGroup.set_name(`general-settings-group-${slotId}`);
        page.add(generalSettingsGroup);

        // Shortcut
        const shortcutId = `app-shortcut-${slotId}`;
        const shortcutRow = new Adw.ActionRow({
            title: _("Toggle Shortcut"),
            subtitle: _("Shortcut to activate this application"),
        });

        const shortcutLabel = new Gtk.ShortcutLabel({
            disabled_text: _("Select a shortcut"),
            accelerator: settings.get_strv(shortcutId)[0] ?? "<Control>backslash",
            valign: Gtk.Align.CENTER,
            halign: Gtk.Align.CENTER,
        });

        settings.connect(`changed::${shortcutId}`, () => {
            shortcutLabel.set_accelerator(settings.get_strv(shortcutId)[0]);
        });

        shortcutRow.connect("activated", () => {
            const ctl = new Gtk.EventControllerKey();

            const statusPage = new Adw.StatusPage({
                description: _(`Enter new shortcut for Slot ${slotId}`),
                icon_name: "preferences-desktop-keyboard-shortcuts-symbolic",
            });

            const toolbarView = new Adw.ToolbarView({
                content: statusPage,
            });

            const headerBar = new Adw.HeaderBar({
                title_widget: new Adw.WindowTitle({
                    title: _("Set Shortcut"),
                }),
            });

            toolbarView.add_top_bar(headerBar);

            const editor = new Adw.Window({
                modal: true,
                // @ts-ignore
                transient_for: page.get_root(),
                hide_on_close: true,
                width_request: 400,
                height_request: 300,
                resizable: false,
                content: toolbarView,
            });

            editor.add_controller(ctl);

            ctl.connect("key-pressed", (__, keyval, keycode, state) => {
                let mask = state & Gtk.accelerator_get_default_mod_mask();
                mask &= ~Gdk.ModifierType.LOCK_MASK;

                if (
                    !mask &&
                    (keyval === Gdk.KEY_Escape || keyval === Gdk.KEY_BackSpace)
                ) {
                    editor.close();
                    return Gdk.EVENT_STOP;
                }

                if (!isValidAccel(mask, keyval)) {
                    return Gdk.EVENT_STOP;
                }

                settings.set_strv(shortcutId, [
                    Gtk.accelerator_name_with_keycode(null, keyval, keycode, mask),
                ]);

                editor.destroy();
                return Gdk.EVENT_STOP;
            });

            editor.present();
        });

        shortcutRow.add_suffix(shortcutLabel);
        shortcutRow.activatable_widget = shortcutLabel;
        generalSettingsGroup.add(shortcutRow);

        // Auto Hide Window
        const autoHideWindowRow = new Adw.SwitchRow({
            title: _("Auto Hide App"),
            subtitle: _("Hide window when it loses focus"),
        });
        generalSettingsGroup.add(autoHideWindowRow);

        settings.bind(
            `auto-hide-window-${slotId}`,
            autoHideWindowRow,
            "active",
            Gio.SettingsBindFlags.DEFAULT
        );

        // Position Group Settings
        const positionSettingsGroup = new Adw.PreferencesGroup();
        positionSettingsGroup.set_title(_("Position"));
        positionSettingsGroup.set_name(`position-settings-group-${slotId}`);
        page.add(positionSettingsGroup);

        // Screen Edge Selection
        const screenEdgeModel = new Gio.ListStore({
            item_type: GenericObjectModel.$gtype,
        });

        [_("Top"), _("Bottom"), _("Left"), _("Right")].forEach((edge, idx) => {
            // @ts-ignore
            const screenEdgeItem = new GenericObjectModel(edge, idx);
            screenEdgeModel.append(screenEdgeItem);
        });

        const currentEdge = settings.get_string(`screen-edge-${slotId}`);
        const edgeIndex = ["top", "bottom", "left", "right"].indexOf(currentEdge);

        const screenEdgeRow = new Adw.ComboRow({
            title: _("Screen Edge"),
            subtitle: _("Which edge the window should appear from"),
            model: screenEdgeModel,
            expression: Gtk.PropertyExpression.new(
                GenericObjectModel.$gtype,
                null,
                "name"
            ),
            selected: edgeIndex >= 0 ? edgeIndex : 0,
        });

        positionSettingsGroup.add(screenEdgeRow);

        screenEdgeRow.connect("notify::selected", () => {
            const edges = ["top", "bottom", "left", "right"];
            settings.set_string(`screen-edge-${slotId}`, edges[screenEdgeRow.selected]);
        });

        // Vertical Size
        const verticalSpinRow = new Adw.SpinRow({
            title: _("Vertical Size"),
            subtitle: _("Application vertical size"),
            adjustment: new Gtk.Adjustment({
                lower: 10,
                step_increment: 5,
                upper: 3840,
                value: settings.get_int(`vertical-size-${slotId}`),
            }),
        });
        positionSettingsGroup.add(verticalSpinRow);

        // Vertical Size Unit Selector
        const verticalSizeUnitModel = new Gio.ListStore({
            item_type: GenericObjectModel.$gtype,
        });

        [_("Percent"), _("Pixels")].forEach((unit, idx) => {
            // @ts-ignore
            const unitItem = new GenericObjectModel(unit, idx);
            verticalSizeUnitModel.append(unitItem);
        });

        const currentVerticalUnit = settings.get_string(`vertical-size-unit-${slotId}`);
        const verticalUnitIndex = ["percent", "pixels"].indexOf(currentVerticalUnit);

        const verticalSizeUnitRow = new Adw.ComboRow({
            title: _("Vertical Size Unit"),
            subtitle: _("Unit for vertical size measurement"),
            model: verticalSizeUnitModel,
            expression: Gtk.PropertyExpression.new(
                GenericObjectModel.$gtype,
                null,
                "name"
            ),
            selected: verticalUnitIndex >= 0 ? verticalUnitIndex : 0,
        });

        positionSettingsGroup.add(verticalSizeUnitRow);

        // Update spin row bounds when unit changes
        const updateVerticalBounds = () => {
            const unit = settings.get_string(`vertical-size-unit-${slotId}`);
            if (unit === "pixels") {
                verticalSpinRow.adjustment.set_upper(3840);
                verticalSpinRow.set_subtitle(_("Application vertical size in pixels"));
            } else {
                verticalSpinRow.adjustment.set_upper(100);
                verticalSpinRow.set_subtitle(_("Application vertical size in percent"));
            }
        };

        verticalSizeUnitRow.connect("notify::selected", () => {
            const units = ["percent", "pixels"];
            settings.set_string(`vertical-size-unit-${slotId}`, units[verticalSizeUnitRow.selected]);
            updateVerticalBounds();
        });

        verticalSpinRow.connect("changed", () => {
            settings.set_int(`vertical-size-${slotId}`, verticalSpinRow.get_value());
        });
        settings.connect(`changed::vertical-size-${slotId}`, () => {
            verticalSpinRow.set_value(settings.get_int(`vertical-size-${slotId}`));
        });

        updateVerticalBounds();

        // Horizontal Size
        const horizontalSpinRow = new Adw.SpinRow({
            title: _("Horizontal Size"),
            subtitle: _("Application horizontal size"),
            adjustment: new Gtk.Adjustment({
                lower: 30,
                step_increment: 5,
                upper: 7680,
                value: settings.get_int(`horizontal-size-${slotId}`),
            }),
        });
        positionSettingsGroup.add(horizontalSpinRow);

        // Horizontal Size Unit Selector
        const horizontalSizeUnitModel = new Gio.ListStore({
            item_type: GenericObjectModel.$gtype,
        });

        [_("Percent"), _("Pixels")].forEach((unit, idx) => {
            // @ts-ignore
            const unitItem = new GenericObjectModel(unit, idx);
            horizontalSizeUnitModel.append(unitItem);
        });

        const currentHorizontalUnit = settings.get_string(`horizontal-size-unit-${slotId}`);
        const horizontalUnitIndex = ["percent", "pixels"].indexOf(currentHorizontalUnit);

        const horizontalSizeUnitRow = new Adw.ComboRow({
            title: _("Horizontal Size Unit"),
            subtitle: _("Unit for horizontal size measurement"),
            model: horizontalSizeUnitModel,
            expression: Gtk.PropertyExpression.new(
                GenericObjectModel.$gtype,
                null,
                "name"
            ),
            selected: horizontalUnitIndex >= 0 ? horizontalUnitIndex : 0,
        });

        positionSettingsGroup.add(horizontalSizeUnitRow);

        // Update spin row bounds when unit changes
        const updateHorizontalBounds = () => {
            const unit = settings.get_string(`horizontal-size-unit-${slotId}`);
            if (unit === "pixels") {
                horizontalSpinRow.adjustment.set_upper(7680);
                horizontalSpinRow.set_subtitle(_("Application horizontal size in pixels"));
            } else {
                horizontalSpinRow.adjustment.set_upper(100);
                horizontalSpinRow.set_subtitle(_("Application horizontal size in percent"));
            }
        };

        horizontalSizeUnitRow.connect("notify::selected", () => {
            const units = ["percent", "pixels"];
            settings.set_string(`horizontal-size-unit-${slotId}`, units[horizontalSizeUnitRow.selected]);
            updateHorizontalBounds();
        });

        horizontalSpinRow.connect("changed", () => {
            settings.set_int(`horizontal-size-${slotId}`, horizontalSpinRow.get_value());
        });
        settings.connect(`changed::horizontal-size-${slotId}`, () => {
            horizontalSpinRow.set_value(settings.get_int(`horizontal-size-${slotId}`));
        });

        updateHorizontalBounds();

        // Alignment
        const alignmentModel = new Gio.ListStore({
            item_type: GenericObjectModel.$gtype,
        });

        [_("Left/Top"), _("Right/Bottom"), _("Center")].forEach((align, idx) => {
            // @ts-ignore
            const alignmentItem = new GenericObjectModel(align, idx);
            alignmentModel.append(alignmentItem);
        });

        const horizontalAlignmentRow = new Adw.ComboRow({
            title: _("Alignment"),
            subtitle: _("Window alignment (horizontal for top/bottom, vertical for left/right)"),
            model: alignmentModel,
            expression: Gtk.PropertyExpression.new(
                GenericObjectModel.$gtype,
                null,
                "name"
            ),
            selected: settings.get_int(`horizontal-alignment-${slotId}`),
        });

        positionSettingsGroup.add(horizontalAlignmentRow);

        horizontalAlignmentRow.connect("notify::selected", () => {
            settings.set_int(`horizontal-alignment-${slotId}`, horizontalAlignmentRow.selected);
        });

        // Always on top
        const alwaysOnTopRow = new Adw.SwitchRow({
            title: _("Always On Top"),
            subtitle: _("Window appears on top of all other non-topmost windows"),
        });
        positionSettingsGroup.add(alwaysOnTopRow);

        settings.bind(
            `always-on-top-${slotId}`,
            alwaysOnTopRow,
            "active",
            Gio.SettingsBindFlags.DEFAULT
        );

        // Skip taskbar
        const skipTaskbarRow = new Adw.SwitchRow({
            title: _("Hide In Certain Modes"),
            subtitle: _("Window won't appear in overview mode or Alt+Tab"),
        });
        positionSettingsGroup.add(skipTaskbarRow);

        settings.bind(
            `skip-taskbar-${slotId}`,
            skipTaskbarRow,
            "active",
            Gio.SettingsBindFlags.DEFAULT
        );

        return page;
    }

    /**
     * Creates global settings page
     * @param {Gio.Settings} settings - Settings object
     * @param {Adw.PreferencesWindow} window - Parent window
     * @returns {Adw.PreferencesPage}
     */
    _createGlobalPage(settings, window) {
        const page = new Adw.PreferencesPage();
        page.set_title(_("Global"));
        page.set_name("global-preferences");
        page.set_icon_name("preferences-system-symbolic");

        const generalSettingsGroup = new Adw.PreferencesGroup();
        generalSettingsGroup.set_title(_("Display Settings"));
        page.add(generalSettingsGroup);

        // Render on current Monitor
        const renderOnCurrentMonitor = new Adw.SwitchRow({
            title: _("Show on the current Display"),
            subtitle: _("Show on the Display that has the mouse pointer"),
        });
        generalSettingsGroup.add(renderOnCurrentMonitor);

        settings.bind(
            "render-on-current-monitor",
            renderOnCurrentMonitor,
            "active",
            Gio.SettingsBindFlags.DEFAULT
        );

        // Render on primary Monitor
        const renderOnPrimaryMonitor = new Adw.SwitchRow({
            title: _("Show on the primary Display"),
            subtitle: _("Show on the Display set as Primary in GNOME Display settings"),
        });
        generalSettingsGroup.add(renderOnPrimaryMonitor);

        settings.bind(
            "render-on-primary-monitor",
            renderOnPrimaryMonitor,
            "active",
            Gio.SettingsBindFlags.DEFAULT
        );

        // Monitor Screen
        const monitorScreenModel = new Gio.ListStore({
            item_type: GenericObjectModel.$gtype,
        });

        const monitorScreens = getConnectedMonitorsList();

        for (const [idx, monitor] of monitorScreens.entries()) {
            const monitorScreen = new GenericObjectModel(
                // @ts-ignore
                `${monitor.description}`.toUpperCase(),
                // @ts-ignore
                idx
            );
            monitorScreenModel.append(monitorScreen);
        }
        const monitorRow = new Adw.ComboRow({
            title: _("Display"),
            subtitle: _("Which display to render the application on"),
            model: monitorScreenModel,
            expression: Gtk.PropertyExpression.new(
                GenericObjectModel.$gtype,
                null,
                "name"
            ),
            selected: settings.get_int("monitor-screen"),
            sensitive:
                !settings.get_boolean("render-on-current-monitor") &&
                !settings.get_boolean("render-on-primary-monitor"),
        });

        generalSettingsGroup.add(monitorRow);

        monitorRow.connect("notify::selected", () => {
            settings.set_int("monitor-screen", monitorRow.selected);
        });

        // watch for render-on-current-monitor changes
        settings.connect("changed::render-on-current-monitor", () => {
            if (
                settings.get_boolean("render-on-current-monitor") &&
                settings.get_boolean("render-on-primary-monitor")
            ) {
                settings.set_boolean("render-on-primary-monitor", false);
            }
            monitorRow.set_sensitive(
                !settings.get_boolean("render-on-current-monitor")
            );
        });

        // watch for render-on-primary-monitor changes
        settings.connect("changed::render-on-primary-monitor", () => {
            if (
                settings.get_boolean("render-on-primary-monitor") &&
                settings.get_boolean("render-on-current-monitor")
            ) {
                settings.set_boolean("render-on-current-monitor", false);
            }
            monitorRow.set_sensitive(
                !settings.get_boolean("render-on-primary-monitor")
            );
        });

        // Animation Time
        const animationTime = new Adw.SpinRow({
            title: _("Animation Time"),
            subtitle: _("Duration of the dropdown animation in milliseconds"),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                step_increment: 5,
                upper: 500,
                value: settings.get_int("animation-time"),
            }),
        });
        generalSettingsGroup.add(animationTime);
        animationTime.connect("changed", () => {
            settings.set_int("animation-time", animationTime.get_value());
        });
        settings.connect("changed::animation-time", () => {
            animationTime.set_value(settings.get_int("animation-time"));
        });

        return page;
    }
}
