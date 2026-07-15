import { access } from "node:fs/promises";
import { constants } from "node:fs";

const requiredArtifacts = [
  ".next/routes-manifest.json",
  ".next/server/app-paths-manifest.json",
];

try {
  await Promise.all(
    requiredArtifacts.map((artifact) => access(artifact, constants.R_OK)),
  );
} catch (error) {
  console.error(
    `Vercel build contract failed: ${error.path ?? "a required Next.js artifact"} is missing.`,
  );
  process.exitCode = 1;
}
