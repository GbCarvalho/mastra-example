import { z } from 'zod';

export const searchQuerySchema = z.object({
  keywords: z.string().describe('Job title, skill, or role keywords'),
  location: z.string().describe('Location to search (e.g. "Remote", "Berlin, Germany")'),
  remoteOnly: z.boolean().describe('Filter for remote-only positions'),
  seniority: z.string().optional().describe('Seniority level (e.g. "senior", "staff")'),
  jobAgeDays: z.number().optional().describe('Posted within N days'),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
