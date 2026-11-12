# Markdown Preview

在浏览器中预览本地 Markdown 文件，保存即刷新，需要改动时一键跳回 VSCode。

## 快速使用

安装 Node.js 20 或以上版本（自带 npm），运行：

```bash
npx @xiefangqing/md-preview 文档.md
```

浏览器会自动打开。在 VSCode 里修改并保存，页面随即更新，不整页刷新，阅读位置也不会跳走。

终端需要保持运行，按 `Ctrl+C` 停止。每次启动分配新的空闲端口，可以同时开多个实例预览不同文件。

## 选项

| 选项 | 说明 |
| --- | --- |
| `--port <端口>` | 指定端口，默认自动分配空闲端口 |
| `--no-open` | 不自动打开浏览器 |
| `-h, --help` | 显示帮助 |

## 预览范围

- 一次预览一个文件，传目录会报错退出。右上角「打开文件」可以粘贴另一个路径原地切换，不用重启命令。两个按钮都支持单键快捷键：`O` 打开文件，`V` 在 VSCode 打开；输入框聚焦时按键按文本处理。
- 支持 GFM：表格、任务列表、删除线、脚注；代码块按语言高亮。
- 图片按 md 所在目录解析：相对路径、原始 HTML 的 `<img>`、以 `/` 开头的路径都指向该目录；其它资源同样限制在目录内。
- 不提供编辑、搜索、目录大纲。页面内查找用浏览器自带的 `Ctrl+F`。
- 不支持 Mermaid 图表和数学公式。

## 在 VSCode 打开

页面右上角的按钮调用 `code -g 文件:行号`，跳到当前正在阅读的那一段。

VSCode 的 `bin` 目录需要在 PATH 里。Windows 上安装时若未勾选「添加到 PATH」，按钮会提示找不到命令。

## 安全边界

服务只监听本机 `127.0.0.1`，内容接口只返回当前预览的那一个文件。切换文件和打开编辑器只接受 POST 请求，且 Origin 必须与本站地址一致；切换路径必须指向已存在的文件。图片接口被限制在该文件所在目录内，直接打开 SVG 等资源时不会执行其中的脚本。渲染结果经过 DOMPurify 消毒。

## 本地开发

开发环境使用 Node.js 20 或以上，以及 pnpm 8.15.9。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

检查和构建：

```bash
pnpm build
pnpm test
node bin/cli.mjs README.md
```

## 打包与发布

包名为 `@xiefangqing/md-preview`。`prepack` 会自动构建，包内只分发启动器、前端构建产物及 npm 自动包含的元数据和 README。

```bash
pnpm install --frozen-lockfile
pnpm build
npm pack
```

先在仓库外的空目录测试生成的压缩包，将下方路径替换为本机实际路径：

```bash
npx --yes --package /absolute/path/xiefangqing-md-preview-0.1.1.tgz md-preview README.md
```

确认可用后发布：

```bash
npm login --registry=https://registry.npmjs.org/
npm publish --access public
```

发布后不能覆盖同一版本，有问题时递增版本重新发布。
