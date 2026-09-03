import { promises as fs } from "node:fs";
import path from "node:path";
import Mustache from "mustache";
import { extractDocumentation } from "./extract.js";
import {
  getLanguage,
  registerLanguage,
  listLanguages,
  javascript,
  typescript,
  tsx,
  python,
} from "./languages.js";
import {
  classesTemplate,
  classTemplate,
  declarationTemplate,
  defaultTemplate,
  functionsTemplate,
  indexTemplate,
} from "./template.js";
import { prettifyMarkdownTables } from "./markdown.js";
import {
  agentDocumentationProvider,
} from "./agent-docs.js";
import type {
  AgentManifest,
  DocSymbol,
  DocumentationModel,
  DocumentationSourceFile,
  GeneratedPage,
  GenerateDirectoryOptions,
  GenerateFileOptions,
  GenerateOptions,
  LanguageDefinition,
  ProviderGeneratedOutput,
  SymbolKind,
} from "./types.js";

export * from "./types.js";
export {
  agentSymbolTemplate,
  classesTemplate,
  classTemplate,
  declarationTemplate,
  defaultTemplate,
  functionsTemplate,
  indexTemplate,
} from "./template.js";
export {
  extractDocumentation,
  getLanguage,
  registerLanguage,
  listLanguages,
  javascript,
  typescript,
  tsx,
  python,
};
export {
  generateRegistryPackage,
  getRegistryCacheDirectory,
} from "./registry.js";
export { prettifyMarkdownTables } from "./markdown.js";
export {
  agentDocumentationProvider,
  agentDocumentationProviderName,
} from "./agent-docs.js";
export { generateOpenApi, openApiProvider, renderOpenApi } from "./openapi.js";

export function generate(options: GenerateOptions): string {
  const language =
    typeof options.language === "string"
      ? getLanguage(options.language)
      : options.language;
  const model = extractDocumentation(options.source, language, {
    title: options.title,
    sourcePath: options.sourcePath,
    description: options.description,
  });
  return (
    Mustache.render(
      options.template ?? defaultTemplate,
      { ...model, ...options.view },
      options.partials,
    ).trimEnd() + "\n"
  );
}

function render(
  model: DocumentationModel,
  options: Pick<GenerateOptions, "template" | "partials" | "view">,
): string {
  const markdown = Mustache.render(
    options.template ?? defaultTemplate,
    { ...model, ...options.view },
    options.partials,
  );
  return prettifyMarkdownTables(markdown).trimEnd() + "\n";
}

export async function generateFile(
  options: GenerateFileOptions,
): Promise<{
  output: string;
  model: DocumentationModel;
  agentOutputs: string[];
  manifest?: AgentManifest;
}> {
  const source = await fs.readFile(options.input, "utf8");
  const extension = path.extname(options.input);
  const language =
    typeof options.language === "string"
      ? getLanguage(options.language)
      : options.language;
  const model = extractDocumentation(source, language, {
    title: options.title ?? path.basename(options.input),
    sourcePath: options.input,
    description: options.description,
  });
  const output =
    options.output ?? `${options.input.slice(0, -extension.length)}.md`;
  const markdown = render(model, options);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, markdown, "utf8");
  let generatedAgent:
    | { outputs: string[]; manifest: AgentManifest }
    | undefined;
  if (options.agentDocs !== false) {
    const provider = agentDocumentationProvider((result) => {
      generatedAgent = result;
    });
    await provider.generate?.({
      input: options.input,
      output: path.dirname(output),
      files: [],
      modules: [model],
      model,
      pages: [],
      contributions: {},
    });
  }
  const agent = generatedAgent ?? { outputs: [], manifest: undefined };
  return {
    output,
    model,
    agentOutputs: agent.outputs,
    manifest: agent.manifest,
  };
}

const defaultIgnoredDirectories = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  ".hg",
  ".svn",
]);

async function packageMetadata(
  directory: string,
): Promise<{ title?: string; description?: string }> {
  try {
    const contents = await fs.readFile(
      path.join(directory, "package.json"),
      "utf8",
    );
    const manifest = JSON.parse(contents) as {
      name?: unknown;
      description?: unknown;
    };
    return {
      title: typeof manifest.name === "string" ? manifest.name : undefined,
      description:
        typeof manifest.description === "string"
          ? manifest.description
          : undefined,
    };
  } catch {
    return {};
  }
}

export async function generateDirectory(
  options: GenerateDirectoryOptions,
): Promise<{
  output: string;
  outputs: string[];
  pages: GeneratedPage[];
  model: DocumentationModel;
  agentOutputs: string[];
  manifest?: AgentManifest;
  sidebarOutput?: string;
  providerOutputs: string[];
}> {
  const input = path.resolve(options.input);
  const selectedLanguages =
    options.languages?.map((item) =>
      typeof item === "string" ? getLanguage(item) : item,
    ) ?? listLanguages();
  const byExtension = new Map(
    selectedLanguages.flatMap((language) =>
      language.extensions.map(
        (extension) => [extension.toLowerCase(), language] as const,
      ),
    ),
  );
  const ignored = new Set([
    ...defaultIgnoredDirectories,
    ...(options.ignore ?? []),
  ]);
  const files: Array<{ file: string; language: LanguageDefinition }> = [];

  async function walk(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || ignored.has(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (options.recursive !== false) await walk(fullPath);
      } else if (entry.isFile()) {
        const language = byExtension.get(
          path.extname(entry.name).toLowerCase(),
        );
        if (language) files.push({ file: fullPath, language });
      }
    }
  }

  await walk(input);
  files.sort((left, right) => left.file.localeCompare(right.file));
  const modules: DocumentationModel[] = [];
  const sourceFiles: DocumentationSourceFile[] = [];
  for (const item of files) {
    const sourcePath = path.relative(input, item.file).replace(/\\/g, "/");
    const source = await fs.readFile(item.file, "utf8");
    try {
      const module = extractDocumentation(source, item.language, {
        title: sourcePath,
        sourcePath,
      });
      modules.push(module);
      sourceFiles.push({
        path: sourcePath,
        absolutePath: item.file,
        source,
        language: item.language,
        model: module,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to parse ${sourcePath} as ${item.language.name}: ${message}`,
        { cause: error },
      );
    }
  }

  const output = path.resolve(options.output ?? path.join(input, "docs"));
  let generatedAgent:
    | { outputs: string[]; manifest: AgentManifest }
    | undefined;
  const providers = [
    ...(options.providers ?? []),
    ...(options.agentDocs === false
      ? []
      : [
          agentDocumentationProvider((result) => {
            generatedAgent = result;
          }),
        ]),
  ];
  const providerNames = new Set<string>();
  for (const provider of providers) {
    if (!provider.name.trim())
      throw new Error("Documentation providers must have a non-empty name");
    if (providerNames.has(provider.name))
      throw new Error(`Duplicate documentation provider '${provider.name}'`);
    providerNames.add(provider.name);
  }
  const providerData: Record<string, Readonly<Record<string, unknown>>> = {};
  const contributedSymbols: DocSymbol[] = [];
  const analysisContext = { input, output, files: sourceFiles, modules };
  for (const provider of providers) {
    try {
      const contribution = await provider.analyze?.(analysisContext);
      contributedSymbols.push(...(contribution?.symbols ?? []));
      providerData[provider.name] = Object.freeze({
        ...(contribution?.data ?? {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Documentation provider '${provider.name}' failed during analysis: ${message}`,
        { cause: error },
      );
    }
  }

  const manifest = await packageMetadata(input);
  const symbols = [
    ...modules.flatMap((module) => module.symbols),
    ...contributedSymbols,
  ];
  const byKind = (kind: SymbolKind) =>
    symbols.filter((symbol) => symbol.kind === kind);
  const languages = [...new Set(modules.map((module) => module.language))];
  const model: DocumentationModel = {
    title: options.title ?? manifest.title ?? path.basename(input),
    description: options.description ?? manifest.description,
    packageName: options.title ?? manifest.title ?? path.basename(input),
    packageDescription: options.description ?? manifest.description,
    packageDescriptionYaml: JSON.stringify(
      options.description ?? manifest.description ?? "",
    ),
    language: languages.length === 1 ? languages[0] : "multiple",
    sourcePath: input,
    symbols,
    classes: byKind("class"),
    functions: byKind("function"),
    interfaces: byKind("interface"),
    types: byKind("type"),
    enums: byKind("enum"),
    hasSymbols: symbols.length > 0,
    modules,
  };
  const pages: GeneratedPage[] = [];
  const usedPaths = new Set<string>();
  // Control characters are invalid in filenames on supported platforms.
  /* eslint-disable no-control-regex */
  const safeName = (name: string) =>
    name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/\s+/g, "-") ||
    "anonymous";
  /* eslint-enable no-control-regex */

  if (options.builtInPages !== false) {
    for (const module of modules) {
      const pythonDirectory = module.sourcePath
        ? path.posix.dirname(module.sourcePath)
        : "";
      const modulePath =
        module.language === "python" && pythonDirectory !== "."
          ? pythonDirectory
          : "";
      for (const symbol of [
        ...module.classes,
        ...module.interfaces,
        ...module.enums,
        ...module.types,
      ]) {
        const base = path.join(
          output,
          modulePath,
          `${safeName(symbol.name)}.md`,
        );
        let pageOutput = base;
        let suffix = 2;
        while (usedPaths.has(pageOutput.toLowerCase())) {
          pageOutput = base.replace(/\.md$/, `-${suffix++}.md`);
        }
        usedPaths.add(pageOutput.toLowerCase());
        const pageModel: DocumentationModel = {
          title: symbol.name,
          symbolTypeLabel: (
            {
              class: "Class",
              interface: "Interface",
              enum: "Enumeration",
              type: "Type Alias",
            } as Partial<
              Record<
                SymbolKind,
                NonNullable<DocumentationModel["symbolTypeLabel"]>
              >
            >
          )[symbol.kind],
          frontmatterTitleYaml: JSON.stringify(
            `${symbol.name}${model.packageName ? ` | ${model.packageName} Documentation` : ""}`,
          ),
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
          hasSymbols: true,
          modules: [module],
        };
        await fs.mkdir(path.dirname(pageOutput), { recursive: true });
        const builtInTemplate = ["class", "interface"].includes(symbol.kind)
          ? classTemplate
          : declarationTemplate;
        await fs.writeFile(
          pageOutput,
          render(pageModel, {
            ...options,
            template: options.template ?? builtInTemplate,
          }),
          "utf8",
        );
        pages.push({
          output: pageOutput,
          symbol,
          symbols: [symbol],
          model: pageModel,
        });
      }
    }

    const classPages = pages.filter((page) => page.symbol?.kind === "class");
    const classesOutput = path.join(output, "classes.md");
    const classLinks = classPages.map((page) => ({
      name: page.symbol!.name,
      href: path
        .relative(output, page.output)
        .replace(/\\/g, "/")
        .split("/")
        .map(encodeURIComponent)
        .join("/"),
    }));
    const classesModel: DocumentationModel = {
      title: "Classes",
      frontmatterTitleYaml: JSON.stringify(
        `Classes${model.packageName ? ` | ${model.packageName} Documentation` : ""}`,
      ),
      description: undefined,
      language: model.language,
      sourcePath: undefined,
      packageName: model.packageName,
      packageDescription: model.packageDescription,
      packageDescriptionYaml: model.packageDescriptionYaml,
      symbols: classPages.map((page) => page.symbol!),
      classes: classPages.map((page) => page.symbol!),
      functions: [],
      interfaces: [],
      types: [],
      enums: [],
      hasSymbols: classPages.length > 0,
      modules: model.modules,
      classLinks,
    };
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(
      classesOutput,
      render(classesModel, {
        ...options,
        template: options.template ?? classesTemplate,
      }),
      "utf8",
    );
    pages.push({
      output: classesOutput,
      symbols: classesModel.classes,
      model: classesModel,
    });

    async function createSymbolIndex(
      kind: "interface" | "enum",
      title: "Interfaces" | "Enums",
      filename: string,
    ): Promise<void> {
      const symbolPages = pages.filter((page) => page.symbol?.kind === kind);
      const symbols = symbolPages.map((page) => page.symbol!);
      const indexLinks = symbolPages.map((page) => ({
        name: page.symbol!.name,
        href: path
          .relative(output, page.output)
          .replace(/\\/g, "/")
          .split("/")
          .map(encodeURIComponent)
          .join("/"),
      }));
      const indexModel: DocumentationModel = {
        title,
        frontmatterTitleYaml: JSON.stringify(
          `${title}${model.packageName ? ` | ${model.packageName} Documentation` : ""}`,
        ),
        description: undefined,
        language: model.language,
        sourcePath: undefined,
        packageName: model.packageName,
        packageDescription: model.packageDescription,
        packageDescriptionYaml: model.packageDescriptionYaml,
        symbols,
        classes: [],
        functions: [],
        interfaces: kind === "interface" ? symbols : [],
        types: [],
        enums: kind === "enum" ? symbols : [],
        hasSymbols: symbols.length > 0,
        modules: model.modules,
        indexLinks,
      };
      const indexOutput = path.join(output, filename);
      await fs.writeFile(
        indexOutput,
        render(indexModel, {
          ...options,
          template: options.template ?? indexTemplate,
          view: { titleLower: title.toLowerCase(), ...options.view },
        }),
        "utf8",
      );
      pages.push({ output: indexOutput, symbols, model: indexModel });
    }

    await createSymbolIndex("interface", "Interfaces", "interfaces.md");
    await createSymbolIndex("enum", "Enums", "enums.md");

    const functions = modules.flatMap((module) => module.functions);
    if (functions.length) {
      const pageOutput = path.join(output, "functions.md");
      const functionLanguages = [
        ...new Set(functions.map((symbol) => symbol.language)),
      ];
      const pageModel: DocumentationModel = {
        title: "Functions",
        frontmatterTitleYaml: JSON.stringify(
          `Functions${model.packageName ? ` | ${model.packageName} Documentation` : ""}`,
        ),
        description: undefined,
        language:
          functionLanguages.length === 1 ? functionLanguages[0] : "multiple",
        sourcePath: undefined,
        packageName: model.packageName,
        packageDescription: model.packageDescription,
        packageDescriptionYaml: model.packageDescriptionYaml,
        symbols: functions,
        classes: [],
        functions,
        interfaces: [],
        types: [],
        enums: [],
        hasSymbols: true,
        modules: modules.filter((module) => module.functions.length > 0),
      };
      await fs.mkdir(output, { recursive: true });
      await fs.writeFile(
        pageOutput,
        render(pageModel, {
          ...options,
          template: options.template ?? functionsTemplate,
        }),
        "utf8",
      );
      pages.push({ output: pageOutput, symbols: functions, model: pageModel });
    }
  }
  const providerOutputs: string[] = [];
  const providerSidebarOutputs: Array<{
    output: string;
    sidebar: NonNullable<ProviderGeneratedOutput["sidebar"]>;
  }> = [];
  const writeProviderOutput = async (
    providerName: string,
    generated: ProviderGeneratedOutput,
  ): Promise<void> => {
    if (!generated.path || path.isAbsolute(generated.path)) {
      throw new Error(
        `Documentation provider '${providerName}' returned an invalid output path '${generated.path}'`,
      );
    }
    const destination = path.resolve(output, generated.path);
    const relative = path.relative(output, destination);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(
        `Documentation provider '${providerName}' returned an output path outside the output directory: '${generated.path}'`,
      );
    }
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const contents = generated.path.toLowerCase().endsWith(".md")
      ? `${prettifyMarkdownTables(generated.contents).trimEnd()}\n`
      : generated.contents;
    await fs.writeFile(destination, contents, "utf8");
    providerOutputs.push(destination);
    if (generated.sidebar) {
      providerSidebarOutputs.push({
        output: destination,
        sidebar: generated.sidebar,
      });
    }
  };
  for (const provider of providers) {
    try {
      const generated = await provider.generate?.({
        ...analysisContext,
        model,
        pages,
        contributions: providerData,
      });
      for (const item of generated ?? [])
        await writeProviderOutput(provider.name, item);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith(`Documentation provider '${provider.name}'`)
      )
        throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Documentation provider '${provider.name}' failed during generation: ${message}`,
        { cause: error },
      );
    }
  }
  const agent = generatedAgent ?? { outputs: [], manifest: undefined };
  let sidebarOutput: string | undefined;
  if (options.vitepress?.sidebar) {
    sidebarOutput =
      typeof options.vitepress.sidebar === "string"
        ? options.vitepress.sidebar
        : path.join(output, "sidebar.json");
    let sidebar: unknown[] = [];
    try {
      const existingSidebar = JSON.parse(
        await fs.readFile(sidebarOutput, "utf8"),
      ) as unknown;
      if (!Array.isArray(existingSidebar)) {
        throw new Error("the existing file must contain a JSON array");
      }
      sidebar = existingSidebar;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not update ${sidebarOutput}: ${message}`, {
          cause: error,
        });
      }
    }
    const sidebarItem = (page: GeneratedPage, text = page.model.title) => ({
      text,
      link: `${path
        .relative(output, page.output)
        .replace(/\\/g, "/")
        .replace(/\.md$/, "")
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
    });
    const providerSidebarItem = (
      item: (typeof providerSidebarOutputs)[number],
    ) => ({
      text: item.sidebar.text,
      link: path
        .relative(output, item.output)
        .replace(/\\/g, "/")
        .replace(/\.md$/, "")
        .split("/")
        .map(encodeURIComponent)
        .join("/"),
    });
    const category = (
      text: string,
      kind: SymbolKind,
      overviewFilename?: string,
    ) => {
      const items = pages
        .filter((page) => page.symbol?.kind === kind)
        .map((page) => sidebarItem(page));
      if (overviewFilename) {
        const overview = pages.find(
          (page) => path.basename(page.output) === overviewFilename,
        );
        if (overview) items.unshift(sidebarItem(overview, "Overview"));
      }
      return items.length > 1 ? { text, items, collapsed: true } : undefined;
    };
    const apiReferenceTitle = options.vitepress?.title ?? "API Reference";
    const apiReferenceItems: any[] = [
      category("Classes", "class", "classes.md"),
      category("Interfaces", "interface", "interfaces.md"),
      category("Enums", "enum", "enums.md"),
      category("Type Aliases", "type"),
      category("Functions", "function", "functions.md"),
    ].filter((item) => item !== undefined);
    apiReferenceItems.push(
      ...providerSidebarOutputs
        .filter((item) => item.sidebar.group === apiReferenceTitle)
        .map(providerSidebarItem),
    );

    const apiReference: any = {
      text: apiReferenceTitle,
      collapsed: false,
      items: apiReferenceItems,
    };

    if (options.vitepress?.base) {
      apiReference.base = options.vitepress.base;
    } else {
      const base = path.relative(path.dirname(sidebarOutput), output);
      if (base) apiReference.base = `/${base}/`;
    }
    const apiReferenceIndex = sidebar.findIndex((item) => {
      if (typeof item !== "object" || item === null || !("text" in item))
        return false;
      return item.text === apiReferenceTitle;
    });
    if (apiReferenceItems.length === 0) {
      if (apiReferenceIndex !== -1) sidebar.splice(apiReferenceIndex, 1);
    } else if (apiReferenceIndex === -1) sidebar.push(apiReference);
    else sidebar[apiReferenceIndex] = apiReference;

    const providerGroups = new Map<
      string,
      ReturnType<typeof providerSidebarItem>[]
    >();
    for (const item of providerSidebarOutputs) {
      if (!item.sidebar.group || item.sidebar.group === apiReferenceTitle)
        continue;
      const group = providerGroups.get(item.sidebar.group) ?? [];
      group.push(providerSidebarItem(item));
      providerGroups.set(item.sidebar.group, group);
    }
    for (const [text, items] of providerGroups) {
      const group = { text, collapsed: true, items };
      if (apiReference.base) Object.assign(group, { base: apiReference.base });
      const index = sidebar.findIndex(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          "text" in item &&
          item.text === text,
      );
      if (index === -1) sidebar.push(group);
      else sidebar[index] = group;
    }
    for (const item of providerSidebarOutputs.filter(
      (entry) => !entry.sidebar.group,
    )) {
      const entry = providerSidebarItem(item);
      entry.link = path
        .relative(path.dirname(sidebarOutput), item.output)
        .replace(/\\/g, "/")
        .replace(/\.md$/, "")
        .split("/")
        .map(encodeURIComponent)
        .join("/");
      const index = sidebar.findIndex(
        (existing) =>
          typeof existing === "object" &&
          existing !== null &&
          "text" in existing &&
          existing.text === entry.text,
      );
      if (index === -1) sidebar.push(entry);
      else sidebar[index] = entry;
    }
    await fs.writeFile(
      sidebarOutput,
      `${JSON.stringify(sidebar, null, 2)}\n`,
      "utf8",
    );
  }
  return {
    output,
    outputs: pages.map((page) => page.output),
    pages,
    model,
    agentOutputs: agent.outputs,
    manifest: agent.manifest,
    sidebarOutput,
    providerOutputs,
  };
}
