const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const flowsDirectory = path.resolve(__dirname, "../e2e/maestro");
const flowFiles = fs
  .readdirSync(flowsDirectory)
  .filter((fileName) => fileName.endsWith(".yaml"))
  .sort();

if (flowFiles.length === 0) {
  throw new Error("No Maestro flow was found.");
}

for (const fileName of flowFiles) {
  const filePath = path.join(flowsDirectory, fileName);
  const documents = YAML.parseAllDocuments(fs.readFileSync(filePath, "utf8"));

  for (const document of documents) {
    if (document.errors.length > 0) {
      throw document.errors[0];
    }
  }

  const metadata = documents[0]?.toJSON();
  if (!metadata || typeof metadata.appId !== "string" || !metadata.appId.trim()) {
    throw new Error(`${fileName} must declare an appId.`);
  }
}

console.log(`Maestro flow syntax valid: ${flowFiles.length} flows.`);
