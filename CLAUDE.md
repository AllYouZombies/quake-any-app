# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Quake Any App is a GNOME Shell Extension that provides a drop-down interface inspired by classic Quake games. It launches **any application** (not just terminals) in Quake mode from **any screen edge** with customizable animations, positioning, and multi-monitor support.

**Key Difference from Original**: This is a fork of [Quake Terminal](https://github.com/diegodario88/quake-terminal). The main enhancements are:
1. Support for any application (removed terminal-only filter)
2. Four screen edges (top, bottom, left, right) instead of just top
3. Flexible sizing with pixels or percentages for width and height independently
4. Smart alignment behavior that adapts to the selected edge

## Architecture

### Core Components

**src/extension.js** - Main extension entry point
- `QuakeAnyAppExtension` class handles lifecycle (enable/disable)
- Registers keyboard shortcut binding (`app-shortcut`) for application toggling
- Manages `QuakeMode` instance creation and state
- Uses `_handleQuakeModeApp()` to coordinate application lifecycle based on internal state machine

**src/quake-mode.js** - Core window management
- `QuakeMode` class manages a single application window instance with animations
- Implements a state machine with lifecycle states: READY → STARTING → CREATED_ACTOR → RUNNING → DEAD
- Handles window spawning, positioning, animations (4-directional slide), and cleanup
- Monkey-patches `Main.wm._shouldAnimateActor` to customize close animations for all edges
- Uses Clutter for smooth slide animations from any edge
- Manages signal connections for window events, focus changes, and settings updates

**src/prefs.js** - Preferences UI
- `QuakeAnyAppPreferences` extends `ExtensionPreferences`
- Builds Adw (libadwaita) preferences window with groups for Application, General, and Position settings
- `AppChooserDialog` allows user to select from **any** available application (no category filter)
- Settings are bound to GSettings schema bidirectionally

**src/schemas/org.gnome.shell.extensions.quake-any-app.gschema.xml** - GSettings schema
- Defines all extension settings including new settings:
  - `screen-edge`: top/bottom/left/right
  - `vertical-size-unit`: percent/pixels
  - `horizontal-size-unit`: percent/pixels
- Must be compiled with `glib-compile-schemas` before use

### Key Architecture Changes

#### Multi-Edge Animation System

The animation system now supports 4 edges with appropriate directional slides:
- **Top edge**: Slides down from top (translation_y: negative to 0)
- **Bottom edge**: Slides up from bottom (translation_y: positive to 0)
- **Left edge**: Slides right from left (translation_x: negative to 0)
- **Right edge**: Slides left from right (translation_x: positive to 0)

Implementation locations:
- `_showWindowWithAnimation()`: Sets initial translation based on edge, animates to (0,0)
- `_hideWindowWithAnimation()`: Animates back to edge-appropriate offset
- `_configureActorCloseAnimation()`: Handles close animation for all edges

#### Flexible Sizing System

Window dimensions can be specified in two units independently:
- **Percent mode**: Size as percentage of monitor area (10-100%)
- **Pixel mode**: Absolute size in pixels (10-3840 for height, 30-7680 for width)

Implementation in `_fitWindowToMonitor()`:
```javascript
if (verticalSizeUnit === "pixels") {
  windowHeight = Math.min(verticalSettingsValue, area.height);
} else {
  windowHeight = Math.round((verticalSettingsValue * area.height) / 100);
}
```

#### Smart Alignment

Alignment behavior adapts based on screen edge:
- **Top/Bottom edges**: Alignment controls horizontal position (left/center/right)
- **Left/Right edges**: Alignment controls vertical position (top/center/bottom)

This provides intuitive positioning regardless of edge selection.

### Signal Management & Lifecycle

The extension uses extensive signal connections that must be properly cleaned up:
- Window signals: `unmanaged`, `notify::focus-window`
- Shell App signals: `windows-changed`
- Window Manager signals: `map`
- Actor signals: `stage-views-changed`
- Settings signals: `changed::*` for various preferences (including new ones like `screen-edge`, `vertical-size-unit`, `horizontal-size-unit`)

All signal IDs are stored and disconnected in `destroy()` to prevent memory leaks.

### Multi-Monitor Support

Three monitor selection modes (mutually exclusive):
1. Current monitor (where mouse pointer is)
2. Primary monitor (GNOME display settings)
3. Specific monitor by index

Monitor selection logic is in `monitorDisplayScreenIndex` getter.

## Development Commands

### Build & Install
```bash
# Install dependencies
npm install

# Compile schemas and install extension
make install

# After installation, restart GNOME Shell:
# - On X11: Alt+F2, type 'r', Enter
# - On Wayland: Log out and log back in
```

### Testing
```bash
# Start nested GNOME Shell session for testing
dbus-run-session -- gnome-shell --nested --wayland
```

### Linting & Formatting
```bash
# Run ESLint
npx eslint src/

# Format code with Prettier
npx prettier --write .
```

### Debugging
```bash
# Watch extension logs (main shell)
journalctl -f -o cat /usr/bin/gnome-shell

# Watch preferences window logs
journalctl -f -o cat /usr/bin/gjs

# Monitor GSettings changes
dconf watch /org/gnome/shell/extensions/quake-any-app/
```

### Packaging
```bash
# Pack extension (creates .zip file)
make pack
```

## Release Process

This project uses **semantic-release** for automated versioning and releases.

### Commit Message Format
Use conventional commits:
- `feat:` - New feature (minor release)
- `fix:` - Bug fix (patch release)
- `docs:` - Documentation only
- `style:` - Code formatting
- `refactor:` - Code refactoring
- `test:` - Test changes
- `chore:` - Build/tooling changes

### What Happens on Release
When commits are pushed to `main`:
1. semantic-release analyzes commit messages and determines next version
2. Updates `package.json` and `src/metadata.json` versions
3. Generates/updates `CHANGELOG.md`
4. Creates git tag
5. Creates GitHub release

**Important**: Both `package.json` `version` and `metadata.json` `version-name` are updated to match. The `metadata.json` `version` field (GNOME extension version number) is incremented separately by the `scripts/update-metadata.js` script.

## Code Style

- 4-space indentation (enforced by ESLint)
- ES6+ JavaScript with imports (not CommonJS)
- JSDoc comments required for all functions (enforced by eslint-plugin-jsdoc)
- Use GJS/GObject introspection bindings (e.g., `import Meta from "gi://Meta"`)
- Prefer arrow functions for callbacks
- Always clean up signal connections in destroy methods

## Important Patterns

### Window Actor Naming
The extension marks its managed window actor with `actor.set_name("quake-any-app")` to identify it among multiple windows from the same application.

### Settings Key Names
- Changed from `terminal-*` to `app-*` (e.g., `app-id`, `app-shortcut`)
- New settings: `screen-edge`, `vertical-size-unit`, `horizontal-size-unit`

### Application Selection
No category filtering - users can select any application that:
- Has a valid Application ID
- Should be shown (not hidden)

### Edge-Based Animation Logic
When implementing or debugging animations:
1. Check `screen-edge` setting
2. Use appropriate translation property (translation_x for left/right, translation_y for top/bottom)
3. Ensure both show and hide animations use consistent directions
4. Remember to reset both translation_x and translation_y in onComplete callbacks

### Size Calculation Pattern
Always check the size unit setting before calculating dimensions:
```javascript
const unit = this._settings.get_string("vertical-size-unit");
if (unit === "pixels") {
  height = Math.min(value, area.height); // Cap at monitor size
} else {
  height = Math.round((value * area.height) / 100);
}
```

## GNOME Shell API References

- Extension system: https://gjs.guide/extensions/
- GObject introspection bindings: `@girs/gnome-shell` TypeScript definitions in devDependencies
- Shell version compatibility: GNOME Shell 45-49 (see `src/metadata.json`)

## File Structure Notes

- TypeScript definitions in `@types/` provide GJS ambient types
- `po/` directory (referenced in Makefile) contains translations
- Extension UUID: `quake-any-app@rustamqua.github.io`
- Settings schema ID: `org.gnome.shell.extensions.quake-any-app`

## Credits

This is a fork of [Quake Terminal](https://github.com/diegodario88/quake-terminal) by Diego Dario. The core architecture and window management system are based on the original implementation.
