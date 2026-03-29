import { LaunchProps, showHUD, showToast, Toast } from "@raycast/api"
import { execFile } from "node:child_process"
import { access, mkdir } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { extensionPreferences } from "./lib/config"
import { openProject } from "./lib/opencode"
import { errorMessage } from "./lib/utils/error"

const execFileAsync = promisify(execFile)

type Arguments = {
  repositoryUrl: string
}

function normalizeRepositoryUrl(remoteUrl: string) {
  const trimmed = remoteUrl.trim()

  try {
    const parsedUrl = new URL(trimmed)

    if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
      const segments = parsedUrl.pathname.split("/").filter(Boolean)

      if (segments.length >= 2) {
        parsedUrl.pathname = `/${segments[0]}/${segments[1]}`
        parsedUrl.search = ""
        parsedUrl.hash = ""

        return parsedUrl.toString().replace(/\/$/, "")
      }
    }
  } catch {
    // Keep non-URL Git remotes like git@github.com:user/repo.git unchanged.
  }

  return trimmed.replace(/\/$/, "")
}

function repositoryName(remoteUrl: string) {
  const normalized = normalizeRepositoryUrl(remoteUrl)
  const match = normalized.match(/([^/:]+?)(?:\.git)?$/)
  const name = match?.[1]

  if (!name) {
    throw new Error(`Could not determine a project name from ${remoteUrl}`)
  }

  return name
}

export default async function Command(props: LaunchProps<{ arguments: Arguments }>) {
  const remoteUrl = normalizeRepositoryUrl(props.arguments.repositoryUrl)

  if (!remoteUrl) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Missing repository URL",
      message: "Provide a remote Git URL to clone",
    })
    return
  }

  const preferences = extensionPreferences()
  const projectName = repositoryName(remoteUrl)
  const targetDirectory = path.join(preferences.cloneDirectory, projectName)

  const toast = await showToast({
    style: Toast.Style.Animated,
    title: `Cloning ${projectName}`,
    message: targetDirectory,
  })

  try {
    await mkdir(preferences.cloneDirectory, { recursive: true })

    try {
      await access(targetDirectory)

      let message = `${targetDirectory} is not a Git repository`

      try {
        await access(path.join(targetDirectory, ".git"))
        message = `${targetDirectory} is already cloned`
      } catch {
        // Keep the non-repository message when .git is missing.
      }

      toast.style = Toast.Style.Success
      toast.title = `${projectName} already exists`
      toast.message = message

      await showHUD(`${projectName} already exists`)
      await openProject(targetDirectory)
      return
    } catch {
      // Continue with clone when the target directory does not exist.
    }

    await execFileAsync("git", ["clone", remoteUrl, targetDirectory], {
      maxBuffer: 1024 * 1024 * 4,
    })

    toast.style = Toast.Style.Success
    toast.title = `Cloned ${projectName}`
    toast.message = targetDirectory

    await showHUD(`Cloned ${projectName}`)
    await openProject(targetDirectory)
  } catch (error) {
    toast.style = Toast.Style.Failure
    toast.title = `Could not clone ${projectName}`
    toast.message = errorMessage(error)
  }
}
