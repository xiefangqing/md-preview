import "github-markdown-css/github-markdown-light.css";
import "highlight.js/styles/github.css";

import { highlightCodeBlocks, renderMarkdown } from "./render";
import type { ApiError, PreviewContent } from "./types";
import "./styles.css";

const MISSING_TEXT = "文件已删除，等待恢复";
const OFFLINE_TEXT = "预览服务已停止，重新运行 md-preview 后打开终端里打印的新地址";
const FIRST_LINE = 1;

const stateElement = document.getElementById("file-state") as HTMLElement;
const contentElement = document.getElementById("content") as HTMLElement;
const editorButton = document.getElementById("open-editor") as HTMLElement;
const fileButton = document.getElementById("open-file") as HTMLElement;
const filePanel = document.getElementById("file-panel") as HTMLElement;
const fileInput = document.getElementById("file-path") as HTMLInputElement;

/** 切换请求进行中，避免连按回车排队 */
let isSwitching = false;

// 没有顶栏了，视口顶部就是判定线，正文上方的留白不计入当前行。
const VIEWPORT_TOP = 0;

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

    const payload = (await response.json()) as ApiError;

    stateElement.textContent = payload.message ?? "打开编辑器失败";
  } catch {
    stateElement.textContent = OFFLINE_TEXT;
  }
}

/** 收起路径输入框 */
function closeFilePanel() {
  filePanel.hidden = true;
}

/** 切换路径输入框的显隐，展开时聚焦并全选上次残留的路径 */
function toggleFilePanel() {
  filePanel.hidden = !filePanel.hidden;

  if (filePanel.hidden) {
    return;
  }

  fileInput.focus();
  fileInput.select();
}

/** 把输入的路径交给服务端切换，页面内容由 switch 事件刷新 */
async function switchFile() {
  const path = fileInput.value.trim();

  // 服务端要重建监听，请求期间不再受理新的切换，避免连按回车排队。
  if (path === "" || isSwitching) {
    return;
  }

  isSwitching = true;

  try {
    const response = await fetch(`/api/switch?path=${encodeURIComponent(path)}`, { method: "POST" });

    if (!response.ok) {
      const payload = (await response.json()) as ApiError;

      stateElement.textContent = payload.message ?? "打开文件失败";
      return;
    }

    fileInput.value = "";
    closeFilePanel();
  } catch {
    stateElement.textContent = OFFLINE_TEXT;
  } finally {
    isSwitching = false;
  }
}

/** 回车切换文件，Esc 收起输入框 */
function handleFileInputKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") {
    switchFile();
  } else if (event.key === "Escape") {
    closeFilePanel();
  }
}

editorButton.addEventListener("click", openInEditor);
fileButton.addEventListener("click", toggleFilePanel);
fileInput.addEventListener("keydown", handleFileInputKeydown);

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

// 换文件是从头读，回到顶部；保存刷新保持原位，两者不能共用。
events.addEventListener("switch", async () => {
  await loadContent();
  window.scrollTo({ top: 0 });
});

events.addEventListener("gone", () => {
  stateElement.textContent = MISSING_TEXT;
});

loadContent();
