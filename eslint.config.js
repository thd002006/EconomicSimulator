import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "public/generated/**",
      "src-tauri/target/**"
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.worker
      }
    },
    rules: {
      "no-console": "off",
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }]
    }
  }
);
