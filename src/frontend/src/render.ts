import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import { marked, Renderer } from "marked";
import type { Token, Tokens } from "marked";

/** 带协议或协议相对地址的图片不归本地目录管 */
const EXTERNAL_SOURCE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** token 上记录的源码行号 */
type LineAware = {
  sourceLine?: number;
};

/** 在开标签内插入属性，块级元素的输出都以 <tag 开头 */
function injectAttribute(html: string, attribute: string) {
  const end = html.indexOf(">");

  if (end === -1) {
    return html;
  }

  return `${html.slice(0, end)} ${attribute}${html.slice(end)}`;
}

/** 有行号时写进 data-line，供跳转 VSCode 使用 */
function withLine(html: string, token: Token) {
  const line = (token as Token & LineAware).sourceLine;

  return line === undefined ? html : injectAttribute(html, `data-line="${line}"`);
}

/** 把相对路径的图片挂到 /local/ 上，绝对地址和 data URI 保持原样 */
function localizeImages(html: string) {
  const template = document.createElement("template");

  template.innerHTML = html;

  for (const image of template.content.querySelectorAll("img")) {
    const source = image.getAttribute("src");

    if (source === null || EXTERNAL_SOURCE.test(source)) {
      continue;
    }

    image.setAttribute("src", `/local/${source.replace(/^\/+/, "")}`);
  }

  return template.innerHTML;
}

/** 只给顶层块级元素补行号，嵌套结构不处理 */
class LineRenderer extends Renderer {
  override heading(token: Tokens.Heading) {
    return withLine(super.heading(token), token);
  }

  override paragraph(token: Tokens.Paragraph) {
    return withLine(super.paragraph(token), token);
  }

  override code(token: Tokens.Code) {
    return withLine(super.code(token), token);
  }

  override blockquote(token: Tokens.Blockquote) {
    return withLine(super.blockquote(token), token);
  }

  override list(token: Tokens.List) {
    return withLine(super.list(token), token);
  }

  override table(token: Tokens.Table) {
    return withLine(super.table(token), token);
  }
}

/** 按原文顺序累加，给每个顶层 token 记上起始行 */
function markSourceLines(tokens: Token[]) {
  let line = 1;

  for (const token of tokens) {
    (token as Token & LineAware).sourceLine = line;
    line += token.raw.split("\n").length - 1;
  }
}

/** 把 markdown 转成可插入页面的安全 HTML */
export function renderMarkdown(markdown: string) {
  const tokens = marked.lexer(markdown);

  markSourceLines(tokens);

  const html = marked.parser(tokens, { renderer: new LineRenderer() });

  // 消毒之后再改地址：这时留下的 src 都已过白名单，改写不会碰掉消毒结果。
  return localizeImages(DOMPurify.sanitize(html));
}

/** 渲染完成后再上色，避免在解析阶段介入 */
export function highlightCodeBlocks(container: HTMLElement) {
  for (const block of container.querySelectorAll("pre code")) {
    hljs.highlightElement(block as HTMLElement);
  }
}
