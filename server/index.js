export default {
  async fetch(request, env) {
    if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
      return new Response('HirePath static assets are unavailable.', { status: 500 });
    }

    return env.ASSETS.fetch(request);
  }
};
