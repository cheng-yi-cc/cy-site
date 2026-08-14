# CY 的个人网站

卡片作品集风格的个人网站：展示文章（支持 Word 和 Markdown）与 GitHub 项目（README 可折叠展示）。首页使用 Canvas 绘制交互网格与粒子头像，并适配亮暗主题、移动端和系统“减少动态效果”设置。

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
src/assets/home-particle-avatar.png ← 首页粒子头像原图
.github/workflows/         ← 自动部署流水线
generated/、public/media/  ← 构建产物，勿手动修改（已 gitignore）
```

## 如何发布一篇新文章

**方式一：GitHub 网页上传（推荐，无需装任何软件）**

1. 打开 GitHub 上本仓库的 `articles/` 目录
2. 点 `Add file → Upload files`，每次只上传一篇 `.docx`
3. 在提交窗口中填写：
   - **提交名称（Commit message）**：直接填写文章标题
   - **提交描述（Extended description）**：填写文章列表中显示的摘要，不能为空
4. 点 `Commit changes`。Word 必须单独提交，不能与其他文章或网站代码放在同一次提交中
5. 等 2~4 分钟（Actions 页面可以看进度），文章自动上线

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

- 新上传或修改的 Word：网页标题取提交名称，摘要取提交描述
- 漏填提交描述、一次提交多篇 Word，或把 Word 与网站代码混合提交时，部署会失败并在 Actions 日志中说明原因
- 本规则启用前的旧 Word 继续从文档一级标题和第一段读取，不受历史提交信息影响
- Word 自带公式会自动转成 LaTeX 渲染；图片必须直接插入 Word，不能只链接本机文件
- 内嵌图片会自动提取到站内；图片路径未转换、文件缺失或文件为空时，部署会直接失败，避免破图页面上线
- 复杂排版（多栏、文本框）会丢失，建议以文字和公式为主

## 如何添加/修改展示的项目

网站会自动读取你 GitHub 账号下的全部公开仓库，你只需要在
`config/projects.json` 里挑名字：

```json
{
  "showAll": false,
  "selected": ["仓库名A", "仓库名B"],
  "hidden": [],
  "notes": { "仓库名A": "可选：给这个仓库单独写一句简介" }
}
```

- **`selected`**：想展示哪些就写哪些（只写仓库名，不用带用户名）。
  数组顺序就是网站上的展示顺序。加一个名字 = 上架，删一个名字 = 下架。
- **`showAll`**：改成 `true` 就展示你的全部公开仓库（自动跳过 fork），
  不想展示的写进 `hidden`。
- **名字写错了也没关系**：构建日志会列出你账号下所有可用的仓库名，照着改即可。

推送后自动抓取每个仓库的星标数、语言、README。README 中的相对链接会改写为
GitHub 链接，图片会转存到本站。

> 只支持公开仓库；私有仓库不会出现在候选列表里。

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

### 更换首页粒子头像

用新的正方形、高对比度线稿替换 `src/assets/home-particle-avatar.png`，保持文件名不变即可。背景脚本会自动采样深色线条生成粒子；替换后运行 `npm run build` 检查资源能否正常打包。粒子数量和刷新率已经针对 Chrome 做过优化，如需提高，应先在高刷新率屏幕上进行性能测试。

## 本地开发

```bash
npm install
npm run dev        # 自动先转换文章、抓取项目，再启动开发服务器
```

本地需要安装 pandoc（处理 docx 用）：`winget install JohnMacFarlane.Pandoc`。

构建项目展示时需要访问 GitHub API。遇到 API 限流，可以设置 `GH_TOKEN` 或
`GITHUB_TOKEN`；也可以把 token 单独写入 `config/.github-token`。该文件已被
`.gitignore` 忽略，不要把 token 提交到仓库。

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
- **文章部署失败？** 打开 GitHub 仓库的 Actions，查看“检查文章发布规则”或“生成内容并构建网站”；常见原因是 Word 未单独提交、缺少提交描述，或图片不是直接内嵌在 Word 中
