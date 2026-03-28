import esbuild from "esbuild";
import process from "node:process";

const production = process.argv.includes("production");

const context = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  platform: "node",
  external: ["obsidian", "electron"],
  format: "cjs",
  target: "es2022",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  logLevel: "info",
  outfile: "main.js"
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
