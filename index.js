import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { rollup } from "rollup";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";

const files = fileURLToPath(new URL("./files", import.meta.url).href);

/** @type {import('.').default} */
export default function (opts = {}) {
  const { out = "build", precompress, envPrefix = "" } = opts;

  return {
    name: "@tessellator/sveltekit-adapter-lambda",

    async adapt(builder) {
      const tmp = builder.getBuildDirectory("adapter-lambda");

      builder.rimraf(out);
      builder.rimraf(tmp);
      builder.mkdirp(tmp);

      builder.log.minor("Copying assets");
      builder.writeClient(`${out}/client`);
      builder.writePrerendered(`${out}/prerendered`);

      if (precompress) {
        builder.log.minor("Compressing assets");
        await Promise.all([
          builder.compress(`${out}/client`),
          builder.compress(`${out}/prerendered`),
        ]);
      }

      builder.log.minor("Building server");

      builder.writeServer(tmp);

      writeFileSync(
        `${tmp}/manifest.js`,
        `export const manifest = ${builder.generateManifest({
          relativePath: "./",
        })};`
      );

      const pkg = JSON.parse(readFileSync("package.json", "utf8"));

      // we bundle the Vite output so that deployments only need
      // their production dependencies. Anything in devDependencies
      // will get included in the bundled code
      const bundle = await rollup({
        input: {
          index: `${tmp}/index.js`,
          manifest: `${tmp}/manifest.js`,
        },
        external: [...Object.keys(pkg.dependencies || {})],
        plugins: [nodeResolve({ preferBuiltins: true }), commonjs(), json()],
      });

      await bundle.write({
        dir: `${out}/server`,
        format: "esm",
        sourcemap: true,
        chunkFileNames: `chunks/[name]-[hash].js`,
      });

      builder.copy(files, out, {
        replace: {
          ENV: "./env.js",
          HANDLER: "./handler.js",
          MANIFEST: "./server/manifest.js",
          SERVER: `./server/index.js`,
          ENV_PREFIX: JSON.stringify(envPrefix),
        },
      });
    },
  };
}
