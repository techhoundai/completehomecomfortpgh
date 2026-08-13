import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { siteConfig } from "../data/siteConfig";

export async function GET(context: any) {
  const posts = (await getCollection("blog"))
    .filter((post) => !post.data.draft)
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());

  return rss({
    title: `${siteConfig.name} Blog`,
    description:
      "HVAC tips, maintenance advice, and home comfort insights for Pittsburgh homeowners.",
    site: context.site,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.date,
      description: post.data.description,
      link: `/blog/${post.id}/`,
    })),
  });
}
