import { handleGeminiRequest } from './gemini-proxy.js';

function plainResponse(message, status) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/gemini') {
      return handleGeminiRequest(request, {
        apiKey: env.GEMINI_API_KEY,
        primaryModel: env.GEMINI_MODEL,
        fallbackModels: env.GEMINI_FALLBACK_MODELS
      });
    }

    if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
      return plainResponse('HirePath static assets are unavailable.', 500);
    }

    return env.ASSETS.fetch(request);
  }
};
