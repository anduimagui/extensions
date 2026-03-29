import { Action, ActionPanel, Color, Icon, List } from "@raycast/api"
import { execFile, spawn } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"
import { useEffect, useState } from "react"
import { openProject, opencodePath } from "./lib/opencode"
import { requestJson, waitForHealth } from "./lib/utils/http"
import { basicAuthHeader, pickPort } from "./lib/utils/network"
import { quote } from "./lib/utils/sql"

const execFileAsync = promisify(execFile)

type ApiProject = {
  id?: string
}

type SessionStatus = {
  type: "idle" | "retry" | "busy"
}

type Permission = {
  sessionID: string
}

type SessionRow = {
  id: string
  directory: string
  title?: string | null
  updated_at?: number | string | null
  waiting?: number | string | null
}

type Item = {
  id: string
  directory: string
  title: string
  updatedAt: number
  state: "permission" | "error" | "unread" | "working"
}

type View = {
  err?: string
  items: Item[]
  loading: boolean
}

function parseTsv(input: string) {
  const lines = input.split(/\r?\n/).filter(Boolean)
  const [header, ...rows] = lines
  if (!header) return [] as Array<Record<string, string>>

  const cols = header.split("\t")
  return rows.map((row) => {
    const vals = row.split("\t")
    return Object.fromEntries(cols.map((col, i) => [col, vals[i] ?? ""]))
  })
}

/* eslint-disable no-unused-vars */
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
/* eslint-enable no-unused-vars */

async function listSessions(projectIds: string[]) {
  if (!projectIds.length) return [] as SessionRow[]

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
    "select s.id, coalesce(s.directory, p.worktree) as directory, coalesce(s.title, p.name, p.worktree) as title,",
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
    "limit 200",
  ].join(" ")

  const { stdout } = await execFileAsync(
    opencodePath(),
    ["db", query, "--format", "tsv"],
    {
      maxBuffer: 1024 * 1024 * 4,
    },
  )

  return parseTsv(stdout)
    .filter(
      (
        row,
      ): row is Record<string, string> & { id: string; directory: string } =>
        Boolean(row.id && row.directory),
    )
    .map((row) => ({
      id: row.id,
      directory: row.directory,
      title: row.title,
      updated_at: row.updated_at,
      waiting: row.waiting,
    }))
}

function state(
  status: SessionStatus | undefined,
  permission: boolean,
  waiting: boolean,
) {
  if (permission) return "permission"
  if (status?.type === "retry") return "error"
  if (waiting) return "unread"
  if (status?.type === "busy") return "working"
  return undefined
}

function badge(state: Item["state"]) {
  if (state === "permission")
    return { source: Icon.CircleFilled, tintColor: Color.Orange }
  if (state === "error")
    return { source: Icon.CircleFilled, tintColor: Color.Red }
  if (state === "unread")
    return { source: Icon.CircleFilled, tintColor: Color.Blue }
  return { source: Icon.CircleFilled, tintColor: Color.SecondaryText }
}

function label(state: Item["state"]) {
  if (state === "permission") return "Permission required"
  if (state === "error") return "Needs attention"
  if (state === "unread") return "Response ready"
  return "Working"
}

function title(row: SessionRow) {
  return row.title || path.basename(row.directory) || row.directory
}

async function load() {
  return withServer(async (baseUrl, authorization) => {
    const [projects, status, permissions] = await Promise.all([
      requestJson<ApiProject[]>(new URL("/project", baseUrl), authorization),
      requestJson<Record<string, SessionStatus>>(
        new URL("/session/status", baseUrl),
        authorization,
      ),
      requestJson<Permission[]>(new URL("/permission", baseUrl), authorization),
    ])

    const ids = projects.flatMap((project) => (project.id ? [project.id] : []))
    const pending = new Set(permissions.map((item) => item.sessionID))

    return (await listSessions(ids))
      .flatMap<Item>((row) => {
        if (!row.directory) return []

        const next = state(
          status[row.id],
          pending.has(row.id),
          Number(row.waiting) > 0,
        )
        if (!next) return []

        return [
          {
            id: row.id,
            directory: row.directory,
            title: title(row),
            updatedAt: Number(row.updated_at) || 0,
            state: next,
          },
        ]
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  })
}

export default function Command() {
  const [view, set] = useState<View>({
    items: [],
    loading: true,
  })

  useEffect(() => {
    let live = true

    load()
      .then((items) => {
        if (!live) return
        set({ items, loading: false })
      })
      .catch((err) => {
        if (!live) return
        set({
          err: err instanceof Error ? err.message : String(err),
          items: [],
          loading: false,
        })
      })

    return () => {
      live = false
    }
  }, [])

  if (view.err) {
    return (
      <List
        isLoading={view.loading}
        searchBarPlaceholder="OpenCode sessions unavailable"
      >
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="OpenCode sessions not available"
          description={view.err}
        />
      </List>
    )
  }

  return (
    <List
      isLoading={view.loading}
      searchBarPlaceholder="Search sessions needing attention..."
    >
      {!view.loading && view.items.length === 0 ? (
        <List.EmptyView
          title="No sessions need attention"
          description="No unread, blocked, or active OpenCode sessions found"
        />
      ) : null}
      {view.items.map((item) => (
        <List.Item
          key={item.id}
          title={item.title}
          subtitle={item.directory}
          accessories={[
            { icon: badge(item.state), tooltip: label(item.state) },
          ]}
          actions={
            <ActionPanel>
              <Action
                title="Open in OpenCode"
                icon={Icon.Terminal}
                onAction={async () => {
                  await openProject(item.directory)
                }}
              />
              <Action.CopyToClipboard
                title="Copy Path"
                content={item.directory}
              />
              <Action.ShowInFinder
                title="Show in Finder"
                path={item.directory}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  )
}
