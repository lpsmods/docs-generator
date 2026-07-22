import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  agentSymbolTemplate, classesTemplate, classTemplate, declarationTemplate, defaultTemplate, functionsTemplate,
  generate, generateDirectory, generateRegistryPackage, getRegistryCacheDirectory,
  extractDocumentation, getLanguage, indexTemplate, prettifyMarkdownTables
} from "../dist/index.js";

describe("documentation generator", () => {
  test("uses a cache directory in the current working directory", () => {
    expect(getRegistryCacheDirectory()).toBe(path.resolve(".docs-generator-cache"));
  });

  test("prettifies Markdown table columns", () => {
    const markdown = prettifyMarkdownTables(`| Name | Type | Description |
| ---- | ---- | --- |
| \`x\` | int | Short |
| \`gamertag\` | str | The gamertag of the Bedrock player |`);

    expect(markdown).toBe(`| Name       | Type | Description                        |
| ---------- | ---- | ---------------------------------- |
| \`x\`        | int  | Short                              |
| \`gamertag\` | str  | The gamertag of the Bedrock player |`);
  });

  test("rejects malformed PyPI package specs before downloading", async () => {
    await expect(generateRegistryPackage({ registry: "pypi", package: "example==" })).rejects.toThrow(
      "Invalid PyPI package spec"
    );
  });

  test("extracts JavaScript classes, methods, functions, comments, and parameters", () => {
    const source = `/** A greeter. */
export class Greeter {
  /** Say hello. */
  greet(name = "world") { return \`Hello \${name}\`; }
}
/** Adds numbers. */
export async function add(a, b) { return a + b; }`;
    const model = extractDocumentation(source, getLanguage("javascript"), { title: "API" });

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
      template: "# {{project}}\n{{#functions}}{{name}}({{#parameters}}{{.}}{{/parameters}}){{/functions}}",
      view: { project: "Example" }
    });

    expect(markdown).toBe("# Example\nhello(name)\n");
  });

  test("ships a default template matching the programmatic default", async () => {
    const packagedTemplate = await readFile("templates/default.mustache", "utf8");

    expect(packagedTemplate).toBe(defaultTemplate);
  });

  test("ships a class template matching the programmatic class default", async () => {
    const packagedTemplate = await readFile("templates/class.mustache", "utf8");

    expect(packagedTemplate).toBe(classTemplate);
  });

  test("ships a functions template matching the programmatic functions default", async () => {
    const packagedTemplate = await readFile("templates/functions.mustache", "utf8");

    expect(packagedTemplate).toBe(functionsTemplate);
  });

  test("ships a declaration template matching the programmatic declaration default", async () => {
    const packagedTemplate = await readFile("templates/declaration.mustache", "utf8");

    expect(packagedTemplate).toBe(declarationTemplate);
  });

  test("ships a classes-index template matching the programmatic default", async () => {
    const packagedTemplate = await readFile("templates/classes.mustache", "utf8");

    expect(packagedTemplate).toBe(classesTemplate);
  });

  test("ships a reusable symbol-index template matching the programmatic default", async () => {
    const packagedTemplate = await readFile("templates/index.mustache", "utf8");

    expect(packagedTemplate).toBe(indexTemplate);
  });

  test("ships an agent-symbol template matching the programmatic default", async () => {
    const packagedTemplate = await readFile("templates/agent-symbol.mustache", "utf8");

    expect(packagedTemplate).toBe(agentSymbolTemplate);
  });

  test("generates one page per class and loose function from a package directory", async () => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "docs-generator-"));
    const output = path.join(temporaryDirectory, "docs");

    try {
      const result = await generateDirectory({ input: "test/fixtures/example-package", output });

      expect(result.model.title).toBe("example-package");
      expect(result.model.description).toBe("Example multi-language package");
      expect(result.model.modules.map(module => module.sourcePath)).toEqual([
        "src/contracts.ts", "src/greeter.py", "src/math.js"
      ]);
      expect(result.model.symbols.map(symbol => symbol.name)).toEqual([
        "Service", "Status", "Identifier", "Greeter", "get_bedrock_link", "verify_online_link", "add", "Calculator"
      ]);
      expect(result.outputs.map(file => path.relative(output, file).replace(/\\/g, "/"))).toEqual([
        "Service.md",
        "Status.md",
        "Identifier.md",
        "src/Greeter.md",
        "Calculator.md",
        "classes.md",
        "interfaces.md",
        "enums.md",
        "functions.md"
      ]);
      const classPage = await readFile(path.join(output, "src/Greeter.md"), "utf8");
      const functionPage = await readFile(path.join(output, "functions.md"), "utf8");
      const javascriptClassPage = await readFile(path.join(output, "Calculator.md"), "utf8");
      const interfacePage = await readFile(path.join(output, "Service.md"), "utf8");
      const enumPage = await readFile(path.join(output, "Status.md"), "utf8");
      const typePage = await readFile(path.join(output, "Identifier.md"), "utf8");
      const classesPage = await readFile(path.join(output, "classes.md"), "utf8");
      const interfacesPage = await readFile(path.join(output, "interfaces.md"), "utf8");
      const enumsPage = await readFile(path.join(output, "enums.md"), "utf8");
      const llms = await readFile(path.join(output, "llms.txt"), "utf8");
      const llmsFull = await readFile(path.join(output, "llms-full.txt"), "utf8");
      const manifest = JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"));
      const agentClass = await readFile(path.join(output, "symbols/classes/src.greeter.Greeter.md"), "utf8");
      const agentFunction = await readFile(path.join(output, "symbols/functions/src.greeter.get_bedrock_link.md"), "utf8");
      expect(classPage).toContain('title: "Greeter | example-package Documentation"');
      expect(classPage).toContain("# Greeter Class");
      expect(classPage).toContain('description: "Example multi-language package"');
      expect(classPage).toContain("Greets users.");
      expect(classPage).toMatch(/\| `greeting`\s+\| str\s+\| The greeting to use \|/);
      expect(classPage).toContain("- [greet](#greet)");
      expect(classPage).toContain("- [greet](#greet)\n- [wave](#wave)");
      expect(classPage).not.toContain("- [greet](#greet)\n\n- [wave](#wave)");
      expect(classPage).toContain("### `greet`");
      expect(classPage).toMatch(/\| `name`\s+\| str\s+\|\s+\|/);
      expect(classPage).toContain("### `wave`\n\nUNDOCUMENTED");
      expect(classPage).not.toContain("| `self`");
      expect(classPage).not.toContain("_whisper");
      expect(functionPage).toContain("## `add`");
      expect(functionPage).not.toContain("normalize");
      expect(functionPage).toContain('title: "Functions | example-package Documentation"');
      expect(functionPage).toContain("## `get_bedrock_link`");
      expect(functionPage).toContain("Get a linked Java account from Bedrock xuid");
      expect(functionPage).toMatch(/\| `xuid`\s+\| int\s+\| Bedrock xuid \|/);
      expect(functionPage).toContain("## `verify_online_link`\n\nundocumented");
      expect(functionPage).not.toContain("_private_helper");
      expect(result.model.symbols.every(symbol => !symbol.name.startsWith("_"))).toBe(true);
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
      expect(classesPage).toContain("- [Greeter](src/Greeter.md)\n- [Calculator](Calculator.md)");
      expect(interfacesPage).toContain("- [Service](Service.md)");
      expect(enumsPage).toContain("- [Status](Status.md)");
      expect(llms).toContain("[src.greeter.Greeter](symbols/classes/src.greeter.Greeter.md)");
      expect(llmsFull).toContain("<!-- BEGIN FILE: symbols/classes/src.greeter.Greeter.md -->");
      expect(manifest.schemaVersion).toBe(1);
      expect(manifest.symbols.find((symbol: { qualifiedName: string }) => symbol.qualifiedName === "src.greeter.Greeter")).toBeTruthy();
      expect(agentClass).toContain('qualifiedName: "src.greeter.Greeter"');
      expect(agentClass).toContain("## Members");
      expect(agentFunction).toContain("## Parameters");
      expect(result.agentOutputs).toContain(path.join(output, "manifest.json"));
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
