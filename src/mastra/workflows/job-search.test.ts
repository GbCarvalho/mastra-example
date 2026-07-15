import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fitEvaluatorAgent } from '../agents/fit-evaluator';
import { mastra } from '../index';
import { deduplicate } from './job-search';
import type { JobPosting } from '../schemas/job-posting';
import type { FitEvaluation, PresentResult } from '../schemas/fit-evaluation';

const LI_HTML = `
<ul>
  <li data-entity-urn="urn:li:jobPosting:87654321">
    <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/87654321">
      <span class="sr-only">Product Engineer</span>
    </a>
    <h3 class="base-search-card__title">Product Engineer</h3>
    <h4 class="base-search-card__subtitle">
      <a href="https://www.linkedin.com/company/mastra">Mastra</a>
    </h4>
    <span class="job-search-card__location">Remote</span>
    <time class="job-search-card__listdate--new t-14" datetime="2026-07-14">1 day ago</time>
  </li>
</ul>`;

const FH_RESPONSE = {
  data: [
    {
      public_slug: 'mastra-product-engineer',
      url: 'https://freehire.dev/jobs/mastra-product-engineer',
      title: 'Product Engineer',
      company: 'Mastra',
      location: 'Remote',
      description: '<p>Build agent workflows with Mastra</p>',
      skills: ['TypeScript', 'AI', 'Node.js'],
      posted_at: '2026-07-13T10:00:00Z',
    },
    {
      public_slug: 'other-senior-dev',
      url: 'https://freehire.dev/jobs/other-senior-dev',
      title: 'Senior Developer',
      company: 'OtherCo',
      location: 'Berlin, Germany',
      description: '<p>Build microservices</p>',
      skills: ['Go', 'AWS', 'Docker'],
      posted_at: '2026-07-12T10:00:00Z',
    },
  ],
  meta: { total: 2 },
};

const MOCK_EVALS: FitEvaluation[] = [
  {
    jobTitle: 'Product Engineer',
    company: 'Mastra',
    url: 'https://www.linkedin.com/jobs/view/87654321',
    technicalSkills: { score: 85, notes: 'Strong TypeScript/Node.js match' },
    experience: { score: 80, notes: '5+ years full-stack, founding exp' },
    behavioral: { score: 90, notes: 'Small team, high ownership — ideal' },
    location: { pass: true, notes: 'Remote' },
    careerAlignment: { score: 95, notes: 'YC-backed, founding-engineer role' },
    overallScore: 87,
    verdict: 'strong',
    keyStrengths: ['Full-stack ownership', 'TypeScript expertise'],
    gaps: ['None significant'],
    dealBreakers: [],
    recommendation: 'Definitely apply — strong fit across all dimensions',
  },
  {
    jobTitle: 'Senior Developer',
    company: 'OtherCo',
    url: 'https://freehire.dev/jobs/other-senior-dev',
    technicalSkills: { score: 55, notes: 'Go/AWS/Docker — partial match' },
    experience: { score: 65, notes: 'Has Go experience, different sector' },
    behavioral: { score: 50, notes: 'Larger company, may have ceremony' },
    location: { pass: true, notes: 'Remote' },
    careerAlignment: { score: 40, notes: 'Not a startup role' },
    overallScore: 50,
    verdict: 'moderate',
    keyStrengths: ['Go experience'],
    gaps: ['Not startup', 'Enterprise signals'],
    dealBreakers: [],
    recommendation: 'Consider if nothing better — moderate fit at best',
  },
];

let fetchIndex = 0;

function multiFetch() {
  fetchIndex = 0;
  const mockFetch = vi.fn(() => {
    const idx = fetchIndex++;
    if (idx === 0) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(LI_HTML),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(FH_RESPONSE),
    });
  });
  vi.stubGlobal('fetch', mockFetch);
  return mockFetch;
}

function mockAgentGenerate() {
  vi.spyOn(fitEvaluatorAgent, 'generate').mockResolvedValue({
    object: MOCK_EVALS,
  } as any);
}

describe('job-search workflow', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('runs full pipeline: search → evaluate → present', async () => {
    multiFetch();
    mockAgentGenerate();

    const workflow = mastra.getWorkflow('jobSearchWorkflow');
    const run = await workflow.createRun();
    const result = await run.start({
      inputData: {
        keywords: 'product engineer',
        location: 'Remote',
        remoteOnly: true,
      },
    });

    expect(result.status).toBe('success');
    const out = result.result as PresentResult;
    expect(out.evaluations).toHaveLength(2);
    expect(out.rankedEvaluations).toHaveLength(2);
    expect(out.summary).toContain('Product Engineer');
    expect(out.summary).toContain('Senior Developer');
    expect(out.summary).toContain('STRONG');
    expect(out.summary).toContain('MODERATE');
  });

  it('ranks evaluations by overallScore descending', async () => {
    multiFetch();
    mockAgentGenerate();

    const workflow = mastra.getWorkflow('jobSearchWorkflow');
    const run = await workflow.createRun();
    const result = await run.start({
      inputData: {
        keywords: 'product engineer',
        location: 'Remote',
        remoteOnly: true,
      },
    });

    const out = result.result as PresentResult;
    expect(out.rankedEvaluations[0].overallScore).toBe(87);
    expect(out.rankedEvaluations[1].overallScore).toBe(50);
    expect(out.rankedEvaluations[0].jobTitle).toBe('Product Engineer');
  });

  it('passes job postings to agent with structured output', async () => {
    multiFetch();
    const spy = vi.spyOn(fitEvaluatorAgent, 'generate').mockResolvedValue({
      object: MOCK_EVALS,
    } as any);

    const workflow = mastra.getWorkflow('jobSearchWorkflow');
    const run = await workflow.createRun();
    await run.start({
      inputData: {
        keywords: 'product engineer',
        location: 'Remote',
        remoteOnly: true,
      },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const promptArg = spy.mock.calls[0][0] as string;
    expect(promptArg).toContain('Product Engineer');
    expect(promptArg).toContain('Mastra');
    expect(promptArg).toContain('Senior Developer');

    const opts = spy.mock.calls[0][1] as any;
    expect(opts.structuredOutput).toBeDefined();
    expect(opts.structuredOutput.schema).toBeDefined();
    expect(opts.memory).toBeDefined();
    expect(opts.memory.resource).toBe('gabriel-carvalho-braga');
    expect(opts.memory.thread).toBe('job-search');
  });

  it('returns empty present result when no postings found', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve('<html></html>'),
      json: () => Promise.resolve({ data: [] }),
    })));

    const workflow = mastra.getWorkflow('jobSearchWorkflow');
    const run = await workflow.createRun();
    const result = await run.start({
      inputData: {
        keywords: 'nonexistent',
        location: 'Nowhere',
        remoteOnly: false,
      },
    });

    expect(result.status).toBe('success');
    const out = result.result as PresentResult;
    expect(out.evaluations).toEqual([]);
    expect(out.rankedEvaluations).toEqual([]);
    expect(out.summary).toContain('No matching jobs found');
  });

  it('gracefully degrades when one portal fails', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.includes('linkedin')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve(''),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(FH_RESPONSE),
      });
    }));
    vi.spyOn(fitEvaluatorAgent, 'generate').mockResolvedValue({
      object: [MOCK_EVALS[1]],
    } as any);

    const workflow = mastra.getWorkflow('jobSearchWorkflow');
    const run = await workflow.createRun();
    const result = await run.start({
      inputData: {
        keywords: 'developer',
        location: 'Remote',
        remoteOnly: true,
      },
    });

    expect(result.status).toBe('success');
    const out = result.result as PresentResult;
    expect(out.evaluations).toHaveLength(1);
    expect(out.rankedEvaluations[0].jobTitle).toBe('Senior Developer');
  });

  it('summary includes all required sections per evaluation', async () => {
    multiFetch();
    mockAgentGenerate();

    const workflow = mastra.getWorkflow('jobSearchWorkflow');
    const run = await workflow.createRun();
    const result = await run.start({
      inputData: {
        keywords: 'product engineer',
        location: 'Remote',
        remoteOnly: true,
      },
    });

    const out = result.result as PresentResult;
    expect(out.summary).toContain('Technical Skills');
    expect(out.summary).toContain('Experience');
    expect(out.summary).toContain('Behavioral');
    expect(out.summary).toContain('Career Alignment');
    expect(out.summary).toContain('Key Strengths');
    expect(out.summary).toContain('Gaps');
    expect(out.summary).toContain('Recommendation');
  });
});

describe('deduplicate', () => {
  it('merges lists, keeping LinkedIn on conflict', () => {
    const li: JobPosting[] = [
      { title: '  Product Engineer ', company: 'Mastra', location: 'Remote', url: 'https://li/1', description: 'LI desc', requirements: [], postedDate: '2026-01-01', portal: 'linkedin' },
      { title: 'Backend Dev', company: 'Acme', location: 'Remote', url: 'https://li/2', description: '', requirements: [], postedDate: '', portal: 'linkedin' },
    ];
    const fh: JobPosting[] = [
      { title: 'product engineer', company: 'mastra', location: 'Remote', url: 'https://fh/1', description: 'FH desc', requirements: ['TypeScript'], postedDate: '2026-01-02', portal: 'freehire' },
      { title: 'Frontend Dev', company: 'OtherCo', location: 'Berlin', url: 'https://fh/2', description: '', requirements: [], postedDate: '', portal: 'freehire' },
    ];

    const result = deduplicate([...li, ...fh]);
    expect(result).toHaveLength(3);
    const pe = result.find((p) => p.description === 'LI desc');
    expect(pe).toBeDefined();
    expect(pe!.portal).toBe('linkedin');
  });

  it('handles empty inputs', () => {
    expect(deduplicate([])).toEqual([]);
    expect(deduplicate([{
      title: 'A', company: 'B', location: '', url: 'https://x.com', description: '', requirements: [], postedDate: '', portal: 'frehire',
    }])).toHaveLength(1);
  });
});
