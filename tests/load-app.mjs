// Loads src/gymbot.jsx in Node so unit tests can call its functions directly.
// The file is a single-file artifact whose only export is the App, so we bundle a copy with one extra
// export line. UI libraries are replaced by empty stand-ins generated from the file's own import lines,
// so the stand-ins never fall out of date when an icon is added.
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STUBBED = ["lucide-react", "recharts", "papaparse"];

function importedNames(source, module) {
  const match = source.match(new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*"${module}"`));
  return match ? match[1].split(",").map((name) => name.trim()).filter(Boolean) : [];
}

const stubLibraries = (source) => ({
  name: "stub-ui-libraries",
  setup(build) {
    build.onResolve({ filter: new RegExp(`^(${STUBBED.join("|")})$`) }, (args) => ({ path: args.path, namespace: "stub" }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
      contents: [
        "const Stub = () => null;",
        "export default { parse: () => ({ data: [], meta: { fields: [] } }) };",
        ...importedNames(source, args.path).map((name) => `export const ${name} = Stub;`),
      ].join("\n"),
      loader: "js",
    }));
  },
});

export async function loadApp(names) {
  const source = await readFile(path.join(ROOT, "src/gymbot.jsx"), "utf8");
  const result = await build({
    stdin: { contents: `${source}\nexport { ${names.join(", ")} };\n`, loader: "jsx", resolveDir: path.join(ROOT, "src"), sourcefile: "gymbot.jsx" },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    plugins: [stubLibraries(source)],
    logLevel: "silent",
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}
