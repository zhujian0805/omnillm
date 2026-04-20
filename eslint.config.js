import config from "@echristian/eslint-config"

export default config(
  {
    prettier: {
      plugins: ["prettier-plugin-packagejson"],
    },
    ignores: ["scripts/claude-tool-hook.cjs", "tests/", "scripts/"],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off",
      "max-depth": "off",
      "max-params": "off",
      complexity: "off",
    },
  },
)
