import { promises as fs } from "node:fs";
import path from "node:path";
import Mustache from "mustache";
import { agentSymbolTemplate } from "./template.js";
import type { AgentManifest, AgentSymbolRecord, DocSymbol, DocumentationModel, SymbolKind } from "./types.js";

const typeLabels: Record<SymbolKind, string> = {
  class: "Class",
  function: "Function",
  method: "Method",
  interface: "Interface",
  enum: "Enumeration",
  type: "Type Alias"
};

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "anonymous";
}

function symbolDirectory(kind: SymbolKind): string {
  return kind === "class" ? "classes" : kind === "interface" ? "interfaces" : kind === "enum" ? "enums" : kind === "type" ? "types" : "functions";
}

function record(symbol: DocSymbol, documentationPath: string): AgentSymbolRecord {
  return {
    name: symbol.name,
    qualifiedName: symbol.qualifiedName,
    kind: symbol.kind,
    language: symbol.language,
    module: symbol.module,
    sourcePath: symbol.sourcePath,
    signature: symbol.signature,
    description: symbol.description,
    parameters: symbol.parameterDetails,
    returns: symbol.returns,
    extends: symbol.extends,
    implements: symbol.implements,
    members: symbol.members.map(member => record(member, `${documentationPath}#${member.anchor}`)),
    documentationPath
  };
}

export async function generateAgentDocumentation(output: string, model: DocumentationModel): Promise<{ outputs: string[]; manifest: AgentManifest }> {
  const symbols = model.symbols.filter(symbol => ["class", "function", "interface", "enum", "type"].includes(symbol.kind));
  const records: AgentSymbolRecord[] = [];
  const renderedPages: Array<{ path: string; contents: string; symbol: DocSymbol }> = [];

  for (const symbol of symbols) {
    const relativePath = path.posix.join("symbols", symbolDirectory(symbol.kind), `${safeName(symbol.qualifiedName)}.md`);
    const contents = Mustache.render(agentSymbolTemplate, {
      ...symbol,
      symbolTypeLabel: typeLabels[symbol.kind],
      nameYaml: JSON.stringify(symbol.name),
      qualifiedNameYaml: JSON.stringify(symbol.qualifiedName),
      kindYaml: JSON.stringify(symbol.kind),
      languageYaml: JSON.stringify(symbol.language),
      moduleYaml: JSON.stringify(symbol.module),
      sourcePathYaml: JSON.stringify(symbol.sourcePath ?? "")
    }).trimEnd() + "\n";
    const destination = path.join(output, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, contents, "utf8");
    renderedPages.push({ path: relativePath, contents, symbol });
    records.push(record(symbol, relativePath));
  }

  const packageName = model.packageName ?? model.title;
  const summary = model.packageDescription ?? model.description ?? "Generated API documentation.";
  const llms = [
    `# ${packageName}`,
    "",
    `> ${summary}`,
    "",
    "## Indexes",
    "",
    "- [Classes](classes.md)",
    "- [Interfaces](interfaces.md)",
    "- [Enums](enums.md)",
    ...(model.functions.length ? ["- [Functions](functions.md)"] : []),
    "",
    "## Symbols",
    "",
    ...renderedPages.map(page => `- [${page.symbol.qualifiedName}](${page.path})${page.symbol.description ? `: ${page.symbol.description.split("\n")[0]}` : ""}`),
    ""
  ].join("\n");
  const full = [
    `# ${packageName} — Complete API Documentation`,
    "",
    `> ${summary}`,
    "",
    ...renderedPages.flatMap(page => [
      `<!-- BEGIN FILE: ${page.path} -->`,
      "",
      page.contents.trimEnd(),
      "",
      `<!-- END FILE: ${page.path} -->`,
      ""
    ])
  ].join("\n");
  const manifest: AgentManifest = { schemaVersion: 1, package: packageName, description: model.packageDescription, symbols: records };
  const files = [
    ["llms.txt", llms],
    ["llms-full.txt", full],
    ["manifest.json", `${JSON.stringify(manifest, null, 2)}\n`]
  ] as const;
  for (const [filename, contents] of files) await fs.writeFile(path.join(output, filename), contents, "utf8");
  return {
    outputs: [...renderedPages.map(page => path.join(output, ...page.path.split("/"))), ...files.map(([filename]) => path.join(output, filename))],
    manifest
  };
}
