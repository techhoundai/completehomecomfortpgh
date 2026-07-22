const fs = require('fs/promises');
const path = require('path');

const MAX_REVIEWS = 50;
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120000;
const DATA_FILE = path.join(__dirname, '..', 'data', 'reviews.json');
const WEBHOOK_URL = 'https://bothound-api-908333870065.us-central1.run.app/v1/webhooks/e1102ea3-c994-437d-a6d5-062988c0a743';
const PLACE_ID = 'ChIJqfSVYcWmpIgRsH-2dlL5BB0';

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const apiKey = process.env.OUTSCRAPER_API_KEY;

  if (!apiKey) {
    await fail('validate_env', 'Missing required environment variable: OUTSCRAPER_API_KEY');
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

  const params = new URLSearchParams({
    query: PLACE_ID,
    reviewsLimit: '500',
    sort: 'newest'
  });

  let response;
  try {
    response = await fetch(`https://api.app.outscraper.com/maps/reviews-v3?${params}`, {
      headers: { 'X-API-KEY': apiKey }
    });
  } catch (err) {
    await fail('api_request', 'Network error calling Outscraper API', {
      error: err.message,
      cause: err.cause?.message || err.cause?.code || String(err.cause || ''),
      stack: err.stack
    });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '(could not read response body)');
    await fail('api_response', `Outscraper API returned HTTP ${response.status}`, {
      statusCode: response.status,
      responseBody: body.slice(0, 2000)
    });
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    await fail('parse_response', 'Failed to parse initial API response as JSON', {
      error: err.message
    });
  }

  if (data.status === 'Pending') {
    const resultsUrl = data.results_location;
    if (!resultsUrl) {
      await fail('missing_results_url', 'API returned Pending status but no results_location', {
        response: JSON.stringify(data).slice(0, 500)
      });
    }

    console.log(`Request queued (${data.id}). Polling for results...`);
    const startTime = Date.now();

    while (Date.now() - startTime < POLL_TIMEOUT_MS) {
      await sleep(POLL_INTERVAL_MS);

      let pollResponse;
      try {
        pollResponse = await fetch(resultsUrl, {
          headers: { 'X-API-KEY': apiKey }
        });
      } catch (err) {
        await fail('poll_request', 'Network error polling Outscraper results', {
          error: err.message,
          cause: err.cause?.message || err.cause?.code || String(err.cause || ''),
          resultsUrl
        });
      }

      if (!pollResponse.ok) {
        const body = await pollResponse.text().catch(() => '(could not read body)');
        await fail('poll_response', `Outscraper poll returned HTTP ${pollResponse.status}`, {
          statusCode: pollResponse.status,
          responseBody: body.slice(0, 2000),
          resultsUrl
        });
      }

      try {
        data = await pollResponse.json();
      } catch (err) {
        await fail('parse_poll', 'Failed to parse poll response as JSON', {
          error: err.message
        });
      }

      if (data.status !== 'Pending') {
        console.log(`Results ready after ${Math.round((Date.now() - startTime) / 1000)}s.`);
        break;
      }
    }

    if (data.status === 'Pending') {
      await fail('api_timeout', `Outscraper results not ready after ${POLL_TIMEOUT_MS / 1000}s`, {
        requestId: data.id,
        resultsUrl
      });
    }
  }

  if (!data.data || data.data.length === 0 || !data.data[0].reviews_data) {
    console.warn('API returned no reviews. Existing data left unchanged.');
    process.exit(0);
  }

  const reviews = data.data[0].reviews_data;
  const existingById = new Map(existing.reviews.map(r => [r.id, r]));
  let added = 0;
  let removed = 0;

  for (const review of reviews) {
    if (!review.author_title || review.review_rating === undefined) {
      await fail('malformed_review', 'API returned a review missing required fields', {
        review: JSON.stringify(review).slice(0, 500)
      });
    }

    if (!review.review_id) {
      await fail('missing_review_id', 'API returned a review without an ID', {
        author: review.author_title
      });
    }

    if (!review.review_text) {
      continue;
    }

    if (!review.review_datetime_utc) {
      await fail('missing_publish_time', 'API returned a review without a timestamp', {
        author: review.author_title,
        id: review.review_id
      });
    }

    const parsed = {
      id: review.review_id,
      authorName: review.author_title,
      text: review.review_text.replace(/<br\s*\/?>/gi, '\n'),
      publishTime: new Date(review.review_datetime_utc).toISOString()
    };

    if (review.review_rating < 5) {
      if (existingById.has(review.review_id)) {
        existingById.delete(review.review_id);
        removed++;
      }
      continue;
    }

    if (existingById.has(review.review_id)) {
      existingById.set(review.review_id, parsed);
    } else {
      existingById.set(review.review_id, parsed);
      added++;
    }
  }

  const merged = Array.from(existingById.values());
  merged.sort((a, b) => b.publishTime.localeCompare(a.publishTime));
  const capped = merged.slice(0, MAX_REVIEWS);

  if (JSON.stringify(existing.reviews) === JSON.stringify(capped)) {
    console.log('No changes to reviews. Skipping write.');
    process.exit(0);
  }

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
