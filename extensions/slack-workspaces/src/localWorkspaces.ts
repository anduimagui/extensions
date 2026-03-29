import { homedir } from "os";
import path from "path";
import { Dirent, createReadStream } from "fs";
import { readFile, readdir } from "fs/promises";
import readline from "readline";

export type LocalSlackWorkspace = {
  id: string;
  name?: string;
  domain?: string;
  iconUrl?: string;
  url?: string;
  unreadCount?: number;
  unreadHighlights?: number;
  hasUnreadActivity?: boolean;
  themeColor?: string;
  isSelected: boolean;
};

type MutableWorkspace = LocalSlackWorkspace & {
  order?: number;
  lastSeenAt: number;
};

type RootStateWorkspace = {
  id?: string;
  name?: string;
  domain?: string;
  icon?: {
    image_68?: string;
    image_88?: string;
  };
  order?: number;
  url?: string;
};

type RootState = {
  webapp?: {
    teams?: Record<
      string,
      {
        theme?: {
          titlebarBackground?: string;
        };
        unreads?: {
          unreads?: number;
          unreadHighlights?: number;
          showBullet?: boolean;
        };
      }
    >;
  };
  workspaces?: Record<string, RootStateWorkspace>;
  workspacesMeta?: {
    selectedWorkspaceId?: string;
  };
};

const workspaceIdPattern = "T[A-Z0-9]{8,}";
const domainRegex = new RegExp(
  String.raw`Updating credentials for workspace (${workspaceIdPattern}) / https://([a-z0-9-]+)\.slack\.com/`,
  "g",
);
const selectedRegex = new RegExp(String.raw`Selected workspace: (${workspaceIdPattern})`, "g");
const workspacesListRegex = /workspaces:\s*([A-Z0-9,]+)/g;
const teamMappingRegex = new RegExp(String.raw`(${workspaceIdPattern}):U[A-Z0-9]+`, "g");

function getSlackDataDirectory() {
  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support", "Slack");
  }

  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming"), "Slack");
  }

  return path.join(homedir(), ".config", "Slack");
}

function updateWorkspace(
  workspaces: Map<string, MutableWorkspace>,
  id: string,
  patch: Partial<Omit<MutableWorkspace, "id">>,
  lastSeenAt: number,
) {
  const existing = workspaces.get(id);
  workspaces.set(id, {
    id,
    name: patch.name ?? existing?.name,
    domain: patch.domain ?? existing?.domain,
    iconUrl: patch.iconUrl ?? existing?.iconUrl,
    url: patch.url ?? existing?.url,
    unreadCount: patch.unreadCount ?? existing?.unreadCount,
    unreadHighlights: patch.unreadHighlights ?? existing?.unreadHighlights,
    hasUnreadActivity: patch.hasUnreadActivity ?? existing?.hasUnreadActivity,
    themeColor: patch.themeColor ?? existing?.themeColor,
    order: patch.order ?? existing?.order,
    isSelected: patch.isSelected ?? existing?.isSelected ?? false,
    lastSeenAt: Math.max(lastSeenAt, existing?.lastSeenAt ?? 0),
  });
}

async function getLogFiles(logDirectory: string, prefix: string) {
  const files = await readdir(logDirectory, { withFileTypes: true });
  return files
    .filter((entry: Dirent) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(".log"))
    .map((entry: Dirent) => ({ fileName: entry.name, filePath: path.join(logDirectory, entry.name) }))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
}

async function processLogFile(filePath: string, onLine: (line: string) => void) {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of reader) {
      onLine(line);
    }
  } finally {
    reader.close();
    stream.close();
  }
}

function updateWorkspaceIds(workspaces: Map<string, MutableWorkspace>, ids: Iterable<string>, lastSeenAt: number) {
  for (const id of ids) {
    updateWorkspace(workspaces, id, {}, lastSeenAt);
  }
}

async function loadRootStateWorkspaces(rootStatePath: string, workspaces: Map<string, MutableWorkspace>) {
  const content = await readFile(rootStatePath, "utf8");
  const rootState = JSON.parse(content) as RootState;
  const selectedWorkspaceId = rootState.workspacesMeta?.selectedWorkspaceId;
  const webappTeams = rootState.webapp?.teams ?? {};

  for (const [id, workspace] of Object.entries(rootState.workspaces ?? {})) {
    const workspaceId = workspace.id ?? id;
    const webappTeam = webappTeams[workspaceId];
    const domain = workspace.domain ?? workspace.url?.match(/^https?:\/\/([a-z0-9-]+)\.slack\.com\//)?.[1];
    updateWorkspace(
      workspaces,
      workspaceId,
      {
        name: workspace.name,
        domain,
        iconUrl: workspace.icon?.image_88 ?? workspace.icon?.image_68,
        url: workspace.url,
        unreadCount: webappTeam?.unreads?.unreads,
        unreadHighlights: webappTeam?.unreads?.unreadHighlights,
        hasUnreadActivity: webappTeam?.unreads?.showBullet,
        themeColor: webappTeam?.theme?.titlebarBackground,
        order: workspace.order,
        isSelected: workspaceId === selectedWorkspaceId,
      },
      Number.MAX_SAFE_INTEGER,
    );
  }
}

async function loadFallbackLogWorkspaces(logDirectory: string, workspaces: Map<string, MutableWorkspace>) {
  const [browserLogs, webappLogs] = await Promise.all([
    getLogFiles(logDirectory, "browser").catch(() => []),
    getLogFiles(logDirectory, "webapp-console").catch(() => []),
  ]);

  for (const { fileName, filePath } of webappLogs) {
    const lastSeenAt = fileName === "webapp-console.log" ? Number.MAX_SAFE_INTEGER - 1 : 0;

    await processLogFile(filePath, (line) => {
      for (const match of line.matchAll(domainRegex)) {
        const [, id, domain] = match;
        updateWorkspace(workspaces, id, { domain }, lastSeenAt);
      }

      updateWorkspaceIds(
        workspaces,
        [...line.matchAll(teamMappingRegex)].map((match) => match[1]),
        lastSeenAt,
      );
    });
  }

  for (const { fileName, filePath } of browserLogs) {
    const lastSeenAt = fileName === "browser.log" ? Number.MAX_SAFE_INTEGER - 1 : 0;

    await processLogFile(filePath, (line) => {
      for (const match of line.matchAll(selectedRegex)) {
        const [, id] = match;
        updateWorkspace(workspaces, id, { isSelected: true }, lastSeenAt);
      }

      for (const match of line.matchAll(workspacesListRegex)) {
        updateWorkspaceIds(
          workspaces,
          match[1]
            .split(",")
            .map((workspaceId) => workspaceId.trim())
            .filter(Boolean),
          lastSeenAt,
        );
      }
    });
  }
}

export async function getLocalSlackWorkspaces(): Promise<LocalSlackWorkspace[]> {
  const slackDataDirectory = getSlackDataDirectory();
  const rootStatePath = path.join(slackDataDirectory, "storage", "root-state.json");
  const logDirectory = path.join(slackDataDirectory, "logs", "default");
  const workspaces = new Map<string, MutableWorkspace>();

  await loadRootStateWorkspaces(rootStatePath, workspaces).catch(() => undefined);
  await loadFallbackLogWorkspaces(logDirectory, workspaces).catch(() => undefined);

  return [...workspaces.values()]
    .sort((a, b) => {
      if (a.isSelected !== b.isSelected) {
        return a.isSelected ? -1 : 1;
      }

      if (a.order !== undefined && b.order !== undefined && a.order !== b.order) {
        return a.order - b.order;
      }

      if (a.order !== undefined) {
        return -1;
      }

      if (b.order !== undefined) {
        return 1;
      }

      if (a.lastSeenAt !== b.lastSeenAt) {
        return b.lastSeenAt - a.lastSeenAt;
      }

      return (a.name ?? a.domain ?? a.id).localeCompare(b.name ?? b.domain ?? b.id);
    })
    .map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      domain: workspace.domain,
      iconUrl: workspace.iconUrl,
      url: workspace.url,
      unreadCount: workspace.unreadCount,
      unreadHighlights: workspace.unreadHighlights,
      hasUnreadActivity: workspace.hasUnreadActivity,
      themeColor: workspace.themeColor,
      isSelected: workspace.isSelected,
    }));
}
