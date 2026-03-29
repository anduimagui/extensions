const SITEMAP_URL = "https://opencode.ai/sitemap.xml";
const DEFAULT_LOCALE = "en";

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
]);

type DocItem = {
  title: string;
  pathLabel: string;
  locale: string;
  url: string;
};

function titleFromSlug(slug: string) {
  if (!slug) return "Intro";
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeDocsUrl(raw: string) {
  const url = new URL(raw);
  const pathname = url.pathname.endsWith("/")
    ? url.pathname
    : `${url.pathname}/`;
  return `${url.origin}${pathname}`;
}

function toDocItem(rawUrl: string): DocItem | undefined {
  const url = new URL(rawUrl);
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] !== "docs") return undefined;

  const docsSegments = segments.slice(1);
  const maybeLocale = docsSegments[0];
  const locale =
    maybeLocale && KNOWN_LOCALES.has(maybeLocale)
      ? maybeLocale
      : DEFAULT_LOCALE;
  const contentSegments =
    locale === DEFAULT_LOCALE ? docsSegments : docsSegments.slice(1);

  const slug = contentSegments.join("/");
  const title = titleFromSlug(contentSegments.at(-1) || "");
  const pathLabel =
    locale === DEFAULT_LOCALE
      ? `docs${slug ? `/${slug}` : ""}`
      : `docs/${locale}${slug ? `/${slug}` : ""}`;

  return {
    title,
    pathLabel,
    locale,
    url: normalizeDocsUrl(rawUrl),
  };
}

function parseLocTags(xml: string) {
  return Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => match[1]);
}

function getLocaleArg() {
  const localeArg = process.argv.find((arg) => arg.startsWith("--locale="));
  const locale = localeArg?.split("=")[1]?.toLowerCase() || DEFAULT_LOCALE;
  if (locale === DEFAULT_LOCALE || KNOWN_LOCALES.has(locale)) return locale;
  throw new Error(`Unsupported locale: ${locale}`);
}

async function main() {
  const locale = getLocaleArg();
  const response = await fetch(SITEMAP_URL, {
    headers: {
      Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "opencode-raycast-script",
    },
  });

  if (!response.ok) {
    throw new Error(`Docs sitemap request failed (${response.status})`);
  }

  const xml = await response.text();
  const allLocs = parseLocTags(xml);
  const docLocs = allLocs.filter((loc) => {
    try {
      const path = new URL(loc).pathname;
      return path === "/docs" || path === "/docs/" || path.startsWith("/docs/");
    } catch {
      return false;
    }
  });

  const uniqueDocs = new Map<string, DocItem>();
  for (const loc of docLocs) {
    const item = toDocItem(loc);
    if (!item) continue;
    uniqueDocs.set(item.url, item);
  }

  const filtered = Array.from(uniqueDocs.values())
    .filter((item) => item.locale === locale)
    .sort((a, b) => a.pathLabel.localeCompare(b.pathLabel));

  console.log(
    JSON.stringify(
      {
        locale,
        count: filtered.length,
        sample: filtered.slice(0, 25).map((item) => item.pathLabel),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
