import os from "node:os"
import path from "node:path"
import { type Project } from "./project-store"

export function projectTitle(item: Project) {
  return (item.name ?? path.basename(item.worktree)) || item.worktree
}

export function projectKeywords(item: Project) {
  const values = new Set<string>()
  values.add(item.worktree)
  values.add(path.basename(item.worktree))
  if (item.name) values.add(item.name)
  if (item.latestSessionTitle) values.add(item.latestSessionTitle)
  return [...values].filter(Boolean)
}

export function projectSubtitle(item: Project) {
  return item.latestSessionTitle || item.worktree
}

export function projectAccessoryPath(item: Project) {
  const home = os.homedir()
  if (item.worktree === home) return "~"
  if (item.worktree.startsWith(`${home}${path.sep}`))
    return `~/${item.worktree.slice(home.length + 1)}`
  return item.worktree
}
