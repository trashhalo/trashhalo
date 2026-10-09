import test from 'node:test';
import assert from 'node:assert/strict';
import { parseActivities, selectArticles, renderReadme } from './render-readme.mjs';

function activity(day, overrides = {}) {
  return { user: 'stephen-solka', type: 'article', blog: {
    status: 'published', publishedAt: `2026-10-${String(day).padStart(2, '0')}T12:00:00Z`,
    title: `Article ${day}`, url: `/blog/Hanno-Labs/article-${day}`,
    authorsData: [{ name: 'Hanno-Labs' }], ...overrides,
  } };
}

test('uses publication date, retains organization posts, removes duplicates, and caps at five', () => {
  const activities = [activity(2), activity(7), activity(3), activity(6), activity(5), activity(4), activity(7),
    activity(9, { status: 'draft' }), { ...activity(10), user: 'someone-else' }];
  const articles = selectArticles(activities, 'stephen-solka');
  assert.deepEqual(articles.map(article => article.title), ['Article 7', 'Article 6', 'Article 5', 'Article 4', 'Article 3']);
  assert.ok(articles.every(article => article.url.startsWith('https://huggingface.co/blog/Hanno-Labs/')));
});

test('decodes quoted JSON from the specific profile container', () => {
  const data = JSON.stringify({ activities: [activity(8, { title: 'A "quote" & <tag>' })] });
  const escaped = data.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<div data-target="Other" data-props="{}"></div><div class="SVELTE_HYDRATER contents" data-target="UserProfile" data-props="${escaped}"></div>`;
  assert.equal(parseActivities(html)[0].blog.title, 'A "quote" & <tag>');
});

test('escapes article titles so they cannot inject Markdown links or headings', () => {
  const articles = selectArticles([activity(8, { title: '[click](evil)\n# <heading>' })], 'stephen-solka');
  const rendered = renderReadme('# Profile\n\n{{HF_ARTICLES}}\n', articles);
  assert.ok(rendered.includes('\\[click\\](evil) # \\<heading\\>'));
  assert.equal(rendered.split('\n').filter(line => line.startsWith('- ')).length, 1);
});

test('fails closed on missing data, empty results, invalid dates, and foreign URLs', () => {
  assert.throws(() => parseActivities('<div>Unavailable</div>'));
  assert.throws(() => selectArticles([], 'stephen-solka'));
  assert.throws(() => selectArticles([activity(8, { publishedAt: 'invalid' })], 'stephen-solka'));
  assert.throws(() => selectArticles([activity(8, { url: 'https://example.com/blog/test' })], 'stephen-solka'));
  assert.throws(() => renderReadme('{{HF_ARTICLES}} {{HF_ARTICLES}}', []));
});
