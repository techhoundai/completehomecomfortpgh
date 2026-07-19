const fs = require('fs/promises');
const path = require('path');

const MAX_REVIEWS = 50;
const DATA_FILE = path.join(__dirname, '..', 'data', 'reviews.json');
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
    event: 'google_reviews_fetch_error',
    timestamp: new Date().toISOString(),
    step,
    message,
    details,
    context: {
      repository: process.env.GITHUB_REPOSITORY || 'techhoundai/completehomecomfortpgh',
      workflow: 'Fetch Google Reviews',
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

async function main() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const placeId = process.env.GOOGLE_PLACE_ID;

  if (!apiKey || !placeId) {
    const missing = [
      !apiKey && 'GOOGLE_PLACES_API_KEY',
      !placeId && 'GOOGLE_PLACE_ID'
    ].filter(Boolean);
    await fail('validate_env', `Missing required environment variables: ${missing.join(', ')}`);
  }

  let existing = { reviews: [] };
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    existing = JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('No existing reviews file — starting fresh.');
    } else {
      await fail('read_existing', 'Existing reviews file is corrupt or unreadable', {
        error: err.message,
        code: err.code
      });
    }
  }

  let response;
  try {
    response = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'reviews'
      }
    });
  } catch (err) {
    await fail('api_request', 'Network error calling Google Places API', {
      error: err.message,
      cause: err.cause?.message || err.cause?.code || String(err.cause || ''),
      stack: err.stack,
      placeId
    });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '(could not read response body)');
    await fail('api_response', `Google Places API returned HTTP ${response.status}`, {
      statusCode: response.status,
      responseBody: body.slice(0, 2000),
      placeId
    });
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    await fail('parse_response', 'Failed to parse API response as JSON', {
      error: err.message
    });
  }

  if (!data.reviews || data.reviews.length === 0) {
    console.warn('API returned no reviews. Existing data left unchanged.');
    process.exit(0);
  }

  const existingById = new Map(existing.reviews.map(r => [r.id, r]));
  let added = 0;
  let removed = 0;

  for (const review of data.reviews) {
    if (!review.authorAttribution?.displayName || !review.rating) {
      await fail('malformed_review', 'API returned a review missing required fields', {
        review: JSON.stringify(review).slice(0, 500)
      });
    }

    if (!review.name) {
      await fail('missing_review_id', 'API returned a review without a resource name', {
        author: review.authorAttribution.displayName
      });
    }

    const parsed = {
      id: review.name,
      authorName: review.authorAttribution.displayName,
      text: review.text?.text || review.originalText?.text,
      publishTime: review.publishTime
    };

    if (review.rating < 5) {
      if (existingById.has(review.name)) {
        existingById.delete(review.name);
        removed++;
      }
      continue;
    }

    if (existingById.has(review.name)) {
      existingById.set(review.name, parsed);
    } else {
      existingById.set(review.name, parsed);
      added++;
    }
  }

  const reviews = Array.from(existingById.values());
  reviews.sort((a, b) => (b.publishTime || '').localeCompare(a.publishTime || ''));
  const capped = reviews.slice(0, MAX_REVIEWS);

  const output = {
    lastUpdated: new Date().toISOString(),
    reviews: capped
  };

  try {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(output, null, 2) + '\n');
  } catch (err) {
    await fail('write_file', 'Failed to write reviews data file', {
      error: err.message,
      code: err.code,
      filePath: DATA_FILE
    });
  }

  console.log(`Wrote ${capped.length} reviews (${added} new, ${removed} removed).`);
}

main().catch(async (err) => {
  await notifyError('unexpected', 'Unexpected error in fetch-reviews script', {
    error: err.message,
    stack: err.stack
  });
  process.exit(1);
});
