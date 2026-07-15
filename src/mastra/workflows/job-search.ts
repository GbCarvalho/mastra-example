import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { searchQuerySchema } from '../schemas/search-query';
import { jobPostingSchema } from '../schemas/job-posting';
import { fitEvaluationSchema, presentResultSchema } from '../schemas/fit-evaluation';
import { linkedinSearchTool } from '../tools/linkedin-search';
import { freehireSearchTool } from '../tools/freehire-search';
import { fitEvaluatorAgent } from '../agents/fit-evaluator';
import type { JobPosting } from '../schemas/job-posting';
import type { FitEvaluation, PresentResult } from '../schemas/fit-evaluation';

function dedupKey(posting: JobPosting): string {
  const t = posting.title.trim().toLowerCase().replace(/\s+/g, ' ');
  const c = posting.company.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${t}|${c}`;
}

function deduplicate(postings: JobPosting[]): JobPosting[] {
  const seen = new Map<string, JobPosting>();
  for (const p of postings) {
    const key = dedupKey(p);
    if (!seen.has(key)) {
      seen.set(key, p);
    } else if (p.portal === 'linkedin') {
      seen.set(key, p);
    }
  }
  return [...seen.values()];
}

function formatJobPostings(postings: JobPosting[]): string {
  return postings.map((p, i) => {
    const reqs = p.requirements.length > 0 ? `\n  Requirements: ${p.requirements.join(', ')}` : '';
    const desc = p.description ? `\n  Description: ${p.description.slice(0, 500)}` : '';
    return `[${i + 1}] ${p.title} at ${p.company} (${p.location})
  URL: ${p.url}
  Portal: ${p.portal}
  Posted: ${p.postedDate}${reqs}${desc}`;
  }).join('\n\n');
}

function formatSummary(evals: FitEvaluation[]): string {
  if (evals.length === 0) return 'No matching jobs found.';

  const lines: string[] = [`# Job Search Results (${evals.length} found)\n`];

  for (let i = 0; i < evals.length; i++) {
    const e = evals[i];
    lines.push(`## ${i + 1}. ${e.jobTitle} at ${e.company}`);
    lines.push(`**Verdict:** ${e.verdict.toUpperCase()} (${e.overallScore}/100)`);
    lines.push(`**URL:** ${e.url}`);
    lines.push('');

    lines.push('| Dimension | Score | Notes |');
    lines.push('|-----------|-------|-------|');
    lines.push(`| Technical Skills | ${e.technicalSkills.score}/100 | ${e.technicalSkills.notes} |`);
    lines.push(`| Experience | ${e.experience.score}/100 | ${e.experience.notes} |`);
    lines.push(`| Behavioral | ${e.behavioral.score}/100 | ${e.behavioral.notes} |`);
    lines.push(`| Location | ${e.location.pass ? 'PASS' : 'FAIL'} | ${e.location.notes} |`);
    lines.push(`| Career Alignment | ${e.careerAlignment.score}/100 | ${e.careerAlignment.notes} |`);
    lines.push('');

    if (e.keyStrengths.length > 0) {
      lines.push('**Key Strengths:**');
      for (const s of e.keyStrengths) lines.push(`- ${s}`);
      lines.push('');
    }

    if (e.gaps.length > 0) {
      lines.push('**Gaps:**');
      for (const g of e.gaps) lines.push(`- ${g}`);
      lines.push('');
    }

    if (e.dealBreakers.length > 0) {
      lines.push('**Deal-Breakers:**');
      for (const d of e.dealBreakers) lines.push(`- ${d}`);
      lines.push('');
    }

    lines.push(`**Recommendation:** ${e.recommendation}`);
    lines.push('');
  }

  return lines.join('\n');
}

const searchStep = createStep({
  id: 'search',
  description: 'Searches LinkedIn and freehire in parallel, merges and deduplicates results',
  inputSchema: searchQuerySchema,
  outputSchema: z.array(jobPostingSchema),
  execute: async ({ inputData }) => {
    const results = await Promise.allSettled([
      linkedinSearchTool.execute(inputData),
      freehireSearchTool.execute(inputData),
    ]);

    const postings: JobPosting[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') {
        postings.push(...r.value);
      }
    }

    return deduplicate(postings);
  },
});

const evaluateStep = createStep({
  id: 'evaluate',
  description: 'Evaluates job postings against candidate profile using Claude Sonnet 4.6',
  inputSchema: z.array(jobPostingSchema),
  outputSchema: z.array(fitEvaluationSchema),
  execute: async ({ inputData }) => {
    const postings = inputData as JobPosting[];
    if (postings.length === 0) return [];

    const prompt = `Evaluate the following ${postings.length} job postings against the candidate profile embedded in your instructions. Return one FitEvaluation per posting, with honest, calibrated scores.

${formatJobPostings(postings)}`;

    const response = await fitEvaluatorAgent.generate(prompt, {
      structuredOutput: { schema: fitEvaluationSchema.array() },
      memory: {
        resource: 'gabriel-carvalho-braga',
        thread: 'job-search',
      },
    });

    return response.object;
  },
});

const presentStep = createStep({
  id: 'present',
  description: 'Formats fit evaluations into a human-readable ranked summary',
  inputSchema: z.array(fitEvaluationSchema),
  outputSchema: presentResultSchema,
  execute: async ({ inputData }) => {
    const evals = inputData as FitEvaluation[];
    const ranked = [...evals].sort((a, b) => b.overallScore - a.overallScore);
    return {
      summary: formatSummary(ranked),
      evaluations: evals,
      rankedEvaluations: ranked,
    } satisfies PresentResult;
  },
});

const jobSearchWorkflow = createWorkflow({
  id: 'job-search',
  description: 'Searches job postings, evaluates fit, and presents ranked results',
  inputSchema: searchQuerySchema,
  outputSchema: presentResultSchema,
})
  .then(searchStep)
  .then(evaluateStep)
  .then(presentStep);

jobSearchWorkflow.commit();

export { jobSearchWorkflow };
export { deduplicate };
