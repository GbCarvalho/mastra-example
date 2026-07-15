import { z } from 'zod';

export const jobPostingSchema = z.object({
  title: z.string(),
  company: z.string(),
  location: z.string(),
  url: z.string().url(),
  description: z.string(),
  requirements: z.array(z.string()),
  postedDate: z.string(),
  portal: z.enum(['linkedin', 'freehire']),
});

export type JobPosting = z.infer<typeof jobPostingSchema>;
