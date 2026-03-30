import { Color } from "@raycast/api"
import { execFile, spawn } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import { extensionPaths } from "./config"
import { opencodePath } from "./opencode"
import { requestJson, waitForHealth } from "./utils/http"
import { basicAuthHeader, pickPort } from "./utils/network"
import { quote } from "./utils/sql"

const execFileAsync = promisify(execFile)
const paths = extensionPaths()
const projectIconExtensions = [
  "png",
  "jpg",
  "jpeg",
  "svg",
  "gif",
  "webp",
  "ico",
]
const iconHydrationBatchSize = 24
const iconHydrationPriorityCount = 40

type ProjectRow = {
  id: string
  worktree: string
  name?: string
  worktree_name?: string
  latest_session_title?: string
  icon_color?: string
  startup_command?: string
  time_updated?: string
  sandbox_count?: string
  has_icon?: string
}

type SessionDirectoryRow = {
  id: string
  directory: string
  latest_session_title?: string
  time_updated?: string
}

type ApiProject = {
  id?: string
}

type SessionStatus = {
  type: "idle" | "retry" | "busy"
}

type Permission = {
  sessionID: string
}

type ProjectSessionRow = {
  id: string
  project_id: string
  title?: string
  updated_at?: string
  waiting?: string
}

type CachedProject = {
  id: string
  worktree: string
  name?: string
  worktreeName?: string
  latestSessionTitle?: string
  iconColor?: string
  startupCommand?: string
  sandboxCount: number
  updatedAt?: number
  hasIcon: boolean
  isSessionOnly?: boolean
  relatedIds?: string[]
}

export type Project = {
  id: string
  worktree: string
  name?: string
  worktreeName?: string
  latestSessionTitle?: string
  icon?: string
  iconColor?: string
  tint?: Color
  startupCommand?: string
  sandboxCount: number
  updatedAt?: number
  hasIcon: boolean
  isSessionOnly: boolean
  isFavorite: boolean
  relatedIds: string[]
}

export type ProjectLists = {
  items: Project[]
  excludedItems: Project[]
}

type HydrationUpdate = (_items: Project[]) => void

let iconManifestCache: Record<string, string> | undefined
let favoritesCache: Set<string> | undefined
let excludedProjectsCache: Set<string> | undefined

function supportDir() {
  mkdirSync(paths.supportPath, { recursive: true })
  return paths.supportPath
}

function iconCacheDir() {
  mkdirSync(paths.projectIconsPath, { recursive: true })
  return paths.projectIconsPath
}

function readJsonFile<T>(filePath: string, fallback: T) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T
  } catch {
    return fallback
  }
}

function writeJsonFile(filePath: string, value: unknown) {
  supportDir()
  writeFileSync(filePath, JSON.stringify(value), "utf8")
}

function getIconManifest() {
  iconManifestCache ??= readJsonFile<Record<string, string>>(
    paths.iconManifestPath,
    {},
  )
  return iconManifestCache
}

function writeIconManifest(manifest: Record<string, string>) {
  iconManifestCache = manifest
  iconCacheDir()
  writeFileSync(paths.iconManifestPath, JSON.stringify(manifest), "utf8")
}

function getFavorites() {
  favoritesCache ??= new Set(readJsonFile<string[]>(paths.favoritesPath, []))
  return favoritesCache
}

function writeFavorites(favorites: Set<string>) {
  favoritesCache = favorites
  writeJsonFile(paths.favoritesPath, [...favorites])
}

function getExcludedProjects() {
  excludedProjectsCache ??= new Set(
    readJsonFile<string[]>(paths.excludedProjectsPath, []),
  )
  return excludedProjectsCache
}

function writeExcludedProjects(excludedProjects: Set<string>) {
  excludedProjectsCache = excludedProjects
  writeJsonFile(paths.excludedProjectsPath, [...excludedProjects])
}

function readProjectIndex() {
  return readJsonFile<CachedProject[]>(paths.projectIndexPath, [])
}

function colorKey(input?: Color) {
  switch (input) {
    case Color.Red:
      return "red"
    case Color.Orange:
      return "orange"
    case Color.Yellow:
      return "yellow"
    case Color.Green:
      return "green"
    case Color.Blue:
      return "blue"
    case Color.Magenta:
      return "magenta"
    case Color.SecondaryText:
      return "secondary"
    default:
      return undefined
  }
}

function writeProjectIndex(items: Project[]) {
  writeJsonFile(
    paths.projectIndexPath,
    items.map((item) => ({
      id: item.id,
      worktree: item.worktree,
      name: item.name,
      worktreeName: item.worktreeName,
      latestSessionTitle: item.latestSessionTitle,
      iconColor: item.iconColor ?? colorKey(item.tint),
      startupCommand: item.startupCommand,
      sandboxCount: item.sandboxCount,
      updatedAt: item.updatedAt,
      hasIcon: item.hasIcon,
      isSessionOnly: item.isSessionOnly,
      relatedIds: item.relatedIds,
    })),
  )
}

function favoriteKeys(
  project: Pick<Project, "id" | "worktree" | "relatedIds">,
) {
  return [project.worktree, project.id, ...project.relatedIds]
}

function isProjectFavorite(
  favorites: Set<string>,
  project: Pick<Project, "id" | "worktree" | "relatedIds">,
) {
  return favoriteKeys(project).some((key) => favorites.has(key))
}

function tint(input: string | null | undefined) {
  if (!input) return undefined
  const key = input.toLowerCase()
  if (key.includes("red")) return Color.Red
  if (key.includes("orange")) return Color.Orange
  if (key.includes("yellow")) return Color.Yellow
  if (key.includes("green")) return Color.Green
  if (key.includes("blue")) return Color.Blue
  if (key.includes("magenta") || key.includes("pink") || key.includes("purple"))
    return Color.Magenta
  if (key.includes("secondary") || key.includes("gray") || key.includes("grey"))
    return Color.SecondaryText
  return undefined
}

function sortProjects(items: Project[]) {
  return items.sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1

    const timeA = a.updatedAt ?? 0
    const timeB = b.updatedAt ?? 0
    if (timeA !== timeB) return timeB - timeA

    const labelA = a.name ?? a.worktree
    const labelB = b.name ?? b.worktree
    return labelA.localeCompare(labelB)
  })
}

function dedupeProjects(items: Project[]) {
  const projects = new Map<string, Project>()

  for (const item of items) {
    const existing = projects.get(item.worktree)
    if (!existing) {
      projects.set(item.worktree, item)
      continue
    }

    const mergedRelatedIds = [
      ...new Set([...existing.relatedIds, ...item.relatedIds]),
    ]
    const keepCurrent =
      item.isFavorite !== existing.isFavorite
        ? item.isFavorite
        : (item.updatedAt ?? 0) !== (existing.updatedAt ?? 0)
          ? (item.updatedAt ?? 0) > (existing.updatedAt ?? 0)
          : item.hasIcon !== existing.hasIcon
            ? item.hasIcon
            : item.sandboxCount > existing.sandboxCount

    projects.set(
      item.worktree,
      keepCurrent
        ? {
            ...item,
            relatedIds: mergedRelatedIds,
            isFavorite: item.isFavorite || existing.isFavorite,
          }
        : {
            ...existing,
            relatedIds: mergedRelatedIds,
            isFavorite: existing.isFavorite || item.isFavorite,
          },
    )
  }

  return [...projects.values()]
}

function isProjectExcluded(project: Pick<Project, "worktree">) {
  const excludedProjects = getExcludedProjects()
  return excludedProjects.has(project.worktree)
}

function splitExcludedProjects(items: Project[]): ProjectLists {
  const visibleItems: Project[] = []
  const excludedItems: Project[] = []

  for (const item of items) {
    if (isProjectExcluded(item)) excludedItems.push(item)
    else visibleItems.push(item)
  }

  return {
    items: sortProjects(visibleItems),
    excludedItems: sortProjects(excludedItems),
  }
}

function cachedIconPath(id: string) {
  const file = getIconManifest()[id]
  if (!file) return undefined

  const fullPath = path.join(iconCacheDir(), file)
  if (existsSync(fullPath)) return fullPath

  const manifest = { ...getIconManifest() }
  delete manifest[id]
  writeIconManifest(manifest)
  return undefined
}

function dataUrlParts(input: string) {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(input)
  if (!match) return undefined
  return { mime: match[1], data: match[2] }
}

function iconExtension(mime: string) {
  if (mime === "image/svg+xml") return "svg"
  if (mime === "image/png") return "png"
  if (mime === "image/jpeg") return "jpg"
  if (mime === "image/gif") return "gif"
  if (mime === "image/webp") return "webp"
  if (mime === "image/vnd.microsoft.icon" || mime === "image/x-icon")
    return "ico"
  return "img"
}

function iconMimeType(ext: string) {
  if (ext === "svg") return "image/svg+xml"
  if (ext === "png") return "image/png"
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg"
  if (ext === "gif") return "image/gif"
  if (ext === "webp") return "image/webp"
  if (ext === "ico") return "image/x-icon"
  return undefined
}

function cacheIconFile(id: string, ext: string, data: Buffer) {
  const file = `${id}.${ext}`
  const fullPath = path.join(iconCacheDir(), file)
  writeFileSync(fullPath, data)
  writeIconManifest({ ...getIconManifest(), [id]: file })
  return fullPath
}

function storeCachedIcon(id: string, iconUrl: string) {
  const parsed = dataUrlParts(iconUrl)
  if (!parsed) return undefined
  return cacheIconFile(
    id,
    iconExtension(parsed.mime),
    Buffer.from(parsed.data, "base64"),
  )
}

function discoverProjectIcon(worktree: string) {
  const settingsDir = path.join(worktree, ".opencode")

  for (const ext of projectIconExtensions) {
    const candidate = path.join(settingsDir, `icon.${ext}`)
    if (existsSync(candidate)) return candidate
  }

  try {
    const pattern = new RegExp(
      `^icon\\.(${projectIconExtensions.join("|")})$`,
      "i",
    )
    const file = readdirSync(settingsDir).find((name) => pattern.test(name))
    if (file) return path.join(settingsDir, file)
  } catch {
    // Ignore unreadable or missing .opencode directory.
  }

  return undefined
}

function cacheProjectIcon(id: string, iconPath: string) {
  const ext = path.extname(iconPath).slice(1).toLowerCase() || "img"
  return cacheIconFile(id, ext, readFileSync(iconPath))
}

function projectIconDataUrl(iconPath: string) {
  const ext = path.extname(iconPath).slice(1).toLowerCase()
  const mime = iconMimeType(ext)
  if (!mime) throw new Error(`Unsupported icon file type: .${ext || "unknown"}`)
  return `data:${mime};base64,${readFileSync(iconPath).toString("base64")}`
}

function parseTsv(input: string) {
  const lines = input.split(/\r?\n/).filter(Boolean)
  const [header, ...rows] = lines
  if (!header) return [] as Array<Record<string, string>>

  const columns = header.split("\t")
  return rows.map((row) => {
    const values = row.split("\t")
    return Object.fromEntries(
      columns.map((column, index) => [column, values[index] ?? ""]),
    )
  })
}

async function withServer<T>(
  run: (baseUrl: string, authorization: string) => Promise<T>,
) {
  const port = await pickPort()
  const username = "raycast"
  const password = `raycast-${process.pid}-${Date.now()}`
  const authorization = basicAuthHeader(username, password)
  const baseUrl = `http://127.0.0.1:${port}`
  let stderr = ""

  const child = spawn(
    opencodePath(),
    ["serve", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      env: {
        ...process.env,
        OPENCODE_SERVER_PASSWORD: password,
        OPENCODE_SERVER_USERNAME: username,
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  )

  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString("utf8")
    stderr = stderr.slice(-4000)
  })

  try {
    await waitForHealth(baseUrl, authorization, 10000, () => stderr.trim())
    return await run(baseUrl, authorization)
  } finally {
    if (!child.killed) child.kill("SIGTERM")
  }
}
function sessionState(
  status: SessionStatus | undefined,
  permission: boolean,
  waiting: boolean,
) {
  if (permission) return "permission"
  if (status?.type === "busy") return "working"
  if (status?.type === "retry") return "error"
  if (waiting) return "unread"
  return undefined
}

function sessionPriority(state: ReturnType<typeof sessionState>) {
  if (state === "working") return 4
  if (state === "permission") return 3
  if (state === "error") return 2
  if (state === "unread") return 1
  return 0
}

function normalizePreviewTitle(input?: string) {
  if (!input) return undefined
  const normalized = input.replace(/\s+/g, " ").trim()
  if (!normalized) return undefined
  const maxLength = 72
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`
}

async function listProjectSessions(projectIds: string[]) {
  if (!projectIds.length) return [] as ProjectSessionRow[]

  const query = [
    "with latest_assistant as (",
    "select session_id, time_created, json_extract(data, '$.time.completed') as completed,",
    "row_number() over (partition by session_id order by time_created desc) as rn",
    "from message",
    "where json_extract(data, '$.role') = 'assistant'",
    "),",
    "latest_user as (",
    "select session_id, time_created, row_number() over (partition by session_id order by time_created desc) as rn",
    "from message",
    "where json_extract(data, '$.role') = 'user'",
    "),",
    "known_projects as (",
    `select id, worktree, name from project where id in (${projectIds.map(quote).join(", ")})`,
    ")",
    "select s.id, s.project_id, coalesce(s.title, p.name, p.worktree) as title,",
    "coalesce(s.time_updated, s.time_created) as updated_at,",
    "case",
    "when la.time_created is not null and la.completed is not null and coalesce(lu.time_created, 0) < la.time_created then 1",
    "else 0",
    "end as waiting",
    "from session s",
    "join known_projects p on p.id = s.project_id",
    "left join latest_assistant la on la.session_id = s.id and la.rn = 1",
    "left join latest_user lu on lu.session_id = s.id and lu.rn = 1",
    "where s.parent_id is null",
    "and s.time_archived is null",
    "order by coalesce(s.time_updated, s.time_created) desc",
  ].join(" ")

  const { stdout } = await execFileAsync(
    opencodePath(),
    ["db", query, "--format", "tsv"],
    {
      maxBuffer: 1024 * 1024 * 8,
    },
  )

  return parseTsv(stdout)
    .filter(
      (
        row,
      ): row is Record<string, string> & { id: string; project_id: string } =>
        Boolean(row.id && row.project_id),
    )
    .map((row) => ({
      id: row.id,
      project_id: row.project_id,
      title: row.title,
      updated_at: row.updated_at,
      waiting: row.waiting,
    }))
}

async function resolveSessionPreviewTitles(items: Project[]) {
  const projectIds = items.map((item) => item.id)
  if (!projectIds.length) return items

  try {
    const previews = await withServer(async (baseUrl, authorization) => {
      const [projects, statuses, permissions, sessions] = await Promise.all([
        requestJson<ApiProject[]>(new URL("/project", baseUrl), authorization),
        requestJson<Record<string, SessionStatus>>(
          new URL("/session/status", baseUrl),
          authorization,
        ),
        requestJson<Permission[]>(
          new URL("/permission", baseUrl),
          authorization,
        ),
        listProjectSessions(projectIds),
      ])

      const knownProjectIds = new Set(
        projects.flatMap((project) => (project.id ? [project.id] : [])),
      )
      const pending = new Set(permissions.map((item) => item.sessionID))
      const sessionsByProject = new Map<string, ProjectSessionRow[]>()

      for (const session of sessions) {
        if (!knownProjectIds.has(session.project_id)) continue
        const existing = sessionsByProject.get(session.project_id)
        if (existing) existing.push(session)
        else sessionsByProject.set(session.project_id, [session])
      }

      return new Map(
        items.map((item) => {
          const fallback = normalizePreviewTitle(item.latestSessionTitle)
          const preferred = (sessionsByProject.get(item.id) || [])
            .map((session) => ({
              title: normalizePreviewTitle(session.title),
              updatedAt: Number(session.updated_at) || 0,
              priority: sessionPriority(
                sessionState(
                  statuses[session.id],
                  pending.has(session.id),
                  Number(session.waiting) > 0,
                ),
              ),
            }))
            .filter((session) => session.title)
            .sort(
              (a, b) => b.priority - a.priority || b.updatedAt - a.updatedAt,
            )[0]

          return [item.id, preferred?.title || fallback]
        }),
      )
    })

    return items.map((item) => ({
      ...item,
      latestSessionTitle: previews.get(item.id) || item.latestSessionTitle,
    }))
  } catch {
    return items.map((item) => ({
      ...item,
      latestSessionTitle: normalizePreviewTitle(item.latestSessionTitle),
    }))
  }
}

async function loadSessionOnlyProjects(favorites: Set<string>) {
  const query = [
    "select min(id) as id, directory,",
    "(select nullif(s2.title, '') from session s2 where s2.directory = s1.directory and s2.parent_id is null and s2.time_archived is null order by coalesce(s2.time_updated, s2.time_created) desc limit 1) as latest_session_title,",
    "max(coalesce(time_updated, time_created)) as time_updated",
    "from session s1",
    "where directory != '/'",
    "and parent_id is null",
    "and time_archived is null",
    "and project_id = 'global'",
    "and not exists (select 1 from project p where p.worktree = s1.directory)",
    "group by directory",
    "order by max(coalesce(time_updated, time_created)) desc, directory asc",
  ].join(" ")

  const { stdout } = await execFileAsync(
    opencodePath(),
    ["db", query, "--format", "tsv"],
    {
      maxBuffer: 1024 * 1024 * 4,
    },
  )

  return parseTsv(stdout)
    .filter((row): row is SessionDirectoryRow =>
      Boolean(row.id && row.directory),
    )
    .map((row) => {
      const relatedIds = [row.id]
      return {
        id: row.id,
        worktree: row.directory,
        name: undefined,
        worktreeName: undefined,
        latestSessionTitle: row.latest_session_title || undefined,
        icon: cachedIconPath(row.id),
        iconColor: undefined,
        tint: undefined,
        startupCommand: undefined,
        sandboxCount: 0,
        updatedAt: row.time_updated
          ? Number(row.time_updated) || undefined
          : undefined,
        hasIcon: false,
        isSessionOnly: true,
        isFavorite: isProjectFavorite(favorites, {
          id: row.id,
          worktree: row.directory,
          relatedIds,
        }),
        relatedIds,
      } satisfies Project
    })
}

function toProject(row: ProjectRow, favorites: Set<string>): Project {
  const relatedIds = [row.id]
  return {
    id: row.id,
    worktree: row.worktree,
    name: row.name || undefined,
    worktreeName: row.worktree_name || undefined,
    latestSessionTitle: row.latest_session_title || undefined,
    icon: cachedIconPath(row.id),
    iconColor: row.icon_color || undefined,
    tint: tint(row.icon_color),
    startupCommand: row.startup_command || undefined,
    sandboxCount: Number(row.sandbox_count) || 0,
    updatedAt: row.time_updated
      ? Number(row.time_updated) || undefined
      : undefined,
    hasIcon: Number(row.has_icon) > 0,
    isSessionOnly: false,
    isFavorite: isProjectFavorite(favorites, {
      id: row.id,
      worktree: row.worktree,
      relatedIds,
    }),
    relatedIds,
  }
}

function cachedProjectToProject(
  record: CachedProject,
  favorites: Set<string>,
): Project {
  const relatedIds = record.relatedIds?.length ? record.relatedIds : [record.id]
  return {
    id: record.id,
    worktree: record.worktree,
    name: record.name,
    worktreeName: record.worktreeName,
    latestSessionTitle: record.latestSessionTitle,
    icon: cachedIconPath(record.id),
    iconColor: record.iconColor,
    tint: tint(record.iconColor),
    startupCommand: record.startupCommand,
    sandboxCount: record.sandboxCount,
    updatedAt: record.updatedAt,
    hasIcon: record.hasIcon,
    isSessionOnly: Boolean(record.isSessionOnly),
    isFavorite: isProjectFavorite(favorites, {
      id: record.id,
      worktree: record.worktree,
      relatedIds,
    }),
    relatedIds,
  }
}

export function readCachedProjects() {
  return readCachedProjectLists().items
}

function readAllCachedProjects() {
  const favorites = getFavorites()
  return sortProjects(
    dedupeProjects(
      readProjectIndex().map((item) => cachedProjectToProject(item, favorites)),
    ),
  )
}

function writeMergedProjectIndex(items: Project[]) {
  const byWorktree = new Map(
    readAllCachedProjects().map((item) => [item.worktree, item]),
  )
  for (const item of items) byWorktree.set(item.worktree, item)
  writeProjectIndex(sortProjects([...byWorktree.values()]))
}

export function readCachedProjectLists() {
  return splitExcludedProjects(readAllCachedProjects())
}

export async function loadProjects() {
  const favorites = getFavorites()
  const query = [
    "select id, worktree, name,",
    "(select nullif(w.name, '') from workspace w where w.directory = project.worktree order by rowid desc limit 1) as worktree_name,",
    "(select nullif(s.title, '') from session s where s.project_id = project.id and s.parent_id is null and s.time_archived is null order by coalesce(s.time_updated, s.time_created) desc limit 1) as latest_session_title,",
    "icon_color, json_extract(commands, '$.start') as startup_command,",
    "time_updated, coalesce(json_array_length(sandboxes), 0) as sandbox_count,",
    "case when icon_url is not null and icon_url != '' then 1 else 0 end as has_icon",
    "from project",
    "where worktree != '/'",
    "order by coalesce(time_updated, 0) desc, coalesce(name, worktree) asc",
  ].join(" ")

  const { stdout } = await execFileAsync(
    opencodePath(),
    ["db", query, "--format", "tsv"],
    {
      maxBuffer: 1024 * 1024 * 4,
    },
  )

  const items = sortProjects(
    dedupeProjects([
      ...parseTsv(stdout)
        .filter((item): item is ProjectRow => Boolean(item.id && item.worktree))
        .map((item) => toProject(item, favorites)),
      ...(await loadSessionOnlyProjects(favorites)),
    ]),
  )

  const next = await resolveSessionPreviewTitles(items)

  writeProjectIndex(next)
  return splitExcludedProjects(next)
}

async function fetchRemoteIcons(items: Project[]) {
  const ids = items.map((item) => item.id)
  if (!ids.length) return new Map<string, string>()

  const query = [
    "select id, icon_url",
    "from project",
    `where id in (${ids.map(quote).join(", ")}) and icon_url is not null and icon_url != ''`,
  ].join(" ")

  const { stdout } = await execFileAsync(
    opencodePath(),
    ["db", query, "--format", "tsv"],
    {
      maxBuffer: 1024 * 1024 * 8,
    },
  )

  return new Map(
    parseTsv(stdout)
      .filter((row) => row.id && row.icon_url)
      .map((row) => [row.id, row.icon_url]),
  )
}

function prioritizeHydration(items: Project[]) {
  return [...items].sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1
    const timeA = a.updatedAt ?? 0
    const timeB = b.updatedAt ?? 0
    return timeB - timeA
  })
}

async function hydrateIconBatch(items: Project[]) {
  const remotePending: Project[] = []

  for (const item of items) {
    if (item.icon) continue

    const cached = cachedIconPath(item.id)
    if (cached) {
      item.icon = cached
      continue
    }

    const projectIcon = discoverProjectIcon(item.worktree)
    if (projectIcon) {
      item.icon = cacheProjectIcon(item.id, projectIcon)
      continue
    }

    if (item.hasIcon) remotePending.push(item)
  }

  if (!remotePending.length) return

  const remoteIcons = await fetchRemoteIcons(remotePending)
  for (const item of remotePending) {
    const iconUrl = remoteIcons.get(item.id)
    if (iconUrl) item.icon = storeCachedIcon(item.id, iconUrl)
  }
}

export async function hydrateProjectIcons(
  items: Project[],
  onUpdate?: HydrationUpdate,
) {
  const next = items.map((item) => ({ ...item }))
  const pending = prioritizeHydration(next.filter((item) => !item.icon))
  if (!pending.length) return next

  const priority = pending.slice(0, iconHydrationPriorityCount)
  const remainder = pending.slice(iconHydrationPriorityCount)

  if (priority.length) {
    await hydrateIconBatch(priority)
    onUpdate?.([...next])
  }

  for (
    let index = 0;
    index < remainder.length;
    index += iconHydrationBatchSize
  ) {
    await hydrateIconBatch(
      remainder.slice(index, index + iconHydrationBatchSize),
    )
    onUpdate?.([...next])
  }

  return next
}

export function renameProjectInCache(
  items: Project[],
  project: Pick<Project, "worktree">,
  name?: string,
) {
  const nextName = name?.trim() || undefined
  const next = sortProjects(
    items.map((item) =>
      item.worktree === project.worktree ? { ...item, name: nextName } : item,
    ),
  )
  writeMergedProjectIndex(next)
  return next
}

export function updateProjectInCache(
  items: Project[],
  project: Pick<Project, "worktree">,
  updates: Partial<Pick<Project, "name" | "iconColor" | "startupCommand">>,
) {
  const next = sortProjects(
    items.map((item) =>
      item.worktree === project.worktree
        ? {
            ...item,
            name: updates.name?.trim() || undefined,
            iconColor: updates.iconColor?.trim() || undefined,
            tint: tint(updates.iconColor),
            startupCommand: updates.startupCommand?.trim() || undefined,
          }
        : item,
    ),
  )

  writeMergedProjectIndex(next)
  return next
}

export function toggleFavoriteProject(
  items: Project[],
  project: Pick<Project, "id" | "worktree" | "relatedIds">,
) {
  const favorites = new Set(getFavorites())
  const key = project.worktree
  const keysToClear = favoriteKeys(project)
  const alreadyFavorite = keysToClear.some((favoriteKey) =>
    favorites.has(favoriteKey),
  )

  for (const favoriteKey of keysToClear) favorites.delete(favoriteKey)
  if (!alreadyFavorite) favorites.add(key)

  writeFavorites(favorites)
  return sortProjects(
    items.map((item) =>
      item.worktree === project.worktree
        ? { ...item, isFavorite: isProjectFavorite(favorites, item) }
        : item,
    ),
  )
}

export function removeProjectFromCache(
  items: Project[],
  project: Pick<Project, "id" | "worktree">,
) {
  const favorites = new Set(getFavorites())
  const removed =
    favorites.delete(project.worktree) || favorites.delete(project.id)
  if (removed) writeFavorites(favorites)

  const excludedProjects = new Set(getExcludedProjects())
  excludedProjects.add(project.worktree)
  writeExcludedProjects(excludedProjects)

  const next = items.filter((item) => item.worktree !== project.worktree)
  writeMergedProjectIndex(next)
  return next
}

export function restoreExcludedProject(project: Pick<Project, "worktree">) {
  const excludedProjects = new Set(getExcludedProjects())
  excludedProjects.delete(project.worktree)
  writeExcludedProjects(excludedProjects)
}

export async function saveProjectIcon(
  items: Project[],
  project: Pick<Project, "id" | "worktree">,
  iconPath: string,
) {
  const ext = path.extname(iconPath).slice(1).toLowerCase()
  if (!projectIconExtensions.includes(ext)) {
    throw new Error("Use PNG, JPG, JPEG, SVG, GIF, WEBP, or ICO")
  }

  const query = [
    "update project",
    `set icon_url = ${quote(projectIconDataUrl(iconPath))}`,
    `where worktree = ${quote(project.worktree)}`,
  ].join(" ")

  await execFileAsync(opencodePath(), ["db", query], {
    maxBuffer: 1024 * 1024 * 8,
  })

  const cachedIcon = cacheProjectIcon(project.id, iconPath)
  const next = items.map((item) =>
    item.worktree === project.worktree
      ? { ...item, icon: cachedIcon, hasIcon: true }
      : item,
  )
  writeMergedProjectIndex(next)
  return next
}
