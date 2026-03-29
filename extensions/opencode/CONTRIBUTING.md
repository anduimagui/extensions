# Contributing

Thanks for your interest in contributing to Opencode Desktop.

## Development Setup

```bash
git clone https://github.com/anduimagui/opencode-raycast.git
cd opencode-raycast
npm install
```

Start the extension in Raycast development mode:

```bash
npm run dev
```

## Before Opening a Pull Request

Run the local checks before submitting changes:

```bash
npm run lint
npm run build
```

## Guidelines

- Keep changes focused and well described
- Follow the existing TypeScript and Raycast patterns in `src/`
- Update documentation when behavior changes
- Include screenshots or recordings for UI changes when helpful

## Pull Requests

1. Fork the repository
2. Create a branch for your change
3. Make and test your update
4. Open a pull request with a clear description of the problem and solution

## Issues

When filing a bug, include:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Your macOS, Raycast, and OpenCode versions when relevant
