import { closeMainWindow, open } from "@raycast/api"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { projectRemoteBrowserUrl } from "./project-remote"

const execFileAsync = promisify(execFile)
const opencodeAppPaths = [
  "/Applications/OpenCode.app",
  "/Applications/OpenCode Beta.app",
  path.join(os.homedir(), "Applications", "OpenCode.app"),
  path.join(os.homedir(), "Applications", "OpenCode Beta.app"),
]

async function openInstalledOpencode(url: string) {
  const appPath = opencodeAppPaths.find((item) => existsSync(item))
  if (!appPath) return false

  await execFileAsync("open", ["-a", appPath, url])
  return true
}

function opencodeCandidates() {
  const pathEntries = (process.env.PATH || "").split(":").filter(Boolean)
  const home = os.homedir()
  const extras = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(home, ".local", "bin"),
    path.join(home, ".opencode", "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, "Library", "pnpm"),
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".volta", "bin"),
    path.join(home, ".asdf", "shims"),
    path.join(home, "bin"),
    "/Applications/OpenCode.app/Contents/MacOS",
    path.join(home, "Applications", "OpenCode.app", "Contents", "MacOS"),
  ]
  return [
    ...new Set(
      [...pathEntries, ...extras].map((dir) => path.join(dir, "opencode")),
    ),
  ]
}

export function opencodePath() {
  const file = opencodeCandidates().find((item) => existsSync(item))
  if (file) return file
  throw new Error(
    "Could not find `opencode`. Expected it on PATH or in /opt/homebrew/bin, /usr/local/bin, ~/.local/bin, ~/.opencode/bin, ~/.bun/bin, ~/Library/pnpm, ~/.npm-global/bin, ~/.volta/bin, ~/.asdf/shims, ~/bin, or OpenCode.app/Contents/MacOS",
  )
}

export async function syncProjectCache() {
  const { hydrateProjectIcons, loadProjects } = await import("./project-store")
  const { items } = await loadProjects()
  return hydrateProjectIcons(items)
}

export async function openProject(dir: string) {
  const url = `opencode://open-project?directory=${encodeURIComponent(dir)}`

  await closeMainWindow().catch(() => undefined)

  if (await openInstalledOpencode(url)) return

  await open(url)
}

export async function openProjectRemote(worktree: string) {
  const url = await projectRemoteBrowserUrl(worktree)
  await closeMainWindow().catch(() => undefined)
  await open(url)
}
