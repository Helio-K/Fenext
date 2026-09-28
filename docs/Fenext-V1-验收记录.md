# Fenext V1 验收记录

版本：1.0.0

验证日期：2026-09-28
环境：macOS ARM64、Node.js 24.16.0、Electron 44.4.5、Playwright Chromium

## 本次实际通过

| 检查 | 结果 |
|---|---|
| `npm test` | 52 / 52 通过；账户隔离、资料处理、凭证、版本冲突、备份与同步等；验证仅导出笔记正文中的明确链接，并清理旧版自动图谱区 |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过；保留前端主包超过 500 kB 的体积提示，不影响构建 |
| `npx playwright test` | 24 / 24 通过；覆盖收集、知识库、凭证、来源弹窗、插件、个人菜单及窗口适配 |
| `npm run test:desktop` | 开发入口实际启动通过：登录、Obsidian 测试知识库连接、手动同步、笔记写入与打开指定笔记、显示器边界、900×600 缩放、系统全屏往返、受限桥接、快捷键、浮窗与 Esc 草稿恢复 |
| 打包后 Mac 应用运行 | 对 `release/mac-arm64/Fenext.app` 运行同一桌面验收脚本，全部通过，使用隔离测试账户与临时 Obsidian 知识库 |
| `npm run desktop:mac -- --arm64` | 生成 Fenext-1.0.0-arm64-mac.zip，未签名 |
| `npm run desktop:win -- --x64` | 生成 Windows x64 NSIS 安装程序，发布资产命名为 Fenext-Setup-1.0.0.exe；交叉构建，未配置签名证书 |
| 两端内置版本 | 解包检查 app.asar 中 package.json：均为 1.0.0，包含“关于 Fenext”入口 |
| 桌面图标 | 1024 像素源文件及 macOS `.icns` 均含透明通道；64 像素 Dock 预览确认四角透明、圆角底及原狐狸形象 |
| `npm run web:package` | 生成 Fenext-Web-1.0.0.zip，包含前端构建、服务源码、worker、部署配置与插件 |
| `node scripts/release-web-smoke.mjs` | 从 ZIP 解压到临时目录，独立安装生产依赖，启动 API 和 worker，验证 health 版本、账户与资料持久化、浏览器登录及收集箱 |
| 网页包内容边界 | ZIP 不含 .env、用户数据库、master.key、node_modules 或小程序代码 |
| 插件 1.0.0 | 打包与更新清单匹配，Chrome / Edge 下载链接和校验、连接、提取、旧版提醒等自动化流程通过 |

网页包验证使用隔离数据及 4312 端口；界面与桌面验证使用 4311 端口。未修改现有账号或资料，也未调用付费模型。测试截图保存在 `.local/qa/`，其中内容为测试夹具。

## 尚未验收或未交付

- Windows 实机安装、运行和本地目录同步；macOS Intel 安装包。
- Edge 实机安装、提取与更新；Firefox、Safari 和移动浏览器扩展不在 V1 范围。
- Apple 签名、公证、Windows 代码签名及客户端自动升级。
- Docker 容器运行：本机 Docker 守护进程不可用，未声称已验证容器启动。
- 公网域名、HTTPS 和服务器部署；当前是本地发布产物，未上线公开服务。
- 全部模型与代表性资料的整理质量；历史真实模型验证不等于本次所有配置均已验收。
- 微信小程序、微信/手机号登录及平台专属来源接入不属于本次 V1 交付。

## 复现与发布清单

在项目目录依次执行：

```sh
npm test
npm run typecheck
npm run web:package
npx playwright test
npm run test:desktop
npm run desktop:mac -- --arm64
npm run desktop:win -- --x64
FENEXT_SMOKE_EXECUTABLE="$(pwd)/release/mac-arm64/Fenext.app/Contents/MacOS/Fenext" npm run test:desktop
node scripts/release-web-smoke.mjs
npm run release:assemble
```

产物集中于 `release/v1.0.0/`。`manifest.json` 记录每个包的实际文件大小和 SHA-256；可在该目录运行 `shasum -a 256 -c SHA256SUMS.txt` 核对。重新构建后须重新组装并验证清单。
