import type Parser from "tree-sitter";

export type SymbolKind = "class" | "function" | "method" | "interface" | "type" | "enum";

export interface SourceLocation {
  startLine: number;
  endLine: number;
}

export interface DocParameter {
  name: string;
  type: string;
  description: string;
  signature: string;
}

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

export interface LanguageDefinition {
  name: string;
  extensions: string[];
  grammar: any;
  nodeKinds: Partial<Record<string, SymbolKind>>;
  nameFields?: string[];
  parameterFields?: string[];
  bodyFields?: string[];
  /** Extract a documentation comment. Return undefined to use the default preceding-comment logic. */
  getDocumentation?: (node: Parser.SyntaxNode, source: string) => string | undefined;
  /** Customize extraction for grammar-specific constructs. */
  transformSymbol?: (symbol: DocSymbol, node: Parser.SyntaxNode, source: string) => DocSymbol | null;
}

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

export interface GenerateFileOptions extends Omit<GenerateOptions, "source"> {
  input: string;
  output?: string;
}

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
  /** Generate a VitePress sidebar configuration at `<output>/sidebar.json`. */
  vitepressSidebar?: boolean | string;
}

export interface GeneratedPage {
  output: string;
  /** Present for single-symbol pages such as classes. */
  symbol?: DocSymbol;
  symbols: DocSymbol[];
  model: DocumentationModel;
}

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

export interface AgentManifest {
  schemaVersion: 1;
  package: string;
  description?: string;
  symbols: AgentSymbolRecord[];
}

export type PackageRegistry = "npm" | "pypi";

export interface GenerateRegistryPackageOptions extends Omit<GenerateDirectoryOptions, "input"> {
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
