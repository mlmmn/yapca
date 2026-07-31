/* eslint-disable @typescript-eslint/no-deprecated -- tseslint.config() is the only way to use extends; core defineConfig has incompatible API */
import { includeIgnoreFile } from "@eslint/config-helpers";
import eslint from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import eslintPluginAstro from "eslint-plugin-astro";
import pluginReact from "eslint-plugin-react";
import reactCompiler from "eslint-plugin-react-compiler";
import eslintPluginReactHooks from "eslint-plugin-react-hooks";
import path from "node:path";
import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";
import vitestPlugin from "@vitest/eslint-plugin";

const gitignorePath = path.resolve(import.meta.dirname, ".gitignore");

const baseConfig = tseslint.config({
  extends: [eslint.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
  plugins: {
    "@stylistic": stylistic,
  },
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    "no-console": "warn",
    "no-unused-vars": "off",
    curly: ["error", "all"],
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],
    "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
    "@typescript-eslint/consistent-type-definitions": ["error", "type"],
    "@typescript-eslint/no-non-null-assertion": "error",
    "no-nested-ternary": "error",
    "no-unneeded-ternary": "error",
    "@stylistic/padding-line-between-statements": [
      "warn",
      {
        blankLine: "never",
        next: ["import"],
        prev: ["import"],
      },
      {
        blankLine: "never",
        next: ["const", "let", "var"],
        prev: ["const", "let", "var"],
      },
      {
        blankLine: "any",
        next: ["const", "let", "var", "multiline-const", "multiline-let", "multiline-var"],
        prev: ["multiline-const", "multiline-let", "multiline-var"],
      },
      {
        blankLine: "any",
        next: ["multiline-const", "multiline-let", "multiline-var"],
        prev: ["const", "let", "var", "multiline-const", "multiline-let", "multiline-var"],
      },
      {
        blankLine: "always",
        next: ["expression"],
        prev: ["const", "let", "var"],
      },
      {
        blankLine: "always",
        next: ["const", "let", "var"],
        prev: ["expression", "import"],
      },
      {
        blankLine: "always",
        next: ["*"],
        prev: ["block-like", "default"],
      },
      {
        blankLine: "always",
        next: ["block-like", "default"],
        prev: ["*"],
      },
      {
        blankLine: "any",
        next: ["case"],
        prev: ["case"],
      },
      {
        blankLine: "always",
        next: ["case"],
        prev: ["block-like"],
      },
      {
        blankLine: "always",
        next: ["expression", "const", "let", "var"],
        prev: ["require"],
      },
      {
        blankLine: "never",
        next: ["require"],
        prev: ["require"],
      },
      {
        blankLine: "always",
        next: ["return"],
        prev: ["*"],
      },
    ],
  },
});

const reactConfig = tseslint.config({
  files: ["**/*.{js,jsx,ts,tsx}"],
  extends: [pluginReact.configs.flat.recommended],
  languageOptions: {
    ...pluginReact.configs.flat.recommended.languageOptions,
    globals: {
      window: true,
      document: true,
    },
  },
  plugins: {
    "react-hooks": eslintPluginReactHooks,
    "react-compiler": reactCompiler,
  },
  settings: { react: { version: "detect" } },
  rules: {
    ...eslintPluginReactHooks.configs.recommended.rules,
    "react/react-in-jsx-scope": "off",
    "react-compiler/react-compiler": "error",
    "react/no-multi-comp": "error",
    "react/jsx-no-useless-fragment": [
      "warn",
      {
        allowExpressions: true,
      },
    ],
    "react/jsx-one-expression-per-line": "warn",
    "react/no-unstable-nested-components": [
      "error",
      {
        allowAsProps: true,
      },
    ],
  },
});

const shadcnUiConfig = tseslint.config({
  // shadcn's generated compound-component files (e.g. Dialog + DialogTrigger + ...)
  // intentionally group several tightly-coupled parts per file; re-running
  // `shadcn add` would just reintroduce any split, so this rule doesn't apply here.
  files: ["src/components/ui/**/*.{ts,tsx}"],
  rules: {
    "react/no-multi-comp": "off",
  },
});

const testConfig = tseslint.config({
  // Test files intentionally use assertion-focused idioms that are not production code patterns.
  files: ["**/*.test.ts", "**/*.test.tsx"],
  plugins: {
    vitest: vitestPlugin,
  },
  rules: {
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/unbound-method": "off",
    "react/no-multi-comp": "off",
    "vitest/consistent-test-it": ["error", { fn: "test", withinDescribe: "test" }],
  },
});

const astroConfig = tseslint.config({
  files: ["**/*.astro"],
  rules: {
    "astro/no-set-html-directive": "error",
    "astro/no-unused-css-selector": "warn",
    "astro/prefer-class-list-directive": "warn",
  },
});

const ambientTypesConfig = tseslint.config({
  files: ["**/*.d.ts"],
  rules: {
    // Ambient global/namespace augmentation (e.g. `declare namespace App`) requires
    // `interface` — `type` aliases cannot participate in declaration merging.
    "@typescript-eslint/consistent-type-definitions": "off",
  },
});

export default tseslint.config(
  includeIgnoreFile(gitignorePath),
  {
    // `src/lib/database.types.ts` is generated by `supabase gen types typescript` — its
    // generic helper types trip strict rules (e.g. no-redundant-type-constituents) that
    // would just recur on every regeneration; never hand-edit this file anyway.
    //
    // `supabase/.temp/**` holds runtime artifacts written by `pnpx supabase start`. It is
    // git-ignored, but via the nested `supabase/.gitignore` — and `includeIgnoreFile` above
    // reads the root `.gitignore` only, so those files still reach the type-aware parser and
    // fail it for living outside `tsconfig.json`. Without this, `pnpm lint` exits 1 whenever
    // the local stack is running, which is the normal state for `pnpm test:integration`.
    ignores: [".claude/**", "src/lib/database.types.ts", "supabase/.temp/**"],
  },
  baseConfig,
  reactConfig,
  eslintPluginAstro.configs["flat/recommended"],
  ...eslintPluginAstro.configs["flat/jsx-a11y-recommended"],
  astroConfig,
  ambientTypesConfig,
  shadcnUiConfig,
  testConfig,
  eslintPluginPrettier,
);
