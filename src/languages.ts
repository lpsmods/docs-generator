import JavaScript from "tree-sitter-javascript";
import Python from "tree-sitter-python";
import TypeScript from "tree-sitter-typescript";
import type { LanguageDefinition } from "./types.js";

function pythonStringContents(source: string): string {
  const value = source.trim();
  const match = /^(?:[rubf]*)(["']{3}|["'])([\s\S]*)\1$/i.exec(value);
  return (match?.[2] ?? value).trim();
}

const jsKinds = {
  class_declaration: "class",
  function_declaration: "function",
  generator_function_declaration: "function",
  function_signature: "function",
  method_definition: "method",
  method_signature: "method",
  abstract_method_signature: "method",
  interface_declaration: "interface",
  type_alias_declaration: "type",
  enum_declaration: "enum"
} as const;

export const javascript: LanguageDefinition = {
  name: "javascript",
  extensions: [".js", ".jsx", ".mjs", ".cjs"],
  grammar: JavaScript as unknown as LanguageDefinition["grammar"],
  nodeKinds: jsKinds
};

export const typescript: LanguageDefinition = {
  name: "typescript",
  extensions: [".ts", ".mts", ".cts"],
  grammar: TypeScript.typescript as unknown as LanguageDefinition["grammar"],
  nodeKinds: jsKinds
};

export const tsx: LanguageDefinition = {
  ...typescript,
  name: "tsx",
  extensions: [".tsx", ".jsx"],
  grammar: TypeScript.tsx as unknown as LanguageDefinition["grammar"]
};

export const python: LanguageDefinition = {
  name: "python",
  extensions: [".py", ".pyi"],
  grammar: Python as unknown as LanguageDefinition["grammar"],
  nodeKinds: { class_definition: "class", function_definition: "function" },
  /** Reclassifies functions nested directly in Python classes as methods. */
  transformSymbol(symbol, node) {
    if (symbol.kind === "function" && node.parent?.type === "block" && node.parent.parent?.type === "class_definition") {
      symbol.kind = "method";
    }
    return symbol;
  },
  /** Extracts the leading Python string literal used as a declaration docstring. */
  getDocumentation(node, source) {
    const body = node.childForFieldName("body");
    const first = body?.namedChild(0);
    if (first?.type === "expression_statement") {
      const value = first.namedChild(0);
      if (value && ["string", "concatenated_string"].includes(value.type)) {
        return pythonStringContents(source.slice(value.startIndex, value.endIndex));
      }
    }
    return undefined;
  }
};

const definitions = new Map<string, LanguageDefinition>();

export function registerLanguage(definition: LanguageDefinition): void {
  definitions.set(definition.name.toLowerCase(), definition);
  for (const extension of definition.extensions) definitions.set(extension.toLowerCase(), definition);
}

export function getLanguage(nameOrExtension: string): LanguageDefinition {
  const key = nameOrExtension.toLowerCase();
  const definition = definitions.get(key) ?? definitions.get(key.startsWith(".") ? key : `.${key}`);
  if (!definition) throw new Error(`Unsupported language '${nameOrExtension}'. Register it with registerLanguage().`);
  return definition;
}

export function listLanguages(): LanguageDefinition[] {
  return [...new Set(definitions.values())];
}

[javascript, typescript, tsx, python].forEach(registerLanguage);
