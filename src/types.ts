import type Parser from "tree-sitter";

/** Identifies the supported kinds of source-code symbols. */
export type SymbolKind =
  | "class"
  | "function"
  | "method"
  | "interface"
  | "type"
  | "enum";

/** Identifies the inclusive source-line range occupied by a documented symbol. */
export interface SourceLocation {
  startLine: number;
  endLine: number;
}

/** Describes a parameter parsed from a callable declaration and its documentation. */
export interface DocParameter {
  name: string;
  type: string;
  description: string;
  signature: string;
}

/** Represents a public source-code symbol in the normalized documentation model. */
export interface DocSymbol {
  kind: SymbolKind;
  name: string;
  anchor: string;
  qualifiedName: string;
  module: string;
  visibility: "public";
  signature: string;
  description: string;
  parameters: string[];
  parameterDetails: DocParameter[];
  returns?: string;
  async: boolean;
  location: SourceLocation;
  language: string;
  sourcePath?: string;
  members: DocSymbol[];
  extends: string[];
  implements: string[];
}

/** Contains the symbols and metadata used to render documentation for a source unit. */
export interface DocumentationModel {
  title: string;
  language: string;
  sourcePath?: string;
  description?: string;
  symbols: DocSymbol[];
  classes: DocSymbol[];
  functions: DocSymbol[];
  interfaces: DocSymbol[];
  types: DocSymbol[];
  enums: DocSymbol[];
  hasSymbols: boolean;
  modules: DocumentationModel[];
  packageName?: string;
  packageDescription?: string;
  /** Package description encoded as a YAML-compatible double-quoted scalar. */
  packageDescriptionYaml?: string;
  /** Page title encoded as a YAML-compatible double-quoted scalar. */
  frontmatterTitleYaml?: string;
  symbolTypeLabel?: "Class" | "Interface" | "Enumeration" | "Type Alias";
  classLinks?: Array<{ name: string; href: string }>;
  indexLinks?: Array<{ name: string; href: string }>;
}

/** Configures Tree-sitter parsing and symbol extraction for a source language. */
export interface LanguageDefinition {
  name: string;
  extensions: string[];
  grammar: any;
  nodeKinds: Partial<Record<string, SymbolKind>>;
  nameFields?: string[];
  parameterFields?: string[];
  bodyFields?: string[];
  /** Extract a documentation comment. Return undefined to use the default preceding-comment logic. */
  getDocumentation?: (
    node: Parser.SyntaxNode,
    source: string,
  ) => string | undefined;
  /** Customize extraction for grammar-specific constructs. */
  transformSymbol?: (
    symbol: DocSymbol,
    node: Parser.SyntaxNode,
    source: string,
  ) => DocSymbol | null;
}

/** Options for generating Markdown documentation from source text. */
export interface GenerateOptions {
  source: string;
  language: string | LanguageDefinition;
  template?: string;
  partials?: Record<string, string>;
  title?: string;
  sourcePath?: string;
  description?: string;
  view?: Record<string, unknown>;
}

/** Options for generating documentation from a single source file. */
export interface GenerateFileOptions extends Omit<GenerateOptions, "source"> {
  input: string;
  output?: string;
  /** Generate llms.txt, llms-full.txt, manifest.json, and per-symbol agent pages. Defaults to true. */
  agentDocs?: boolean;
}

/** Options for generating Markdown from an OpenAPI document hosted over HTTP(S). */
export interface GenerateOpenApiOptions {
  /** URL of an OpenAPI 3.x JSON document. */
  input: string;
  /** Directory where `index.md` and per-tag Markdown files are written. Defaults to `docs/<hostname>-openapi`. */
  output?: string;
  /** Override the title declared by the OpenAPI document. */
  title?: string;
  /** Additional request headers, for example an Authorization header. */
  headers?: Record<string, string>;
  /** Generate or update a VitePress sidebar with the OpenAPI index and tags. */
  vitepress?: GenerateVitepressOptions;
  /** Mustache template used for each tag page. */
  template?: string;
  /** Mustache template used for the OpenAPI index page. */
  indexTemplate?: string;
  partials?: Record<string, string>;
  view?: Record<string, unknown>;
  /** Generate llms.txt, llms-full.txt, and manifest.json. Defaults to true. */
  agentDocs?: boolean;
}

/** Options for adding remote OpenAPI documentation to directory generation. */
export interface OpenApiProviderOptions {
  /** URL of an OpenAPI 3.x JSON document. */
  input: string;
  /** Relative directory for generated pages. Defaults to `openapi`. */
  output?: string;
  /** Override the title declared by the OpenAPI document. */
  title?: string;
  /** Additional request headers, for example an Authorization header. */
  headers?: Record<string, string>;
  /** Mustache template used for each tag page. */
  template?: string;
  /** Mustache template used for the OpenAPI index page. */
  indexTemplate?: string;
  partials?: Record<string, string>;
  view?: Record<string, unknown>;
  /** Generate llms.txt, llms-full.txt, and manifest.json. Defaults to true. */
  agentDocs?: boolean;
}

/** Options for adding generated documentation to a VitePress sidebar. */
export interface GenerateVitepressOptions {
  /**
   * The title for the VitePress sidebar configuration. Defaults to "API Reference".
   */
  title?: string;
  /**
   * The base path for links in the VitePress sidebar configuration.
   */
  base?: string;
  /** Generate a VitePress sidebar configuration at `<output>/sidebar.json`. */
  sidebar?: string | boolean;
}

/** Options for generating documentation for all supported files in a directory. */
export interface GenerateDirectoryOptions {
  input: string;
  /** Directory where per-symbol Markdown files are written. Defaults to `<input>/docs`. */
  output?: string;
  languages?: Array<string | LanguageDefinition>;
  template?: string;
  partials?: Record<string, string>;
  title?: string;
  description?: string;
  view?: Record<string, unknown>;
  recursive?: boolean;
  ignore?: string[];
  /** Generate llms.txt, llms-full.txt, manifest.json, and per-symbol agent pages. Defaults to true. */
  agentDocs?: boolean;
  /** Generate the built-in Markdown API pages. Defaults to true. */
  builtInPages?: boolean;
  /** Package- or framework-specific analysis and output providers. */
  providers?: DocumentationProvider[];
  /**
   * VitePress generation options.
   */
  vitepress?: GenerateVitepressOptions;
}

/** Describes a rendered documentation page and the model used to produce it. */
export interface GeneratedPage {
  output: string;
  /** Present for single-symbol pages such as classes. */
  symbol?: DocSymbol;
  symbols: DocSymbol[];
  model: DocumentationModel;
}

/** A source file discovered during directory generation. */
export interface DocumentationSourceFile {
  path: string;
  absolutePath: string;
  source: string;
  language: LanguageDefinition;
  model: DocumentationModel;
}

/** Additional information returned by a documentation provider's analysis pass. */
export interface DocumentationContribution {
  /** Standard API symbols to merge into the generated documentation model. */
  symbols?: DocSymbol[];
  /** Provider-specific data made available to all providers during generation. */
  data?: Record<string, unknown>;
}

/** Read-only source information supplied to a provider during analysis. */
export interface ProviderAnalysisContext {
  input: string;
  output: string;
  files: readonly DocumentationSourceFile[];
  modules: readonly DocumentationModel[];
}

/** A text file generated by a provider, relative to the documentation output directory. */
export interface ProviderGeneratedOutput {
  path: string;
  contents: string;
  /** Include this output in a generated VitePress sidebar. */
  sidebar?: {
    text: string;
    /** Sidebar group name. Omit to add a top-level link. */
    group?: string;
  };
}

/** Documentation state supplied to a provider when generating additional files. */
export interface ProviderGenerationContext extends ProviderAnalysisContext {
  model: DocumentationModel;
  pages: readonly GeneratedPage[];
  /** Analysis data keyed by provider name. */
  contributions: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/** Extends directory generation with package- or framework-specific documentation. */
export interface DocumentationProvider {
  name: string;
  /** Analyze discovered sources and return symbols or provider-specific data. */
  analyze?: (
    context: ProviderAnalysisContext,
  ) =>
    | DocumentationContribution
    | void
    | Promise<DocumentationContribution | void>;
  /** Generate additional documentation files from the completed model. */
  generate?: (
    context: ProviderGenerationContext,
  ) =>
    | ProviderGeneratedOutput[]
    | void
    | Promise<ProviderGeneratedOutput[] | void>;
}

/** Serializable symbol metadata written to the agent documentation manifest. */
export interface AgentSymbolRecord {
  name: string;
  qualifiedName: string;
  kind: SymbolKind;
  language: string;
  module: string;
  sourcePath?: string;
  signature: string;
  description: string;
  parameters: DocParameter[];
  returns?: string;
  extends: string[];
  implements: string[];
  members: AgentSymbolRecord[];
  documentationPath: string;
}

/** Machine-readable manifest describing the generated package documentation. */
export interface AgentManifest {
  schemaVersion: 1;
  package: string;
  description?: string;
  symbols: AgentSymbolRecord[];
}

/** Identifies a package registry supported by registry documentation generation. */
export type PackageRegistry = "npm" | "pypi";

/** Options for downloading and documenting a package from a supported registry. */
export interface GenerateRegistryPackageOptions extends Omit<
  GenerateDirectoryOptions,
  "input"
> {
  registry: PackageRegistry;
  /** npm package spec (`name`, `name@version`) or PyPI spec (`name`, `name==version`). */
  package: string;
  /** Maximum accepted PyPI artifact size in bytes. Defaults to 100 MiB. */
  maxDownloadBytes?: number;
  /** Persistent extracted-source cache directory. */
  cacheDirectory?: string;
  /** Cache lifetime in milliseconds. Defaults to 24 hours. */
  cacheTtlMs?: number;
  /** Disable the persistent extracted-source cache. */
  cache?: boolean;
  /** Download and replace the cached package immediately. */
  refreshCache?: boolean;
}
