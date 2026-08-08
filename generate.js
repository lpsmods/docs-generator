import { generateDirectory } from "./dist/index.js";

export async function build() {
  await generateDirectory({
    input: "src",
    output: "docs/reference",
    vitepress: { sidebar: "docs/sidebar.json" },
  });
}

build();
