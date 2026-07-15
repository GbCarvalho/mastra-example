import { createTool } from '@mastra/core/tools';
import { searchQuerySchema } from '../schemas/search-query';
import { jobPostingSchema } from '../schemas/job-posting';
import type { JobPosting } from '../schemas/job-posting';

const BASE_URL = 'https://freehire.dev';

const UA = 'freehire-search-skill/1.0 (+https://freehire.dev)';

interface Envelope<T> {
  data: T;
  meta?: { total?: number; limit?: number; offset?: number };
  error?: string;
}

interface FreehireJob {
  public_slug: string;
  url: string;
  title: string;
  company: string;
  location: string;
  description: string;
  skills: string[];
  work_mode?: string;
  posted_at: string | null;
}

function apiGet<T>(path: string): Promise<Envelope<T> | null> {
  const url = `${BASE_URL}${path}`;
  return fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    redirect: 'follow',
  }).then(async (response) => {
    if (response.status === 404) return null;
    const body = (await response.json().catch(() => null)) as Envelope<T> | null;
    if (!response.ok) {
      throw new Error(
        `Freehire API returned ${response.status}: ${body?.error || response.statusText}`,
      );
    }
    if (!body) throw new Error('Freehire API returned an unparseable response');
    return body;
  });
}

function buildParams(opts: {
  keywords: string;
  location: string;
  remoteOnly: boolean;
  seniority?: string;
  jobAgeDays?: number;
}): URLSearchParams {
  const p = new URLSearchParams();
  if (opts.keywords) p.set('q', opts.keywords);
  if (opts.jobAgeDays && opts.jobAgeDays > 0 && opts.jobAgeDays < 9999) {
    p.set('posted_within_days', String(opts.jobAgeDays));
  }
  if (opts.remoteOnly) p.set('work_mode', 'remote');
  if (opts.seniority) p.set('seniority', opts.seniority);
  p.set('limit', '50');
  p.set('offset', '0');
  p.set('semantic_ratio', '0');
  return p;
}

function toJobPosting(j: FreehireJob): JobPosting {
  return {
    title: j.title || '(untitled)',
    company: j.company || '',
    location: j.location || '',
    url: j.url,
    description: j.description || '',
    requirements: j.skills || [],
    postedDate: j.posted_at || '',
    portal: 'freehire',
  };
}

export const freehireSearchTool = createTool({
  id: 'freehire-search',
  description: 'Searches freehire.dev job postings by keywords, location, remote, and facet filters',
  inputSchema: searchQuerySchema,
  outputSchema: jobPostingSchema.array(),
  execute: async (inputData) => {
    const params = buildParams({
      keywords: inputData.keywords,
      location: inputData.location,
      remoteOnly: inputData.remoteOnly,
      seniority: inputData.seniority,
      jobAgeDays: inputData.jobAgeDays,
    });

    // ponytail: no retry/backoff — workflow step retries handle flaky upstream
    const env = await apiGet<FreehireJob[]>(`/api/v1/jobs/search?${params.toString()}`);
    const jobs = env?.data ?? [];

    return jobs.map(toJobPosting);
  },
});
