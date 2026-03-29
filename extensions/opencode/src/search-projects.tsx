import { Action, ActionPanel, Cache, Icon, List, Toast, confirmAlert, showToast } from "@raycast/api"
import { useEffect, useState } from "react"
import { ProjectListItem } from "./components/project-list-item"
import { useProjectActions, type ProjectListState } from "./hooks/use-project-actions"
import { projectAccessoryPath, projectKeywords, projectSubtitle, projectTitle } from "./lib/project"
import {
  hydrateProjectIcons,
  loadProjects,
  readCachedProjectLists,
  restoreExcludedProject,
  type Project,
} from "./lib/project-store"
import { openProject } from "./lib/opencode"

const projectRecencyCache = new Cache({ namespace: "search-projects" })
const recentProjectOrderKey = "recent-project-order"

function readRecentProjectOrder() {
  try {
    const value = projectRecencyCache.get(recentProjectOrderKey)
    if (!value) return []

    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return []
  }
}

function writeRecentProjectOrder(worktree: string) {
  const nextOrder = [worktree, ...readRecentProjectOrder().filter((item) => item !== worktree)]
  projectRecencyCache.set(recentProjectOrderKey, JSON.stringify(nextOrder))
  return nextOrder
}

function sortProjectsByRecentOrder(items: Project[], recentOrder: string[]) {
  if (!recentOrder.length) return items

  const orderIndex = new Map(recentOrder.map((worktree, index) => [worktree, index]))
  return [...items].sort((a, b) => {
    const aIndex = orderIndex.get(a.worktree)
    const bIndex = orderIndex.get(b.worktree)

    if (aIndex === undefined && bIndex === undefined) return 0
    if (aIndex === undefined) return 1
    if (bIndex === undefined) return -1
    return aIndex - bIndex
  })
}

function splitHydratedProjects(items: Project[], excludedItems: Project[]) {
  const excludedWorktrees = new Set(excludedItems.map((item) => item.worktree))
  return {
    items: items.filter((item) => !excludedWorktrees.has(item.worktree)),
    excludedItems: items.filter((item) => excludedWorktrees.has(item.worktree)),
  }
}

export default function Command() {
  const [state, set] = useState<ProjectListState>(() => ({
    ...readCachedProjectLists(),
    loading: true,
  }))
  const { toggleFavorite, removeProject, saveProject, chooseAndSaveProjectIcon } = useProjectActions(set)
  const items = sortProjectsByRecentOrder(state.items, readRecentProjectOrder())

  async function openAndTrackProject(item: Project) {
    writeRecentProjectOrder(item.worktree)
    await openProject(item.worktree)
  }

  async function restoreProject(item: Project) {
    const confirmed = await confirmAlert({
      title: "Restore Project",
      message: `Show ${projectTitle(item)} in search results again?`,
      primaryAction: {
        title: "Restore",
      },
    })
    if (!confirmed) return

    restoreExcludedProject(item)
    set((current) => ({ ...current, ...readCachedProjectLists() }))

    await showToast({
      style: Toast.Style.Success,
      title: "Project restored",
      message: item.worktree,
    })
  }

  useEffect(() => {
    let live = true
    const hadCachedItems = state.items.length > 0

    loadProjects()
      .then(async (data) => {
        if (!live) return
        set({ items: data.items, excludedItems: data.excludedItems, loading: false })

        const items = await hydrateProjectIcons([...data.items, ...data.excludedItems], (hydrated) => {
          if (!live) return
          set((current) => {
            if ("err" in current) return current
            return { ...current, ...splitHydratedProjects(hydrated, current.excludedItems), loading: false }
          })
        })

        if (!live) return
        set({ ...splitHydratedProjects(items, data.excludedItems), loading: false })
      })
      .catch(async (err) => {
        if (!live) return

        set((current) => {
          if (current.items.length) return { ...current, loading: false }
          return { err: err instanceof Error ? err.message : String(err), items: [], excludedItems: [], loading: false }
        })

        if (hadCachedItems) {
          await showToast({
            style: Toast.Style.Failure,
            title: "Using cached projects",
            message: err instanceof Error ? err.message : String(err),
          })
        }
      })

    return () => {
      live = false
    }
  }, [])

  if ("err" in state) {
    return (
      <List isLoading={state.loading} searchBarPlaceholder="OpenCode projects unavailable">
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="OpenCode projects not available"
          description={state.err}
          actions={
            <ActionPanel>
              <Action.OpenInBrowser title="Open OpenCode Docs" url="https://opencode.ai" />
            </ActionPanel>
          }
        />
      </List>
    )
  }

  return (
    <List isLoading={state.loading} searchBarPlaceholder="Search OpenCode projects...">
      <List.Section title="Projects" subtitle={String(items.length)}>
        {items.map((item) => (
          <ProjectListItem
            key={item.id}
            item={item}
            onOpenProject={openAndTrackProject}
            onToggleFavorite={toggleFavorite}
            onRemoveProject={removeProject}
            onSaveProject={saveProject}
            onSaveProjectIcon={chooseAndSaveProjectIcon}
          />
        ))}
      </List.Section>
      <List.Section title="Excluded Projects" subtitle={String(state.excludedItems.length)}>
        {state.excludedItems.map((item) => (
          <List.Item
            key={`excluded-${item.id}`}
            title={projectTitle(item)}
            subtitle={projectSubtitle(item)}
            keywords={projectKeywords(item)}
            accessories={[{ text: projectAccessoryPath(item), tooltip: item.worktree }]}
            icon={item.icon ? { source: item.icon } : { source: Icon.EyeDisabled }}
            actions={
              <ActionPanel>
                <Action
                  title="Restore Project to Results"
                  icon={Icon.ArrowClockwise}
                  onAction={async () => {
                    await restoreProject(item)
                  }}
                />
                <Action.CopyToClipboard title="Copy Path" content={item.worktree} />
                <Action.ShowInFinder title="Show in Finder" path={item.worktree} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  )
}
