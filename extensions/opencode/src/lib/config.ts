import { environment, getPreferenceValues } from "@raycast/api"
import path from "node:path"

function requiredPreference(value: string, label: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`Missing required preference: ${label}`)
  }
  return trimmed
}

export function cloneProjectPreferences() {
  const preferences = getPreferenceValues<Preferences.CloneProject>()

  return {
    cloneDirectory: requiredPreference(preferences.cloneDirectory, "Clone Directory"),
  }
}

export function extensionPaths() {
  const supportPath = environment.supportPath
  const projectIconsPath = path.join(supportPath, "project-icons")

  return {
    supportPath,
    favoritesPath: path.join(supportPath, "favorite-projects.json"),
    excludedProjectsPath: path.join(supportPath, "excluded-projects.json"),
    projectIndexPath: path.join(supportPath, "project-index.json"),
    iconManifestPath: path.join(projectIconsPath, "manifest.json"),
    projectIconsPath,
  }
}
