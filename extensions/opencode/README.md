# Opencode Desktop

Opencode Desktop adds a native Raycast launcher for browsing Opencode projects, cloning repositories into a preferred directory, reopening sessions that still need attention, and searching the public docs.

## Features

- Browse local Opencode projects from Raycast
- Clone Git repositories into a configured workspace folder
- Reopen unread or blocked Opencode sessions quickly
- Search Opencode documentation by locale, then preview or open pages in the browser
- Open projects directly in the Opencode macOS app

## Requirements

- macOS with [Raycast](https://www.raycast.com/)
- [Opencode](https://opencode.ai/) installed
- The `opencode` CLI available on your `PATH`

## Installation

Clone the repository and install dependencies:

```bash
npm install
```

Then start Raycast development mode:

```bash
npm run dev
```

Set the extension's `Clone Directory` preference in Raycast before using the clone command. The documentation command also supports a `Documentation Locale` preference.

## Usage

This extension currently includes six commands:

- `Search Projects` searches your Opencode project list and opens a selection in Opencode
- `Clone Project` clones a Git remote into your configured directory and opens it
- `Sync Cache` refreshes the cached Opencode project and icon data
- `Open Unread Sessions` lists sessions with unread, blocked, or active work
- `Search Worktrees` searches project worktrees and opens them in Opencode
- `Search Documentation` browses Opencode docs for the selected locale, previews markdown, and opens pages in the browser

## Development

```bash
git clone https://github.com/anduimagui/opencode-raycast.git
cd opencode-raycast
npm install
npm run lint
npm run build
```

## Project Structure

```text
assets/
src/
  components/
  hooks/
  lib/
```

## Contributing

Contributions are welcome. See `CONTRIBUTING.md` for development and pull request guidance.

## Store Submission Notes

- The public extension depends on a local Opencode installation and the `opencode` CLI.
- Before submitting to the Raycast Store, confirm the icon, screenshots, and repository metadata match the final public branding.

## License

MIT. See `LICENSE`.
