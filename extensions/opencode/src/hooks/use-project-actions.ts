import { Alert, Toast, confirmAlert, showToast } from "@raycast/api"
import path from "node:path"
import { type Dispatch, type SetStateAction } from "react"
import { type EditProjectFormValues } from "../components/edit-project-form"
import { opencodePath } from "../lib/opencode"
import {
  type Project,
  readCachedProjects,
  readCachedProjectLists,
  removeProjectFromCache,
  saveProjectIcon,
  toggleFavoriteProject,
  updateProjectInCache,
} from "../lib/project-store"
import { projectTitle } from "../lib/project"
import { errorMessage } from "../lib/utils/error"
import { quote } from "../lib/utils/sql"

import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export type ProjectListState = {
  err?: string
  items: Project[]
  excludedItems: Project[]
  loading: boolean
}

type SetProjectListState = Dispatch<SetStateAction<ProjectListState>>

export function useProjectActions(setState: SetProjectListState) {
  function appleScriptString(input: string) {
    return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
  }

  async function pickProjectIconFile(project: Project) {
    const prompt = appleScriptString(
      `Choose an icon for ${projectTitle(project)}`,
    )
    const fileTypes = ["png", "jpg", "jpeg", "svg", "gif", "webp", "ico"]
      .map((ext) => `"${ext}"`)
      .join(", ")

    try {
      const { stdout } = await execFileAsync("osascript", [
        "-e",
        `POSIX path of (choose file with prompt "${prompt}" of type {${fileTypes}})`,
      ])
      return stdout.trim() || undefined
    } catch (error) {
      const message = errorMessage(error)
      if (message.includes("User canceled") || message.includes("-128"))
        return undefined
      throw error
    }
  }

  function toggleFavorite(project: Project) {
    setState((current) => ({
      ...current,
      items: toggleFavoriteProject(current.items, project),
    }))
  }

  async function removeProject(item: Project) {
    const confirmed = await confirmAlert({
      title: "Exclude Project",
      message: `Exclude ${projectTitle(item)} from search results?`,
      primaryAction: {
        title: "Exclude",
        style: Alert.ActionStyle.Destructive,
      },
    })
    if (!confirmed) return

    setState((current) => ({
      ...current,
      items: removeProjectFromCache(current.items, item),
      excludedItems: readCachedProjectLists().excludedItems,
    }))

    await showToast({
      style: Toast.Style.Success,
      title: "Project excluded",
      message: item.worktree,
    })
  }

  async function saveProject(item: Project, values: EditProjectFormValues) {
    const name = values.name.trim()
    const iconColor = values.iconColor.trim()
    const startupCommand = values.startupCommand.trim()
    const iconPath = values.file?.[0]

    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Saving project details",
      message: projectTitle(item),
    })

    try {
      const query = [
        "update project",
        `set name = ${quote(name)}`,
        `, icon_color = ${quote(iconColor)}`,
        startupCommand
          ? `, commands = json_object('start', ${quote(startupCommand)})`
          : ", commands = null",
        `where worktree = ${quote(item.worktree)}`,
      ].join(" ")

      await execFileAsync(opencodePath(), ["db", query], {
        maxBuffer: 1024 * 1024 * 8,
      })

      let items: Project[] = []
      setState((current) => {
        items = updateProjectInCache(current.items, item, {
          name,
          iconColor,
          startupCommand,
        })
        return { ...current, items }
      })

      if (iconPath) {
        items = await saveProjectIcon(items, item, iconPath)
        setState((current) => ({ ...current, items }))
      }

      const changedParts = [
        name !== (item.name ?? "") ? "name" : undefined,
        iconPath ? "icon" : undefined,
        iconColor !== (item.iconColor ?? "") ? "color" : undefined,
        startupCommand !== (item.startupCommand ?? "")
          ? "startup script"
          : undefined,
      ].filter(Boolean)

      toast.style = Toast.Style.Success
      toast.title = changedParts.length
        ? `Updated ${changedParts.join(", ")}`
        : "Project details saved"
      toast.message = projectTitle({ ...item, name: name || undefined })
      return true
    } catch (error) {
      toast.style = Toast.Style.Failure
      toast.title = "Could not save project details"
      toast.message = errorMessage(error)
      return false
    }
  }

  async function chooseAndSaveProjectIcon(item: Project) {
    const iconPath = await pickProjectIconFile(item)
    if (!iconPath) return false

    const toast = await showToast({
      style: Toast.Style.Animated,
      title: item.hasIcon ? "Updating project icon" : "Adding project icon",
      message: projectTitle(item),
    })

    try {
      const items = await saveProjectIconFromPath(item, iconPath)
      setState((current) => ({ ...current, items }))

      toast.style = Toast.Style.Success
      toast.title = item.hasIcon ? "Project icon updated" : "Project icon added"
      toast.message = path.basename(iconPath)
      return true
    } catch (error) {
      toast.style = Toast.Style.Failure
      toast.title = "Could not save project icon"
      toast.message = errorMessage(error)
      return false
    }
  }

  async function saveProjectIconFromPath(item: Project, iconPath: string) {
    return saveProjectIcon(readCachedProjects(), item, iconPath)
  }

  return {
    chooseAndSaveProjectIcon,
    toggleFavorite,
    removeProject,
    saveProject,
  }
}
