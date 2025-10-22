# GNOME Shell Extension - Quake Any App

![License: GPL v3](https://img.shields.io/badge/License-GPL%20v3-blue.svg)

<p align="center">
  <img src="assets/terminal.png" width="200" alt="A black terminal emulator icon with traditional bash symbol" />
</p>

<p align="center"><em>Quake Any App: A drop-down interface for GNOME Shell that launches any application in Quake mode from any screen edge, inspired by classic Quake games.</em></p>

## Overview

The GNOME Shell Extension - Quake Any App enhances your desktop by providing a drop-down interface, inspired by classic Quake games, that can instantly launch **any application** from **any screen edge** over any workspace.

> **Forked from**: [Quake Terminal](https://github.com/diegodario88/quake-terminal) by Diego Dario

### New Features

- **Any Application:** Launch any installed application (not just terminals) in Quake mode
- **Four Screen Edges:** Choose from top, bottom, left, or right screen edge
- **Flexible Sizing:** Set window size in either percentages or pixels for both width and height independently
- **Smart Alignment:** Automatic alignment behavior based on edge (horizontal alignment for top/bottom, vertical for left/right)

### Key Features

- **Quick Activation:** Instantly summon your preferred application in Quake mode using a single keyboard shortcut or a customizable key combination for fast, efficient access.
- **Workspace Integration:** The application remains hidden in overview mode and during Alt+Tab switching, ensuring it never obstructs your workflow when not in use.
- **Multi-Display Support:** Choose which display the Quake application appears on, offering flexibility for multi-monitor setups.
- **Custom Arguments:** Launch your application with custom arguments when opened by Quake Any App, allowing tailored configurations.
- **Aesthetic Animations:** Smooth sizing and animation timing from any screen edge for a polished user experience.

> **Note:** This extension does not provide applications. It works with applications already installed on your system.

---

## Installation

### Manual Installation

1. Clone this repository to your system:

```bash
git clone https://github.com/AllYouZombies/quake-any-app.git
```

2. Run the provided installation script:

```bash
cd quake-any-app
npm install
make install
```

3. Restart GNOME Shell (Alt+F2, type 'r', press Enter on X11, or log out/in on Wayland)

4. Enable the extension using GNOME Extensions app or:

```bash
gnome-extensions enable quake-any-app@AllYouZombies.github.io
```

## Contributing

### Setup

1. Fork this repo on Github
2. Clone your new repo
3. Browse to the root of the project and run the provided installation script:

```bash
npm install
```

```bash
make install
```

4. Make your changes to the code
5. Start a nested GNOME Shell session to test your changes

```bash
dbus-run-session -- gnome-shell --nested --wayland
```

### Release Process

This project uses [semantic-release](https://semantic-release.gitbook.io/) for automated versioning and releases. The release process is triggered automatically when commits are pushed to the `main` branch.

#### Commit Message Format

Use [conventional commits](https://www.conventionalcommits.org/) format for your commit messages:

- `feat:` - A new feature (triggers a minor release)
- `fix:` - A bug fix (triggers a patch release)
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Build process or auxiliary tool changes

Example:

```
feat: add support for custom terminal arguments
fix: resolve animation timing issue
docs: update installation instructions
```

#### What Happens on Release

When you push to `main` with proper conventional commit messages:

1. **Version Calculation**: semantic-release analyzes commit messages and determines the next version
2. **Version Updates**: Updates both `package.json` and `src/metadata.json` with the new version
3. **Changelog**: Generates/updates `CHANGELOG.md` with release notes
4. **Git Tag**: Creates a git tag for the release
5. **GitHub Release**: Creates a GitHub release with generated notes

Both `package.json` version and `metadata.json` `version-name` will be updated to match, while `metadata.json` `version` (GNOME extension version) will be incremented automatically.

### Debugging

- Watch extensions logs

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

- Watch preferences window logs

```bash
journalctl -f -o cat /usr/bin/gjs
```

- Watch GSettings updates:

```bash
dconf watch /org/gnome/shell/extensions/quake-any-app/
```

## GJS docs

GNOME Shell Extensions documentation and tutorial: https://gjs.guide/extensions/

## Credits

This project is a fork of [Quake Terminal](https://github.com/diegodario88/quake-terminal) by Diego Dario. Many thanks to Diego for creating the original extension!

## License

GPL-3.0-or-later

---

Made with ❤️ by [Rustam Astafeev](https://github.com/AllYouZombies) (forked from [Diego Dario](https://github.com/diegodario88))
