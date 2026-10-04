import type { Decorator, Preview } from "@storybook/react-vite";
import "../src/app/globals.css";

/** Light/dark and comfortable/compact variants from the toolbar. */
const withTheme: Decorator = (Story, ctx) => {
  const html = document.documentElement;
  html.classList.toggle("dark", ctx.globals.theme === "dark");
  html.dataset.density = ctx.globals.density;
  return (
    <div className="bg-canvas p-6 text-text">
      <Story />
    </div>
  );
};

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: "Colour theme",
      toolbar: { title: "Theme", icon: "mirror", items: ["light", "dark"], dynamicTitle: true },
    },
    density: {
      description: "Table density",
      toolbar: { title: "Density", icon: "component", items: ["comfortable", "compact"], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: "light", density: "comfortable" },
  parameters: { layout: "fullscreen", controls: { expanded: true } },
};
export default preview;
