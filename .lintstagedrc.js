const path = require("path");

const buildNextEslintCommand = (filenames) =>
  `yarn workspace @sh/nextjs eslint --fix ${filenames
    .map((f) => path.relative(path.join("packages", "nextjs"), f))
    .join(" ")}`;

const checkTypesNextCommand = () => "yarn next:check-types";
const buildFoundryFmtCommand = (filenames) =>
  `yarn workspace @sh/foundry exec forge fmt ${filenames
    .map((f) => path.relative(path.join("packages", "foundry"), f))
    .join(" ")}`;
const buildFoundryLintCommand = (filenames) =>
  `yarn workspace @sh/foundry exec forge fmt --check ${filenames
    .map((f) => path.relative(path.join("packages", "foundry"), f))
    .join(" ")}`;

module.exports = {
  "packages/nextjs/**/*.{ts,tsx}": [
    buildNextEslintCommand,
    checkTypesNextCommand,
  ],
  "packages/foundry/**/*.sol": [
    buildFoundryFmtCommand,
    buildFoundryLintCommand,
  ],
};
