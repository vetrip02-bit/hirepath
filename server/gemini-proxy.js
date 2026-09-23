const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const DEFAULT_PRIMARY_MODEL = 'gemini-3.6-flash';
const DEFAULT_FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-2.5-flash'];
const RETRYABLE_STATUSES = [404, 429, 500, 502, 503, 504];
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60000;

function responseHeaders(contentType) {
  return new Headers({
    'Content-Type': contentType || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-HirePath-Retry-Handled': 'true'
  });
}

function plainResponse(message, status, errorCode) {
  const headers = responseHeaders('text/plain; charset=utf-8');
  if (errorCode) { headers.set('X-HirePath-Error', errorCode); }
  return new Response(message, { status, headers });
}

function safeModel(value) {
  const model = String(value || '').trim();
  return /^[a-z0-9][a-z0-9._-]{0,79}$/.test(model) ? model : '';
}

function uniqueModels(values) {
  const seen = new Set();
  return values.map(safeModel).filter((model) => {
    if (!model || seen.has(model)) { return false; }
    seen.add(model);
    return true;
  });
}

function configuredModels(request, options) {
  const requested = safeModel(request.headers.get('X-HirePath-Model'));
  const primary = safeModel(options.primaryModel) || DEFAULT_PRIMARY_MODEL;
  const configuredFallbacks = String(options.fallbackModels || '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);

  return uniqueModels([
    requested,
    primary,
    ...configuredFallbacks,
    ...DEFAULT_FALLBACK_MODELS
  ]);
}

async function fetchWithTimeout(url, init) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    : null;

  try {
    return await fetch(url, { ...init, signal: controller ? controller.signal : undefined });
  } finally {
    if (timeout) { clearTimeout(timeout); }
  }
}

function providerResponse(upstream, model, usedFallback) {
  const headers = responseHeaders(
    upstream.headers.get('Content-Type') || 'application/json; charset=utf-8'
  );
  const retryAfter = upstream.headers.get('Retry-After');
  if (retryAfter) { headers.set('Retry-After', retryAfter); }
  headers.set('X-HirePath-Model', model);
  if (usedFallback) { headers.set('X-HirePath-Fallback', 'true'); }
  return new Response(upstream.body, { status: upstream.status, headers });
}

/**
 * Secure same-origin Gemini proxy shared by Sites and Netlify.
 * It retries provider capacity/rate failures on stable fallback models, while
 * never exposing the API key to browser JavaScript.
 */
export async function handleGeminiRequest(request, options = {}) {
  if (request.method !== 'POST') {
    return plainResponse('Method not allowed.', 405, 'method-not-allowed');
  }

  const apiKey = String(options.apiKey || '').trim();
  if (!apiKey) {
    return plainResponse('Gemini is not configured.', 503, 'not-configured');
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return plainResponse('JSON is required.', 415, 'invalid-content-type');
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) {
    return plainResponse('Request is too large.', 413, 'request-too-large');
  }

  const models = configuredModels(request, options);
  let lastResponse = null;
  let lastNetworkError = null;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    try {
      const upstream = await fetchWithTimeout(
        API_BASE + encodeURIComponent(model) + ':generateContent',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body
        }
      );

      if (upstream.ok || RETRYABLE_STATUSES.indexOf(upstream.status) === -1) {
        return providerResponse(upstream, model, index > 0);
      }

      lastResponse = upstream;
      if (index < models.length - 1) {
        await upstream.arrayBuffer();
      }
    } catch (error) {
      lastNetworkError = error;
      if (index === models.length - 1) {
        return plainResponse(
          error && error.name === 'AbortError'
            ? 'Gemini timed out on every available model.'
            : 'Gemini could not be reached on any available model.',
          502,
          'provider-network'
        );
      }
    }
  }

  if (lastResponse) {
    return providerResponse(lastResponse, models[models.length - 1], models.length > 1);
  }

  return plainResponse(
    lastNetworkError ? 'Gemini could not be reached.' : 'Gemini is unavailable.',
    502,
    'provider-unavailable'
  );
}

