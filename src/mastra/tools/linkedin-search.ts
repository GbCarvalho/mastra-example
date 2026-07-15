import { createTool } from '@mastra/core/tools';
import { searchQuerySchema } from '../schemas/search-query';
import { jobPostingSchema } from '../schemas/job-posting';
import type { JobPosting } from '../schemas/job-posting';

const SEARCH_URL = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

interface JobCard {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  date: string | null;
  url: string;
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, ' ');
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html));
}

function parseJobCards(html: string): JobCard[] {
  const results: JobCard[] = [];
  const chunks = html.split(/data-entity-urn="urn:li:jobPosting:/).slice(1);

  for (const chunk of chunks) {
    const idMatch = chunk.match(/^(\d+)/);
    if (!idMatch) continue;
    const id = idMatch[1];

    const linkMatch = chunk.match(/class="base-card__full-link[^"]*"[^>]*href="([^"]+)"/i);
    const url = linkMatch ? decodeHtmlEntities(linkMatch[1]).split('?')[0] : '';

    let title: string | null = null;
    const h3 = chunk.match(/class="base-search-card__title"[^>]*>([\s\S]*?)<\/h3>/i);
    if (h3) title = clean(h3[1]);
    if (!title) {
      const sr = chunk.match(/class="sr-only"[^>]*>([\s\S]*?)<\/span>/i);
      if (sr) title = clean(sr[1]);
    }
    if (!title) continue;

    let company: string | null = null;
    const sub = chunk.match(/class="base-search-card__subtitle"[^>]*>([\s\S]*?)<\/h4>/i);
    if (sub) company = clean(sub[1]) || null;

    const loc = chunk.match(/class="job-search-card__location"[^>]*>([\s\S]*?)<\/span>/i);
    const location = loc ? clean(loc[1]) || null : null;

    const dt = chunk.match(/class="job-search-card__listdate[^"]*"[^>]*datetime="([^"]+)"/i);
    const date = dt ? dt[1] : null;

    results.push({
      id,
      title,
      company,
      location,
      date,
      url: url || `https://www.linkedin.com/jobs/view/${id}`,
    });
  }

  return results;
}

function jobageToTPR(days: number): string | null {
  if (!days || days <= 0 || days >= 9999) return null;
  return `r${days * 86400}`;
}

function workTypeFlag(mode: string | undefined): string | null {
  switch ((mode || '').toLowerCase()) {
    case 'remote': return '2';
    case 'hybrid': return '3';
    case 'onsite':
    case 'on-site': return '1';
    default: return null;
  }
}

function buildUrl(opts: { keywords: string; location: string; remoteOnly: boolean; jobAgeDays?: number }): string {
  const params = new URLSearchParams();
  params.set('keywords', opts.keywords);
  params.set('location', opts.location);
  const tpr = jobageToTPR(opts.jobAgeDays ?? 9999);
  if (tpr) params.set('f_TPR', tpr);
  if (opts.remoteOnly) {
    const wt = workTypeFlag('remote');
    if (wt) params.set('f_WT', wt);
  }
  params.set('start', '0');
  return `${SEARCH_URL}?${params.toString()}`;
}

export const linkedinSearchTool = createTool({
  id: 'linkedin-search',
  description: 'Searches LinkedIn public job postings by keywords, location, and remote filter',
  inputSchema: searchQuerySchema,
  outputSchema: jobPostingSchema.array(),
  execute: async (inputData) => {
    const url = buildUrl({
      keywords: inputData.keywords,
      location: inputData.location,
      remoteOnly: inputData.remoteOnly,
      jobAgeDays: inputData.jobAgeDays,
    });

    // ponytail: no retry/backoff — workflow step retries handle flaky 429s
    const response = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-Requested-With': 'XMLHttpRequest',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`LinkedIn search failed: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const cards = parseJobCards(html);

    // ponytail: description/requirements empty — search endpoint doesn't return them.
    // Detail fetching is a v2 enhancement.
    return cards.map((card): JobPosting => ({
      title: card.title,
      company: card.company ?? '',
      location: card.location ?? '',
      url: card.url,
      description: '',
      requirements: [],
      postedDate: card.date ?? '',
      portal: 'linkedin',
    }));
  },
});
