import { Toast, showHUD, showToast } from "@raycast/api"
import { syncProjectCache } from "./lib/opencode"
import { errorMessage } from "./lib/utils/error"

export default async function Command() {
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: "Syncing OpenCode cache",
    message: "Refreshing projects and icons",
  })

  try {
    const items = await syncProjectCache()

    toast.style = Toast.Style.Success
    toast.title = "OpenCode cache synced"
    toast.message = `${items.length} project${items.length === 1 ? "" : "s"}`

    await showHUD(`Synced ${items.length} project${items.length === 1 ? "" : "s"}`)
  } catch (error) {
    toast.style = Toast.Style.Failure
    toast.title = "Could not sync OpenCode cache"
    toast.message = errorMessage(error)
  }
}
