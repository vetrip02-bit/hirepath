const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent';

function plainResponse(message, status) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

async function callGemini(request, env) {
  if (request.method !== 'POST') {
    return plainResponse('Method not allowed.', 405);
  }

  const apiKey = typeof env.GEMINI_API_KEY === 'string' ? env.GEMINI_API_KEY.trim() : '';
  if (!apiKey) {
    return plainResponse('Gemini is not configured.', 503);
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return plainResponse('JSON is required.', 415);
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > 12 * 1024 * 1024) {
    return plainResponse('Request is too large.', 413);
  }

  const upstream = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body
  });

  const headers = new Headers({
    'Content-Type': upstream.headers.get('Content-Type') || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  const retryAfter = upstream.headers.get('Retry-After');
  if (retryAfter) { headers.set('Retry-After', retryAfter); }

  return new Response(upstream.body, { status: upstream.status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/gemini') {
      return callGemini(request, env);
    }

    if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
      return plainResponse('HirePath static assets are unavailable.', 500);
    }

    return env.ASSETS.fetch(request);
  }
};
