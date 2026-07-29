import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";
import globals from "globals";

/**
 * One flat config for the whole workspace.
 *
 * Why a single root config rather than one per package: the rules that matter here
 * are correctness rules, and correctness does not vary by directory. A shared config
 * also means a new package is linted the moment it exists, instead of the moment
 * someone remembers to add a script.
 *
 * Deliberately NOT type-aware (`recommendedTypeChecked`). Type errors are already
 * caught by `tsc --noEmit` in its own gate; running the type checker twice would
 * roughly triple lint time and buy almost nothing. Lint's job here is the class of
 * bug the compiler cannot see — stale hook dependencies, floating promises in event
 * handlers, unreachable branches.
 *
 * Style is not enforced. There is no formatter argument to have: rules that only
 * reformat code are noise in review and get disabled the first time they block a
 * hotfix.
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/*.d.ts",
      "packages/db/prisma/migrations/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Unused code is either a mistake or a leftover; both should be visible.
      // The underscore escape hatch is for genuinely-required-but-unused params
      // (React error boundary signatures, catch bindings).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // `any` defeats the type system this repo pays for. Warn rather than error so
      // it surfaces in review without blocking an urgent fix.
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-implicit-coercion": "error",
      "prefer-const": "error",
    },
  },

  // React surfaces — the hook rules are the reason this config exists. A stale
  // dependency array is a data-correctness bug in a product about deadlines.
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "@next/next": nextPlugin },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      // App Router only — there is no /pages directory for this rule to scan.
      "@next/next/no-html-link-for-pages": "off",
    },
  },

  // Tests may reach for shapes the production types forbid in order to prove the
  // production types hold.
  {
    files: ["**/*.test.{ts,tsx}", "**/tests/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },

  // Scripts and config run in Node and legitimately log.
  {
    files: ["**/scripts/**/*.ts", "*.config.{ts,js,mjs}", "**/vitest.config.ts"],
    rules: { "no-console": "off" },
  },
);
