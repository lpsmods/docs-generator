import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import extractZip from "extract-zip";
import pacote from "pacote";
import * as tar from "tar";
import { generateDirectory } from "./index.js";
import type { GenerateRegistryPackageOptions } from "./types.js";

const DEFAULT_MAX_DOWNLOAD = 100 * 1024 * 1024;
const DEFAULT_CACHE_TTL = 24 * 60 * 60 * 1000;

interface CacheMetadata {
  registry: "npm" | "pypi";
  package: string;
  name: string;
  version?: string;
  description?: string;
  cachedAt: number;
}

export function getRegistryCacheDirectory(): string {
  return path.resolve(".docs-generator-cache");
}

function safePackageName(spec: string): string {
  return spec.replace(/^@/, "").replace(/==|@/g, "-").replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function cacheEntry(cacheDirectory: string, registry: string, spec: string): string {
  const digest = createHash("sha256").update(`${registry}:${spec}`).digest("hex").slice(0, 16);
  return path.join(cacheDirectory, registry, `${safePackageName(spec)}-${digest}`);
}

async function readCachedPackage(entry: string, ttl: number): Promise<CacheMetadata | undefined> {
  try {
    const metadata = JSON.parse(await fs.readFile(path.join(entry, "metadata.json"), "utf8")) as CacheMetadata;
    if (Date.now() - metadata.cachedAt > ttl) return undefined;
    if (!(await fs.stat(path.join(entry, "source"))).isDirectory()) return undefined;
    return metadata;
  } catch {
    return undefined;
  }
}

async function writeCachedPackage(entry: string, source: string, metadata: CacheMetadata): Promise<void> {
  await fs.rm(entry, { recursive: true, force: true });
  await fs.mkdir(entry, { recursive: true });
  await fs.cp(source, path.join(entry, "source"), { recursive: true });
  await fs.writeFile(path.join(entry, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");
}

function parsePyPISpec(spec: string): { name: string; version?: string } {
  const separator = spec.lastIndexOf("==");
  const name = (separator < 0 ? spec : spec.slice(0, separator)).trim();
  const version = separator < 0 ? undefined : spec.slice(separator + 2).trim();
  if (!name || (separator >= 0 && !version)) throw new Error(`Invalid PyPI package spec '${spec}'. Use name or name==version.`);
  return { name, version };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "@lpsmods/docs-generator" } });
  if (!response.ok) throw new Error(`Registry request failed (${response.status} ${response.statusText}): ${url}`);
  return response.json() as Promise<T>;
}

async function download(url: string, destination: string, expectedHash: string | undefined, maximum: number): Promise<void> {
  const response = await fetch(url, { headers: { "User-Agent": "@lpsmods/docs-generator" } });
  if (!response.ok) throw new Error(`Package download failed (${response.status} ${response.statusText})`);
  const declaredSize = Number(response.headers.get("content-length"));
  if (declaredSize && declaredSize > maximum) throw new Error(`Package exceeds the ${maximum}-byte download limit.`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > maximum) throw new Error(`Package exceeds the ${maximum}-byte download limit.`);
  if (expectedHash && createHash("sha256").update(data).digest("hex") !== expectedHash) {
    throw new Error("Downloaded PyPI package failed SHA-256 verification.");
  }
  await fs.writeFile(destination, data);
}

async function extractedRoot(directory: string): Promise<string> {
  const entries = (await fs.readdir(directory, { withFileTypes: true })).filter(entry => !entry.name.startsWith("."));
  return entries.length === 1 && entries[0].isDirectory() ? path.join(directory, entries[0].name) : directory;
}

async function matchingDirectory(parent: string, expectedName: string): Promise<string | undefined> {
  try {
    const entries = await fs.readdir(parent, { withFileTypes: true });
    const match = entries.find(entry => entry.isDirectory() && entry.name.toLowerCase() === expectedName.toLowerCase());
    return match ? path.join(parent, match.name) : undefined;
  } catch {
    return undefined;
  }
}

async function pythonPackageRoot(distributionRoot: string, projectName: string): Promise<string> {
  const importName = projectName.replace(/[-.]+/g, "_");
  const direct = await matchingDirectory(distributionRoot, importName);
  if (direct) return direct;
  const sourceLayout = await matchingDirectory(distributionRoot, "src");
  if (sourceLayout) return await matchingDirectory(sourceLayout, importName) ?? distributionRoot;
  return distributionRoot;
}

async function extractPyPI(spec: string, directory: string, maxDownloadBytes: number): Promise<{ source: string; name: string; version: string; description?: string }> {
  const parsed = parsePyPISpec(spec);
  const endpoint = parsed.version
    ? `https://pypi.org/pypi/${encodeURIComponent(parsed.name)}/${encodeURIComponent(parsed.version)}/json`
    : `https://pypi.org/pypi/${encodeURIComponent(parsed.name)}/json`;
  type FileInfo = { filename: string; packagetype: string; url: string; size?: number; digests?: { sha256?: string }; yanked?: boolean };
  const metadata = await fetchJson<{ info: { name: string; version: string; summary?: string }; urls: FileInfo[] }>(endpoint);
  const available = metadata.urls.filter(file => !file.yanked);
  const artifact = available.find(file => file.packagetype === "sdist") ?? available.find(file => file.packagetype === "bdist_wheel");
  if (!artifact) throw new Error(`No source distribution or wheel is available for ${metadata.info.name} ${metadata.info.version}.`);
  if (artifact.size && artifact.size > maxDownloadBytes) throw new Error(`Package exceeds the ${maxDownloadBytes}-byte download limit.`);

  const archive = path.join(directory, artifact.filename);
  const extracted = path.join(directory, "source");
  await fs.mkdir(extracted);
  await download(artifact.url, archive, artifact.digests?.sha256, maxDownloadBytes);
  if (/\.(?:whl|zip)$/i.test(artifact.filename)) await extractZip(archive, { dir: extracted });
  else await tar.extract({ file: archive, cwd: extracted, strict: true });
  const distributionRoot = await extractedRoot(extracted);
  return {
    source: await pythonPackageRoot(distributionRoot, metadata.info.name),
    name: metadata.info.name,
    version: metadata.info.version,
    description: metadata.info.summary
  };
}

export async function generateRegistryPackage(options: GenerateRegistryPackageOptions) {
  const temporaryDirectory = await fs.mkdtemp(path.join(tmpdir(), "docs-generator-package-"));
  const output = path.resolve(options.output ?? path.join("docs", safePackageName(options.package)));
  const cacheDirectory = path.resolve(options.cacheDirectory ?? getRegistryCacheDirectory());
  const entry = cacheEntry(cacheDirectory, options.registry, options.package);
  try {
    let source: string;
    let resolvedName = options.package;
    let resolvedVersion: string | undefined;
    let resolvedDescription: string | undefined;
    let cacheHit = false;
    const cached = options.cache === false || options.refreshCache
      ? undefined
      : await readCachedPackage(entry, options.cacheTtlMs ?? DEFAULT_CACHE_TTL);
    if (cached) {
      source = path.join(entry, "source");
      resolvedName = cached.name;
      resolvedVersion = cached.version;
      resolvedDescription = cached.description;
      cacheHit = true;
    } else {
      if (options.registry === "npm") {
        source = path.join(temporaryDirectory, "source");
        const manifest = await pacote.manifest(options.package);
        await pacote.extract(options.package, source);
        resolvedName = manifest.name;
        resolvedVersion = manifest.version;
        const description = (manifest as unknown as { description?: unknown }).description;
        resolvedDescription = typeof description === "string" ? description : undefined;
      } else {
        const extracted = await extractPyPI(options.package, temporaryDirectory, options.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD);
        source = extracted.source;
        resolvedName = extracted.name;
        resolvedVersion = extracted.version;
        resolvedDescription = extracted.description;
      }
      if (options.cache !== false) {
        await writeCachedPackage(entry, source, {
          registry: options.registry,
          package: options.package,
          name: resolvedName,
          version: resolvedVersion,
          description: resolvedDescription,
          cachedAt: Date.now()
        });
        source = path.join(entry, "source");
      }
    }
    const result = await generateDirectory({
      ...options,
      input: source,
      output,
      title: options.title ?? resolvedName,
      description: options.description ?? resolvedDescription
    });
    return {
      ...result,
      registry: options.registry,
      package: resolvedName,
      version: resolvedVersion,
      cacheHit,
      cacheDirectory: options.cache === false ? undefined : entry
    };
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}
