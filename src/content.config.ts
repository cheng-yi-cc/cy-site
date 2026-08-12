import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// generated/ 目录由 scripts/build-content.mjs 在构建前生成：
// - articles: articles/ 下的 .docx / .md 转换而来
// - projects: 从 GitHub 抓取的仓库元信息与 README
const articles = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './generated/articles' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date().optional(),
    summary: z.string().default(''),
    tags: z.array(z.string()).default([]),
    source: z.enum(['markdown', 'docx']).default('markdown'),
  }),
});

const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './generated/projects' }),
  schema: z.object({
    title: z.string(),
    repo: z.string(),
    url: z.string(),
    description: z.string().default(''),
    stars: z.number().default(0),
    forks: z.number().default(0),
    language: z.string().optional(),
    topics: z.array(z.string()).default([]),
    updated: z.string().optional(),
    fetched: z.coerce.date().optional(),
  }),
});

export const collections = { articles, projects };
