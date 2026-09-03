import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import Mustache from "mustache";
import { prettifyMarkdownTables } from "./markdown.js";
import type {
  DocumentationProvider,
  GenerateOpenApiOptions,
  OpenApiProviderOptions,
  ProviderGeneratedOutput,
  ProviderGenerationContext,
} from "./types.js";

type JsonObject = Record<string, unknown>;
function readOpenApiTemplate(filename: string): string {
  try {
    return readFileSync(
      new URL(`../templates/openapi/${filename}`, import.meta.url),
      "utf8",
    );
  } catch (error) {
    throw new Error(`Could not read OpenAPI template '${filename}'`, {
      cause: error,
    });
  }
}
const methods = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;
function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
function schemaType(value: unknown): string {
  const schema = object(value);
  const reference = text(schema.$ref);
  if (reference) return reference.split("/").at(-1) ?? reference;
  if (Array.isArray(schema.type)) return schema.type.map(String).join(" | ");
  if (schema.type === "array")
    return `${schemaType(schema.items) || "unknown"}[]`;
  if (typeof schema.type === "string") return schema.type;
  if (Array.isArray(schema.oneOf))
    return schema.oneOf.map(schemaType).join(" | ");
  if (Array.isArray(schema.anyOf))
    return schema.anyOf.map(schemaType).join(" | ");
  return "object";
}
function renderParameters(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length) return [];
  return [
    "#### Parameters",
    "",
    "| Name | In | Required | Type | Description |",
    "| --- | --- | --- | --- | --- |",
    ...value.map((item) => {
      const parameter = object(item);
      return `| \`${escapeCell(text(parameter.name))}\` | ${escapeCell(text(parameter.in))} | ${parameter.required === true ? "yes" : "no"} | ${escapeCell(schemaType(parameter.schema))} | ${escapeCell(text(parameter.description))} |`;
    }),
    "",
  ];
}
function renderResponses(value: unknown): string[] {
  const entries = Object.entries(object(value));
  return entries.length
    ? [
        "#### Responses",
        "",
        "| Status | Description |",
        "| --- | --- |",
        ...entries.map(
          ([status, response]) =>
            `| \`${escapeCell(status)}\` | ${escapeCell(text(object(response).description))} |`,
        ),
        "",
      ]
    : [];
}

export function renderOpenApi(
  document: unknown,
  title?: string,
  tag?: string | null,
  template?: string,
  partials?: Record<string, string>,
  view?: Record<string, unknown>,
): string {
  const api = object(document);
  if (!text(api.openapi).startsWith("3."))
    throw new Error("Expected an OpenAPI 3.x document");
  const info = object(api.info);
  const heading = title ?? text(info.title) ?? "OpenAPI documentation";
  const lines: string[] = [];
  if (text(info.version)) lines.push(`Version: \`${text(info.version)}\``, "");
  if (text(info.description)) lines.push(text(info.description), "");
  const servers = Array.isArray(api.servers)
    ? api.servers.map((item) => text(object(item).url)).filter(Boolean)
    : [];
  if (servers.length)
    lines.push(
      "## Servers",
      "",
      ...servers.map((server) => `- \`${server}\``),
      "",
    );
  lines.push("## Endpoints", "");
  let operationCount = 0;
  for (const [route, pathValue] of Object.entries(object(api.paths))) {
    const pathItem = object(pathValue);
    for (const method of methods) {
      if (!pathItem[method]) continue;
      const operation = object(pathItem[method]);
      const operationTags = Array.isArray(operation.tags)
        ? operation.tags.map(String)
        : [];
      if (
        tag !== undefined &&
        (tag === null
          ? operationTags.length > 0
          : !operationTags.includes(tag))
      )
        continue;
      operationCount++;
      lines.push(`### \`${method.toUpperCase()} ${route}\``, "");
      const summary = text(operation.summary) || text(operation.description);
      if (summary) lines.push(summary, "");
      if (text(operation.operationId))
        lines.push(`Operation ID: \`${text(operation.operationId)}\``, "");
      lines.push(
        ...renderParameters([
          ...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
          ...(Array.isArray(operation.parameters) ? operation.parameters : []),
        ]),
      );
      const requestBody = object(operation.requestBody);
      if (Object.keys(requestBody).length) {
        const contentTypes = Object.keys(object(requestBody.content));
        lines.push(
          "#### Request body",
          "",
          `${requestBody.required === true ? "Required" : "Optional"}${contentTypes.length ? `; content types: ${contentTypes.map((value) => `\`${value}\``).join(", ")}` : ""}.`,
          "",
        );
      }
      lines.push(...renderResponses(operation.responses));
    }
  }
  if (!operationCount) lines.push("No endpoints are defined.", "");
  const schemas = object(object(api.components).schemas);
  if (tag === undefined && Object.keys(schemas).length) {
    lines.push("## Schemas", "");
    for (const [name, rawSchema] of Object.entries(schemas)) {
      const schema = object(rawSchema);
      lines.push(`### \`${name}\``, "");
      if (text(schema.description)) lines.push(text(schema.description), "");
      const properties = object(schema.properties);
      const required = new Set(
        Array.isArray(schema.required) ? schema.required.map(String) : [],
      );
      if (Object.keys(properties).length) {
        lines.push(
          "| Property | Type | Required | Description |",
          "| --- | --- | --- | --- |",
        );
        for (const [property, definition] of Object.entries(properties))
          lines.push(
            `| \`${escapeCell(property)}\` | ${escapeCell(schemaType(definition))} | ${required.has(property) ? "yes" : "no"} | ${escapeCell(text(object(definition).description))} |`,
          );
        lines.push("");
      } else lines.push(`Type: \`${schemaType(schema)}\``, "");
    }
  }
  return `${Mustache.render(
    template ?? readOpenApiTemplate("tag.mustache"),
    {
      title: heading || "OpenAPI documentation",
      tag: tag === undefined ? heading : tag === null ? "Untagged" : tag,
      body: lines.join("\n").trimEnd(),
      ...view,
    },
    partials,
  ).trimEnd()}\n`;
}

function safeFilename(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "") || "untagged"
  );
}

function openApiTags(
  document: JsonObject,
): Array<{ name: string; filter: string | null }> {
  const tags: string[] = [];
  const add = (tag: string) => {
    if (tag && !tags.includes(tag)) tags.push(tag);
  };
  if (Array.isArray(document.tags))
    for (const item of document.tags) add(text(object(item).name));
  let hasUntagged = false;
  for (const pathValue of Object.values(object(document.paths))) {
    const pathItem = object(pathValue);
    for (const method of methods) {
      if (!pathItem[method]) continue;
      const operationTags = object(pathItem[method]).tags;
      if (Array.isArray(operationTags) && operationTags.length)
        operationTags.map(String).forEach(add);
      else hasUntagged = true;
    }
  }
  return [
    ...tags.map((name) => ({ name, filter: name })),
    ...(hasUntagged ? [{ name: "Untagged", filter: null }] : []),
  ];
}

async function fetchOpenApi(
  input: string,
  headers?: Record<string, string>,
): Promise<{ url: URL; document: JsonObject }> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Invalid OpenAPI URL: ${input}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error(`Unsupported OpenAPI URL protocol: ${url.protocol}`);
  const response = await fetch(url, {
    headers: {
      Accept: "application/json, application/vnd.oai.openapi+json",
      "User-Agent": "@lpsmods/docs-generator",
      ...headers,
    },
  });
  if (!response.ok)
    throw new Error(
      `OpenAPI request failed (${response.status} ${response.statusText}): ${url}`,
    );
  let document: unknown;
  try {
    document = await response.json();
  } catch {
    throw new Error(`OpenAPI response was not valid JSON: ${url}`);
  }
  const api = object(document);
  renderOpenApi(api);
  return { url, document: api };
}

async function buildOpenApiFiles(
  api: JsonObject,
  options: Pick<
    OpenApiProviderOptions,
    | "title"
    | "template"
    | "indexTemplate"
    | "partials"
    | "view"
    | "agentDocs"
  >,
): Promise<Array<{ filename: string; contents: string; tag?: string }>> {
  const tagTemplate = options.template ?? readOpenApiTemplate("tag.mustache");
  const indexTemplate =
    options.indexTemplate ?? readOpenApiTemplate("index.mustache");
  const completeMarkdown = renderOpenApi(api, options.title);
  const tags = openApiTags(api);
  const usedNames = new Set<string>();
  const tagFiles = tags.map(({ name, filter }) => {
    const base = safeFilename(name);
    let filename = `${base}.md`;
    let suffix = 2;
    while (usedNames.has(filename)) filename = `${base}-${suffix++}.md`;
    usedNames.add(filename);
    return { name, filter, filename };
  });
  const info = object(api.info);
  const heading = options.title || text(info.title) || "OpenAPI documentation";
  const schemasAt = completeMarkdown.indexOf("\n## Schemas\n");
  const schemas = schemasAt >= 0 ? completeMarkdown.slice(schemasAt + 1) : "";
  const index = `${Mustache.render(
    indexTemplate,
    {
      title: heading,
      version: text(info.version),
      description: text(info.description),
      tags: tagFiles,
      schemas: schemas.trimEnd(),
      ...options.view,
    },
    options.partials,
  ).trimEnd()}\n`;
  const pages = [
    { filename: "index.md", contents: index },
    ...tagFiles.map(({ name, filter, filename }) => ({
      filename,
      contents: renderOpenApi(
        api,
        options.title,
        filter,
        tagTemplate,
        options.partials,
        options.view,
      ),
      tag: name,
    })),
  ];
  if (options.agentDocs === false) return pages;
  const description =
    text(info.description) || "Generated OpenAPI documentation.";
  const llms = [
    `# ${heading}`,
    "",
    `> ${description}`,
    "",
    "## Documentation",
    "",
    "- [Overview](index.md)",
    ...tagFiles.map(({ name, filename }) => `- [${name}](${filename})`),
    "",
  ].join("\n");
  const llmsFull = [
    `# ${heading} — Complete OpenAPI Documentation`,
    "",
    `> ${description}`,
    "",
    ...pages.flatMap((page) => [
      `<!-- BEGIN FILE: ${page.filename} -->`,
      "",
      page.contents.trimEnd(),
      "",
      `<!-- END FILE: ${page.filename} -->`,
      "",
    ]),
  ].join("\n");
  const operations = Object.entries(object(api.paths)).flatMap(
    ([route, pathValue]) => {
      const pathItem = object(pathValue);
      return methods.flatMap((method) => {
        if (!pathItem[method]) return [];
        const operation = object(pathItem[method]);
        return [
          {
            method: method.toUpperCase(),
            path: route,
            operationId: text(operation.operationId) || undefined,
            summary: text(operation.summary) || undefined,
            tags: Array.isArray(operation.tags)
              ? operation.tags.map(String)
              : [],
          },
        ];
      });
    },
  );
  const manifest = {
    schemaVersion: 1,
    type: "openapi",
    title: heading,
    version: text(info.version) || undefined,
    tags: tagFiles.map(({ name, filename }) => ({
      name,
      documentationPath: filename,
    })),
    operations,
  };
  return [
    ...pages,
    { filename: "llms.txt", contents: llms },
    { filename: "llms-full.txt", contents: llmsFull },
    {
      filename: "manifest.json",
      contents: `${JSON.stringify(manifest, null, 2)}\n`,
    },
  ];
}

function providerPath(directory: string, filename: string): string {
  const normalized = directory.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return normalized ? `${normalized}/${filename}` : filename;
}

/** Add a remote OpenAPI document to a `generateDirectory()` provider pipeline. */
function createOpenApiProvider(
  options: OpenApiProviderOptions,
  onDocument?: (document: JsonObject) => void,
): DocumentationProvider {
  return {
    name: `openapi:${options.input}`,
    async generate(): Promise<ProviderGeneratedOutput[]> {
      const { document } = await fetchOpenApi(options.input, options.headers);
      onDocument?.(document);
      const directory = options.output ?? "openapi";
      return (await buildOpenApiFiles(document, options)).map((file) => ({
        path: providerPath(directory, file.filename),
        contents: file.contents,
        sidebar: file.tag
          ? { text: file.tag, group: options.title ?? "OpenAPI" }
          : file.filename === "index.md"
            ? {
                text:
                  options.title ||
                  text(object(document.info).title) ||
                  "OpenAPI",
              }
            : undefined,
      }));
    },
  };
}

export function openApiProvider(
  options: OpenApiProviderOptions,
): DocumentationProvider {
  return createOpenApiProvider(options);
}

export async function generateOpenApi(
  options: GenerateOpenApiOptions,
): Promise<{
  output: string;
  outputs: string[];
  document: JsonObject;
  sidebarOutput?: string;
}> {
  let url: URL;
  try {
    url = new URL(options.input);
  } catch {
    throw new Error(`Invalid OpenAPI URL: ${options.input}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error(`Unsupported OpenAPI URL protocol: ${url.protocol}`);
  const output = path.resolve(
    options.output ?? path.join("docs", `${url.hostname}-openapi`),
  );
  await fs.mkdir(output, { recursive: true });
  let document: JsonObject | undefined;
  const provider = createOpenApiProvider(
    {
      input: options.input,
      output: "",
      title: options.title,
      headers: options.headers,
      template: options.template,
      indexTemplate: options.indexTemplate,
      partials: options.partials,
      view: options.view,
      agentDocs: options.agentDocs,
    },
    (value) => {
      document = value;
    },
  );
  const files =
    (await provider.generate?.({} as ProviderGenerationContext)) ?? [];
  const outputs: string[] = [];
  for (const file of files) {
    const destination = path.resolve(output, file.path);
    if (
      destination !== output &&
      !destination.startsWith(`${output}${path.sep}`)
    )
      throw new Error(
        `OpenAPI provider returned an output path outside the output directory: ${file.path}`,
      );
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const contents = file.path.toLowerCase().endsWith(".md")
      ? `${prettifyMarkdownTables(file.contents).trimEnd()}\n`
      : file.contents;
    await fs.writeFile(destination, contents, "utf8");
    outputs.push(destination);
  }
  if (!document) throw new Error("OpenAPI provider did not return a document");
  let sidebarOutput: string | undefined;
  if (options.vitepress?.sidebar) {
    sidebarOutput = path.resolve(
      typeof options.vitepress.sidebar === "string"
        ? options.vitepress.sidebar
        : path.join(output, "sidebar.json"),
    );
    let sidebar: unknown[] = [];
    try {
      const existing = JSON.parse(await fs.readFile(sidebarOutput, "utf8"));
      if (!Array.isArray(existing))
        throw new Error("the existing file must contain a JSON array");
      sidebar = existing;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not update ${sidebarOutput}: ${message}`, {
          cause: error,
        });
      }
    }
    const title =
      options.vitepress.title ||
      options.title ||
      text(object(document.info).title) ||
      "OpenAPI";
    const linkRoot = options.vitepress.base
      ? output
      : path.dirname(sidebarOutput);
    const link = (destination: string) =>
      path
        .relative(linkRoot, destination)
        .replace(/\\/g, "/")
        .replace(/\.md$/, "")
        .split("/")
        .map(encodeURIComponent)
        .join("/");
    const items = files
      .filter((file) => file.sidebar)
      .map((file) => ({
        text: file.path === "index.md" ? "Overview" : file.sidebar!.text,
        link: link(path.resolve(output, file.path)),
      }));
    const group: Record<string, unknown> = {
      text: title,
      collapsed: false,
      items,
    };
    if (options.vitepress.base) group.base = options.vitepress.base;
    const existingIndex = sidebar.findIndex(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "text" in item &&
        item.text === title,
    );
    if (existingIndex === -1) sidebar.push(group);
    else sidebar[existingIndex] = group;
    await fs.mkdir(path.dirname(sidebarOutput), { recursive: true });
    await fs.writeFile(sidebarOutput, `${JSON.stringify(sidebar, null, 2)}\n`);
  }
  return { output, outputs, document, sidebarOutput };
}
