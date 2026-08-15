const fs = require("node:fs");
const path = require("node:path");

const projectRoot = process.cwd();
const expoPackageRoot = path.dirname(require.resolve("expo/package.json"));
const routeGeneratorPath = path.join(
  expoPackageRoot,
  "node_modules",
  "@expo",
  "cli",
  "build",
  "src",
  "start",
  "server",
  "type-generation",
  "routes.js",
);

if (!fs.existsSync(routeGeneratorPath)) {
  throw new Error(`Không tìm thấy Expo route generator: ${routeGeneratorPath}`);
}

const { setupTypedRoutes } = require(routeGeneratorPath);
const typesDirectory = path.join(projectRoot, ".expo", "types");
const routerDirectory = path.join(projectRoot, "src", "app");

fs.mkdirSync(typesDirectory, { recursive: true });

setupTypedRoutes({
  projectRoot,
  routerDirectory,
  typesDirectory,
  plugin: undefined,
})
  .then(() => {
    process.stdout.write("Expo Router types generated.\n");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
