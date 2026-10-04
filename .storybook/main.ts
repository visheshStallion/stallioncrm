import path from "node:path";
import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";

const root = process.cwd();
const mock = (f: string) => path.resolve(root, ".storybook/mocks", f);

/** Component library docs (prompt 17 §4). Next.js routing and server actions are mocked. */
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  framework: { name: "@storybook/react-vite", options: {} },
  core: { disableTelemetry: true },
  viteFinal: async (cfg) => {
    cfg.plugins = [...(cfg.plugins ?? []), tailwindcss()];
    cfg.resolve = {
      ...cfg.resolve,
      alias: [
        { find: "next/link", replacement: mock("next-link.tsx") },
        { find: "next/navigation", replacement: mock("next-navigation.ts") },
        { find: /^@\/server\/modules\/.*\/actions$/, replacement: mock("actions.ts") },
        { find: "@/app/(crm)/actions", replacement: mock("actions.ts") },
        { find: "server-only", replacement: mock("empty.ts") },
        { find: "@", replacement: path.resolve(root, "src") },
      ],
    };
    return cfg;
  },
};
export default config;
