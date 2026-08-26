const RUNTIME_SPECIFIERS = new Set([
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
]);

function isRuntimeSpecifier(spec: string): boolean {
  return spec.startsWith("gloomberb/") || RUNTIME_SPECIFIERS.has(spec);
}

function parseNamedBindings(raw: string): string[] {
  const inner = raw.trim().replace(/^{|}$/g, "").trim();
  if (!inner) return [];
  const parts: string[] = [];
  for (const piece of inner.split(",")) {
    const token = piece.trim();
    if (!token || token.startsWith("type ")) continue;
    const aliased = token.match(/^(\w+)\s+as\s+(\w+)$/);
    if (aliased) {
      parts.push(`${aliased[1]}: ${aliased[2]}`);
      continue;
    }
    if (/^\w+$/.test(token)) parts.push(token);
  }
  return parts;
}

function rewriteClause(clause: string, spec: string): string {
  const ns = `globalThis.__GLOOM_PLUGIN_RUNTIME[${JSON.stringify(spec)}]`;
  const trimmed = clause.trim();
  if (trimmed.startsWith("* as ")) {
    const name = trimmed.slice("* as ".length).trim();
    return `const ${name} = ${ns};`;
  }
  const defaultAndNamed = trimmed.match(/^(\w+)\s*,\s*(\{[\s\S]*\})$/);
  if (defaultAndNamed) {
    const named = parseNamedBindings(defaultAndNamed[2]!);
    const lines = [`const ${defaultAndNamed[1]} = ${ns}.default ?? ${ns};`];
    if (named.length > 0) lines.push(`const { ${named.join(", ")} } = ${ns};`);
    return lines.join("\n");
  }
  if (trimmed.startsWith("{")) {
    const named = parseNamedBindings(trimmed);
    if (named.length === 0) return "";
    return `const { ${named.join(", ")} } = ${ns};`;
  }
  if (/^\w+$/.test(trimmed)) {
    return `const ${trimmed} = ${ns}.default ?? ${ns};`;
  }
  return `const ${trimmed} = ${ns};`;
}

const IMPORT_RE = /^[ \t]*import\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["'][ \t]*;?[ \t]*$/gm;

export function rewriteGloomImports(source: string): string {
  return source.replace(IMPORT_RE, (full, typeKw: string | undefined, clause: string, spec: string) => {
    if (!isRuntimeSpecifier(spec)) return full;
    if (typeKw) return "";
    const rewritten = rewriteClause(clause, spec);
    return rewritten;
  });
}

export function withJsxRuntimePrelude(source: string): string {
  return `const GloomReact = globalThis.__GLOOM_PLUGIN_RUNTIME.react;\n${source}`;
}
