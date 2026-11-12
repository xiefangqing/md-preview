import "github-markdown-css/github-markdown-light.css";
import "highlight.js/styles/github.css";

import { highlightCodeBlocks, renderMarkdown } from "./render";
import type { OpenError, PreviewContent } from "./types";
import "./styles.css";

const MISSING_TEXT = "文件已删除，等待恢复";
const OFFLINE_TEXT = "预览服务已停止，重新运行 md-preview 后打开终端里打印的新地址";
const FIRST_LINE = 1;

const nameElement = document.getElementById("file-name") as HTMLElement;
const stateElement = document.getElementById("file-state") as HTMLElement;
const contentElement = document.getElementById("content") as HTMLElement;
const openButton = document.getElementById("open-editor") as HTMLElement;
const barElement = document.querySelector(".md-bar") as HTMLElement;

// 顶栏高度直接量渲染结果，避免样式改了而这里的阈值没跟着改。
const VIEWPORT_TOP = barElement.getBoundingClientRect().height;

/** 取视口里最靠上的那个块的行号 */
function readCurrentLine() {
  const blocks = contentElement.querySelectorAll<HTMLElement>("[data-line]");
  let line = FIRST_LINE;

  for (const block of blocks) {
    if (block.getBoundingClientRect().top > VIEWPORT_TOP) {
      break;
    }

    line = Number(block.dataset.line);
  }

  return line;
}

/** 拉取文件内容并重新渲染。滚动位置由浏览器保持，这里不主动滚 */
async function loadContent() {
  try {
    const response = await fetch("/api/content", { cache: "no-store" });

    if (!response.ok) {
      stateElement.textContent = MISSING_TEXT;
      return;
    }

    const payload = (await response.json()) as PreviewContent;

    nameElement.textContent = payload.name;
    document.title = payload.name;
    stateElement.textContent = "";
    contentElement.innerHTML = renderMarkdown(payload.content);
    highlightCodeBlocks(contentElement);
  } catch {
    stateElement.textContent = OFFLINE_TEXT;
  }
}

/** 用 VSCode 打开并定位到当前阅读位置 */
async function openInEditor() {
  try {
    const response = await fetch(`/api/open?line=${readCurrentLine()}`, { method: "POST" });

    if (response.ok) {
      return;
    }

    const payload = (await response.json()) as OpenError;

    stateElement.textContent = payload.message ?? "打开编辑器失败";
  } catch {
    stateElement.textContent = OFFLINE_TEXT;
  }
}

openButton.addEventListener("click", openInEditor);

const events = new EventSource("/api/events");

events.addEventListener("open", () => {
  stateElement.textContent = "";
});

events.addEventListener("error", () => {
  stateElement.textContent = OFFLINE_TEXT;
});

events.addEventListener("change", () => {
  loadContent();
});

events.addEventListener("gone", () => {
  stateElement.textContent = MISSING_TEXT;
});

loadContent();
