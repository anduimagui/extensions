import { Action, ActionPanel, getApplications, Icon, Image, List } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { useEffect, useState } from "react";
import { getLocalSlackWorkspaces, LocalSlackWorkspace } from "./localWorkspaces";

function useSlackApp() {
  const [state, setState] = useState<{ isAppInstalled: boolean; isLoading: boolean }>({
    isAppInstalled: false,
    isLoading: true,
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const apps = await getApplications();
      const isInstalled = apps.some((app) => app.name.toLowerCase() === "slack");

      if (!cancelled) {
        setState({ isAppInstalled: isInstalled, isLoading: false });
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

function getWorkspaceAccessories(workspace: LocalSlackWorkspace): List.Item.Accessory[] {
  const accessories: List.Item.Accessory[] = [];

  if (workspace.isSelected) {
    accessories.push({ tag: "Current" });
  }

  if (workspace.unreadHighlights && workspace.unreadHighlights > 0) {
    accessories.push({
      tag: { value: `${workspace.unreadHighlights} highlight${workspace.unreadHighlights === 1 ? "" : "s"}` },
    });
  } else if (workspace.unreadCount && workspace.unreadCount > 0) {
    accessories.push({ text: `${workspace.unreadCount} unread` });
  } else if (workspace.hasUnreadActivity) {
    accessories.push({ text: "Unread" });
  }

  if (workspace.themeColor) {
    accessories.push({
      icon: { source: Icon.CircleFilled, tintColor: workspace.themeColor },
      tooltip: `Theme ${workspace.themeColor}`,
    });
  }

  if (!workspace.domain && !workspace.name) {
    accessories.push({ text: workspace.id });
  }

  return accessories;
}

export default function Command() {
  const { isAppInstalled, isLoading: isLoadingSlackApp } = useSlackApp();
  const { data: workspaces, isLoading, error } = useCachedPromise(getLocalSlackWorkspaces, []);

  return (
    <List isLoading={isLoading || isLoadingSlackApp} searchBarPlaceholder="Search local Slack workspaces">
      {workspaces?.map((workspace) => {
        const title = workspace.name ?? workspace.domain ?? workspace.id;
        const subtitle = workspace.domain ? `${workspace.domain}.slack.com` : workspace.id;
        const browserUrl = workspace.url ?? `https://app.slack.com/client/${workspace.id}`;

        return (
          <List.Item
            key={workspace.id}
            title={title}
            subtitle={subtitle}
            icon={workspace.iconUrl ? { source: workspace.iconUrl, mask: Image.Mask.Circle } : { source: "icon.png" }}
            accessories={getWorkspaceAccessories(workspace)}
            actions={
              <ActionPanel>
                {isAppInstalled ? (
                  <Action.Open title="Open in Slack" target={`slack://open?team=${workspace.id}`} application="Slack" />
                ) : null}
                <Action.OpenInBrowser title="Open in Browser" url={browserUrl} />
                {workspace.url ? <Action.CopyToClipboard title="Copy Workspace URL" content={workspace.url} /> : null}
                <Action.CopyToClipboard title="Copy Workspace Id" content={workspace.id} />
              </ActionPanel>
            }
          />
        );
      })}

      {!isLoading && !error && workspaces?.length === 0 ? (
        <List.EmptyView
          icon={Icon.MagnifyingGlass}
          title="No Local Workspaces Found"
          description="Open Slack and switch workspaces so the desktop app can cache workspace metadata locally."
        />
      ) : null}

      {error ? (
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="Could Not Read Slack Data"
          description={error instanceof Error ? error.message : "Unable to inspect the local Slack workspace data."}
        />
      ) : null}
    </List>
  );
}
