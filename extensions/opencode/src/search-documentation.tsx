import {
  Action,
  ActionPanel,
  Detail,
  getPreferenceValues,
  Icon,
  List,
} from "@raycast/api"
import { useEffect, useMemo, useState } from "react"

const DOCS_HOME_URL = "https://opencode.ai/docs/"
const SITEMAP_URL = "https://opencode.ai/sitemap.xml"
const DEFAULT_LOCALE = "en"
const DOCS_REPO_RAW_BASE =
  "https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/web/src/content/docs"

const KNOWN_LOCALES = new Set([
  "ar",
  "da",
  "de",
  "es",
  "fr",
  "it",
  "ja",
  "ko",
  "nb",
  "pl",
  "pt-br",
  "ru",
  "th",
  "tr",
  "zh-cn",
  "zh-tw",
])

type Preferences = {
  docsLocale?: string
}

type DocItem = {
  title: string
  pathLabel: string
  locale: string
  url: string
  keywords: string[]
}

type State = {
  loading: boolean
  items: DocItem[]
  error?: string
}

type PreviewState = {
  loading: boolean
  markdown: string
  error?: string
}

function titleFromSlug(slug: string) {
  if (!slug) return "Intro"

  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function normalizeDocsUrl(raw: string) {
  const url = new URL(raw)
  const pathname = url.pathname.endsWith("/")
    ? url.pathname
    : `${url.pathname}/`
  return `${url.origin}${pathname}`
}

function toDocItem(rawUrl: string): DocItem | undefined {
  const url = new URL(rawUrl)
  const segments = url.pathname.split("/").filter(Boolean)
  if (segments[0] !== "docs") return undefined

  const docsSegments = segments.slice(1)
  const maybeLocale = docsSegments[0]
  const locale =
    maybeLocale && KNOWN_LOCALES.has(maybeLocale) ? maybeLocale : DEFAULT_LOCALE
  const contentSegments =
    locale === DEFAULT_LOCALE ? docsSegments : docsSegments.slice(1)

  const slug = contentSegments.join("/")
  const title = titleFromSlug(contentSegments.at(-1) || "")
  const pathLabel =
    locale === DEFAULT_LOCALE
      ? `docs${slug ? `/${slug}` : ""}`
      : `docs/${locale}${slug ? `/${slug}` : ""}`

  return {
    title,
    pathLabel,
    locale,
    url: normalizeDocsUrl(rawUrl),
    keywords: [title, pathLabel, slug, locale].filter(Boolean),
  }
}

function parseLocTags(xml: string) {
  return Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => match[1])
}

function sourceCandidatesForDoc(item: DocItem) {
  const route = item.pathLabel.replace(/^docs\/?/, "")

  if (!route) {
    return ["index.mdx", "index.md"]
  }

  const clean = route.replace(/\/$/, "")
  return [
    `${clean}.mdx`,
    `${clean}.md`,
    `${clean}/index.mdx`,
    `${clean}/index.md`,
  ]
}

async function fetchMarkdownSource(item: DocItem) {
  for (const relativeFile of sourceCandidatesForDoc(item)) {
    const response = await fetch(`${DOCS_REPO_RAW_BASE}/${relativeFile}`, {
      headers: {
        Accept: "text/plain,*/*;q=0.8",
        "User-Agent": "opencode-raycast",
      },
    })

    if (!response.ok) continue
    return response.text()
  }

  throw new Error("Could not fetch markdown source for this page")
}

function PreviewDetail({ item }: { item: DocItem }) {
  const [state, setState] = useState<PreviewState>({
    loading: true,
    markdown: `# Loading\n\nFetching source for \`${item.pathLabel}\`...`,
  })

  useEffect(() => {
    let live = true

    fetchMarkdownSource(item)
      .then((markdown) => {
        if (!live) return
        setState({ loading: false, markdown })
      })
      .catch((error) => {
        if (!live) return
        setState({
          loading: false,
          markdown: `# Preview unavailable\n\nCould not load source for \`${item.pathLabel}\`.`,
          error: error instanceof Error ? error.message : String(error),
        })
      })

    return () => {
      live = false
    }
  }, [item])

  const markdown = state.error
    ? `${state.markdown}\n\n---\n\n${state.error}`
    : state.markdown

  return (
    <Detail
      isLoading={state.loading}
      markdown={markdown}
      navigationTitle={item.title}
      actions={
        <ActionPanel>
          <Action.OpenInBrowser
            title="Open in Browser"
            url={item.url}
            shortcut={{ modifiers: ["cmd"], key: "enter" }}
          />
          <Action.CopyToClipboard title="Copy URL" content={item.url} />
          <Action.CopyToClipboard title="Copy Path" content={item.pathLabel} />
        </ActionPanel>
      }
    />
  )
}

function filterDocsByLocale(items: DocItem[], locale: string) {
  return items.filter((item) => item.locale === locale)
}

async function fetchDocsFromSitemap(locale: string): Promise<DocItem[]> {
  const response = await fetch(SITEMAP_URL, {
    headers: {
      Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "opencode-raycast",
    },
  })

  if (!response.ok) {
    throw new Error(`Docs sitemap request failed (${response.status})`)
  }

  const xml = await response.text()
  const allLocs = parseLocTags(xml)

  const docLocs = allLocs.filter((loc) => {
    try {
      const path = new URL(loc).pathname
      return path === "/docs" || path === "/docs/" || path.startsWith("/docs/")
    } catch {
      return false
    }
  })

  const uniqueDocs = new Map<string, DocItem>()

  for (const loc of docLocs) {
    const item = toDocItem(loc)
    if (!item) continue
    uniqueDocs.set(item.url, item)
  }

  const filtered = filterDocsByLocale(Array.from(uniqueDocs.values()), locale)

  return filtered.sort((a, b) => {
    if (a.pathLabel === "docs") return -1
    if (b.pathLabel === "docs") return 1
    return a.pathLabel.localeCompare(b.pathLabel)
  })
}

export default function Command() {
  const preferences = getPreferenceValues<Preferences>()
  const selectedLocale = useMemo(() => {
    const value = (preferences.docsLocale || DEFAULT_LOCALE).toLowerCase()
    return value === DEFAULT_LOCALE || KNOWN_LOCALES.has(value)
      ? value
      : DEFAULT_LOCALE
  }, [preferences.docsLocale])

  const [state, setState] = useState<State>({ loading: true, items: [] })

  useEffect(() => {
    let live = true

    fetchDocsFromSitemap(selectedLocale)
      .then((items) => {
        if (!live) return
        setState({ loading: false, items })
      })
      .catch((error) => {
        if (!live) return
        setState({
          loading: false,
          items: [],
          error: error instanceof Error ? error.message : String(error),
        })
      })

    return () => {
      live = false
    }
  }, [selectedLocale])

  if (state.error) {
    return (
      <List
        isLoading={state.loading}
        searchBarPlaceholder="OpenCode documentation unavailable"
      >
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="Could not load documentation"
          description={state.error}
          actions={
            <ActionPanel>
              <Action.OpenInBrowser
                title="Open OpenCode Docs"
                url={DOCS_HOME_URL}
              />
            </ActionPanel>
          }
        />
      </List>
    )
  }

  return (
    <List
      isLoading={state.loading}
      searchBarPlaceholder={`Search OpenCode documentation (${selectedLocale})...`}
    >
      {state.items.map((doc) => (
        <List.Item
          key={doc.url}
          title={doc.title}
          subtitle={doc.pathLabel}
          icon={Icon.Document}
          keywords={doc.keywords}
          actions={
            <ActionPanel>
              <Action.Push
                title="Preview Markdown"
                target={<PreviewDetail item={doc} />}
              />
              <Action.OpenInBrowser
                title="Open in Browser"
                url={doc.url}
                shortcut={{ modifiers: ["cmd"], key: "enter" }}
              />
              <Action.CopyToClipboard title="Copy URL" content={doc.url} />
              <Action.CopyToClipboard
                title="Copy Path"
                content={doc.pathLabel}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  )
}
