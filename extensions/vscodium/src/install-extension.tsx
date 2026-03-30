import { Action, ActionPanel, Color, Icon, List, showToast, Toast } from "@raycast/api";
import { useFetch } from "@raycast/utils";
import { useState } from "react";
import {
  InstallExtensionByIDAction,
  OpenExtensionByIDInBrowserAction,
  OpenExtensionByIDInVSCodiumAction,
  UninstallExtensionByIDAction,
} from "./extension-actions";
import { useLocalExtensions } from "./extensions";
import { Extension } from "./lib/vscodium";
import { compactNumberFormat } from "./utils";

function InstallExtensionAction(props: { extension: GalleryExtension; afterInstall?: () => void }): JSX.Element {
  return (
    <InstallExtensionByIDAction extensionID={getFullExtensionID(props.extension)} afterInstall={props.afterInstall} />
  );
}

function UninstallExtensionAction(props: { extension: GalleryExtension; afterUninstall?: () => void }): JSX.Element {
  return (
    <UninstallExtensionByIDAction
      extensionID={getFullExtensionID(props.extension)}
      afterUninstall={props.afterUninstall}
    />
  );
}

export interface GalleryQueryResult {
  offset: number;
  totalSize: number;
  extensions: GalleryExtension[];
}

export interface GalleryExtension {
  namespace: string;
  name: string;
  displayName: string;
  version: string;
  description?: string;
  timestamp: string;
  downloadCount?: number;
  verified?: boolean;
  deprecated?: boolean;
  files?: {
    icon?: string;
  };
}

function getFullExtensionID(extension: GalleryExtension): string {
  return `${extension.namespace}.${extension.name}`;
}

function GalleryExtensionListItem(props: {
  extension: GalleryExtension;
  installedExtensions: Extension[] | undefined;
  reloadLocalExtensions: () => void;
}): JSX.Element {
  const e = props.extension;
  const ie = props.installedExtensions;
  const installCount = e.downloadCount;
  const version = e.version;
  const lastUpdated = e.timestamp ? new Date(e.timestamp) : undefined;
  const installedIDs = ie ? ie.map((ext) => ext.id.toLocaleLowerCase()) : [];
  const alreadyInstalled = installedIDs.includes(getFullExtensionID(e).toLocaleLowerCase());
  return (
    <List.Item
      title={{ value: e.displayName, tooltip: e.description }}
      subtitle={e.namespace}
      icon={e.files?.icon || "icon.png"}
      accessories={[
        {
          tag: alreadyInstalled ? { value: "Installed", color: Color.Blue } : "",
          tooltip: alreadyInstalled ? "Already Installed" : "",
        },
        {
          tag: e.verified ? { value: "Verified", color: Color.Green } : "",
          tooltip: e.verified ? "Verified publisher" : "",
        },
        {
          tag: e.deprecated ? { value: "Deprecated", color: Color.Orange } : "",
          tooltip: e.deprecated ? "Deprecated extension" : "",
        },
        {
          icon: installCount !== undefined ? Icon.Download : undefined,
          text: installCount !== undefined ? compactNumberFormat(installCount) : undefined,
          tooltip: installCount !== undefined ? `${compactNumberFormat(installCount)} Installs` : undefined,
        },
        {
          tag: version,
          tooltip: lastUpdated ? `Last Update: ${lastUpdated?.toLocaleString()}` : "",
        },
      ]}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            {alreadyInstalled ? (
              <UninstallExtensionAction extension={e} afterUninstall={props.reloadLocalExtensions} />
            ) : (
              <InstallExtensionAction extension={e} afterInstall={props.reloadLocalExtensions} />
            )}
            <OpenExtensionByIDInVSCodiumAction extensionID={getFullExtensionID(e)} />
          </ActionPanel.Section>
          <ActionPanel.Section>
            <OpenExtensionByIDInBrowserAction extensionID={getFullExtensionID(e)} />
            <Action.CopyToClipboard
              content={getFullExtensionID(e)}
              title="Copy Extension Id"
              shortcut={{ modifiers: ["cmd", "shift"], key: "." }}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

function getTotalResultCount(data: GalleryQueryResult | undefined): number | undefined {
  return data?.totalSize;
}

export default function InstallExtensionRootCommand(): JSX.Element {
  const [searchText, setSearchText] = useState("");
  const { extensions: installExtensions, refresh } = useLocalExtensions();
  const { isLoading, error, data } = useGalleryQuery(searchText);
  if (error) {
    showToast({ style: Toast.Style.Failure, title: "Error", message: error });
  }
  const extensions = data?.extensions;
  const totalExtensionCount = getTotalResultCount(data);
  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search by name or ID in Open VSX"
      onSearchTextChange={setSearchText}
      throttle
    >
      <List.Section
        title="Found Extensions"
        subtitle={
          totalExtensionCount !== undefined ? `${extensions?.length}/${totalExtensionCount}` : `${extensions?.length}`
        }
      >
        {extensions?.map((e) => (
          <GalleryExtensionListItem
            key={getFullExtensionID(e)}
            extension={e}
            installedExtensions={installExtensions}
            reloadLocalExtensions={refresh}
          />
        ))}
      </List.Section>
    </List>
  );
}

function useGalleryQuery(searchText: string): {
  data: GalleryQueryResult | undefined;
  error: string | undefined;
  isLoading: boolean;
} {
  const execute = searchText.length > 0;
  const url = `https://open-vsx.org/api/-/search?query=${encodeURIComponent(searchText)}&size=100&offset=0`;
  const { isLoading, error, data } = useFetch<GalleryQueryResult | undefined>(url, {
    keepPreviousData: false,
    execute: execute,
  });
  return {
    isLoading: execute ? isLoading : false,
    error: error?.message,
    data: searchText.length <= 0 ? undefined : data,
  };
}
