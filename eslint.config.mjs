// @ts-check
import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Brand isolation guard-rail: the raw (unscoped) Prisma client lives in src/server/db/unsafe.ts.
 * Application code must go through scopedDb(ctx). Only src/server/db, the seed, scripts and tests
 * may touch the raw client.
 */
export const UNSAFE_DB_MESSAGE =
  "The unscoped Prisma client bypasses brand isolation. Use scopedDb(ctx) from '@/server/db' (see docs/ARCHITECTURE.md).";

const unsafeImportRule = [
  "error",
  {
    paths: [
      {
        name: "@prisma/client",
        importNames: ["PrismaClient"],
        message: UNSAFE_DB_MESSAGE,
      },
    ],
    patterns: [
      {
        regex: "(^|/)db/unsafe(\\.ts)?$",
        message: UNSAFE_DB_MESSAGE,
      },
    ],
  },
];

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".local/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      "prompt/**",
      "storybook-static/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: {
      "@next/next": nextPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-restricted-imports": unsafeImportRule,
    },
  },
  {
    // The only places allowed to use the raw client.
    files: ["src/server/db/**", "prisma/**", "scripts/**", "tests/**"],
    rules: { "no-restricted-imports": "off" },
  },
);
