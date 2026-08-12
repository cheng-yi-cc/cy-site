/**
 * 内容构建脚本（npm run dev / build 之前自动执行）
 *
 * 1. 文章：articles/*.docx（pandoc 转 markdown，公式转 LaTeX、图片提取）
 *          articles/*.md（规范化 frontmatter、转存本地图片）
 *    输出 → generated/articles/*.md，图片 → public/media/articles/
 *
 * 2. 项目：读取 config/projects.json，从 GitHub API 抓取仓库元信息与 README，
 *    改写相对链接，并把 README 中的图片转存到 public/media/projects/
 *    （raw.githubusercontent.com 在中国大陆无法访问，转存后访客才能看到图）
 *    输出 → generated/projects/*.md
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import matter from 'gray-matter';

const pExecFile = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTICLES_DIR = path.join(ROOT, 'articles');
const PROJECTS_CONFIG = path.join(ROOT, 'config', 'projects.json');
const GEN_DIR = path.join(ROOT, 'generated');
const GEN_ARTICLES = path.join(GEN_DIR, 'articles');
const GEN_PROJECTS = path.join(GEN_DIR, 'projects');
const MEDIA_DIR = path.join(ROOT, 'public', 'media');
const USER_AGENT = 'cy-site-content-builder/1.0';
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico)(\?.*)?$/i;

/* ---------------- 工具函数 ---------------- */

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function slugify(s) {
  return (
    String(s)
      .trim()
      .toLowerCase()
      // ASCII 与全角标点都去掉（Astro 路由会丢弃它们，保持一致才不会 404）
      .replace(/[\\/:*?"<>|#%{}$!@&+`=:'"]/g, '')
      .replace(/[，。！？；：、（）【】《》〈〉…—·～「」『』“”‘’]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled'
  );
}

// JSON.stringify 产出的字符串是合法的 YAML 标量，统一用它转义
function toFrontmatter(obj) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

// 文件名约定：YYYY-MM-DD-标题 → 拆出日期与标题
function parseFilename(name) {
  const m = name.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[-_ ]+(.+)$/);
  if (m) {
    const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    return { date, rest: m[4] };
  }
  return { date: null, rest: name };
}

// 从正文第一段提取摘要（跳过标题、图片、代码块、表格、HTML）
function deriveSummary(md) {
  for (const line of md.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (/^(#|!|<|\||```|---)/.test(t)) continue;
    const clean = t
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`~>]/g, '')
      .trim();
    if (clean) return clean.length > 110 ? clean.slice(0, 110) + '……' : clean;
  }
  return '';
}

// 去掉正文第一个 H1（页面标题已由 frontmatter 渲染，避免重复）
function stripLeadingH1(body) {
  const m = body.match(/^\s{0,3}#\s+[^\n]+$/m);
  if (!m) return body;
  return (body.slice(0, m.index) + body.slice(m.index + m[0].length)).trim();
}

async function copyDir(src, dest) {
  await ensureDir(dest);
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else if (!(await exists(d))) await fs.copyFile(s, d);
  }
}

/* ---------------- pandoc 定位 ---------------- */

let pandocBin = null;

async function findPandoc() {
  if (pandocBin) return pandocBin;
  try {
    await pExecFile('pandoc', ['--version']);
    pandocBin = 'pandoc';
    return pandocBin;
  } catch {
    /* 继续找其他位置 */
  }
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || '';
    const candidates = [path.join(local, 'Pandoc', 'pandoc.exe')];
    const wingetBase = path.join(local, 'Microsoft', 'WinGet', 'Packages');
    try {
      for (const dir of await fs.readdir(wingetBase)) {
        if (!dir.toLowerCase().includes('pandoc')) continue;
        const pkg = path.join(wingetBase, dir);
        for (const sub of await fs.readdir(pkg)) {
          candidates.push(path.join(pkg, sub, 'pandoc.exe'));
        }
      }
    } catch {
      /* 忽略 */
    }
    for (const c of candidates) {
      if (await exists(c)) {
        pandocBin = c;
        return pandocBin;
      }
    }
  }
  throw new Error(
    '未找到 pandoc。请安装：winget install JohnMacFarlane.Pandoc（Windows）或 apt install pandoc（Linux）'
  );
}

/* ---------------- 文章处理 ---------------- */

async function rehostLocalImages(body, baseDir, urlPrefix) {
  const destDir = path.join(MEDIA_DIR, ...urlPrefix.split('/'));
  const handle = async (url) => {
    if (/^(https?:|data:|\/)/i.test(url)) return url;
    const srcPath = path.resolve(baseDir, decodeURIComponent(url));
    if (!(await exists(srcPath))) return url;
    await ensureDir(destDir);
    const name = path.basename(srcPath);
    await fs.copyFile(srcPath, path.join(destDir, name));
    return `/media/${urlPrefix}/${name}`;
  };

  let out = body;
  const jobs = [];
  for (const m of out.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    jobs.push({ full: m[0], url: m[1] });
  }
  for (const m of out.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    jobs.push({ full: m[0], url: m[1] });
  }
  for (const job of jobs) {
    const newUrl = await handle(job.url);
    if (newUrl !== job.url) {
      out = out.replace(job.url, newUrl);
    }
  }
  return out;
}

async function processDocx(file, pandoc) {
  const baseName = path.basename(file, path.extname(file));
  const { date, rest } = parseFilename(baseName);
  const slug = slugify(rest);
  const tmpDir = path.join(GEN_DIR, '.tmp-docx', slug);
  await ensureDir(tmpDir);
  const outFile = path.join(tmpDir, 'body.md');
  await pExecFile(pandoc, [
    file,
    '-f',
    'docx',
    '-t',
    'gfm',
    '--wrap=none',
    `--extract-media=${tmpDir}`,
    '-o',
    outFile,
  ]);
  let body = await fs.readFile(outFile, 'utf8');
  // pandoc 的 gfm 行内公式写成 $`TeX`$（GitHub 风格带反引号），
  // remark-math 不认这种写法，把反引号去掉还原成 $TeX$
  body = body
    .replace(/\$\$`([^`]+)`\$\$/g, (_m, tex) => `$$${tex}$$`)
    .replace(/\$`([^`\n]+)`\$/g, (_m, tex) => `$${tex}$`);

  let title = rest;
  const h1 = body.match(/^\s{0,3}#\s+([^\n]+)$/m);
  if (h1) {
    title = h1[1].trim();
    body = stripLeadingH1(body);
  }

  // pandoc 把 docx 内嵌图片解到 tmpDir/media/，正文中以 media/xxx 引用
  const mediaSrc = path.join(tmpDir, 'media');
  if (await exists(mediaSrc)) {
    await copyDir(mediaSrc, path.join(MEDIA_DIR, 'articles', slug));
    body = body
      .replaceAll('](media/', `](/media/articles/${slug}/`)
      .replaceAll('src="media/', `src="/media/articles/${slug}/`)
      .replaceAll("src='media/", `src='/media/articles/${slug}/`);
  }

  const fm = toFrontmatter({
    title,
    date: date || undefined,
    summary: deriveSummary(body),
    source: 'docx',
  });
  await fs.writeFile(
    path.join(GEN_ARTICLES, `${slug}.md`),
    fm + '\n' + body.trim() + '\n'
  );
  console.log(`[文章] docx 已转换：${path.basename(file)} → ${slug}`);
}

async function processMd(file) {
  const raw = await fs.readFile(file, 'utf8');
  const { data, content } = matter(raw);
  const baseName = path.basename(file, path.extname(file));
  const { date: fnameDate, rest } = parseFilename(baseName);
  const slug = slugify(rest);

  let body = content;
  const h1 = body.match(/^\s{0,3}#\s+([^\n]+)$/m);
  const title = data.title || (h1 && h1[1].trim()) || rest;
  body = stripLeadingH1(body);

  body = await rehostLocalImages(
    body,
    path.dirname(file),
    path.posix.join('articles', slug)
  );

  const fm = toFrontmatter({
    title,
    date: data.date
      ? new Date(data.date).toISOString()
      : fnameDate || undefined,
    summary: data.summary || data.description || deriveSummary(body),
    tags: Array.isArray(data.tags) ? data.tags : undefined,
    source: 'markdown',
  });
  await fs.writeFile(
    path.join(GEN_ARTICLES, `${slug}.md`),
    fm + '\n' + body.trim() + '\n'
  );
  console.log(`[文章] md 已处理：${path.basename(file)} → ${slug}`);
}

async function buildArticles() {
  await ensureDir(GEN_ARTICLES);
  if (!(await exists(ARTICLES_DIR))) {
    console.log('[文章] 未找到 articles/ 目录，跳过');
    return;
  }
  const files = (await fs.readdir(ARTICLES_DIR))
    .filter((f) => /\.(md|markdown|docx)$/i.test(f))
    .sort();
  if (!files.length) {
    console.log('[文章] articles/ 下没有文章文件');
    return;
  }
  let pandoc = null;
  let ok = 0;
  for (const file of files) {
    try {
      const full = path.join(ARTICLES_DIR, file);
      if (/\.docx$/i.test(file)) {
        if (!pandoc) pandoc = await findPandoc();
        await processDocx(full, pandoc);
      } else {
        await processMd(full);
      }
      ok++;
    } catch (err) {
      console.warn(`[文章] 处理 ${file} 失败：${err.message}`);
    }
  }
  console.log(`[文章] 完成 ${ok}/${files.length} 篇`);
}

/* ---------------- 项目处理（GitHub） ---------------- */

async function ghFetch(url, accept, token) {
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: accept || 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}（${url}）`);
  return res;
}

async function rewriteReadme(readme, { repo, branch, slug }) {
  const mediaDestDir = path.join(MEDIA_DIR, 'projects', slug);
  const hosted = new Map();

  // 下载远程图片转存到站内；失败返回 null（保留原地址）
  async function rehost(url) {
    if (hosted.has(url)) return hosted.get(url);
    try {
      const extMatch = url.match(/\.(png|jpe?g|gif|svg|webp|avif|bmp|ico)/i);
      const key =
        crypto.createHash('md5').update(url).digest('hex').slice(0, 12) +
        (extMatch ? extMatch[0].toLowerCase().split('?')[0] : '.img');
      const dest = path.join(mediaDestDir, key);
      if (!(await exists(dest))) {
        const res = await fetch(url, {
          redirect: 'follow',
          headers: { 'User-Agent': USER_AGENT },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await ensureDir(mediaDestDir);
        await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
      }
      const local = `/media/projects/${slug}/${key}`;
      hosted.set(url, local);
      return local;
    } catch {
      hosted.set(url, null);
      return null;
    }
  }

  function resolveRepoPath(p) {
    const parts = [];
    for (const seg of p.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') parts.pop();
      else parts.push(seg);
    }
    return parts.join('/');
  }

  // 判断链接/图片的新地址
  async function classify(url) {
    if (/^https?:\/\//i.test(url)) {
      let u;
      try {
        u = new URL(url);
      } catch {
        return url;
      }
      const isRaw =
        u.hostname === 'raw.githubusercontent.com' ||
        (u.hostname === 'github.com' && /^\/[^/]+\/[^/]+\/raw\//.test(u.pathname));
      if (isRaw && IMAGE_EXT.test(u.pathname)) {
        return (await rehost(url)) || url;
      }
      return url;
    }
    if (/^(#|mailto:|data:)/i.test(url)) return url;
    const [rawPath, anchor] = url.split('#');
    const resolved = resolveRepoPath(rawPath);
    if (IMAGE_EXT.test(rawPath)) {
      const rawUrl = `https://raw.githubusercontent.com/${repo}/${branch}/${resolved}`;
      return (await rehost(rawUrl)) || rawUrl;
    }
    const base = `https://github.com/${repo}/blob/${branch}/${resolved}`;
    return anchor ? `${base}#${anchor}` : base;
  }

  let out = readme;
  const jobs = [];
  // markdown 图片与链接
  for (const m of out.matchAll(/(!?\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g)) {
    jobs.push({ url: m[2], from: m[2] });
  }
  // HTML <img src> 与 <a href>
  for (const m of out.matchAll(/<(?:img|a)[^>]+(?:src|href)=(["'])([^"']+)\1/gi)) {
    jobs.push({ url: m[2], from: m[2] });
  }
  const seen = new Set();
  for (const job of jobs) {
    if (seen.has(job.url)) continue;
    seen.add(job.url);
    const newUrl = await classify(job.url);
    if (newUrl !== job.url) {
      out = out.replaceAll(job.url, newUrl);
    }
  }
  return out;
}

async function processProject(repo, note, token) {
  const slug = slugify(repo.replace('/', '-'));
  const meta = await (
    await ghFetch(`https://api.github.com/repos/${repo}`, undefined, token)
  ).json();

  let readme = '';
  try {
    readme = await (
      await ghFetch(
        `https://api.github.com/repos/${repo}/readme`,
        'application/vnd.github.raw+json',
        token
      )
    ).text();
  } catch {
    readme = '';
  }

  const branch = meta.default_branch || 'HEAD';
  let body = readme
    ? await rewriteReadme(readme, { repo, branch, slug })
    : '> 该仓库没有 README。';
  body = stripLeadingH1(body);

  const fm = toFrontmatter({
    title: meta.name,
    repo,
    url: meta.html_url,
    description: note || meta.description || '',
    stars: meta.stargazers_count ?? 0,
    forks: meta.forks_count ?? 0,
    language: meta.language || undefined,
    topics: Array.isArray(meta.topics) ? meta.topics : undefined,
    updated: meta.pushed_at || undefined,
    fetched: new Date().toISOString(),
  });
  await fs.writeFile(
    path.join(GEN_PROJECTS, `${slug}.md`),
    fm + '\n' + body.trim() + '\n'
  );
  console.log(`[项目] 已抓取：${repo}（★ ${meta.stargazers_count ?? 0}）`);
}

async function loadLocalToken() {
  try {
    return (
      (await fs.readFile(path.join(ROOT, 'config', '.github-token'), 'utf8')).trim()
    );
  } catch {
    return '';
  }
}

async function buildProjects() {
  await ensureDir(GEN_PROJECTS);
  if (!(await exists(PROJECTS_CONFIG))) {
    console.log('[项目] 未找到 config/projects.json，跳过');
    return;
  }
  const cfg = JSON.parse(await fs.readFile(PROJECTS_CONFIG, 'utf8'));
  const list = Array.isArray(cfg) ? cfg : cfg.projects || [];
  if (!list.length) {
    console.log('[项目] 项目列表为空');
    return;
  }
  const token =
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    (await loadLocalToken());
  let ok = 0;
  for (const item of list) {
    const repo = typeof item === 'string' ? item : item.repo;
    if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      console.warn(`[项目] 仓库名不合法：${repo}，跳过`);
      continue;
    }
    try {
      await processProject(
        repo,
        typeof item === 'string' ? undefined : item.note,
        token
      );
      ok++;
    } catch (err) {
      console.warn(`[项目] 抓取 ${repo} 失败：${err.message}，跳过`);
    }
  }
  console.log(`[项目] 完成 ${ok}/${list.length} 个`);
}

/* ---------------- 主流程 ---------------- */

async function main() {
  const start = Date.now();
  // 清空旧产物，避免已删除的文章/项目残留
  await fs.rm(GEN_DIR, { recursive: true, force: true });
  await fs.rm(path.join(MEDIA_DIR, 'articles'), { recursive: true, force: true });
  await fs.rm(path.join(MEDIA_DIR, 'projects'), { recursive: true, force: true });

  await buildArticles();
  await buildProjects();

  console.log(
    `[内容构建] 完成，耗时 ${((Date.now() - start) / 1000).toFixed(1)}s`
  );
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  main().catch((err) => {
    console.error('[内容构建] 失败：', err);
    process.exit(1);
  });
}

export { rewriteReadme, slugify, stripLeadingH1, deriveSummary };
