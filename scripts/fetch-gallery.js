const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

const APIFY_API_URL = 'https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items';
const IG_PROFILE_URL = 'https://www.instagram.com/complete_home_comfort_llc/';
const FILTER_HASHTAG = 'pittsburghhvac';
const MAX_IMAGES = 50;
const REQUEST_TIMEOUT_MS = 300000;
const DATA_FILE = path.join(__dirname, '..', 'data', 'gallery.json');
const GALLERY_DIR = path.join(__dirname, '..', 'media', 'gallery');
const GALLERY_HTML = path.join(__dirname, '..', 'gallery', 'index.html');
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

async function optimizeAndSave(buffer, destPath) {
  await sharp(buffer)
    .resize(1200, null, { withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(destPath);
}

async function downloadImage(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await optimizeAndSave(buffer, destPath);
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

  let existing = { images: [] };
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    existing = JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('No existing gallery file — starting fresh.');
    } else {
      await fail('read_existing', 'Existing gallery file is corrupt or unreadable', {
        error: err.message,
        code: err.code
      });
    }
  }

  const input = {
    resultsType: 'posts',
    directUrls: [IG_PROFILE_URL],
    resultsLimit: MAX_IMAGES
  };

  let response;
  try {
    response = await fetch(`${APIFY_API_URL}?token=${apifyToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
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

  const matchingPosts = posts.filter(post => {
    const tags = (post.hashtags || []).map(t => t.toLowerCase());
    return tags.includes(FILTER_HASHTAG);
  });

  console.log(`${matchingPosts.length} posts match #${FILTER_HASHTAG} (${posts.length} total).`);

  const entries = [];
  for (const post of matchingPosts) {
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
          id,
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
        entries.push(entry);
      });
    } else {
      const isVideo = post.type === 'Video';
      const entry = {
        id: post.shortCode,
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
      entries.push(entry);
    }
  }

  const videoCount = entries.filter(e => e.type === 'video').length;
  const imageCount = entries.length - videoCount;
  console.log(`${entries.length} total items (${imageCount} images, ${videoCount} videos, including carousel slides).`);

  if (entries.length === 0 && existing.images.length === 0) {
    console.log('No matching posts found and no existing gallery. Nothing to do.');
    process.exit(0);
  }

  const existingById = new Map(existing.images.map(img => [img.id, img]));
  const freshIds = new Set(entries.map(e => e.id));
  let added = 0;
  let updated = 0;
  let removed = 0;

  for (const [id, img] of existingById) {
    if (!freshIds.has(id)) {
      try {
        await fs.unlink(path.join(GALLERY_DIR, img.filename));
      } catch (e) {
        if (e.code !== 'ENOENT') console.warn(`Could not delete ${img.filename}: ${e.message}`);
      }
      if (img.videoFilename) {
        try {
          await fs.unlink(path.join(GALLERY_DIR, img.videoFilename));
        } catch (e) {
          if (e.code !== 'ENOENT') console.warn(`Could not delete ${img.videoFilename}: ${e.message}`);
        }
      }
      console.log(`  - Removed: ${img.filename} (${id})`);
      existingById.delete(id);
      removed++;
    }
  }

  await fs.mkdir(GALLERY_DIR, { recursive: true });

  for (const entry of entries) {
    const { id, displayUrl, videoUrl, caption, alt, filename, type, videoFilename, instagramUrl, timestamp } = entry;
    const parsed = { id, caption, alt, filename, type, instagramUrl, timestamp };
    if (videoFilename) parsed.videoFilename = videoFilename;

    if (existingById.has(id)) {
      const old = existingById.get(id);
      if (old.caption !== caption) {
        if (old.filename !== filename) {
          try { await fs.rename(path.join(GALLERY_DIR, old.filename), path.join(GALLERY_DIR, filename)); }
          catch (e) { if (e.code !== 'ENOENT') console.warn(`Could not rename ${old.filename}: ${e.message}`); }
        }
        if (old.videoFilename && videoFilename && old.videoFilename !== videoFilename) {
          try { await fs.rename(path.join(GALLERY_DIR, old.videoFilename), path.join(GALLERY_DIR, videoFilename)); }
          catch (e) { if (e.code !== 'ENOENT') console.warn(`Could not rename ${old.videoFilename}: ${e.message}`); }
        }
        console.log(`  ~ Updated: ${filename} (${id})`);
        existingById.set(id, parsed);
        updated++;
      }
    } else {
      try {
        await downloadImage(displayUrl, path.join(GALLERY_DIR, filename));
        if (type === 'video' && videoUrl && videoFilename) {
          await downloadVideo(videoUrl, path.join(GALLERY_DIR, videoFilename));
        }
        console.log(`  + Added: ${filename} (${id})${type === 'video' ? ' [video]' : ''}`);
        existingById.set(id, parsed);
        added++;
      } catch (err) {
        console.warn(`  ! Failed to download ${id}: ${err.message}. Skipping.`);
      }
    }
  }

  const merged = Array.from(existingById.values());
  merged.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const overflow = merged.splice(MAX_IMAGES);
  for (const img of overflow) {
    try { await fs.unlink(path.join(GALLERY_DIR, img.filename)); } catch (e) { if (e.code !== 'ENOENT') console.warn(`Could not delete ${img.filename}: ${e.message}`); }
    if (img.videoFilename) {
      try { await fs.unlink(path.join(GALLERY_DIR, img.videoFilename)); } catch (e) { if (e.code !== 'ENOENT') console.warn(`Could not delete ${img.videoFilename}: ${e.message}`); }
    }
  }
  if (overflow.length > 0) console.log(`  - Capped: removed ${overflow.length} oldest entries (max ${MAX_IMAGES}).`);

  if (JSON.stringify(existing.images) === JSON.stringify(merged)) {
    console.log('No changes to gallery. Skipping write.');
    process.exit(0);
  }

  const output = {
    lastUpdated: new Date().toISOString(),
    images: merged
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

  const START_MARKER = '<!-- gallery-schema:start -->';
  const END_MARKER = '<!-- gallery-schema:end -->';

  try {
    const html = await fs.readFile(GALLERY_HTML, 'utf-8');
    const startIdx = html.indexOf(START_MARKER);
    const endIdx = html.indexOf(END_MARKER);

    if (startIdx !== -1 && endIdx !== -1) {
      const schema = JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'ImageGallery',
        name: 'HVAC Project Gallery',
        description: 'Browse recent HVAC installations and projects by Complete Home Comfort in Pittsburgh, PA.',
        url: 'https://completehomecomfortpgh.com/gallery/',
        publisher: { '@id': 'https://completehomecomfortpgh.com/#organization' },
        image: merged.map(img => ({
          '@type': 'ImageObject',
          contentUrl: `https://completehomecomfortpgh.com/media/gallery/${img.filename}`,
          name: img.alt
        }))
      });
      const newBlock = `${START_MARKER}\n<script type="application/ld+json">\n${schema}\n</script>\n${END_MARKER}`;
      const updatedHtml = html.slice(0, startIdx) + newBlock + html.slice(endIdx + END_MARKER.length);
      await fs.writeFile(GALLERY_HTML, updatedHtml);
      console.log(`Updated gallery schema (${merged.length} images).`);
    } else {
      console.warn('Gallery schema markers not found in gallery page. Skipping schema update.');
    }
  } catch (err) {
    console.warn('Could not update gallery page schema:', err.message);
  }

  console.log(`Wrote ${merged.length} gallery images (${added} new, ${updated} updated, ${removed} removed).`);
}

main().catch(async (err) => {
  await notifyError('unexpected', 'Unexpected error in fetch-gallery script', {
    error: err.message,
    stack: err.stack
  });
  process.exit(1);
});
