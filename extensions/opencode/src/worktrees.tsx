import { Action, ActionPanel, Icon, List, Toast, showToast } from "@raycast/api"
import path from "node:path"
import { useEffect, useState } from "react"
import { ProjectListItemActions } from "./components/project-list-item-actions"
import { useProjectActions, type ProjectListState } from "./hooks/use-project-actions"
import { loadProjects, readCachedProjects, type Project } from "./lib/project-store"

type WorktreeListState = ProjectListState

function worktreeTitle(item: Project) {
  return item.worktreeName?.trim() || path.basename(item.worktree) || item.worktree
}

function projectLabel(item: Project, allItems: Project[]) {
  const byWorktree = new Map(allItems.map((project) => [project.worktree, project]))
  let current = path.dirname(item.worktree)

  while (current && current !== item.worktree && current !== path.dirname(current)) {
    const project = byWorktree.get(current)
    if (project) return project.name?.trim() || path.basename(project.worktree) || project.worktree
    current = path.dirname(current)
  }

  const parent = path.basename(path.dirname(item.worktree))
  return parent && parent !== "." && parent !== path.basename(item.worktree) ? parent : undefined
}

function worktreeKeywords(item: Project, project?: string) {
  return [
    ...new Set([item.worktree, path.basename(item.worktree), item.worktreeName, item.name, project].filter(Boolean)),
  ]
}

export default function Command() {
  const [state, set] = useState<WorktreeListState>(() => ({
    items: readCachedProjects(),
    excludedItems: [],
    loading: true,
  }))
  const { toggleFavorite, removeProject, saveProject, chooseAndSaveProjectIcon } = useProjectActions(set)

  useEffect(() => {
    let live = true
    const hadCachedItems = state.items.length > 0

    loadProjects()
      .then((data) => {
        if (!live) return
        set({
          items: data.items,
          excludedItems: data.excludedItems,
          loading: false,
        })
      })
      .catch(async (err) => {
        if (!live) return

        set((current) => {
          if (current.items.length) return { ...current, loading: false }
          return {
            err: err instanceof Error ? err.message : String(err),
            items: [],
            excludedItems: [],
            loading: false,
          }
        })

        if (hadCachedItems) {
          await showToast({
            style: Toast.Style.Failure,
            title: "Using cached worktrees",
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
      <List isLoading={state.loading} searchBarPlaceholder="OpenCode worktrees unavailable">
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="OpenCode worktrees not available"
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
    <List isLoading={state.loading} searchBarPlaceholder="Search OpenCode worktrees...">
      {state.items.map((item) => {
        const project = projectLabel(item, state.items)
        const savedNameDiffers = Boolean(
          item.worktreeName?.trim() && item.worktreeName.trim() !== path.basename(item.worktree),
        )

        return (
          <List.Item
            key={item.id}
            title={worktreeTitle(item)}
            subtitle={project ?? item.worktree}
            keywords={worktreeKeywords(item, project)}
            accessories={[
              ...(savedNameDiffers
                ? [
                    {
                      text: path.basename(item.worktree),
                      tooltip: item.worktree,
                    },
                  ]
                : []),
              ...(item.isFavorite ? [{ icon: Icon.Star, tooltip: "Favorite" }] : []),
              ...(item.sandboxCount
                ? [
                    {
                      tag: `${item.sandboxCount} sandbox${item.sandboxCount === 1 ? "" : "es"}`,
                    },
                  ]
                : []),
            ]}
            icon={item.icon ? { source: item.icon } : undefined}
            actions={
              <ProjectListItemActions
                item={item}
                onToggleFavorite={toggleFavorite}
                onRemoveProject={removeProject}
                onSaveProject={saveProject}
                onSaveProjectIcon={chooseAndSaveProjectIcon}
              />
            }
          />
        )
      })}
    </List>
  )
}
