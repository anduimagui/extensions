import { Action, ActionPanel, Icon } from "@raycast/api"
import {
  EditProjectForm,
  type EditProjectFormValues,
} from "./edit-project-form"
import { RelatedWorktreesList } from "./related-worktrees-list"
import { openProject, openProjectRemote } from "../lib/opencode"
import { type Project } from "../lib/project-store"

/* eslint-disable no-unused-vars */
export type SaveProjectHandler = (
  project: Project,
  values: EditProjectFormValues,
) => Promise<boolean>
export type SaveProjectIconHandler = (project: Project) => Promise<boolean>

type ProjectListItemActionsProps = {
  item: Project
  onOpenProject?: (project: Project) => Promise<void>
  onToggleFavorite: (project: Project) => void
  onRemoveProject: (project: Project) => Promise<void>
  onSaveProject: SaveProjectHandler
  onSaveProjectIcon: SaveProjectIconHandler
}
/* eslint-enable no-unused-vars */

export function ProjectListItemActions({
  item,
  onOpenProject,
  onToggleFavorite,
  onRemoveProject,
  onSaveProject,
  onSaveProjectIcon,
}: ProjectListItemActionsProps) {
  return (
    <ActionPanel>
      <Action
        title="Open in OpenCode"
        icon={Icon.Terminal}
        onAction={async () => {
          if (onOpenProject) {
            await onOpenProject(item)
            return
          }
          await openProject(item.worktree)
        }}
      />
      <Action
        title={item.isFavorite ? "Unfavorite Project" : "Favorite Project"}
        icon={item.isFavorite ? Icon.StarDisabled : Icon.Star}
        shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
        onAction={() => onToggleFavorite(item)}
      />
      <Action.Push
        title="Open Related Worktrees"
        icon={Icon.Folder}
        shortcut={{ modifiers: ["cmd", "shift"], key: "w" }}
        target={<RelatedWorktreesList item={item} />}
      />
      <Action.Push
        title="Edit Project"
        icon={Icon.Pencil}
        shortcut={{ modifiers: ["cmd"], key: "r" }}
        target={<EditProjectForm item={item} onSave={onSaveProject} />}
      />
      <Action.Push
        title="Rename Project"
        icon={Icon.TextCursor}
        target={<EditProjectForm item={item} onSave={onSaveProject} />}
      />
      <Action
        title={item.hasIcon ? "Change Project Icon" : "Add Project Icon"}
        icon={Icon.Image}
        shortcut={{ modifiers: ["cmd", "shift"], key: "i" }}
        onAction={async () => {
          await onSaveProjectIcon(item)
        }}
      />
      <Action
        title="Open Remote in Browser"
        icon={Icon.Globe}
        shortcut={{ modifiers: ["cmd", "shift"], key: "o" }}
        onAction={async () => {
          await openProjectRemote(item.worktree)
        }}
      />
      <Action
        title="Exclude Project from Results"
        icon={Icon.Trash}
        style={Action.Style.Destructive}
        shortcut={{ modifiers: ["ctrl"], key: "x" }}
        onAction={async () => {
          await onRemoveProject(item)
        }}
      />
      <Action.CopyToClipboard title="Copy Path" content={item.worktree} />
      <Action.ShowInFinder title="Show in Finder" path={item.worktree} />
    </ActionPanel>
  )
}
