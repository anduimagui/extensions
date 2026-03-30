import { Color, Icon, List } from "@raycast/api"
import { ProjectListItemActions } from "./project-list-item-actions"
import { projectAccessoryPath, projectKeywords, projectSubtitle, projectTitle } from "../lib/project"
import { type Project } from "../lib/project-store"
import { type SaveProjectHandler, type SaveProjectIconHandler } from "./project-list-item-actions"

type ProjectListItemProps = {
  item: Project
  onOpenProject?: (project: Project) => Promise<void>
  onToggleFavorite: (project: Project) => void
  onRemoveProject: (project: Project) => Promise<void>
  onSaveProject: SaveProjectHandler
  onSaveProjectIcon: SaveProjectIconHandler
}

export function ProjectListItem({
  item,
  onOpenProject,
  onToggleFavorite,
  onRemoveProject,
  onSaveProject,
  onSaveProjectIcon,
}: ProjectListItemProps) {
  return (
    <List.Item
      title={projectTitle(item)}
      subtitle={projectSubtitle(item)}
      keywords={projectKeywords(item)}
      accessories={[
        { text: projectAccessoryPath(item), tooltip: item.worktree },
        ...(item.isFavorite ? [{ icon: { source: Icon.Star, tintColor: Color.Yellow } }] : []),
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
          onOpenProject={onOpenProject}
          onToggleFavorite={onToggleFavorite}
          onRemoveProject={onRemoveProject}
          onSaveProject={onSaveProject}
          onSaveProjectIcon={onSaveProjectIcon}
        />
      }
    />
  )
}
