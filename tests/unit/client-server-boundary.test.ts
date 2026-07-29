import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const sourceRoot = join(process.cwd(), "src");
const clientDirectivePattern = /^\s*["']use client["'];/;
const serverImportPattern =
  /(?:from\s+|import\s*\()\s*["'](?:@\/server(?:\/|["'])|[^"']*\/src\/server\/)/;

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {
    withFileTypes: true,
  });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(path)));
    } else if ([".ts", ".tsx"].includes(extname(entry.name))) {
      files.push(path);
    }
  }

  return files;
}

describe("граница клиентского и серверного кода", () => {
  it("не допускает импорт src/server из клиентских модулей", async () => {
    const violations: string[] = [];

    for (const path of await collectSourceFiles(sourceRoot)) {
      const source = await readFile(path, "utf8");

      if (
        clientDirectivePattern.test(source) &&
        serverImportPattern.test(source)
      ) {
        violations.push(relative(process.cwd(), path));
      }
    }

    expect(violations).toEqual([]);
  });
});
