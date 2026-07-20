import Parser from "tree-sitter";
import type { DocParameter, DocSymbol, DocumentationModel, LanguageDefinition, SymbolKind } from "./types.js";

const cleanComment = (text: string): string => text
  .replace(/^\s*\/\*\*?/, "").replace(/\*\/\s*$/, "")
  .split(/\r?\n/).map(line => line.replace(/^\s*(?:\/\/\/|\/\/|#|\*)\s?/, "")).join("\n").trim();

function precedingComment(node: Parser.SyntaxNode, source: string): string {
  let sibling = node.previousNamedSibling;
  const comments: string[] = [];
  while (sibling?.type === "comment") {
    if (node.startPosition.row - sibling.endPosition.row > (comments.length ? 1 : 2)) break;
    comments.unshift(cleanComment(source.slice(sibling.startIndex, sibling.endIndex)));
    sibling = sibling.previousNamedSibling;
  }
  return comments.join("\n");
}

function documentation(node: Parser.SyntaxNode, source: string, language: LanguageDefinition): string {
  const custom = language.getDocumentation?.(node, source);
  if (custom !== undefined) return custom;
  const direct = precedingComment(node, source);
  if (direct) return direct;
  // TypeScript declarations can be nested in `ambient_declaration` and
  // `export_statement` wrappers between their JSDoc and declaration node.
  const transparentWrappers = new Set(["ambient_declaration", "export_statement"]);
  let current = node;
  while (current.parent && transparentWrappers.has(current.parent.type)) {
    current = current.parent;
    const wrapped = precedingComment(current, source);
    if (wrapped) return wrapped;
  }
  return "";
}

function field(node: Parser.SyntaxNode, names: string[]): Parser.SyntaxNode | null {
  for (const name of names) {
    const result = node.childForFieldName(name);
    if (result) return result;
  }
  return null;
}

function signature(node: Parser.SyntaxNode, source: string, bodyFields: string[]): string {
  const body = field(node, bodyFields);
  const end = body?.startIndex ?? node.endIndex;
  return source.slice(node.startIndex, end).trim().replace(/[{:=>\s]+$/, "").trim();
}

function parameterDetail(node: Parser.SyntaxNode, source: string): DocParameter {
  const nameNode = field(node, ["name", "pattern", "left"]) ?? node.namedChild(0) ?? node;
  const typeNode = field(node, ["type"]);
  return {
    name: source.slice(nameNode.startIndex, nameNode.endIndex).replace(/^\*+/, ""),
    type: typeNode ? source.slice(typeNode.startIndex, typeNode.endIndex).replace(/^:\s*/, "") : "",
    description: "",
    signature: source.slice(node.startIndex, node.endIndex)
  };
}

function declaredClassParameters(node: Parser.SyntaxNode, source: string): DocParameter[] {
  const body = node.childForFieldName("body");
  if (!body) return [];
  const parameters: DocParameter[] = [];
  for (const child of body.namedChildren) {
    const declaration = child.type === "expression_statement" ? child.namedChild(0) : child;
    if (!declaration || !["assignment", "public_field_definition", "field_declaration", "property_declaration"].includes(declaration.type)) continue;
    const nameNode = field(declaration, ["name", "left"]);
    const typeNode = field(declaration, ["type"]);
    if (!nameNode || !typeNode) continue;
    parameters.push({
      name: source.slice(nameNode.startIndex, nameNode.endIndex),
      type: source.slice(typeNode.startIndex, typeNode.endIndex).replace(/^:\s*/, ""),
      description: "",
      signature: source.slice(declaration.startIndex, declaration.endIndex)
    });
  }
  return parameters;
}

function documentedParameters(documentation: string, parameters: DocParameter[]): { description: string; parameters: DocParameter[] } {
  const lines = documentation.split(/\r?\n/);
  const details = new Map<string, { type?: string; description: string }>();
  let sectionStart = lines.length;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    let match = /^\s*@param\s+(?:\{([^}]+)\}\s+)?(\S+)\s*-?\s*(.*)$/.exec(line);
    if (match) {
      sectionStart = Math.min(sectionStart, index);
      details.set(match[2].replace(/^\[|\]$/g, "").split("=")[0], { type: match[1], description: match[3].trim() });
      continue;
    }
    match = /^\s*:param\s+(\w+)\s*:\s*(.*)$/.exec(line);
    if (match) {
      sectionStart = Math.min(sectionStart, index);
      details.set(match[1], { ...details.get(match[1]), description: match[2].trim() });
      continue;
    }
    match = /^\s*:type\s+(\w+)\s*:\s*(.*)$/.exec(line);
    if (match) {
      sectionStart = Math.min(sectionStart, index);
      details.set(match[1], { type: match[2].trim(), description: details.get(match[1])?.description ?? "" });
      continue;
    }
    if (/^\s*(?:Args|Arguments|Parameters)\s*:\s*$/.test(line)) {
      sectionStart = Math.min(sectionStart, index);
      for (index++; index < lines.length; index++) {
        const parameter = /^\s+(\*{0,2}[\w$]+)(?:\s*\(([^)]+)\))?\s*:\s*(.*)$/.exec(lines[index]);
        if (!parameter) {
          if (lines[index].trim() && !/^\s+/.test(lines[index])) { index--; break; }
          continue;
        }
        details.set(parameter[1].replace(/^\*+/, ""), { type: parameter[2], description: parameter[3].trim() });
      }
      continue;
    }
    if (/^\s*Parameters\s*$/.test(line) && /^\s*-{3,}\s*$/.test(lines[index + 1] ?? "")) {
      sectionStart = Math.min(sectionStart, index);
      index += 2;
      while (index < lines.length) {
        const parameter = /^\s*([\w$]+)\s*:\s*(.+)$/.exec(lines[index]);
        if (!parameter) { if (lines[index].trim()) { index--; break; } index++; continue; }
        const descriptions: string[] = [];
        while (++index < lines.length && /^\s+\S/.test(lines[index])) descriptions.push(lines[index].trim());
        details.set(parameter[1], { type: parameter[2].trim(), description: descriptions.join(" ") });
      }
    }
  }

  return {
    description: lines.slice(0, sectionStart).join("\n").trim(),
    parameters: parameters.map(parameter => {
      const documented = details.get(parameter.name);
      return documented ? {
        ...parameter,
        type: parameter.type || documented.type || "",
        description: documented.description
      } : parameter;
    })
  };
}

export function extractDocumentation(source: string, language: LanguageDefinition, metadata: Partial<DocumentationModel> = {}): DocumentationModel {
  const parser = new Parser();
  parser.setLanguage(language.grammar);
  // node-tree-sitter 0.21 rejects large strings passed as one input buffer.
  // Supplying bounded chunks keeps parsing reliable for published packages.
  const tree = source.length < 32_000
    ? parser.parse(source)
    : parser.parse(offset => source.slice(offset, offset + 8_192));
  const symbols: DocSymbol[] = [];
  const nameFields = language.nameFields ?? ["name"];
  const parameterFields = language.parameterFields ?? ["parameters"];
  const bodyFields = language.bodyFields ?? ["body"];

  function visit(node: Parser.SyntaxNode, owner?: DocSymbol, insideCallable = false, hidden = false): void {
    const kind = language.nodeKinds[node.type] as SymbolKind | undefined;
    let currentOwner = owner;
    let currentSymbol: DocSymbol | undefined;
    let currentDocumentation = "";
    let hideDescendants = hidden;
    if (kind) {
      const nameNode = field(node, nameFields);
      const paramsNode = field(node, parameterFields);
      const symbolName = nameNode ? source.slice(nameNode.startIndex, nameNode.endIndex) : "anonymous";
      const privatePythonSymbol = language.name === "python" && symbolName.startsWith("_");
      hideDescendants ||= privatePythonSymbol;
      const rawDocumentation = documentation(node, source, language);
      currentDocumentation = rawDocumentation;
      const parsedDocumentation = documentedParameters(
        rawDocumentation,
        paramsNode?.namedChildren.map(child => parameterDetail(child, source)) ?? []
      );
      let symbol: DocSymbol | null = {
        kind,
        name: symbolName,
        anchor: symbolName.toLowerCase(),
        qualifiedName: symbolName,
        module: metadata.sourcePath?.replace(/\.[^.]+$/, "").replace(/[\\/]/g, ".") ?? "",
        visibility: "public",
        signature: signature(node, source, bodyFields),
        description: parsedDocumentation.description,
        parameters: paramsNode?.namedChildren.map(child => source.slice(child.startIndex, child.endIndex)) ?? [],
        parameterDetails: parsedDocumentation.parameters,
        returns: field(node, ["return_type", "returns"]) ? source.slice(
          field(node, ["return_type", "returns"])!.startIndex,
          field(node, ["return_type", "returns"])!.endIndex
        ).replace(/^(?:->|:)\s*/, "") : undefined,
        async: /\basync\b/.test(source.slice(node.startIndex, nameNode?.startIndex ?? node.startIndex)),
        location: { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 },
        language: language.name,
        sourcePath: metadata.sourcePath,
        members: [],
        extends: [],
        implements: []
      };
      if (hidden || privatePythonSymbol) symbol = null;
      else if (language.transformSymbol && symbol) symbol = language.transformSymbol(symbol, node, source);
      if (symbol) {
        if (symbol.kind === "method") {
          symbol.parameterDetails = symbol.parameterDetails.filter(parameter => !["self", "cls"].includes(parameter.name));
          symbol.parameters = symbol.parameterDetails.map(parameter => parameter.signature);
        }
        currentSymbol = symbol;
        if (owner && symbol.kind === "method") owner.members.push(symbol);
        else if (symbol.kind !== "method" && !(symbol.kind === "function" && insideCallable)) symbols.push(symbol);
        if (["class", "interface"].includes(symbol.kind)) currentOwner = symbol;
      }
    }
    const childInsideCallable = insideCallable || kind === "function" || kind === "method";
    for (const child of node.namedChildren) visit(child, currentOwner, childInsideCallable, hideDescendants);
    if (currentSymbol?.kind === "class") {
      const constructors = currentSymbol.members.filter(member => ["constructor", "__init__"].includes(member.name));
      const declared = declaredClassParameters(node, source);
      const constructorParameters = constructors.flatMap(member => member.parameterDetails)
        .filter(parameter => !["self", "cls"].includes(parameter.name));
      currentSymbol.parameterDetails = declared.length ? declared : constructorParameters;
      currentSymbol.parameterDetails = documentedParameters(currentDocumentation, currentSymbol.parameterDetails).parameters;
      currentSymbol.parameters = currentSymbol.parameterDetails.map(parameter => parameter.signature);
      currentSymbol.members = currentSymbol.members.filter(member => !["constructor", "__init__"].includes(member.name));
    }
    if (currentSymbol) {
      currentSymbol.qualifiedName = currentSymbol.module ? `${currentSymbol.module}.${currentSymbol.name}` : currentSymbol.name;
      for (const member of currentSymbol.members) {
        member.module = currentSymbol.module;
        member.qualifiedName = `${currentSymbol.qualifiedName}.${member.name}`;
      }
    }
  }
  visit(tree.rootNode);

  const byKind = (kind: SymbolKind) => symbols.filter(symbol => symbol.kind === kind);
  return {
    title: metadata.title ?? metadata.sourcePath ?? "API Documentation",
    language: language.name,
    sourcePath: metadata.sourcePath,
    description: metadata.description,
    symbols,
    classes: byKind("class"), functions: byKind("function"), interfaces: byKind("interface"),
    types: byKind("type"), enums: byKind("enum"), hasSymbols: symbols.length > 0, modules: []
  };
}
