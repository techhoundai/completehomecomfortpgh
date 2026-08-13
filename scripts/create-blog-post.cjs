const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");

const WEBHOOK_URL =
  "https://bothound-api-908333870065.us-central1.run.app/v1/webhooks/e1102ea3-c994-437d-a6d5-062988c0a743";

async function notifyError(step, message, details = {}) {
  console.error(`[${step}] ${message}`);
  if (Object.keys(details).length > 0) {
    console.error("Details:", JSON.stringify(details, null, 2));
  }

  const secret = process.env.BOTHOUND_WEBHOOK_SECRET;
  if (!secret) {
    console.error(
      "BOTHOUND_WEBHOOK_SECRET not set — cannot send error notification"
    );
    return;
  }

  const payload = {
    event: "blog_post_creation_error",
    timestamp: new Date().toISOString(),
    step,
    message,
    details,
    context: {
      repository: process.env.GITHUB_REPOSITORY || "unknown",
      workflow: "Create Blog Post",
      runId: process.env.GITHUB_RUN_ID || null,
      runUrl:
        process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY
          ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
          : null,
    },
  };

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "BotHound-Webhook-Secret": secret,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`Webhook returned ${res.status}`);
    }
  } catch (err) {
    console.error("Failed to send error webhook:", err.message);
  }
}

async function fail(step, message, details = {}) {
  await notifyError(step, message, details);
  process.exit(1);
}

async function main() {
  let rawPayload = process.env.PAYLOAD;
  if (!rawPayload) {
    await fail("parse_payload", "PAYLOAD environment variable is not set");
  }

  let payload;
  try {
    payload = JSON.parse(rawPayload);
  } catch (err) {
    await fail("parse_payload", "Failed to parse PAYLOAD as JSON", {
      error: err.message,
      payload: rawPayload.slice(0, 2000),
    });
  }

  const required = ["title", "description", "content"];
  const missing = required.filter((f) => !payload[f]);
  if (missing.length > 0) {
    await fail("validate_fields", `Missing required fields: ${missing.join(", ")}`, {
      missingFields: missing,
      providedFields: Object.keys(payload),
    });
  }

  const slug =
    payload.slug ||
    payload.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const filePath = path.join("src", "content", "blog", `${slug}.md`);

  if (fsSync.existsSync(filePath)) {
    await fail("duplicate_slug", `Blog post already exists: ${filePath}`, {
      slug,
      title: payload.title,
      existingFile: filePath,
    });
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

  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
  } catch (err) {
    await fail("write_file", "Failed to write blog post file", {
      error: err.message,
      code: err.code,
      filePath,
      slug,
      title: payload.title,
    });
  }

  console.log(`Created blog post: ${filePath}`);
}

main().catch(async (err) => {
  await notifyError("unexpected", "Unexpected error in create-blog-post script", {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});
