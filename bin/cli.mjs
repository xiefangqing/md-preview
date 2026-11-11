#!/usr/bin/env node

import { exec } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { watch } from "chokidar";
import open from "open";
import sirv from "sirv";

const HOST = "127.0.0.1";
const AUTOMATIC_PORT = 0;
const ERROR_EXIT_CODE = 1;
const SEARCH_PARAM_LINE = "line";
const HEARTBEAT_INTERVAL = 25000;
const siteDirectory = fileURLToPath(new URL("../src/frontend/dist/", import.meta.url));

const CONTENT_TYPES = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const USAGE = `用法：md-preview <markdown 文件路径> [选项]

选项：
  --port <端口>   指定端口，默认自动分配
  --no-open       不自动打开浏览器
  -h, --help      显示帮助`;

/** 解析命令行参数，非法输入直接抛错 */
function parseArguments(argv) {
  const options = { file: undefined, port: AUTOMATIC_PORT, openBrowser: true, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--port") {
      const port = Number(argv[index + 1]);

      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error("--port 需要一个 0 到 65535 之间的整数");
      }

      options.port = port;
      index += 1;
      continue;
    }

    if (value === "--no-open") {
      options.openBrowser = false;
      continue;
    }

    if (value === "-h" || value === "--help") {
      options.help = true;
      continue;
    }

    if (value.startsWith("-")) {
      throw new Error(`未知参数：${value}`);
    }

    if (options.file !== undefined) {
      throw new Error("只接受一个文件路径");
    }

    options.file = value;
  }

  return options;
}

/** 统一输出 JSON 响应 */
function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

let options;

try {
  options = parseArguments(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(ERROR_EXIT_CODE);
}

if (options.help) {
  console.log(USAGE);
  process.exit(0);
}

if (options.file === undefined) {
  console.error(USAGE);
  process.exit(ERROR_EXIT_CODE);
}

const filePath = resolve(process.cwd(), options.file);
const fileName = basename(filePath);
const fileDirectory = dirname(filePath);

try {
  await access(join(siteDirectory, "index.html"));
} catch {
  console.error("缺少前端构建产物，请先在项目目录运行 pnpm build");
  process.exit(ERROR_EXIT_CODE);
}

let fileInfo;

try {
  fileInfo = await stat(filePath);
} catch {
  console.error(`找不到文件：${filePath}`);
  process.exit(ERROR_EXIT_CODE);
}

if (!fileInfo.isFile()) {
  console.error(`不是文件：${filePath}`);
  process.exit(ERROR_EXIT_CODE);
}

/** 当前打开的预览连接 */
const listeners = new Set();

/** 把事件推给所有预览连接 */
function broadcast(event) {
  for (const response of listeners) {
    response.write(`event: ${event}\ndata:\n\n`);
  }
}

// 编辑器保存可能分多次写入，等文件稳定后再通知，避免读到半截内容。
const watcher = watch(filePath, {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
});

watcher.on("change", () => broadcast("change"));
watcher.on("unlink", () => broadcast("gone"));
watcher.on("error", (error) => console.error(`监听文件失败：${error.message}`));

/** 返回启动时锁定的那一个文件，不接受客户端指定路径 */
async function sendContent(response) {
  try {
    const content = await readFile(filePath, "utf8");

    sendJson(response, 200, { name: fileName, content });
  } catch {
    sendJson(response, 404, { name: fileName, message: "文件已不存在" });
  }
}

/** 建立 SSE 长连接，断开时移除 */
function openEventStream(request, response) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
  });

  // 先发一条注释，让浏览器立刻进入已连接状态。
  response.write(": connected\n\n");

  // 长时间没有事件时补一条注释，避免连接被当成空闲连接掐掉。
  const heartbeat = setInterval(() => response.write(": ping\n\n"), HEARTBEAT_INTERVAL);

  listeners.add(response);
  response.on("close", () => {
    clearInterval(heartbeat);
    listeners.delete(response);
  });
}

/** 提供 md 同目录内的图片等资源，阻止跳出该目录 */
async function sendLocalFile(pathname, response) {
  let relative;

  try {
    relative = decodeURIComponent(pathname.slice("/local/".length));
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }

  const target = resolve(fileDirectory, relative);

  // 只允许 md 所在目录内的文件，防止 ../ 跳出。
  if (target !== fileDirectory && !target.startsWith(fileDirectory + sep)) {
    response.writeHead(403);
    response.end();
    return;
  }

  try {
    const content = await readFile(target);

    response.writeHead(200, {
      "content-type": CONTENT_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-store",
      // 直接打开 svg 等资源时不执行其中的脚本。
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end();
  }
}

/** 用 VSCode 打开当前文件并定位到指定行 */
function handleOpen(request, response) {
  const port = server.address().port;
  const origin = request.headers.origin;

  // 只接受本站页面发起的请求，避免其他网页借服务弹出编辑器。
  if (origin !== undefined && origin !== `http://${HOST}:${port}`) {
    response.writeHead(403);
    response.end();
    return;
  }

  const { searchParams } = new URL(request.url, `http://${HOST}`);
  const line = Number(searchParams.get(SEARCH_PARAM_LINE));
  const target = Number.isInteger(line) && line > 0 ? `${filePath}:${line}` : filePath;

  // Windows 上的 code 是 .cmd，必须经 shell 执行，直接 spawn 会抛 EINVAL 并终止整个服务。
  exec(`code -g "${target}"`, (error) => {
    if (error) {
      sendJson(response, 500, { message: "找不到 code 命令，请把 VSCode 的 bin 目录加入 PATH" });
      return;
    }

    response.writeHead(204);
    response.end();
  });
}

// dev 模式不做启动期索引：构建产物的文件名带 hash，索引里会缺新文件导致 404。
const serveStatic = sirv(siteDirectory, { dev: true });

const server = createServer(async (request, response) => {
  const { pathname } = new URL(request.url, `http://${HOST}`);

  if (pathname === "/api/content") {
    await sendContent(response);
    return;
  }

  if (pathname === "/api/events") {
    openEventStream(request, response);
    return;
  }

  if (pathname === "/api/open") {
    handleOpen(request, response);
    return;
  }

  if (pathname.startsWith("/local/")) {
    await sendLocalFile(pathname, response);
    return;
  }

  // 静态页面统一返回完整资源，避免无效 Range 进入 sirv 的分段读取逻辑。
  delete request.headers.range;
  serveStatic(request, response);
});

/** 启动失败时输出原因，关掉监听让进程正常退出 */
async function handleServerError(error) {
  if (error.code === "EADDRINUSE") {
    console.error(`端口 ${options.port} 已被占用，换一个端口或去掉 --port 使用随机端口`);
  } else {
    console.error(`md-preview 启动失败：${error.message}`);
  }

  await watcher.close();
  process.exitCode = ERROR_EXIT_CODE;
}

/** 服务就绪后打印地址并按需打开浏览器 */
async function openBrowser() {
  // 用 IPv4 字面地址：本机 localhost 会先解析到 ::1，而服务只监听 127.0.0.1。
  const address = `http://${HOST}:${server.address().port}`;

  console.log(`正在预览 ${fileName}`);
  console.log(address);

  if (!options.openBrowser) {
    return;
  }

  try {
    await open(address);
  } catch (error) {
    console.error(`无法自动打开浏览器，请手动访问上面的地址：${error.message}`);
  }
}

server.on("error", handleServerError);
server.listen(options.port, HOST, openBrowser);
