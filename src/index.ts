import { promises as fs } from "node:fs";
import path from "node:path";
import Mustache from "mustache";
import { extractDocumentation } from "./extract.js";
import { getLanguage, registerLanguage, listLanguages, javascript, typescript, tsx, python } from "./languages.js";
import { classesTemplate, classTemplate, declarationTemplate, defaultTemplate, functionsTemplate, indexTemplate } from "./template.js";
import { prettifyMarkdownTables } from "./markdown.js";
import { generateAgentDocumentation } from "./agent-docs.js";
import type { AgentManifest, DocumentationModel, GeneratedPage, GenerateDirectoryOptions, GenerateFileOptions, GenerateOptions, LanguageDefinition, SymbolKind } from "./types.js";

export * from "./types.js";
export { agentSymbolTemplate, classesTemplate, classTemplate, declarationTemplate, defaultTemplate, functionsTemplate, indexTemplate } from "./template.js";
export { extractDocumentation, getLanguage, registerLanguage, listLanguages, javascript, typescript, tsx, python };
export { generateRegistryPackage, getRegistryCacheDirectory } from "./registry.js";
export { prettifyMarkdownTables } from "./markdown.js";

export function generate(options: GenerateOptions): string {
  const language = typeof options.language === "string" ? getLanguage(options.language) : options.language;
  const model = extractDocumentation(options.source, language, {
    title: options.title, sourcePath: options.sourcePath, description: options.description
  });
  return Mustache.render(options.template ?? defaultTemplate, { ...model, ...options.view }, options.partials).trimEnd() + "\n";
}

function render(model: DocumentationModel, options: Pick<GenerateOptions, "template" | "partials" | "view">): string {
  const markdown = Mustache.render(options.template ?? defaultTemplate, { ...model, ...options.view }, options.partials);
  return prettifyMarkdownTables(markdown).trimEnd() + "\n";
}

export async function generateFile(options: GenerateFileOptions): Promise<{ output: string; model: DocumentationModel }> {
  const source = await fs.readFile(options.input, "utf8");
  const extension = path.extname(options.input);
  const language = typeof options.language === "string" ? getLanguage(options.language) : options.language;
  const model = extractDocumentation(source, language, {
    title: options.title ?? path.basename(options.input), sourcePath: options.input, description: options.description
  });
  const output = options.output ?? `${options.input.slice(0, -extension.length)}.md`;
  const markdown = render(model, options);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, markdown, "utf8");
  return { output, model };
}


const defaultIgnoredDirectories = new Set(["node_modules", "dist", "build", "coverage", ".git", ".hg", ".svn"]);

async function packageMetadata(directory: string): Promise<{ title?: string; description?: string }> {
  try {
    const contents = await fs.readFile(path.join(directory, "package.json"), "utf8");
    const manifest = JSON.parse(contents) as { name?: unknown; description?: unknown };
    return {
      title: typeof manifest.name === "string" ? manifest.name : undefined,
      description: typeof manifest.description === "string" ? manifest.description : undefined
    };
  } catch {
    return {};
  }
}

export async function generateDirectory(options: GenerateDirectoryOptions): Promise<{
  output: string;
  outputs: string[];
  pages: GeneratedPage[];
  model: DocumentationModel;
  agentOutputs: string[];
  manifest?: AgentManifest;
}> {
  const input = path.resolve(options.input);
  const selectedLanguages = options.languages?.map(item => typeof item === "string" ? getLanguage(item) : item) ?? listLanguages();
  const byExtension = new Map(selectedLanguages.flatMap(language => language.extensions.map(extension => [extension.toLowerCase(), language] as const)));
  const ignored = new Set([...defaultIgnoredDirectories, ...(options.ignore ?? [])]);
  const files: Array<{ file: string; language: LanguageDefinition }> = [];

  async function walk(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || ignored.has(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (options.recursive !== false) await walk(fullPath);
      } else if (entry.isFile()) {
        const language = byExtension.get(path.extname(entry.name).toLowerCase());
        if (language) files.push({ file: fullPath, language });
      }
    }
  }

  await walk(input);
  files.sort((left, right) => left.file.localeCompare(right.file));
  const modules: DocumentationModel[] = [];
  for (const item of files) {
    const sourcePath = path.relative(input, item.file).replace(/\\/g, "/");
    const source = await fs.readFile(item.file, "utf8");
    try {
      modules.push(extractDocumentation(source, item.language, { title: sourcePath, sourcePath }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse ${sourcePath} as ${item.language.name}: ${message}`, { cause: error });
    }
  }

  const manifest = await packageMetadata(input);
  const symbols = modules.flatMap(module => module.symbols);
  const byKind = (kind: SymbolKind) => symbols.filter(symbol => symbol.kind === kind);
  const languages = [...new Set(modules.map(module => module.language))];
  const model: DocumentationModel = {
    title: options.title ?? manifest.title ?? path.basename(input),
    description: options.description ?? manifest.description,
    packageName: options.title ?? manifest.title ?? path.basename(input),
    packageDescription: options.description ?? manifest.description,
    packageDescriptionYaml: JSON.stringify(options.description ?? manifest.description ?? ""),
    language: languages.length === 1 ? languages[0] : "multiple",
    sourcePath: input,
    symbols,
    classes: byKind("class"), functions: byKind("function"), interfaces: byKind("interface"),
    types: byKind("type"), enums: byKind("enum"), hasSymbols: symbols.length > 0, modules
  };
  const output = path.resolve(options.output ?? path.join(input, "docs"));
  const pages: GeneratedPage[] = [];
  const usedPaths = new Set<string>();
  // Control characters are invalid in filenames on supported platforms.
  // eslint-disable-next-line no-control-regex
  const safeName = (name: string) => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/\s+/g, "-") || "anonymous";

  for (const module of modules) {
    const pythonDirectory = module.sourcePath ? path.posix.dirname(module.sourcePath) : "";
    const modulePath = module.language === "python" && pythonDirectory !== "." ? pythonDirectory : "";
    for (const symbol of [...module.classes, ...module.interfaces, ...module.enums, ...module.types]) {
      const base = path.join(output, modulePath, `${safeName(symbol.name)}.md`);
      let pageOutput = base;
      let suffix = 2;
      while (usedPaths.has(pageOutput.toLowerCase())) {
        pageOutput = base.replace(/\.md$/, `-${suffix++}.md`);
      }
      usedPaths.add(pageOutput.toLowerCase());
      const pageModel: DocumentationModel = {
        title: symbol.name,
        symbolTypeLabel: ({
          class: "Class",
          interface: "Interface",
          enum: "Enumeration",
          type: "Type Alias"
        } as Partial<Record<SymbolKind, NonNullable<DocumentationModel["symbolTypeLabel"]>>>)[symbol.kind],
        frontmatterTitleYaml: JSON.stringify(`${symbol.name}${model.packageName ? ` | ${model.packageName} Documentation` : ""}`),
        description: undefined,
        language: symbol.language,
        sourcePath: symbol.sourcePath,
        packageName: model.packageName,
        packageDescription: model.packageDescription,
        packageDescriptionYaml: model.packageDescriptionYaml,
        symbols: [symbol],
        classes: symbol.kind === "class" ? [symbol] : [],
        functions: symbol.kind === "function" ? [symbol] : [],
        interfaces: symbol.kind === "interface" ? [symbol] : [],
        types: symbol.kind === "type" ? [symbol] : [],
        enums: symbol.kind === "enum" ? [symbol] : [],
        hasSymbols: true, modules: [module]
      };
      await fs.mkdir(path.dirname(pageOutput), { recursive: true });
      const builtInTemplate = ["class", "interface"].includes(symbol.kind) ? classTemplate : declarationTemplate;
      await fs.writeFile(pageOutput, render(pageModel, { ...options, template: options.template ?? builtInTemplate }), "utf8");
      pages.push({ output: pageOutput, symbol, symbols: [symbol], model: pageModel });
    }
  }

  const classPages = pages.filter(page => page.symbol?.kind === "class");
  const classesOutput = path.join(output, "classes.md");
  const classLinks = classPages.map(page => ({
    name: page.symbol!.name,
    href: path.relative(output, page.output).replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/")
  }));
  const classesModel: DocumentationModel = {
    title: "Classes",
    frontmatterTitleYaml: JSON.stringify(`Classes${model.packageName ? ` | ${model.packageName} Documentation` : ""}`),
    description: undefined,
    language: model.language,
    sourcePath: undefined,
    packageName: model.packageName,
    packageDescription: model.packageDescription,
    packageDescriptionYaml: model.packageDescriptionYaml,
    symbols: classPages.map(page => page.symbol!),
    classes: classPages.map(page => page.symbol!),
    functions: [], interfaces: [], types: [], enums: [],
    hasSymbols: classPages.length > 0,
    modules: model.modules,
    classLinks
  };
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(classesOutput, render(classesModel, { ...options, template: options.template ?? classesTemplate }), "utf8");
  pages.push({ output: classesOutput, symbols: classesModel.classes, model: classesModel });

  async function createSymbolIndex(kind: "interface" | "enum", title: "Interfaces" | "Enums", filename: string): Promise<void> {
    const symbolPages = pages.filter(page => page.symbol?.kind === kind);
    const symbols = symbolPages.map(page => page.symbol!);
    const indexLinks = symbolPages.map(page => ({
      name: page.symbol!.name,
      href: path.relative(output, page.output).replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/")
    }));
    const indexModel: DocumentationModel = {
      title,
      frontmatterTitleYaml: JSON.stringify(`${title}${model.packageName ? ` | ${model.packageName} Documentation` : ""}`),
      description: undefined,
      language: model.language,
      sourcePath: undefined,
      packageName: model.packageName,
      packageDescription: model.packageDescription,
      packageDescriptionYaml: model.packageDescriptionYaml,
      symbols,
      classes: [], functions: [],
      interfaces: kind === "interface" ? symbols : [],
      types: [], enums: kind === "enum" ? symbols : [],
      hasSymbols: symbols.length > 0,
      modules: model.modules,
      indexLinks
    };
    const indexOutput = path.join(output, filename);
    await fs.writeFile(indexOutput, render(indexModel, {
      ...options,
      template: options.template ?? indexTemplate,
      view: { titleLower: title.toLowerCase(), ...options.view }
    }), "utf8");
    pages.push({ output: indexOutput, symbols, model: indexModel });
  }

  await createSymbolIndex("interface", "Interfaces", "interfaces.md");
  await createSymbolIndex("enum", "Enums", "enums.md");

  const functions = modules.flatMap(module => module.functions);
  if (functions.length) {
    const pageOutput = path.join(output, "functions.md");
    const functionLanguages = [...new Set(functions.map(symbol => symbol.language))];
    const pageModel: DocumentationModel = {
      title: "Functions",
      frontmatterTitleYaml: JSON.stringify(`Functions${model.packageName ? ` | ${model.packageName} Documentation` : ""}`),
      description: undefined,
      language: functionLanguages.length === 1 ? functionLanguages[0] : "multiple",
      sourcePath: undefined,
      packageName: model.packageName,
      packageDescription: model.packageDescription,
      packageDescriptionYaml: model.packageDescriptionYaml,
      symbols: functions,
      classes: [], functions, interfaces: [], types: [], enums: [], hasSymbols: true,
      modules: modules.filter(module => module.functions.length > 0)
    };
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(pageOutput, render(pageModel, { ...options, template: options.template ?? functionsTemplate }), "utf8");
    pages.push({ output: pageOutput, symbols: functions, model: pageModel });
  }
  const agent = options.agentDocs === false
    ? { outputs: [], manifest: undefined }
    : await generateAgentDocumentation(output, model);
  return { output, outputs: pages.map(page => page.output), pages, model, agentOutputs: agent.outputs, manifest: agent.manifest };
}
