import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    dateModified: z.coerce.date().optional(),
    author: z.string().default("Complete Home Comfort"),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    relatedPosts: z.array(z.string()).optional(),
    faq: z
      .array(z.object({ question: z.string(), answer: z.string() }))
      .optional(),
  }),
});

export const collections = { blog };
