# CY 的个人网站

卡片作品集风格的个人网站：展示文章（支持 Word 和 Markdown）与 GitHub 项目（README 可折叠展示）。

- 构建：[Astro](https://astro.build)（纯静态输出）
- 部署：Cloudflare Pages（中国大陆可直连，免备案）
- 自动化：GitHub Actions —— 推送即构建、构建即部署

## 工作原理

```
你把 .docx / .md 放进 articles/ 并推送
        ↓ GitHub Actions 自动触发
pandoc 把 docx 转成 markdown（公式转 LaTeX，图片提取）
        ↓
脚本抓取 config/projects.json 里各仓库的 README 与元信息
（README 中的图片会转存到站内，保证大陆访客能看到）
        ↓
Astro 构建成纯静态网站 → wrangler 部署到 Cloudflare Pages
```

大陆访客访问的是纯静态页面，全程不需要连接 GitHub。

## 目录结构

```
articles/                  ← 文章都放这里（.md 或 .docx）
config/site.json           ← 网站标题、简介、GitHub 主页、统计 token
config/projects.json       ← 要展示的项目仓库列表
scripts/build-content.mjs  ← 内容构建脚本（docx 转换 + 项目抓取）
src/                       ← Astro 页面与样式
.github/workflows/         ← 自动部署流水线
generated/、public/media/  ← 构建产物，勿手动修改（已 gitignore）
```

## 如何发布一篇新文章

**方式一：GitHub 网页上传（推荐，无需装任何软件）**

1. 打开 GitHub 上本仓库的 `articles/` 目录
2. 点 `Add file → Upload files`，把写好的 `.docx` 或 `.md` 拖进去
3. 填写提交信息，点 `Commit changes`
4. 等 2~4 分钟（Actions 页面可以看进度），文章自动上线

**方式二：本地 git 推送**（如果你习惯用命令行）

### 文件命名约定

```
2026-08-12-我的文章标题.docx     → 日期 + 标题，推荐
我的文章标题.md                  → 不写日期也行，但列表页不显示日期
```

### Markdown 文章的 frontmatter（可选）

```markdown
---
title: 文章标题
date: 2026-08-12
summary: 显示在卡片上的摘要，不写则自动取第一段
tags: [标签1, 标签2]
---
```

### Word 文章说明

- 标题取文档里的第一个一级标题；没有则用文件名
- Word 自带公式会自动转成 LaTeX 渲染，图片自动提取
- 复杂排版（多栏、文本框）会丢失，建议以文字和公式为主

## 如何添加/修改展示的项目

编辑 `config/projects.json`：

```json
{
  "projects": [
    { "repo": "你的用户名/仓库名", "note": "可选：自定义一句话简介" }
  ]
}
```

推送后自动抓取该仓库的星标数、语言、README。README 中的相对链接会改写为 GitHub 链接，图片会转存到本站。

> 目前只支持公开仓库。

## 个性化设置

编辑 `config/site.json`：

| 字段 | 说明 |
| --- | --- |
| `title` | 浏览器标签页标题 |
| `name` | 页头 logo 与首页署名 |
| `heroGreeting` | 首页大标题的问候语 |
| `bio` | 首页简介 |
| `github` | 你的 GitHub 主页地址 |
| `cfAnalyticsToken` | Cloudflare 访问统计 token（见下文） |

## 本地开发

```bash
npm install
npm run dev        # 自动先转换文章、抓取项目，再启动开发服务器
```

本地需要安装 pandoc（处理 docx 用）：`winget install JohnMacFarlane.Pandoc`。

## 首次部署配置（一次性）

1. 在 GitHub 新建仓库（如 `cy-site`），把本项目推送上去
2. 注册 [Cloudflare](https://dash.cloudflare.com/)，进入控制台：
   - 右侧栏复制 **Account ID**
   - `My Profile → API Tokens → Create Token → Create Custom Token`，
     权限选 **Account / Cloudflare Pages / Edit**，创建后复制 token
3. 在 GitHub 仓库 `Settings → Secrets and variables → Actions` 添加两个 secret：
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
4. 随便推送一次（或 Actions 页面手动 Run workflow），首次部署会自动创建
   Pages 项目，之后访问 **https://cy-site.pages.dev**

> 如果你改了 Pages 项目名，记得同步修改 `.github/workflows/deploy.yml`
> 里 `--project-name=` 和 `astro.config.mjs` 里的 `site`。

## 开启访问统计

1. Cloudflare 控制台 → `Analytics & Logs → Web Analytics → Add a site`
2. 选择 JS Snippet 方式，复制其中的 **token**
3. 填入 `config/site.json` 的 `cfAnalyticsToken`，推送即可

## 常见问题

- **大陆访问速度？** 静态资源全部在 Cloudflare CDN，直连可用；速度偶尔波动属正常
- **以后想用自己的域名？** Cloudflare Pages 项目 → Custom domains 里直接绑定，无需备案
- **README 特别大的仓库？** 页面会相应变大，属正常现象
- **docx 公式转换不准？** 极少数复杂公式（如多层嵌套矩阵）可能不完美，建议复杂公式直接在 markdown 里写 LaTeX
