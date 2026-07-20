# @lpsmods/docs-generator

Generate Markdown API documentation from source files using Tree-sitter grammars and Mustache templates. JavaScript, TypeScript, TSX, and Python are included; additional Tree-sitter grammars can be registered without changing the generator.

## Install

```sh
npm install @lpsmods/docs-generator
```

## API

```js
import { generate, generateDirectory, generateFile, generateRegistryPackage } from "@lpsmods/docs-generator";

const markdown = generate({
  source: `/** Add two numbers. */\nexport function add(a, b) { return a + b; }`,
  language: "javascript",
  title: "Math API"
});

await generateFile({
  input: "src/example.py",
  output: "docs/example.md",
  language: "python",
  template: "# {{title}}\n{{#functions}}## {{name}}\n{{description}}\n{{/functions}}"
});

// Create one page per class and one functions.md for all loose functions.
await generateDirectory({
  input: "src",
  output: "docs/api"
});

// Download a published package, generate its docs, then clean up its source.
await generateRegistryPackage({
  registry: "npm",
  package: "yocto-queue@1.2.1",
  output: "docs/yocto-queue"
});

await generateRegistryPackage({
  registry: "pypi",
  package: "six==1.17.0",
  output: "docs/six"
});
```

Templates receive `title`, `language`, `sourcePath`, `description`, `hasSymbols`, `symbols`, `classes`, `functions`, `interfaces`, `types`, and `enums`. Each symbol contains `kind`, `name`, `signature`, `description`, `parameters`, `async`, `location`, and nested `members`. Pass `partials` for Mustache partials and `view` for custom template data.

Markdown tables produced by built-in or custom templates are automatically padded and aligned after Mustache rendering. The formatter is also exported as `prettifyMarkdownTables(markdown)` for standalone use.

The npm package includes two ready-to-use template files:

- `templates/class.mustache` — the default YAML-front-matter class page with parameters and methods.
- `templates/functions.mustache` — the default combined loose-functions page with typed parameter tables.
- `templates/declaration.mustache` — the default enum and type-alias page.
- `templates/classes.mustache` — the generated class index page.
- `templates/index.mustache` — the reusable interface and enum index layout.
- `templates/default.mustache` — the complete template used when `template` is omitted.
- `templates/compact.mustache` — a shorter symbol-oriented layout.

Pass a packaged template to the CLI after resolving its installed location:

```js
const compactTemplate = require.resolve("@lpsmods/docs-generator/templates/compact.mustache");
```

```sh
docs-generator src/example.ts --template path/to/compact.mustache
```

## CLI

```sh
docs-generator src/example.ts -o docs/example.md
docs-generator src/example.py --language python --template templates/api.mustache
docs-generator src -o docs/api
docs-generator npm:yocto-queue@1.2.1 -o docs/yocto-queue
docs-generator pypi:six==1.17.0 -o docs/six
docs-generator --version
```

The input can be a file or directory. For directories, source files are discovered recursively using all registered language extensions. Each top-level class, interface, enum, and type alias gets its own Markdown file. Classes and interfaces include their methods and parameters. Root-level `classes.md`, `interfaces.md`, and `enums.md` files index their respective pages, while all loose functions are combined into `functions.md`. Local and nested functions are excluded.

Non-Python class pages are flattened into the output directory—for example, a JavaScript `Calculator` class produces `docs/api/Calculator.md` regardless of its source folder. Python preserves package directories but removes the source module filename: class `AskEnum` in `tkinter/windows/askenum.py` produces `docs/api/tkinter/windows/AskEnum.md`. Duplicate names in the same output directory receive numeric suffixes such as `Calculator-2.md`.

Python classes, functions, and methods whose names begin with `_` are treated as private and omitted, including descendants of private classes.

`node_modules`, build output, coverage, version-control folders, and hidden directories are ignored. The default output directory is `<input>/docs`. Use `--language` to restrict a folder to one language. `generateDirectory()` returns `outputs` and `pages` arrays alongside the aggregate discovery `model`.

### Published packages

Prefix a package specification with `npm:` or `pypi:`. npm inputs support standard package names, versions, and tags such as `npm:lodash`, `npm:lodash@4.17.21`, or `npm:lodash@latest`. PyPI inputs accept a project name with an optional exact version, such as `pypi:requests` or `pypi:requests==2.32.5`.

Remote packages are downloaded to temporary storage and removed after generation. PyPI artifacts are SHA-256 verified and limited to 100 MiB by default; `maxDownloadBytes` can customize that programmatically. Source distributions are preferred, with wheels used when no source distribution is published. When `-o` is omitted, remote output defaults to `docs/<package-spec>` in the current directory.

For PyPI projects, standard `<project>/<package>/` and `<project>/src/<package>/` layouts are detected automatically. The import-package directory becomes the source root, preventing duplicated output paths such as `tkinterplus/tkinterplus/` while retaining its submodules.

## Add a language

```js
const { registerLanguage } = require("@lpsmods/docs-generator");
const Java = require("tree-sitter-java");

registerLanguage({
  name: "java",
  extensions: [".java"],
  grammar: Java,
  nodeKinds: {
    class_declaration: "class",
    method_declaration: "method",
    interface_declaration: "interface",
    enum_declaration: "enum"
  }
});
```

`nameFields`, `parameterFields`, `bodyFields`, `getDocumentation`, and `transformSymbol` can adapt grammars whose structure differs from the defaults.
