import { readFile, writeFile, rename } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const HF_ORIGIN = 'https://huggingface.co';
const ARTICLE_LIMIT = 5;
const MARKER = '{{HF_ARTICLES}}';

function decodeAttribute(value) {
  const entities = { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|quot|apos|amp|lt|gt);/gi, (_, entity) => {
    if (entity.startsWith('#')) {
      return String.fromCodePoint(entity[1].toLowerCase() === 'x'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10));
    }
    return entities[entity.toLowerCase()];
  });
}

export function parseActivities(html) {
  const profileTag = [...html.matchAll(/<div\b[^>]*>/g)]
    .find(([tag]) => /\bdata-target\s*=\s*(["'])UserProfile\1/.test(tag));
  const props = profileTag?.[0].match(/\bdata-props\s*=\s*(["'])(.*?)\1/s)?.[2];
  if (!props) throw new Error('Hugging Face profile data was not found; keeping the existing README.');
  const data = JSON.parse(decodeAttribute(props));
  if (!Array.isArray(data.activities)) throw new Error('Hugging Face activities schema changed.');
  return data.activities;
}

export function selectArticles(activities, author) {
  const unique = new Map();
  for (const activity of activities) {
    // The activity user identifies the author; authorsData may identify the publishing organization.
    if (activity.user !== author || activity.type !== 'article' || activity.blog?.status !== 'published') continue;
    const blog = activity.blog;
    const timestamp = Date.parse(blog.publishedAt);
    if (!Number.isFinite(timestamp) || typeof blog.title !== 'string' || !blog.title.trim() || typeof blog.url !== 'string') {
      throw new Error('A published article is missing its date, title, or URL.');
    }
    const url = new URL(blog.url, HF_ORIGIN);
    if (url.origin !== HF_ORIGIN || !url.pathname.startsWith('/blog/')) {
      throw new Error('Unexpected article URL.');
    }
    unique.set(url.href, { title: blog.title, url: url.href, timestamp });
  }
  if (unique.size === 0) throw new Error('No published articles found; keeping the existing README.');
  return [...unique.values()]
    .sort((a, b) => b.timestamp - a.timestamp || a.url.localeCompare(b.url))
    .slice(0, ARTICLE_LIMIT);
}

export function renderReadme(template, articles) {
  if (template.split(MARKER).length !== 2) throw new Error('The template must contain exactly one HF_ARTICLES marker.');
  const dates = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const list = articles.map(({ title, url, timestamp }) => {
    const label = title.trim().replace(/\s+/g, ' ').replace(/[\\\[\]*_`<>]/g, '\\$&');
    const destination = url.replace(/\(/g, '%28').replace(/\)/g, '%29');
    return `- [${label}](${destination}) · ${dates.format(timestamp)}`;
  }).join('\n');
  return '<!-- Generated from README.template.md by scripts/render-readme.mjs. -->\n\n' + template.replace(MARKER, list);
}

async function main() {
  const { values } = parseArgs({ options: {
    template: { type: 'string', default: 'README.template.md' },
    output: { type: 'string', default: 'README.md' },
    author: { type: 'string', default: 'stephen-solka' },
  } });
  if (!/^[a-zA-Z0-9_-]+$/.test(values.author)) throw new Error('Invalid Hugging Face username.');
  const template = await readFile(values.template, 'utf8');
  const response = await fetch(`${HF_ORIGIN}/${values.author}/activity/articles`, {
    headers: { 'User-Agent': 'github-profile-readme', Accept: 'text/html' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Hugging Face returned HTTP ${response.status}.`);
  const articles = selectArticles(parseActivities(await response.text()), values.author);
  const rendered = renderReadme(template, articles);
  await writeFile(`${values.output}.tmp`, rendered);
  await rename(`${values.output}.tmp`, values.output);
  console.log(`Rendered ${articles.length} articles into ${values.output}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
