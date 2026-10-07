# 来福Simulation Wiki 静态镜像

此项目会通过 MediaWiki API 每小时镜像来福Simulation Wiki 的全部主命名空间条目与媒体文件，并生成可离线浏览的静态站点。

## 本地使用

```powershell
npm ci
npm run sync:wiki
npm run build
npm run dev
```

`sync:wiki` 会重新获取全部文章、重写站内链接为本地路由，并将图片、音频和视频存放在 `public/wiki-assets`。生成的条目数据位于 `docs/public/wiki-data`（`index.json` 与 `pages/*.json`），并为每个条目生成一个 `docs/wiki-pages/*.md` 入口页，保证直链刷新不 404。

站点使用 VitePress 静态化（`docs/.vitepress`），前端应用逻辑集中在主题内（`docs/.vitepress/theme/index.js`），运行时通过 `#/wiki/` 哈希路由加载 JSON 数据，Service Worker（`sw.js`）提供离线缓存。

> **Windows 注意事项**：在 Windows 下执行构建时，工作目录的盘符必须使用大写（如 `D:\Documents\...`）。VitePress 在 Windows 上存在路径大小写比较问题，使用小写盘符（如 `d:\...`）会导致 `build` 阶段 `renderPage` 崩溃。Linux/macOS 与 GitHub Actions 不受影响。

## GitHub Pages

仓库包含 [deploy-pages.yml](.github/workflows/deploy-pages.yml)。推送到 `main` 后，GitHub Actions 会依次同步源站内容、构建 VitePress 站点（输出到仓库根目录 `dist/`）并部署到 GitHub Pages。

首次启用时，在 GitHub 仓库的 **Settings > Pages > Build and deployment** 中选择 **GitHub Actions**。之后可通过 Actions 页面手动执行 “Build and deploy Wiki” 来更新迁移内容。

## 许可

迁移页面保留原 Wiki 的 CC BY-SA 署名链接。请在发布前确认你对源站媒体及附加内容拥有适当的再发布权利。