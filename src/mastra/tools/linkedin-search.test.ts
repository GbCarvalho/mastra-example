import { describe, it, expect, vi, beforeEach } from 'vitest';
import { linkedinSearchTool } from './linkedin-search';
import type { JobPosting } from '../schemas/job-posting';

const HTML_ONE_JOB = `
<ul>
  <li data-entity-urn="urn:li:jobPosting:12345678">
    <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/12345678">
      <span class="sr-only">Senior Backend Engineer</span>
    </a>
    <h3 class="base-search-card__title">Senior Backend Engineer</h3>
    <h4 class="base-search-card__subtitle">
      <a href="https://www.linkedin.com/company/acme">Acme Corp</a>
    </h4>
    <span class="job-search-card__location">Berlin, Germany</span>
    <time class="job-search-card__listdate--new t-14" datetime="2026-07-10">2 days ago</time>
  </li>
</ul>`;

function mockFetchHtml(html: string) {
  const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve(html),
  });
  vi.stubGlobal('fetch', mockFetch);
  return mockFetch;
}

describe('linkedinSearchTool', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('parses valid HTML response into JobPosting[]', async () => {
    mockFetchHtml(HTML_ONE_JOB);

    const result = await linkedinSearchTool.execute({
      keywords: 'backend engineer',
      location: 'Berlin, Germany',
      remoteOnly: false,
    });

    expect(result).toHaveLength(1);
    const job = (result as JobPosting[])[0];
    expect(job.title).toBe('Senior Backend Engineer');
    expect(job.company).toBe('Acme Corp');
    expect(job.location).toBe('Berlin, Germany');
    expect(job.url).toBe('https://www.linkedin.com/jobs/view/12345678');
    expect(job.portal).toBe('linkedin');
    expect(job.postedDate).toBe('2026-07-10');
    expect(job.description).toBe('');
    expect(job.requirements).toEqual([]);
  });

  it('returns empty array when HTML has no job cards', async () => {
    mockFetchHtml('<html><body><p>No results found</p></body></html>');

    const result = await linkedinSearchTool.execute({
      keywords: 'nonexistent role',
      location: 'Antarctica',
      remoteOnly: false,
    });

    expect(result).toEqual([]);
  });

  it('passes remoteOnly and jobAgeDays as correct URL params', async () => {
    const mockFetch = mockFetchHtml('');

    await linkedinSearchTool.execute({
      keywords: 'rust developer',
      location: 'Remote',
      remoteOnly: true,
      jobAgeDays: 7,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('f_WT=2');
    expect(calledUrl).toContain('f_TPR=r604800');
    expect(calledUrl).toContain('keywords=rust+developer');
    expect(calledUrl).toContain('location=Remote');
  });

  it('throws descriptive error on HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: () => Promise.resolve(''),
    }));

    await expect(
      linkedinSearchTool.execute({
        keywords: 'engineer',
        location: 'Berlin, Germany',
        remoteOnly: false,
      }),
    ).rejects.toThrow('LinkedIn search failed: 429');
  });
});
