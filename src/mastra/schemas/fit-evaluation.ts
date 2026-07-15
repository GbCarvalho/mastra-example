import { z } from 'zod';

export const dimensionScoreSchema = z.object({
  score: z.number().min(0).max(100).describe('Score from 0-100'),
  notes: z.string().describe('Brief explanation of the score'),
});

export const fitEvaluationSchema = z.object({
  jobTitle: z.string(),
  company: z.string(),
  url: z.string(),
  technicalSkills: dimensionScoreSchema,
  experience: dimensionScoreSchema,
  behavioral: dimensionScoreSchema,
  location: z.object({
    pass: z.boolean(),
    notes: z.string(),
  }),
  careerAlignment: dimensionScoreSchema,
  overallScore: z.number().min(0).max(100),
  verdict: z.enum(['strong', 'good', 'moderate', 'weak', 'poor']),
  keyStrengths: z.array(z.string()),
  gaps: z.array(z.string()),
  dealBreakers: z.array(z.string()),
  recommendation: z.string(),
});

export type FitEvaluation = z.infer<typeof fitEvaluationSchema>;

export const presentResultSchema = z.object({
  summary: z.string(),
  evaluations: z.array(fitEvaluationSchema),
  rankedEvaluations: z.array(fitEvaluationSchema),
});

export type PresentResult = z.infer<typeof presentResultSchema>;
