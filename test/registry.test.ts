import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pacote from "pacote";
import * as tar from "tar";
import { afterEach, describe, expect, test, vi } from "vitest";
import { generateRegistryPackage } from "../dist/index.js";
import { extractZipSecurely } from "../dist/registry.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipEntry(name: string, contents: string, unixMode = 0o100644): Buffer {
  const fileName = Buffer.from(name);
  const data = Buffer.from(contents);
  const checksum = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x031e, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  central.writeUInt32LE((unixMode * 0x10000) >>> 0, 38);
  const centralDirectory = Buffer.concat([central, fileName]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(local.length + fileName.length + data.length, 16);
  return Buffer.concat([local, fileName, data, centralDirectory, end]);
}

describe("secure ZIP extraction", () => {
  test("extracts regular files", async () => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "docs-generator-zip-"));
    try {
      const archive = path.join(temporaryDirectory, "package.zip");
      const output = path.join(temporaryDirectory, "output");
      await writeFile(archive, zipEntry("package/example.py", "value = 1\n"));
      await extractZipSecurely(archive, output);
      expect(await readFile(path.join(output, "package", "example.py"), "utf8")).toBe("value = 1\n");
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test.each([
    ["path traversal", "../outside.py", 0o100644],
    ["symbolic links", "package/link.py", 0o120777],
  ])("rejects %s", async (_case, fileName, mode) => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "docs-generator-zip-"));
    try {
      const archive = path.join(temporaryDirectory, "package.zip");
      await writeFile(archive, zipEntry(fileName, "target", mode));
      await expect(extractZipSecurely(archive, path.join(temporaryDirectory, "output"))).rejects.toThrow(/invalid relative path|escapes|symbolic link/);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});

describe("generateRegistryPackage", () => {
  test("generates an npm package, persists it, reuses its cache, and refreshes on request", async () => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "docs-generator-registry-npm-"));
    const extract = vi.spyOn(pacote, "extract").mockImplementation(async (_spec, destination) => {
      await mkdir(path.join(destination, "src"), { recursive: true });
      await writeFile(
        path.join(destination, "src", "math.js"),
        "/** Adds two values. */\nexport function add(left, right) { return left + right; }\n",
      );
      return destination;
    });
    const manifest = vi.spyOn(pacote, "manifest").mockResolvedValue({
      name: "@example/math",
      version: "2.3.4",
      description: "Example arithmetic package",
    } as Awaited<ReturnType<typeof pacote.manifest>>);
    try {
      const options = {
        registry: "npm" as const,
        package: "@example/math@2.3.4",
        output: path.join(temporaryDirectory, "docs"),
        cacheDirectory: path.join(temporaryDirectory, "cache"),
        agentDocs: false,
      };
      const first = await generateRegistryPackage(options);
      expect(first).toMatchObject({
        registry: "npm",
        package: "@example/math",
        version: "2.3.4",
        cacheHit: false,
      });
      expect(first.cacheDirectory).toMatch(/cache[\\/]npm[\\/]example-math-2\.3\.4-/);
      expect(first.model.functions.map((item) => item.name)).toContain("add");
      expect((await Promise.all(first.outputs.map((file) => readFile(file, "utf8")))).join("\n")).toContain("@example/math");
      expect(JSON.parse(await readFile(path.join(first.cacheDirectory!, "metadata.json"), "utf8"))).toMatchObject({
        registry: "npm",
        package: "@example/math@2.3.4",
        name: "@example/math",
        version: "2.3.4",
        description: "Example arithmetic package",
      });

      const second = await generateRegistryPackage({ ...options, output: path.join(temporaryDirectory, "cached-docs") });
      expect(second.cacheHit).toBe(true);
      expect(second.model.functions.map((item) => item.name)).toContain("add");
      expect(manifest).toHaveBeenCalledTimes(1);
      expect(extract).toHaveBeenCalledTimes(1);

      const expired = await generateRegistryPackage({
        ...options,
        output: path.join(temporaryDirectory, "expired-docs"),
        cacheTtlMs: -1,
      });
      expect(expired.cacheHit).toBe(false);

      const refreshed = await generateRegistryPackage({
        ...options,
        output: path.join(temporaryDirectory, "refreshed-docs"),
        refreshCache: true,
      });
      expect(refreshed.cacheHit).toBe(false);
      expect(manifest).toHaveBeenCalledTimes(3);
      expect(extract).toHaveBeenCalledTimes(3);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test("supports disabling the npm cache and overriding generated metadata", async () => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "docs-generator-registry-no-cache-"));
    vi.spyOn(pacote, "manifest").mockResolvedValue({
      name: "example-package",
      version: "1.0.0",
      description: "Manifest description",
    } as Awaited<ReturnType<typeof pacote.manifest>>);
    vi.spyOn(pacote, "extract").mockImplementation(async (_spec, destination) => {
      await writeFile(destination + ".placeholder", "");
      await mkdir(destination, { recursive: true });
      await writeFile(path.join(destination, "index.js"), "export const answer = 42;\n");
      return destination;
    });
    try {
      const result = await generateRegistryPackage({
        registry: "npm",
        package: "example-package",
        output: path.join(temporaryDirectory, "docs"),
        cacheDirectory: path.join(temporaryDirectory, "unused-cache"),
        cache: false,
        title: "Custom title",
        description: "Custom description",
        agentDocs: false,
      });
      expect(result.cacheDirectory).toBeUndefined();
      expect(result.cacheHit).toBe(false);
      expect(result.model).toMatchObject({ title: "Custom title", description: "Custom description" });
      expect((await Promise.all(result.outputs.map((file) => readFile(file, "utf8")))).join("\n")).toContain("Custom title");
      await expect(readFile(path.join(temporaryDirectory, "unused-cache", "metadata.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test("downloads, verifies, extracts, and documents a PyPI wheel", async () => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "docs-generator-registry-wheel-"));
    const wheel = zipEntry(
      "example_pkg/api.py",
      'def greet(name: str):\n    """Greets a user."""\n    return f"Hello {name}"\n',
    );
    const digest = createHash("sha256").update(wheel).digest("hex");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://pypi.org/pypi/example-pkg/1.2.0/json") {
        return Response.json({
          info: { name: "example-pkg", version: "1.2.0", summary: "Example Python package" },
          urls: [
            { filename: "ignored.zip", packagetype: "sdist", url: "https://files.example/ignored.zip", yanked: true },
            {
              filename: "example_pkg-1.2.0-py3-none-any.whl",
              packagetype: "bdist_wheel",
              url: "https://files.example/example.whl",
              size: wheel.length,
              digests: { sha256: digest },
            },
          ],
        });
      }
      if (url === "https://files.example/example.whl") {
        return new Response(wheel, { headers: { "content-length": String(wheel.length) } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    globalThis.fetch = fetchMock as typeof fetch;
    try {
      const result = await generateRegistryPackage({
        registry: "pypi",
        package: "example-pkg==1.2.0",
        output: path.join(temporaryDirectory, "docs"),
        cacheDirectory: path.join(temporaryDirectory, "cache"),
        agentDocs: false,
      });
      expect(result).toMatchObject({
        registry: "pypi",
        package: "example-pkg",
        version: "1.2.0",
        cacheHit: false,
      });
      expect(result.model.functions.map((item) => item.name)).toContain("greet");
      expect(result.model.description).toBe("Example Python package");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test("prefers and extracts a PyPI source distribution with a src layout", async () => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "docs-generator-registry-sdist-"));
    const staging = path.join(temporaryDirectory, "staging", "sample_lib-4.0.0", "src", "sample_lib");
    const archive = path.join(temporaryDirectory, "sample_lib-4.0.0.tar.gz");
    await mkdir(staging, { recursive: true });
    await writeFile(path.join(staging, "core.py"), 'def run():\n    """Runs the sample."""\n');
    await tar.create({ cwd: path.join(temporaryDirectory, "staging"), file: archive, gzip: true }, ["sample_lib-4.0.0"]);
    const archiveData = await readFile(archive);
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://pypi.org/pypi/sample-lib/json") {
        return Response.json({
          info: { name: "sample-lib", version: "4.0.0", summary: "Source package" },
          urls: [{
            filename: "sample_lib-4.0.0.tar.gz",
            packagetype: "sdist",
            url: "https://files.example/sample.tar.gz",
            size: archiveData.length,
          }],
        });
      }
      if (url === "https://files.example/sample.tar.gz") return new Response(archiveData);
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;
    try {
      const result = await generateRegistryPackage({
        registry: "pypi",
        package: "sample-lib",
        output: path.join(temporaryDirectory, "docs"),
        cache: false,
        agentDocs: false,
      });
      expect(result).toMatchObject({ package: "sample-lib", version: "4.0.0", cacheDirectory: undefined });
      expect(result.model.functions.map((item) => item.name)).toContain("run");
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test("rejects unavailable, oversized, truncated, and checksum-mismatched PyPI artifacts", async () => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "docs-generator-registry-errors-"));
    const cases = [
      {
        name: "unavailable artifact",
        urls: [],
        error: /No source distribution or wheel/,
      },
      {
        name: "declared artifact size",
        urls: [{ filename: "package.whl", packagetype: "bdist_wheel", url: "https://files.example/package", size: 11 }],
        maximum: 10,
        error: /exceeds the 10-byte download limit/,
      },
      {
        name: "downloaded artifact size",
        urls: [{ filename: "package.whl", packagetype: "bdist_wheel", url: "https://files.example/package" }],
        maximum: 3,
        body: Buffer.from("four"),
        error: /exceeds the 3-byte download limit/,
      },
      {
        name: "checksum",
        urls: [{ filename: "package.whl", packagetype: "bdist_wheel", url: "https://files.example/package", digests: { sha256: "0".repeat(64) } }],
        body: Buffer.from("content"),
        error: /failed SHA-256 verification/,
      },
    ];
    try {
      for (const item of cases) {
        globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
          if (String(input).startsWith("https://pypi.org/")) {
            return Response.json({ info: { name: "package", version: "1.0.0" }, urls: item.urls });
          }
          return new Response(item.body ?? Buffer.alloc(0));
        }) as typeof fetch;
        await expect(generateRegistryPackage({
          registry: "pypi",
          package: "package",
          output: path.join(temporaryDirectory, item.name),
          cache: false,
          agentDocs: false,
          maxDownloadBytes: item.maximum,
        })).rejects.toThrow(item.error);
      }
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test("reports PyPI registry and artifact download failures", async () => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "docs-generator-registry-http-"));
    try {
      globalThis.fetch = vi.fn(async () => new Response("unavailable", { status: 503, statusText: "Unavailable" })) as typeof fetch;
      await expect(generateRegistryPackage({
        registry: "pypi",
        package: "package",
        output: path.join(temporaryDirectory, "registry-error"),
        cache: false,
        agentDocs: false,
      })).rejects.toThrow(/Registry request failed \(503 Unavailable\)/);

      globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
        if (String(input).startsWith("https://pypi.org/")) {
          return Response.json({
            info: { name: "package", version: "1.0.0" },
            urls: [{ filename: "package.whl", packagetype: "bdist_wheel", url: "https://files.example/package.whl" }],
          });
        }
        return new Response("missing", { status: 404, statusText: "Not Found" });
      }) as typeof fetch;
      await expect(generateRegistryPackage({
        registry: "pypi",
        package: "package",
        output: path.join(temporaryDirectory, "download-error"),
        cache: false,
        agentDocs: false,
      })).rejects.toThrow(/Package download failed \(404 Not Found\)/);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
