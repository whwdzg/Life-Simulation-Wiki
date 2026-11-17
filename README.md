# 来福Simulation Wiki 静态镜像站

[来福Simulation Wiki](https://lifesimulation.fandom.com/zh/wiki/%E6%9D%A5%E7%A6%8FSimulation_Wiki) 的非官方全量静态镜像。项目通过 GitHub Actions **每小时**调用 MediaWiki API 抓取页面、模板、图片、音频和视频，生成可离线浏览的静态站点并部署到 GitHub Pages。

- 镜像内容：451 个页面（条目、用户页、项目页、文件页、模板、分类、模块、博客、地图）
- 镜像命名空间：条目（0）、用户（2）、项目（4）、文件（6）、模板（10）、分类（14）、博客（502）、模块（828）、地图（2900）
- 媒体文件：195 个原文件（另含页面缩略图），全部保存在本站
- 模板：由 MediaWiki 解析器在构建时展开为静态 HTML，信息框、导航框、标签页等无需 JavaScript 也能显示
- 首页底部与全站页脚都会显示最近一次内容更新时间（UTC+8）

## 工作方式

```text
GitHub Actions（每小时整点）
  ├─ 读取 siteinfo / allpages / 最新修订 / 维基文本
  ├─ action=parse 渲染每个页面（模板、解析器函数已在服务端展开）
  ├─ 收集页面中的图片、缩略图、音视频 URL 并下载到 .cache/media
  ├─ 改写站内链接与媒体链接，生成 dist/ 静态站
  └─ upload-pages-artifact → deploy-pages
```

几个关键点：

- **模板支持**：不使用浏览器端 JavaScript 去请求源站，而是在构建时让 MediaWiki 渲染模板；模板页面本身也会展示维基文本源代码。
- **站点自定义 CSS**：每次构建读取 `MediaWiki:Common.css`、`MediaWiki:Wikia.css`、`MediaWiki:Mobile.css`，因此 `rainbow-text-hover`、`bounce-text`、`spoiler-blur`、`freeze-ice`、页签和头像悬停等模板效果会被保留。
- **图片与媒体**：源站 CDN 上的原图、页面缩略图、文件页预览图都会下载到 `dist/media/`，构建后不再依赖 Fandom。
- **增量媒体缓存**：`.cache/media` 通过 `actions/cache` 持久化，并用媒体清单签名作为缓存键；没有变更时不会重复下载约 120 MB 媒体（源站原文件合计约 260 MB，CDN 通常返回 WebP）。
- **静态搜索**：生成 `data/search.json`，浏览器本地搜索标题、摘要与正文。
- **失败回退**：单个页面或媒体抓取失败不会中断整次构建；页面会显示错误提示或保留原站链接，并在下一次整点重试。

## 本地使用

要求 Node.js 20 或更高版本，无第三方依赖：

```powershell
npm run build     # 抓取源站并生成 dist/
npm run serve     # 在本机预览 http://127.0.0.1:5173/
npm run check     # 校验内部链接、资源、首页更新时间与搜索索引
```

开发时可以限制抓取范围、跳过媒体下载：

```powershell
$env:PAGE_LIMIT = '20'
$env:SKIP_MEDIA = '1'
npm run build
```

> 中国大陆网络环境通常需要代理。Node.js 需要显式使用系统代理，例如：
>
> ```powershell
> $env:HTTPS_PROXY = 'http://127.0.0.1:7897'
> $env:HTTP_PROXY = 'http://127.0.0.1:7897'
> $env:NODE_USE_ENV_PROXY = '1'
> npm run build
> ```

### 配置项

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `WIKI_API` | `https://lifesimulation.fandom.com/zh/api.php` | MediaWiki API 地址 |
| `SITE_BASE` | 空（站点根路径） | 部署在子路径时使用，例如 `/Life-Simulation-Wiki` |
| `SITE_ORIGIN` | `http://localhost:5173` | 用于 canonical、sitemap 的站点源 |
| `OUT_DIR` | `dist` | 输出目录 |
| `CACHE_DIR` | `.cache` | 媒体缓存目录 |
| `SYNC_CONCURRENCY` | `6` | 页面解析并发数 |
| `MEDIA_CONCURRENCY` | `8` | 媒体下载并发数 |
| `PAGE_LIMIT` | `0`（全部） | 仅抓取前 N 页，便于开发 |
| `SKIP_MEDIA` | `0` | 设为 `1` 时跳过媒体下载 |

## 部署到 GitHub Pages

1. 推送到 `main` 分支，或手动运行 **Actions → Build and deploy wiki mirror → Run workflow**。
2. 首次使用时，在仓库 **Settings → Pages → Build and deployment** 中将 **Source** 设为 **GitHub Actions**。
3. 工作流会读取 `actions/configure-pages` 提供的 `base_path` 和 `origin`，自动处理项目子路径（如 `https://<user>.github.io/Life-Simulation-Wiki/`）与自定义域名。
4. 定时任务为 `0 * * * *`（UTC 整点）。GitHub 的 schedule 可能延迟数分钟到数十分钟，这是平台行为。

如需更换源 Wiki，请修改 `src/lib/config.mjs` 中的 `SITE` 与 `MIRRORED_NAMESPACES`，或通过 `WIKI_API` 覆盖 API 地址。

## 目录结构

```text
.github/workflows/deploy-pages.yml   每小时构建与部署
scripts/build.mjs                    构建入口
scripts/check.mjs                    产物校验
scripts/serve.mjs                    本地静态服务器
scripts/media-signature.mjs          媒体缓存签名
src/lib/api.mjs                      MediaWiki API 客户端（重试、POST、maxlag）
src/lib/collect.mjs                  页面、修订、模板、媒体索引抓取
src/lib/rewrite.mjs                  HTML 清洗、链接与媒体改写
src/lib/assets.mjs                   媒体下载、缓存、复制
src/lib/layout.mjs                   页面外壳、导航、页脚、更新状态
src/lib/generate.mjs                 页面与索引生成
src/assets/style.css                 站点样式（含 MediaWiki/Fandom 组件）
src/assets/app.js                    搜索、标签页、折叠、灯箱、主题
```

## 已知限制

- 只读静态镜像：不提供编辑、评论、上传、登录。
- 依赖实时数据库的特殊页面（最近更改、链入页面、用户贡献等）不会逐页镜像，链接指向原站。
- 动态变量、随机名言等保存的是构建时快照。
- 源站若启用验证码、Cloudflare 挑战或 API 限流，抓取可能失败；工作流会保留上一次成功部署的站点。

## 许可

- 镜像页面与媒体来自来福Simulation Wiki，依 [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/deed.zh-hans) 提供；本站不主张其版权。
- 本项目源代码以 [GNU General Public License v3.0](LICENSE) 发布。
- 本站为社区维护的非官方镜像，与 Fandom、来福Simulation 服务器管理组无隶属关系。
