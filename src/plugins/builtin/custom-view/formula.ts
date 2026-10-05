type FormulaNode =
  | { type: "num"; value: number }
  | { type: "name"; name: string }
  | { type: "neg"; expr: FormulaNode }
  | { type: "bin"; op: "+" | "-" | "*" | "/"; left: FormulaNode; right: FormulaNode };

const NUMBER = /^(?:\d+\.\d+|\d+|\.\d+)/;
const NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*/;

function tokenize(source: string): string[] | null {
  const tokens: string[] = [];
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const space = /^\s+/.exec(rest);
    if (space) {
      index += space[0].length;
      continue;
    }
    const number = NUMBER.exec(rest);
    if (number) {
      tokens.push(number[0]);
      index += number[0].length;
      continue;
    }
    const name = NAME.exec(rest);
    if (name) {
      tokens.push(name[0]);
      index += name[0].length;
      continue;
    }
    const op = rest[0];
    if (op && "()+-*/".includes(op)) {
      tokens.push(op);
      index += 1;
      continue;
    }
    return null;
  }
  return tokens;
}

export function parseFormula(source: string): FormulaNode | null {
  const tokens = tokenize(source.trim());
  if (!tokens || tokens.length === 0) return null;
  let index = 0;
  const peek = () => tokens[index];
  const take = () => tokens[index++];

  function parseExpr(): FormulaNode | null {
    let left = parseTerm();
    if (!left) return null;
    while (peek() === "+" || peek() === "-") {
      const op = take() as "+" | "-";
      const right = parseTerm();
      if (!right) return null;
      left = { type: "bin", op, left, right };
    }
    return left;
  }

  function parseTerm(): FormulaNode | null {
    let left = parseFactor();
    if (!left) return null;
    while (peek() === "*" || peek() === "/") {
      const op = take() as "*" | "/";
      const right = parseFactor();
      if (!right) return null;
      left = { type: "bin", op, left, right };
    }
    return left;
  }

  function parseFactor(): FormulaNode | null {
    const token = peek();
    if (!token) return null;
    if (token === "+") {
      take();
      return parseFactor();
    }
    if (token === "-") {
      take();
      const expr = parseFactor();
      return expr ? { type: "neg", expr } : null;
    }
    if (token === "(") {
      take();
      const expr = parseExpr();
      if (!expr || take() !== ")") return null;
      return expr;
    }
    if (NUMBER.test(token)) {
      take();
      const value = Number(token);
      return Number.isFinite(value) ? { type: "num", value } : null;
    }
    if (NAME.test(token)) {
      take();
      return { type: "name", name: token };
    }
    return null;
  }

  const node = parseExpr();
  if (!node || index !== tokens.length) return null;
  return node;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function evaluateFormula(node: FormulaNode, lookup: (name: string) => unknown): number | null {
  switch (node.type) {
    case "num":
      return node.value;
    case "name":
      return asNumber(lookup(node.name));
    case "neg": {
      const value = evaluateFormula(node.expr, lookup);
      return value === null ? null : -value;
    }
    case "bin": {
      const left = evaluateFormula(node.left, lookup);
      const right = evaluateFormula(node.right, lookup);
      if (left === null || right === null) return null;
      switch (node.op) {
        case "+": return left + right;
        case "-": return left - right;
        case "*": return left * right;
        case "/": return right === 0 ? null : left / right;
        default: return null;
      }
    }
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}
