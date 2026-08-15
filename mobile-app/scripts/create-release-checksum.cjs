const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const artifactPath = process.argv[2];
if (!artifactPath) {
  throw new Error("Usage: npm run release:checksum -- <path-to-apk>");
}

const resolvedPath = path.resolve(process.cwd(), artifactPath);
if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
  throw new Error(`Release artifact not found: ${resolvedPath}`);
}

const digest = crypto.createHash("sha256");
const input = fs.createReadStream(resolvedPath);
input.on("data", (chunk) => digest.update(chunk));
input.on("error", (error) => {
  throw error;
});
input.on("end", () => {
  console.log(JSON.stringify({
    artifact: path.relative(process.cwd(), resolvedPath),
    bytes: fs.statSync(resolvedPath).size,
    sha256: digest.digest("hex"),
    generatedAt: new Date().toISOString(),
  }, null, 2));
});
