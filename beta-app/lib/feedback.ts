import { z } from "zod";

export const feedbackSchema = z.object({
  attemptId: z.string().min(1), userId: z.string().min(1).optional(), usefulness: z.enum(["YES", "PARTLY", "NO"]),
  accurateText: z.string().max(1200).default(""), confusingText: z.string().max(1200).default(""), nextWishText: z.string().max(1200).default(""),
  reuseIntent: z.enum(["YES", "MAYBE", "NO"]),
}).strict();
