export interface WebsiteArtifact {
  html: string;
}

/** Turns fenced HTML, CSS, and JavaScript from an assistant reply into one previewable page. */
export function extractWebsiteArtifact(markdown: string): WebsiteArtifact | null {
  const blocks: Array<{ language: string; code: string }> = [];
  const fencePattern = /```([^\n`]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(markdown)) !== null) {
    blocks.push({ language: match[1].trim().toLowerCase(), code: match[2].trim() });
  }

  const htmlBlock = blocks.find((block) => ["html", "html5", "htm"].includes(block.language));

  const css = blocks
    .filter((block) => block.language === "css")
    .map((block) => block.code)
    .join("\n\n");
  const javascript = blocks
    .filter((block) => ["js", "javascript"].includes(block.language))
    .map((block) => block.code)
    .join("\n\n")
    .replace(/<\/script/gi, "<\\/script");

  let html = htmlBlock?.code ?? "";
  if (!htmlBlock) {
    const pastedCode = markdown.trim();
    const tags = pastedCode.match(/<\/?[a-z][^>]*>/gi) ?? [];
    const textOutsideTags = pastedCode.replace(/<!--[\s\S]*?-->/g, "").replace(/<\/?[a-z][^>]*>/gi, "").trim();
    const isDocument = /<!doctype\s+html|<html[\s>]|<body[\s>]/i.test(pastedCode);
    const isHtmlFragment = pastedCode.length > 80 && tags.length >= 3 && textOutsideTags.length < pastedCode.length * 0.6;
    if (!isDocument && !isHtmlFragment) return null;

    const documentStart = pastedCode.search(/<!doctype\s+html|<html\b/i);
    html = documentStart >= 0 ? pastedCode.slice(documentStart) : pastedCode;
  }

  if (!/<html[\s>]/i.test(html)) {
    html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${html}</body></html>`;
  }

  if (css) {
    const style = `<style>\n${css}\n</style>`;
    if (/<\/head>/i.test(html)) {
      html = html.replace(/<\/head>/i, `${style}</head>`);
    } else {
      html = html.replace(/<html[^>]*>/i, (tag) => `${tag}<head>${style}</head>`);
    }
  }

  if (javascript) {
    const script = `<script>\n${javascript}\n</script>`;
    if (/<\/body>/i.test(html)) {
      html = html.replace(/<\/body>/i, `${script}</body>`);
    } else {
      html = html.replace(/<\/html>/i, `${script}</html>`);
    }
  }

  return { html };
}

export function isWebsiteRequest(prompt: string): boolean {
  const asksToBuild = /\b(create|build|make|design|develop|generate|code|write|continue|resume|finish|update|modify|edit|improve|recreate)\b/i.test(prompt);
  const asksForWeb = /\b(site|website|web site|webpage|web page|landing page|dashboard|web app|homepage)\b/i.test(prompt);
  return asksToBuild && asksForWeb;
}

export function isWebsiteFollowUp(prompt: string): boolean {
  return /\b(add|remove|change|update|modify|fix|improve|replace|restyle|style|continue|resume|finish|edit|recreate|color|colour|font|button|section|layout|responsive|navigation|navbar|hero|make it|turn it)\b/i.test(prompt);
}

const MARKDOWN_FENCE = "\u0060\u0060\u0060";
export const WEBSITE_BUILD_INSTRUCTIONS = `When the user asks you to create or change a website, return a complete, polished, responsive, standalone HTML page in a fenced ${MARKDOWN_FENCE}html code block. Put CSS in a fenced ${MARKDOWN_FENCE}css block and optional interactive vanilla JavaScript in a fenced ${MARKDOWN_FENCE}javascript block. Do not use React, JSX, build tools, or external dependencies. The page must work as-is in a browser preview. Briefly describe what you built before the code. For non-website requests, answer normally.`;
