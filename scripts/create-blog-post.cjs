const fs = require("fs");
const path = require("path");

const payload = JSON.parse(process.env.PAYLOAD);

const required = ["title", "description", "content"];
const missing = required.filter((f) => !payload[f]);
if (missing.length > 0) {
  console.error(`Missing required fields: ${missing.join(", ")}`);
  process.exit(1);
}

const slug =
  payload.slug ||
  payload.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const filePath = path.join("src", "content", "blog", `${slug}.md`);

if (fs.existsSync(filePath)) {
  console.error(`Blog post already exists: ${filePath}`);
  process.exit(1);
}

const date = payload.date || new Date().toISOString().split("T")[0];

function esc(str) {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

let fm = "---\n";
fm += `title: "${esc(payload.title)}"\n`;
fm += `description: "${esc(payload.description)}"\n`;
fm += `date: ${date}\n`;
if (payload.author) fm += `author: "${esc(payload.author)}"\n`;
if (Array.isArray(payload.tags) && payload.tags.length > 0) {
  fm += `tags: [${payload.tags.map((t) => `"${esc(t)}"`).join(", ")}]\n`;
}
fm += `draft: false\n`;
if (Array.isArray(payload.relatedPosts) && payload.relatedPosts.length > 0) {
  fm += "relatedPosts:\n";
  for (const rp of payload.relatedPosts) {
    fm += `  - ${rp}\n`;
  }
}
if (Array.isArray(payload.faq) && payload.faq.length > 0) {
  fm += "faq:\n";
  for (const item of payload.faq) {
    fm += `  - question: "${esc(item.question)}"\n`;
    fm += `    answer: "${esc(item.answer)}"\n`;
  }
}
fm += "---\n\n";

const content = fm + payload.content.trim() + "\n";
fs.mkdirSync(path.dirname(filePath), { recursive: true });
fs.writeFileSync(filePath, content, "utf-8");

console.log(`Created blog post: ${filePath}`);
