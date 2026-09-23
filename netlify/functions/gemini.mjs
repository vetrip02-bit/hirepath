import { handleGeminiRequest } from '../../server/gemini-proxy.js';

export default async function gemini(request) {
  return handleGeminiRequest(request, {
    apiKey: process.env.GEMINI_API_KEY,
    primaryModel: process.env.GEMINI_MODEL,
    fallbackModels: process.env.GEMINI_FALLBACK_MODELS
  });
}

