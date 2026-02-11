import globals from "globals"
import tseslint from "typescript-eslint"
import { defineConfig } from "eslint/config"
import eslintConfigPrettier from "eslint-config-prettier/flat"

export default defineConfig([
  {
    files: [
      "src/**/*.{js,mjs,cjs,ts,mts,cts}",
      "eslint.config.ts",
      "prettier-config.ts",
    ],
    languageOptions: { globals: globals.node },
  },
  tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    rules: {
      "prefer-const": [
        "error",
        {
          ignoreReadBeforeAssign: true,
        },
      ],
    },
  },
])
