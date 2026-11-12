import "github-markdown-css/github-markdown-light.css";
import "highlight.js/styles/github.css";

import { highlightCodeBlocks, renderMarkdown } from "./render";
import type { ApiError, PreviewContent } from "./types";
import "./styles.css";

const MISSING_TEXT = "文件已删除，等待恢复";
const OFFLINE_TEXT = "预览服务已停止，重新运行 md-preview 后打开终端里打印的新地址";
const FIRST_LINE = 1;

// 改快捷键时同步改 README 的说明，按钮文案由下面这段拼接。
const SHORTCUT_OPEN_FILE = "o";
const SHORTCUT_OPEN_EDITOR = "v";

const stateElement = document.getElementById("file-state") as HTMLElement;
const contentElement = document.getElementById("content") as HTMLElement;
const actionsElement = document.getElementById("file-actions") as HTMLElement;
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

/** 点到按钮组和弹层以外的位置就收起，按钮自己负责开合 */
function handleDocumentClick(event: MouseEvent) {
  if (filePanel.hidden) {
    return;
  }

  if (event.target instanceof Node && actionsElement.contains(event.target)) {
    return;
  }

  closeFilePanel();
}

/** 单个字母的快捷键，带修饰键时交给浏览器 */
function handleShortcut(event: KeyboardEvent) {
  if (event.ctrlKey || event.altKey || event.metaKey) {
    return;
  }

  // 长按会按系统重复率连续触发：V 会反复拉起编辑器，O 会让面板高频开合。
  if (event.repeat) {
    return;
  }

  // 正在输入路径时，按键属于文本内容。
  if (event.target === fileInput) {
    return;
  }

  const key = event.key.toLowerCase();

  // 打开面板后焦点立刻落到输入框，不拦下这一下按键会被当成文本输进去。
  if (key === SHORTCUT_OPEN_FILE) {
    event.preventDefault();
    toggleFilePanel();
    return;
  }

  if (key === SHORTCUT_OPEN_EDITOR) {
    event.preventDefault();
    openInEditor();
  }
}

// 快捷键字母只在常量里维护，按钮文案由这里补上，index.html 只写按钮名称。
editorButton.append(`（${SHORTCUT_OPEN_EDITOR.toUpperCase()}）`);
fileButton.append(`（${SHORTCUT_OPEN_FILE.toUpperCase()}）`);

editorButton.addEventListener("click", openInEditor);
fileButton.addEventListener("click", toggleFilePanel);
fileInput.addEventListener("keydown", handleFileInputKeydown);
document.addEventListener("click", handleDocumentClick);
document.addEventListener("keydown", handleShortcut);

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
