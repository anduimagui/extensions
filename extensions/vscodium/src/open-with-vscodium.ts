import { showToast, Toast, open, closeMainWindow, getSelectedFinderItems, getFrontmostApplication } from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import { getCurrentFinderPath } from "./utils/apple-scripts";

const getSelectedPathFinderItems = async () => {
  const script = `
    tell application "Path Finder"
      set thePaths to {}
      repeat with pfItem in (get selection)
        set the end of thePaths to POSIX path of pfItem
      end repeat
      return thePaths
    end tell
  `;

  const paths = await runAppleScript(script);
  return paths.split(",");
};

export default async function main() {
  try {
    let selectedItems: { path: string }[] = [];
    const currentApp = await getFrontmostApplication();

    if (currentApp.name === "Finder") {
      selectedItems = await getSelectedFinderItems();
    } else if (currentApp.name === "Path Finder") {
      const paths = await getSelectedPathFinderItems();
      selectedItems = paths.map((p) => ({ path: p }));
    }

    if (selectedItems.length === 0) {
      const currentPath = await getCurrentFinderPath();
      if (currentPath.length === 0) throw new Error("Not a valid directory");
      await open(currentPath, "VSCodium");
    } else {
      for (const item of selectedItems) {
        await open(item.path, "VSCodium");
      }
    }

    await closeMainWindow();
  } catch (error) {
    await showToast({
      title: "Failed opening selected Finder or Path Finder item",
      style: Toast.Style.Failure,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
