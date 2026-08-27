const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

const APIFY_API_URL = 'https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items';
const IG_PROFILE_URL = 'https://www.instagram.com/complete_home_comfort_llc/';
const FILTER_HASHTAG = 'chchvacwebsite';
const MAX_POSTS = 50;
const REQUEST_TIMEOUT_MS = 300000;
const DATA_FILE = path.join(__dirname, '..', 'src', 'data', 'gallery.json');
const GALLERY_DIR = path.join(__dirname, '..', 'public', 'media', 'gallery');
const WEBHOOK_URL = 'https://bothound-api-908333870065.us-central1.run.app/v1/webhooks/e1102ea3-c994-437d-a6d5-062988c0a743';

async function notifyError(step, message, details = {}) {
  console.error(`[${step}] ${message}`);
  if (Object.keys(details).length > 0) {
    console.error('Details:', JSON.stringify(details, null, 2));
  }

  const secret = process.env.BOTHOUND_WEBHOOK_SECRET;
  if (!secret) {
    console.error('BOTHOUND_WEBHOOK_SECRET not set — cannot send error notification');
    return;
  }

  const payload = {
    event: 'instagram_gallery_fetch_error',
    timestamp: new Date().toISOString(),
    step,
    message,
    details,
    context: {
      repository: process.env.GITHUB_REPOSITORY || 'techhoundai/completehomecomfortpgh',
      workflow: 'Fetch Instagram Gallery',
      runId: process.env.GITHUB_RUN_ID || null,
      runUrl: process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY
        ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : null
    }
  };

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'BotHound-Webhook-Secret': secret
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      console.error(`Webhook returned ${res.status}`);
    }
  } catch (err) {
    console.error('Failed to send error webhook:', err.message);
  }
}

async function fail(step, message, details = {}) {
  await notifyError(step, message, details);
  process.exit(1);
}

function slugify(caption, id, ext = 'webp') {
  const slug = caption
    .replace(/#\w+/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug ? `${slug}-${id}.${ext}` : `project-${id}.${ext}`;
}

function deriveAltText(caption) {
  if (!caption) return 'HVAC project by Complete Home Comfort';
  const cleaned = caption
    .replace(/#\w+/g, '')
    .replace(/\n+/g, ' ')
    .trim();
  if (!cleaned) return 'HVAC project by Complete Home Comfort';
  const firstSentence = cleaned.match(/^[^.!?]+[.!?]?/);
  const text = firstSentence ? firstSentence[0].trim() : cleaned;
  return text.slice(0, 120);
}

async function downloadImage(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await sharp(buffer)
    .resize(1200, null, { withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(destPath);
}

async function downloadVideo(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(destPath, buffer);
}

async function main() {
  const apifyToken = process.env.APIFY_API_TOKEN;

  if (!apifyToken) {
    await fail('validate_env', 'Missing required environment variable: APIFY_API_TOKEN');
  }

  // --- Fetch posts from Instagram via Apify ---

  let response;
  try {
    response = await fetch(`${APIFY_API_URL}?token=${apifyToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resultsType: 'posts',
        directUrls: [IG_PROFILE_URL],
        resultsLimit: MAX_POSTS
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (err) {
    if (err.name === 'TimeoutError') {
      await fail('api_timeout', `Apify request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    await fail('api_request', 'Network error calling Apify API', {
      error: err.message,
      cause: err.cause?.message || err.cause?.code || String(err.cause || '')
    });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '(could not read response body)');
    await fail('api_response', `Apify API returned HTTP ${response.status}`, {
      statusCode: response.status,
      responseBody: body.slice(0, 2000)
    });
  }

  let posts;
  try {
    posts = await response.json();
  } catch (err) {
    await fail('parse_response', 'Failed to parse API response as JSON', {
      error: err.message
    });
  }

  if (!Array.isArray(posts)) {
    await fail('unexpected_format', 'API response is not an array', {
      type: typeof posts,
      preview: JSON.stringify(posts).slice(0, 500)
    });
  }

  console.log(`Fetched ${posts.length} posts from Instagram.`);

  // --- Filter by hashtag, sort newest-first, cap at MAX_POSTS ---

  const matchingPosts = posts.filter(post => {
    const tags = (post.hashtags || []).map(t => t.toLowerCase());
    return tags.includes(FILTER_HASHTAG);
  });

  console.log(`${matchingPosts.length} posts match #${FILTER_HASHTAG} (${posts.length} total).`);

  matchingPosts.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  const cappedPosts = matchingPosts.slice(0, MAX_POSTS);
  if (matchingPosts.length > MAX_POSTS) {
    console.log(`  Capped to newest ${MAX_POSTS} posts (${matchingPosts.length - MAX_POSTS} oldest skipped).`);
  }

  // --- Build desired entries from posts ---

  const desired = [];
  for (const post of cappedPosts) {
    if (!post.shortCode) {
      await fail('missing_shortcode', 'API returned a post without a shortCode', {
        post: JSON.stringify(post).slice(0, 500)
      });
    }
    if (!post.timestamp) {
      await fail('missing_timestamp', 'API returned a post without a timestamp', {
        shortCode: post.shortCode
      });
    }

    const caption = post.caption || '';
    const alt = deriveAltText(caption);
    const instagramUrl = post.url || `https://www.instagram.com/p/${post.shortCode}/`;

    if (post.type === 'Sidecar' && Array.isArray(post.childPosts)) {
      post.childPosts.forEach((child, i) => {
        const id = `${post.shortCode}-${i}`;
        const isVideo = child.type === 'Video';
        const entry = {
          displayUrl: child.displayUrl,
          caption, alt,
          filename: slugify(caption, id),
          type: isVideo ? 'video' : 'image',
          instagramUrl,
          timestamp: post.timestamp
        };
        if (isVideo) {
          entry.videoUrl = child.videoUrl;
          entry.videoFilename = slugify(caption, id, 'mp4');
        }
        desired.push(entry);
      });
    } else {
      const isVideo = post.type === 'Video';
      const entry = {
        displayUrl: post.displayUrl,
        caption, alt,
        filename: slugify(caption, post.shortCode),
        type: isVideo ? 'video' : 'image',
        instagramUrl,
        timestamp: post.timestamp
      };
      if (isVideo) {
        entry.videoUrl = post.videoUrl;
        entry.videoFilename = slugify(caption, post.shortCode, 'mp4');
      }
      desired.push(entry);
    }
  }

  const videoCount = desired.filter(e => e.type === 'video').length;
  const imageCount = desired.length - videoCount;
  console.log(`${desired.length} total items (${imageCount} images, ${videoCount} videos, including carousel slides).`);

  if (desired.length === 0) {
    console.log('No matching posts found. Nothing to do.');
    process.exit(0);
  }

  // --- Download all files fresh ---

  await fs.mkdir(GALLERY_DIR, { recursive: true });

  const desiredFilenames = new Set();
  let failed = 0;
  for (const entry of desired) {
    if (!entry.displayUrl) {
      console.warn(`  ! No displayUrl for ${entry.filename}. Skipping.`);
      failed++;
      continue;
    }

    desiredFilenames.add(entry.filename);
    try {
      await downloadImage(entry.displayUrl, path.join(GALLERY_DIR, entry.filename));
    } catch (err) {
      console.warn(`  ! Failed to download ${entry.filename}: ${err.message}. Skipping.`);
      desiredFilenames.delete(entry.filename);
      failed++;
      continue;
    }

    if (entry.type === 'video' && entry.videoUrl && entry.videoFilename) {
      desiredFilenames.add(entry.videoFilename);
      try {
        await downloadVideo(entry.videoUrl, path.join(GALLERY_DIR, entry.videoFilename));
      } catch (err) {
        console.warn(`  ! Failed to download ${entry.videoFilename}: ${err.message}. Skipping.`);
        desiredFilenames.delete(entry.videoFilename);
        failed++;
      }
    }
  }

  console.log(`Downloaded ${desiredFilenames.size} files${failed > 0 ? ` (${failed} failed)` : ''}.`);

  if (desiredFilenames.size === 0) {
    await fail('all_downloads_failed', `All ${desired.length} downloads failed — aborting to preserve existing gallery`);
  }

  // --- Delete files not in the desired set ---

  const existingFiles = await fs.readdir(GALLERY_DIR);
  let deleted = 0;
  for (const file of existingFiles) {
    if (!desiredFilenames.has(file)) {
      try {
        await fs.unlink(path.join(GALLERY_DIR, file));
        deleted++;
      } catch (e) {
        if (e.code !== 'ENOENT') console.warn(`  Could not delete ${file}: ${e.message}`);
      }
    }
  }
  if (deleted > 0) console.log(`Deleted ${deleted} old files.`);

  // --- Write gallery.json if entries changed ---

  const galleryEntries = desired
    .filter(e => desiredFilenames.has(e.filename))
    .map(({ displayUrl, videoUrl, ...rest }) => rest);

  let existing = [];
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    existing = JSON.parse(raw).images || [];
  } catch {}

  if (JSON.stringify(galleryEntries) === JSON.stringify(existing)) {
    console.log('No changes to gallery data. Skipping write.');
    process.exit(0);
  }

  const output = {
    lastUpdated: new Date().toISOString(),
    images: galleryEntries
  };

  try {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(output, null, 2) + '\n');
  } catch (err) {
    await fail('write_file', 'Failed to write gallery data file', {
      error: err.message,
      code: err.code,
      filePath: DATA_FILE
    });
  }

  console.log(`Wrote ${galleryEntries.length} gallery entries.`);
}

main().catch(async (err) => {
  await notifyError('unexpected', 'Unexpected error in fetch-gallery script', {
    error: err.message,
    stack: err.stack
  });
  process.exit(1);
});
