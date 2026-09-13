export function escapeShareHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function injectShareDocumentMeta(
  html: string,
  meta: { title: string; description?: string },
): string {
  const title = escapeShareHtml(meta.title.trim() || "Gloomberb");
  const description = escapeShareHtml((meta.description ?? "").trim().slice(0, 240));
  const tags = [
    `<meta property="og:title" content="${title}" />`,
    description ? `<meta property="og:description" content="${description}" />` : "",
    `<meta property="og:type" content="article" />`,
    `<meta name="twitter:card" content="summary" />`,
  ].filter(Boolean).join("");
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace("</head>", `${tags}</head>`);
}
