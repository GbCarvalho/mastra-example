import { describe, it, expect, vi, beforeEach } from 'vitest';
import { freehireSearchTool } from './freehire-search';
import type { JobPosting } from '../schemas/job-posting';

const ONE_JOB_RESPONSE = {
  data: [
    {
      public_slug: 'acme-senior-backend',
      url: 'https://freehire.dev/jobs/acme-senior-backend',
      title: 'Senior Backend Engineer',
      company: 'Acme Corp',
      location: 'Remote',
      description: '<p>Build APIs with Node.js and PostgreSQL</p>',
      skills: ['Node.js', 'PostgreSQL', 'TypeScript'],
      work_mode: 'remote',
      posted_at: '2026-07-10T12:00:00Z',
    },
  ],
  meta: { total: 1, limit: 50, offset: 0 },
};

const EMPTY_RESPONSE = { data: [], meta: { total: 0 } };

function mockFetchJson(body: unknown) {
  const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal('fetch', mockFetch);
  return mockFetch;
}

describe('freehireSearchTool', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('parses API response into JobPosting[]', async () => {
    mockFetchJson(ONE_JOB_RESPONSE);

    const result = await freehireSearchTool.execute({
      keywords: 'backend engineer',
      location: 'Remote',
      remoteOnly: false,
    });

    expect(result).toHaveLength(1);
    const job = (result as JobPosting[])[0];
    expect(job.title).toBe('Senior Backend Engineer');
    expect(job.company).toBe('Acme Corp');
    expect(job.location).toBe('Remote');
    expect(job.url).toBe('https://freehire.dev/jobs/acme-senior-backend');
    expect(job.portal).toBe('freehire');
    expect(job.postedDate).toBe('2026-07-10T12:00:00Z');
    expect(job.description).toBe('<p>Build APIs with Node.js and PostgreSQL</p>');
    expect(job.requirements).toEqual(['Node.js', 'PostgreSQL', 'TypeScript']);
  });

  it('returns empty array when API returns no results', async () => {
    mockFetchJson(EMPTY_RESPONSE);

    const result = await freehireSearchTool.execute({
      keywords: 'nonexistent role',
      location: 'Antarctica',
      remoteOnly: false,
    });

    expect(result).toEqual([]);
  });

  it('maps remoteOnly and seniority to correct query params', async () => {
    const mockFetch = mockFetchJson(EMPTY_RESPONSE);

    await freehireSearchTool.execute({
      keywords: 'rust developer',
      location: 'Remote',
      remoteOnly: true,
      seniority: 'senior',
      jobAgeDays: 14,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('q=rust+developer');
    expect(calledUrl).toContain('work_mode=remote');
    expect(calledUrl).toContain('seniority=senior');
    expect(calledUrl).toContain('posted_within_days=14');
    expect(calledUrl).toContain('semantic_ratio=0');
  });

  it('omits optional params when not provided', async () => {
    const mockFetch = mockFetchJson(EMPTY_RESPONSE);

    await freehireSearchTool.execute({
      keywords: 'engineer',
      location: 'Berlin, Germany',
      remoteOnly: false,
    });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('work_mode');
    expect(calledUrl).not.toContain('seniority');
    expect(calledUrl).not.toContain('posted_within_days');
    expect(calledUrl).toContain('q=engineer');
  });

  it('handles missing/null fields gracefully', async () => {
    mockFetchJson({
      data: [
        {
          public_slug: 'minimal-job',
          url: 'https://freehire.dev/jobs/minimal-job',
          title: null,
          company: null,
          location: null,
          description: null,
          skills: null,
          posted_at: null,
        },
      ],
    });

    const result = await freehireSearchTool.execute({
      keywords: 'anything',
      location: 'Nowhere',
      remoteOnly: false,
    });

    expect(result).toHaveLength(1);
    const job = (result as JobPosting[])[0];
    expect(job.title).toBe('(untitled)');
    expect(job.company).toBe('');
    expect(job.location).toBe('');
    expect(job.postedDate).toBe('');
    expect(job.requirements).toEqual([]);
  });

  it('throws descriptive error on HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: () => Promise.resolve({ error: 'downstream timeout' }),
    }));

    await expect(
      freehireSearchTool.execute({
        keywords: 'engineer',
        location: 'Remote',
        remoteOnly: false,
      }),
    ).rejects.toThrow('Freehire API returned 503');
  });

  it('handles 404 as empty result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve(null),
    }));

    const result = await freehireSearchTool.execute({
      keywords: 'engineer',
      location: 'Remote',
      remoteOnly: false,
    });

    expect(result).toEqual([]);
  });
});
