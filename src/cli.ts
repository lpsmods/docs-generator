#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { generateDirectory, generateFile, generateRegistryPackage, getLanguage, listLanguages } from "./index";

const { version } = require("../package.json") as { version: string };

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("-V") || args.includes("--version")) {
    console.log(version);
    return;
  }
  if (args.includes("--help") || !args.length) {
    console.log("Usage: docs-generator <input|npm:spec|pypi:spec> [-o output] [-l language] [-t template.mustache] [--title title] [-V|--version]");
    console.log(`Languages: ${listLanguages().map(item => item.name).join(", ")}`);
    return;
  }
  const value = (short: string, long: string) => { const i = args.findIndex(arg => arg === short || arg === long); return i >= 0 ? args[i + 1] : undefined; };
  const inputArg = args[0];
  const outputArg = value("-o", "--output");
  const templatePath = value("-t", "--template");
  const languageName = value("-l", "--language");
  const registryMatch = /^(npm|pypi):(.+)$/i.exec(inputArg);
  if (registryMatch) {
    const result = await generateRegistryPackage({
      registry: registryMatch[1].toLowerCase() as "npm" | "pypi",
      package: registryMatch[2],
      output: outputArg ? path.resolve(outputArg) : undefined,
      template: templatePath ? await fs.readFile(path.resolve(templatePath), "utf8") : undefined,
      title: value("", "--title"),
      languages: languageName ? [getLanguage(languageName)] : undefined
    });
    console.log(result.output);
    return;
  }
  const input = path.resolve(inputArg);
  const common = {
    input, output: outputArg ? path.resolve(outputArg) : undefined,
    template: templatePath ? await fs.readFile(path.resolve(templatePath), "utf8") : undefined,
    title: value("", "--title")
  };
  const stats = await fs.stat(input);
  const result = stats.isDirectory()
    ? await generateDirectory({ ...common, languages: languageName ? [getLanguage(languageName)] : undefined })
    : await generateFile({ ...common, language: getLanguage(languageName ?? path.extname(input)) });
  console.log(result.output);
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
