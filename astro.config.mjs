import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://completehomecomfortpgh.com",
  trailingSlash: "always",
  integrations: [
    tailwind(),
    sitemap({
      serialize(item) {
        const url = item.url;
        if (url === "https://completehomecomfortpgh.com/") {
          item.priority = 1.0;
          item.changefreq = "weekly";
        } else if (
          url.includes("/heating") ||
          url.includes("/cooling") ||
          url.includes("/services") ||
          url.includes("/repair") ||
          url.includes("/maintenance") ||
          url.includes("/installation")
        ) {
          item.priority = 0.9;
          item.changefreq = "monthly";
        } else if (url.includes("/gallery") || url.includes("/testimonials")) {
          item.priority = 0.8;
          item.changefreq = "weekly";
        } else if (url === "https://completehomecomfortpgh.com/blog/") {
          item.priority = 0.7;
          item.changefreq = "weekly";
        } else if (url.includes("/blog/")) {
          item.priority = 0.6;
          item.changefreq = "monthly";
        } else {
          item.priority = 0.6;
          item.changefreq = "monthly";
        }
        return item;
      },
    }),
  ],
});
