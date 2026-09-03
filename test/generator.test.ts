import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  agentSymbolTemplate,
  classesTemplate,
  classTemplate,
  declarationTemplate,
  defaultTemplate,
  functionsTemplate,
  generate,
  generateDirectory,
  generateFile,
  generateOpenApi,
  generateRegistryPackage,
  getRegistryCacheDirectory,
  extractDocumentation,
  getLanguage,
  indexTemplate,
  openApiProvider,
  prettifyMarkdownTables,
  renderOpenApi,
} from "../dist/index.js";

describe("documentation generator", () => {
  test("generates agent files for a single source file unless disabled", async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "docs-generator-file-agent-"),
    );
    try {
      const enabledOutput = path.join(temporaryDirectory, "enabled", "api.md");
      const enabled = await generateFile({
        input: "test/fixtures/example-package/src/math.js",
        output: enabledOutput,
        language: "javascript",
      });
      expect(enabled.agentOutputs).toContain(
        path.join(temporaryDirectory, "enabled", "llms.txt"),
      );
      expect(
        await readFile(path.join(temporaryDirectory, "enabled", "llms.txt"), "utf8"),
      ).toContain("Calculator");

      const disabledOutput = path.join(temporaryDirectory, "disabled", "api.md");
      const disabled = await generateFile({
        input: "test/fixtures/example-package/src/math.js",
        output: disabledOutput,
        language: "javascript",
        agentDocs: false,
      });
      expect(disabled.agentOutputs).toEqual([]);
      await expect(
        readFile(path.join(temporaryDirectory, "disabled", "llms.txt"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test("reads OpenAPI Mustache template files and supports overrides", async () => {
    expect(await readFile("templates/openapi/tag.mustache", "utf8")).toContain(
      "title: {{tag}}",
    );
    expect(
      await readFile("templates/openapi/index.mustache", "utf8"),
    ).toContain("description: {{description}}");
    expect(
      renderOpenApi(
        { openapi: "3.1.0", info: { title: "API" }, paths: {} },
        undefined,
        "Pets",
        "# {{prefix}} {{title}} / {{tag}}\n\n{{{body}}}",
        undefined,
        { prefix: "Custom" },
      ),
    ).toContain("# Custom API / Pets");
  });

  test("renders endpoints and schemas from an OpenAPI document", () => {
    const markdown = renderOpenApi({
      openapi: "3.1.0",
      info: { title: "Example API", version: "1.0.0" },
      servers: [{ url: "https://api.example.com" }],
      paths: {
        "/pets/{id}": {
          get: {
            operationId: "getPet",
            summary: "Get a pet",
            parameters: [
              {
                name: "id",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            responses: { "200": { description: "A pet" } },
          },
        },
      },
      components: {
        schemas: {
          Pet: {
            type: "object",
            required: ["id"],
            properties: { id: { type: "string", description: "Pet ID" } },
          },
        },
      },
    });

    expect(markdown).toContain("# Example API");
    expect(markdown).toContain("### `GET /pets/{id}`");
    expect(markdown).toContain("| `id` | path | yes | string |");
    expect(markdown).toContain("### `Pet`");
    expect(markdown).toContain("| `id` | string | yes | Pet ID |");
  });

  test("downloads OpenAPI JSON and writes one Markdown file per tag", async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "docs-generator-openapi-"),
    );
    const output = path.join(temporaryDirectory, "api");
    const sidebarOutput = path.join(temporaryDirectory, "sidebar.json");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          openapi: "3.0.3",
          info: { title: "Remote API" },
          tags: [{ name: "Pets" }, { name: "Users" }],
          paths: {
            "/pets": {
              get: { tags: ["Pets"], responses: { "200": { description: "Pets" } } },
            },
            "/users": {
              post: { tags: ["Users"], responses: { "201": { description: "User" } } },
            },
            "/health": {
              get: { responses: { "200": { description: "Healthy" } } },
            },
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    try {
      const result = await generateOpenApi({
        input: "https://api.example.com/openapi.json",
        output,
        vitepress: {
          sidebar: sidebarOutput,
          base: "/lpsmods-api/reference/",
        },
      });
      expect(result.output).toBe(path.resolve(output));
      expect(result.outputs.map((item) => path.basename(item))).toEqual([
        "index.md",
        "pets.md",
        "users.md",
        "untagged.md",
        "llms.txt",
        "llms-full.txt",
        "manifest.json",
      ]);
      expect(await readFile(path.join(output, "index.md"), "utf8")).toContain(
        "[Pets](pets.md)",
      );
      expect(await readFile(path.join(output, "pets.md"), "utf8")).toContain(
        "### `GET /pets`",
      );
      expect(await readFile(path.join(output, "pets.md"), "utf8")).toMatch(
        /^---\ntitle: Pets\n---/,
      );
      expect(await readFile(path.join(output, "pets.md"), "utf8")).not.toContain(
        "POST /users",
      );
      expect(
        await readFile(path.join(output, "untagged.md"), "utf8"),
      ).toContain("### `GET /health`");
      expect(await readFile(path.join(output, "pets.md"), "utf8")).toContain(
        "| Status | Description |\n| ------ | ----------- |\n| `200`  | Pets        |",
      );
      expect(await readFile(path.join(output, "llms.txt"), "utf8")).toContain(
        "- [Pets](pets.md)",
      );
      expect(
        await readFile(path.join(output, "llms-full.txt"), "utf8"),
      ).toContain("<!-- BEGIN FILE: pets.md -->");
      expect(
        JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"))
          .operations,
      ).toHaveLength(3);
      expect(result.sidebarOutput).toBe(path.resolve(sidebarOutput));
      expect(JSON.parse(await readFile(sidebarOutput, "utf8"))).toEqual([
        {
          text: "Remote API",
          collapsed: false,
          items: [
            { text: "Overview", link: "index" },
            { text: "Pets", link: "pets" },
            { text: "Users", link: "users" },
            { text: "Untagged", link: "untagged" },
          ],
          base: "/lpsmods-api/reference/",
        },
      ]);
      expect(await readFile(sidebarOutput, "utf8")).not.toContain(
        "manifest.json",
      );
    } finally {
      globalThis.fetch = originalFetch;
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test("generates per-tag OpenAPI pages through a provider", async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "docs-generator-openapi-provider-"),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          openapi: "3.1.0",
          info: { title: "Provider API" },
          paths: {
            "/widgets": {
              get: {
                tags: ["Widgets"],
                responses: { "200": { description: "Widgets" } },
              },
            },
          },
        }),
      );
    try {
      const result = await generateDirectory({
        input: "test/fixtures/example-package",
        output: temporaryDirectory,
        builtInPages: false,
        agentDocs: false,
        providers: [
          openApiProvider({
            input: "https://api.example.com/openapi.json",
            output: "http-api",
          }),
        ],
      });
      expect(result.providerOutputs).toEqual([
        path.join(temporaryDirectory, "http-api", "index.md"),
        path.join(temporaryDirectory, "http-api", "widgets.md"),
        path.join(temporaryDirectory, "http-api", "llms.txt"),
        path.join(temporaryDirectory, "http-api", "llms-full.txt"),
        path.join(temporaryDirectory, "http-api", "manifest.json"),
      ]);
      expect(
        await readFile(
          path.join(temporaryDirectory, "http-api", "widgets.md"),
          "utf8",
        ),
      ).toContain("### `GET /widgets`");
    } finally {
      globalThis.fetch = originalFetch;
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test("uses a cache directory in the current working directory", () => {
    expect(getRegistryCacheDirectory()).toBe(
      path.resolve(".docs-generator-cache"),
    );
  });

  test("prettifies Markdown table columns", () => {
    const markdown = prettifyMarkdownTables(`| Name | Type | Description |
| ---- | ---- | --- |
| \`x\` | int | Short |
| \`gamertag\` | str | The gamertag of the Bedrock player |`);

    expect(markdown)
      .toBe(`| Name       | Type | Description                        |
| ---------- | ---- | ---------------------------------- |
| \`x\`        | int  | Short                              |
| \`gamertag\` | str  | The gamertag of the Bedrock player |`);
  });

  test("rejects malformed PyPI package specs before downloading", async () => {
    await expect(
      generateRegistryPackage({ registry: "pypi", package: "example==" }),
    ).rejects.toThrow("Invalid PyPI package spec");
  });

  test("extracts JavaScript classes, methods, functions, comments, and parameters", () => {
    const source = `/** A greeter. */
export class Greeter {
  /** Say hello. */
  greet(name = "world") { return \`Hello \${name}\`; }
}
/** Adds numbers. */
export async function add(a, b) { return a + b; }`;
    const model = extractDocumentation(source, getLanguage("javascript"), {
      title: "API",
    });

    expect(model.classes[0].name).toBe("Greeter");
    expect(model.classes[0].description).toBe("A greeter.");
    expect(model.classes[0].members[0].name).toBe("greet");
    expect(model.classes[0].members[0].description).toBe("Say hello.");
    expect(model.functions[0].parameters).toEqual(["a", "b"]);
    expect(model.functions[0].async).toBe(true);
  });

  test("extracts Python docstrings and classifies nested functions as methods", () => {
    const source = `class Greeter:
    """A greeter."""
    def greet(self, name: str):
        """Say hello."""
        return name

def add(a: int, b: int):
    """Adds numbers."""
    return a + b

def concise():
    "Short description."
`;
    const model = extractDocumentation(source, getLanguage(".py"));

    expect(model.classes[0].description).toBe("A greeter.");
    expect(model.classes[0].members[0].kind).toBe("method");
    expect(model.classes[0].members[0].description).toBe("Say hello.");
    expect(model.functions[0].name).toBe("add");
    expect(model.functions[0].description).toBe("Adds numbers.");
    expect(model.functions[1].description).toBe("Short description.");
    expect(model.functions[1].description).not.toContain('"');
  });

  test("extracts JSDoc through TypeScript declaration wrappers", () => {
    const source = `/** Client documentation. */
export declare class Client {
  /** Requests a value. */
  request(id: string): Promise<string>;
}

/** Looks up a client. */
export declare function lookup(name: string): Client;
`;
    const model = extractDocumentation(source, getLanguage("typescript"));

    expect(model.classes[0].description).toBe("Client documentation.");
    expect(model.classes[0].members[0].description).toBe("Requests a value.");
    expect(model.functions[0].description).toBe("Looks up a client.");
  });

  test("extracts symbols from source files larger than Tree-sitter's direct input limit", () => {
    const source = `${"# padding\n".repeat(4_000)}\ndef documented(value):\n    """A function in a large module."""\n    return value\n`;

    const model = extractDocumentation(source, getLanguage("python"));

    expect(model.functions.at(-1)?.name).toBe("documented");
  });

  test("renders custom Mustache templates and user view data", () => {
    const markdown = generate({
      source: "function hello(name) {}",
      language: "javascript",
      template:
        "# {{project}}\n{{#functions}}{{name}}({{#parameters}}{{.}}{{/parameters}}){{/functions}}",
      view: { project: "Example" },
    });

    expect(markdown).toBe("# Example\nhello(name)\n");
  });

  test("ships a default template matching the programmatic default", async () => {
    const packagedTemplate = await readFile(
      "templates/default.mustache",
      "utf8",
    );

    expect(packagedTemplate).toBe(defaultTemplate);
  });

  test("ships a class template matching the programmatic class default", async () => {
    const packagedTemplate = await readFile("templates/class.mustache", "utf8");

    expect(packagedTemplate).toBe(classTemplate);
  });

  test("ships a functions template matching the programmatic functions default", async () => {
    const packagedTemplate = await readFile(
      "templates/functions.mustache",
      "utf8",
    );

    expect(packagedTemplate).toBe(functionsTemplate);
  });

  test("ships a declaration template matching the programmatic declaration default", async () => {
    const packagedTemplate = await readFile(
      "templates/declaration.mustache",
      "utf8",
    );

    expect(packagedTemplate).toBe(declarationTemplate);
  });

  test("ships a classes-index template matching the programmatic default", async () => {
    const packagedTemplate = await readFile(
      "templates/classes.mustache",
      "utf8",
    );

    expect(packagedTemplate).toBe(classesTemplate);
  });

  test("ships a reusable symbol-index template matching the programmatic default", async () => {
    const packagedTemplate = await readFile("templates/index.mustache", "utf8");

    expect(packagedTemplate).toBe(indexTemplate);
  });

  test("ships an agent-symbol template matching the programmatic default", async () => {
    const packagedTemplate = await readFile(
      "templates/agent-symbol.mustache",
      "utf8",
    );

    expect(packagedTemplate).toBe(agentSymbolTemplate);
  });

  test("generates one page per class and loose function from a package directory", async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "docs-generator-"),
    );
    const output = path.join(temporaryDirectory, "docs");

    try {
      const result = await generateDirectory({
        input: "test/fixtures/example-package",
        output,
      });

      expect(result.model.title).toBe("example-package");
      expect(result.model.description).toBe("Example multi-language package");
      expect(result.model.modules.map((module) => module.sourcePath)).toEqual([
        "src/contracts.ts",
        "src/greeter.py",
        "src/math.js",
      ]);
      expect(result.model.symbols.map((symbol) => symbol.name)).toEqual([
        "Service",
        "Status",
        "Identifier",
        "Greeter",
        "get_bedrock_link",
        "verify_online_link",
        "add",
        "Calculator",
      ]);
      expect(
        result.outputs.map((file) =>
          path.relative(output, file).replace(/\\/g, "/"),
        ),
      ).toEqual([
        "Service.md",
        "Status.md",
        "Identifier.md",
        "src/Greeter.md",
        "Calculator.md",
        "classes.md",
        "interfaces.md",
        "enums.md",
        "functions.md",
      ]);
      const classPage = await readFile(
        path.join(output, "src/Greeter.md"),
        "utf8",
      );
      const functionPage = await readFile(
        path.join(output, "functions.md"),
        "utf8",
      );
      const javascriptClassPage = await readFile(
        path.join(output, "Calculator.md"),
        "utf8",
      );
      const interfacePage = await readFile(
        path.join(output, "Service.md"),
        "utf8",
      );
      const enumPage = await readFile(path.join(output, "Status.md"), "utf8");
      const typePage = await readFile(
        path.join(output, "Identifier.md"),
        "utf8",
      );
      const classesPage = await readFile(
        path.join(output, "classes.md"),
        "utf8",
      );
      const interfacesPage = await readFile(
        path.join(output, "interfaces.md"),
        "utf8",
      );
      const enumsPage = await readFile(path.join(output, "enums.md"), "utf8");
      const llms = await readFile(path.join(output, "llms.txt"), "utf8");
      const llmsFull = await readFile(
        path.join(output, "llms-full.txt"),
        "utf8",
      );
      const manifest = JSON.parse(
        await readFile(path.join(output, "manifest.json"), "utf8"),
      );
      const agentClass = await readFile(
        path.join(output, "symbols/classes/src.greeter.Greeter.md"),
        "utf8",
      );
      const agentFunction = await readFile(
        path.join(output, "symbols/functions/src.greeter.get_bedrock_link.md"),
        "utf8",
      );
      expect(classPage).toContain(
        'title: "Greeter | example-package Documentation"',
      );
      expect(classPage).toContain("# Greeter Class");
      expect(classPage).toContain(
        'description: "Example multi-language package"',
      );
      expect(classPage).toContain("Greets users.");
      // expect(classPage).toMatch(/\| `greeting`\s+\| str\s+\| The greeting to use \|/);
      expect(classPage).toContain("- [greet](#greet)");
      expect(classPage).toContain("- [greet](#greet)\n- [wave](#wave)");
      expect(classPage).not.toContain("- [greet](#greet)\n\n- [wave](#wave)");
      expect(classPage).toContain("### `greet`");
      // expect(classPage).toMatch(/\| `name`\s+\| str\s+\|\s+\|/);
      expect(classPage).toContain("### `wave`\n\nUNDOCUMENTED");
      expect(classPage).not.toContain("| `self`");
      expect(classPage).not.toContain("_whisper");
      expect(functionPage).toContain("## `add`");
      expect(functionPage).not.toContain("normalize");
      expect(functionPage).toContain(
        'title: "Functions | example-package Documentation"',
      );
      expect(functionPage).toContain("## `get_bedrock_link`");
      expect(functionPage).toContain(
        "Get a linked Java account from Bedrock xuid",
      );
      expect(functionPage).toMatch(/\| `xuid`\s+\| int\s+\| Bedrock xuid \|/);
      expect(functionPage).toContain("## `verify_online_link`\n\nundocumented");
      expect(functionPage).not.toContain("_private_helper");
      expect(
        result.model.symbols.every((symbol) => !symbol.name.startsWith("_")),
      ).toBe(true);
      expect(javascriptClassPage).toContain("- [Subtract](#subtract)");
      expect(javascriptClassPage).toContain("### `Subtract`");
      expect(interfacePage).toContain("### `start`");
      expect(interfacePage).toContain("# Service Interface");
      expect(enumPage).toContain("enum Status");
      expect(enumPage).toContain("# Status Enumeration");
      expect(typePage).toContain("type Identifier = string | number;");
      expect(typePage).toContain("# Identifier Type Alias");
      expect(classesPage).toContain("- [Greeter](src/Greeter.md)");
      expect(classesPage).toContain("- [Calculator](Calculator.md)");
      expect(classesPage).toContain(
        "- [Greeter](src/Greeter.md)\n- [Calculator](Calculator.md)",
      );
      expect(interfacesPage).toContain("- [Service](Service.md)");
      expect(enumsPage).toContain("- [Status](Status.md)");
      expect(llms).toContain(
        "[src.greeter.Greeter](symbols/classes/src.greeter.Greeter.md)",
      );
      expect(llmsFull).toContain(
        "<!-- BEGIN FILE: symbols/classes/src.greeter.Greeter.md -->",
      );
      expect(manifest.schemaVersion).toBe(1);
      expect(
        manifest.symbols.find(
          (symbol: { qualifiedName: string }) =>
            symbol.qualifiedName === "src.greeter.Greeter",
        ),
      ).toBeTruthy();
      expect(agentClass).toContain('qualifiedName: "src.greeter.Greeter"');
      expect(agentClass).toContain("## Members");
      expect(agentFunction).toContain("## Parameters");
      expect(result.agentOutputs).toContain(path.join(output, "manifest.json"));
      expect(result.providerOutputs).toContain(path.join(output, "manifest.json"));
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test("optionally generates a VitePress sidebar JSON file", async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "docs-generator-sidebar-"),
    );
    const output = path.join(temporaryDirectory, "docs");

    try {
      await mkdir(output, { recursive: true });
      const existingItem = { text: "Guide", link: "/guide" };
      const oldApiReference = {
        text: "API Reference",
        items: [{ text: "Old page", link: "/old-page" }],
      };
      await writeFile(
        path.join(output, "sidebar.json"),
        `${JSON.stringify([existingItem, oldApiReference])}\n`,
        "utf8",
      );
      const result = await generateDirectory({
        input: "test/fixtures/example-package",
        output,
        agentDocs: false,
        vitepress: {
          sidebar: true,
        },
      });
      const sidebar = JSON.parse(
        await readFile(path.join(output, "sidebar.json"), "utf8"),
      );

      expect(result.sidebarOutput).toBe(path.join(output, "sidebar.json"));
      expect(sidebar[0]).toEqual(existingItem);
      expect(sidebar[1].text).toBe("API Reference");
      expect(
        sidebar[1].items.map((item: { text: string }) => item.text),
      ).toEqual(["Classes", "Interfaces", "Enums"]);
      expect(
        sidebar[1].items.find(
          (item: { text: string }) => item.text === "Classes",
        ).items,
      ).toEqual([
        { text: "Overview", link: "classes" },
        { text: "Greeter", link: "src/Greeter" },
        { text: "Calculator", link: "Calculator" },
      ]);
      expect(
        sidebar[1].items.find((item: { text: string }) => item.text === "Enums")
          .items,
      ).toEqual([
        { text: "Overview", link: "enums" },
        { text: "Status", link: "Status" },
      ]);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test("runs documentation providers and writes their additional output", async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "docs-generator-provider-"),
    );
    const output = path.join(temporaryDirectory, "docs");

    try {
      const result = await generateDirectory({
        input: "test/fixtures/example-package",
        output,
        agentDocs: false,
        providers: [
          {
            name: "example-provider",
            analyze({ files }) {
              return { data: { sourceCount: files.length } };
            },
            generate({ contributions, model }) {
              return [
                {
                  path: "framework/summary.md",
                  contents: `# Framework docs\n\n${contributions["example-provider"].sourceCount} sources, ${model.symbols.length} symbols.\n`,
                },
              ];
            },
          },
        ],
      });

      expect(result.providerOutputs).toEqual([
        path.join(output, "framework/summary.md"),
      ]);
      expect(await readFile(result.providerOutputs[0], "utf8")).toBe(
        "# Framework docs\n\n3 sources, 8 symbols.\n",
      );
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test("supports provider-only documentation with parsed analysis data", async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "docs-generator-provider-only-"),
    );
    const output = path.join(temporaryDirectory, "docs");
    let analyzedFiles = 0;
    let analyzedModules = 0;

    try {
      const result = await generateDirectory({
        input: "test/fixtures/example-package",
        output,
        builtInPages: false,
        agentDocs: false,
        providers: [
          {
            name: "provider-only",
            analyze({ files, modules }) {
              analyzedFiles = files.length;
              analyzedModules = modules.length;
              const sourceSymbol = modules[0].symbols[0];
              return {
                symbols: [
                  {
                    ...sourceSymbol,
                    name: "ProviderSymbol",
                    qualifiedName: "provider.ProviderSymbol",
                  },
                ],
                data: {
                  names: modules.flatMap((item) =>
                    item.symbols.map((symbol) => symbol.name),
                  ),
                },
              };
            },
            generate({ contributions, model, pages }) {
              const names = contributions["provider-only"].names as string[];
              return [
                {
                  path: "addon.md",
                  contents: `${pages.length} built-in pages, ${model.symbols.length} aggregate symbols\n${names.join(", ")}\n`,
                },
              ];
            },
          },
        ],
      });

      expect(analyzedFiles).toBe(3);
      expect(analyzedModules).toBe(3);
      expect(result.model.modules).toHaveLength(3);
      expect(result.model.symbols).toHaveLength(9);
      expect(result.model.symbols.at(-1)?.name).toBe("ProviderSymbol");
      expect(result.outputs).toEqual([]);
      expect(result.pages).toEqual([]);
      expect(result.agentOutputs).toEqual([]);
      expect(result.providerOutputs).toEqual([path.join(output, "addon.md")]);
      expect(await readFile(path.join(output, "addon.md"), "utf8")).toContain(
        "0 built-in pages, 9 aggregate symbols\nService, Status, Identifier",
      );
      await expect(
        readFile(path.join(output, "classes.md"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        readFile(path.join(output, "functions.md"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test("keeps agent documentation enabled when built-in pages are disabled", async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "docs-generator-provider-agent-"),
    );
    const output = path.join(temporaryDirectory, "docs");

    try {
      const result = await generateDirectory({
        input: "test/fixtures/example-package",
        output,
        builtInPages: false,
        agentDocs: true,
      });

      expect(result.outputs).toEqual([]);
      expect(result.pages).toEqual([]);
      expect(result.agentOutputs).toContain(path.join(output, "manifest.json"));
      expect(result.manifest?.symbols).toHaveLength(8);
      await expect(
        readFile(path.join(output, "classes.md"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test("includes provider pages but removes nonexistent built-in pages from the VitePress sidebar", async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "docs-generator-provider-sidebar-"),
    );
    const output = path.join(temporaryDirectory, "docs");

    try {
      await mkdir(output, { recursive: true });
      await writeFile(
        path.join(output, "sidebar.json"),
        `${JSON.stringify([
          { text: "Guide", link: "/guide" },
          {
            text: "API Reference",
            items: [{ text: "Classes", link: "classes" }],
          },
        ])}\n`,
        "utf8",
      );
      const result = await generateDirectory({
        input: "test/fixtures/example-package",
        output,
        builtInPages: false,
        agentDocs: false,
        vitepress: { sidebar: true },
        providers: [
          {
            name: "sidebar-provider",
            generate() {
              return [
                {
                  path: "properties.md",
                  contents:
                    "# Properties\n\n| Name | Description |\n| --- | --- |\n| short | A longer description |",
                  sidebar: { text: "Properties", group: "API Reference" },
                },
                {
                  path: "internal.md",
                  contents: "# Internal\n",
                },
              ];
            },
          },
        ],
      });

      expect(result.outputs).toEqual([]);
      expect(result.providerOutputs).toEqual([
        path.join(output, "properties.md"),
        path.join(output, "internal.md"),
      ]);
      expect(
        await readFile(path.join(output, "properties.md"), "utf8"),
      ).toContain(
        "| Name  | Description          |\n| ----- | -------------------- |\n| short | A longer description |",
      );
      expect(
        JSON.parse(await readFile(path.join(output, "sidebar.json"), "utf8")),
      ).toEqual([
        { text: "Guide", link: "/guide" },
        {
          text: "API Reference",
          collapsed: false,
          items: [{ text: "Properties", link: "properties" }],
        },
      ]);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test("rejects provider output outside the documentation directory", async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "docs-generator-provider-path-"),
    );

    try {
      await expect(
        generateDirectory({
          input: "test/fixtures/example-package",
          output: path.join(temporaryDirectory, "docs"),
          agentDocs: false,
          providers: [
            {
              name: "unsafe-provider",
              generate() {
                return [{ path: "../outside.md", contents: "unsafe" }];
              },
            },
          ],
        }),
      ).rejects.toThrow("outside the output directory");
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
