# 来福Simulation Wiki 静态镜像

此项目会通过 MediaWiki API 每小时镜像来福Simulation Wiki 的全部主命名空间条目与媒体文件，并生成可离线浏览的静态站点。

## 本地使用

```powershell
npm ci
npm run sync:wiki
npm run build
npm run dev
```

`sync:wiki` 会重新获取全部文章、重写站内链接为本地路由，并将图片、音频和视频存放在 `public/wiki-assets`。生成的条目数据位于 `public/wiki-data/pages.json`。

## GitHub Pages

仓库包含 [deploy-pages.yml](.github/workflows/deploy-pages.yml)。推送到 `main` 后，GitHub Actions 会依次同步源站内容、构建 Vite 站点并部署到 GitHub Pages。

首次启用时，在 GitHub 仓库的 **Settings > Pages > Build and deployment** 中选择 **GitHub Actions**。之后可通过 Actions 页面手动执行 “Build and deploy Wiki” 来更新迁移内容。

## 许可

迁移页面保留原 Wiki 的 CC BY-SA 署名链接。请在发布前确认你对源站媒体及附加内容拥有适当的再发布权利。