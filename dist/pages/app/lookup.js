/* =============================================================================
   lookup.js — Wikipedia and Dictionary clients for HirePath
   -----------------------------------------------------------------------------
   Two more "get something from the internet" sources, both chosen because they
   need NO API key, NO account and NO server of your own:

     Wikipedia  GET https://en.wikipedia.org/api/rest_v1/page/summary/<title>
     Dictionary GET https://api.dictionaryapi.dev/api/v2/entries/en/<word>

   Both are plain HTTP GET requests over fetch(), and both send CORS headers,
   so they work straight from a static page.

   These are deliberately independent of Gemini: when the Gemini quota is spent,
   or no key has been added at all, looking words up still works.
   ========================================================================== */
(function (global) {
  'use strict';

  var WIKI_SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
  var WIKI_SEARCH = 'https://en.wikipedia.org/w/api.php';
  /* Wiktionary is the primary dictionary: it is the same Wikimedia REST API as
     Wikipedia, so if one reaches the network the other does too. */
  var WIKTIONARY = 'https://en.wiktionary.org/api/rest_v1/page/definition/';
  /* Kept as a fallback for networks where Wiktionary is unavailable. */
  var DICTIONARY = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
  var TIMEOUT_MS = 12000;

  /* Wiktionary returns definitions with wiki markup in them. Parsing to a
     detached document and reading textContent strips the tags without ever
     putting untrusted HTML into the live page. */
  function htmlToText(html) {
    var raw = String(html || '');
    try {
      var doc = new DOMParser().parseFromString(raw, 'text/html');
      return ((doc && doc.body) ? doc.body.textContent : '').replace(/\s+/g, ' ').trim();
    } catch (e) {
      return raw.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    }
  }

  function LookupError(message, kind) {
    this.name = 'LookupError';
    this.message = message;
    this.kind = kind || 'unknown';
  }
  LookupError.prototype = Object.create(Error.prototype);
  LookupError.prototype.constructor = LookupError;

  function cleanTerm(term) {
    return String(term || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  /** fetch with a timeout, returning parsed JSON. */
  function getJson(url, notFoundMessage) {
    if (typeof fetch !== 'function') {
      return Promise.reject(new LookupError('This browser does not support fetch().', 'unsupported'));
    }
    var controller = (typeof AbortController === 'function') ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;

    return fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller ? controller.signal : undefined
    }).then(function (res) {
      if (timer) { clearTimeout(timer); }
      if (res.status === 404) {
        throw new LookupError(notFoundMessage, 'not-found');
      }
      if (res.status === 429) {
        throw new LookupError('That service is busy right now. Wait a moment and try again.', 'busy');
      }
      if (!res.ok) {
        throw new LookupError('The lookup failed (' + res.status + '). Try again in a moment.', 'http');
      }
      return res.json();
    }, function (err) {
      if (timer) { clearTimeout(timer); }
      if (err && err.name === 'AbortError') {
        throw new LookupError('The lookup took too long. Check your connection and try again.', 'timeout');
      }
      if (err && err.name === 'LookupError') { throw err; }
      throw new LookupError(
        'Could not reach the lookup service. Check your internet connection.', 'network');
    }).catch(function (err) {
      if (err && err.name === 'LookupError') { throw err; }
      throw new LookupError('That lookup could not be read. Try a different word.', 'parse');
    });
  }

  var Lookup = {
    LookupError: LookupError,

    /**
     * Wikipedia article summary.
     * @returns {Promise<{title, extract, description, url, thumbnail}>}
     */
    wikipedia: function (term) {
      var q = cleanTerm(term);
      if (!q) {
        return Promise.reject(new LookupError('Type something to look up first.', 'empty'));
      }
      /* The REST summary endpoint wants underscores rather than spaces. */
      var path = encodeURIComponent(q.replace(/ /g, '_'));
      return getJson(WIKI_SUMMARY + path,
        'Wikipedia has no article called “' + q + '”. Try different wording.')
        .then(function (data) {
          if (!data || !data.extract) {
            throw new LookupError(
              'Wikipedia returned nothing readable for “' + q + '”.', 'empty');
          }
          if (data.type === 'disambiguation') {
            throw new LookupError(
              '“' + q + '” can mean several different things on Wikipedia. Try a more specific term.',
              'ambiguous');
          }
          return {
            title: String(data.title || q),
            description: String(data.description || ''),
            extract: String(data.extract),
            url: (data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page) || '',
            thumbnail: (data.thumbnail && data.thumbnail.source) || ''
          };
        });
    },

    /** Wikipedia full-text search, used to suggest titles when a lookup misses. */
    searchWikipedia: function (term) {
      var q = cleanTerm(term);
      if (!q) { return Promise.resolve([]); }
      var url = WIKI_SEARCH +
        '?action=query&list=search&format=json&origin=*&srlimit=5&srsearch=' +
        encodeURIComponent(q);
      return getJson(url, 'No results.').then(function (data) {
        var hits = (data && data.query && data.query.search) || [];
        return hits.map(function (hit) { return String(hit.title || ''); })
          .filter(Boolean).slice(0, 5);
      }, function () { return []; });
    },

    /**
     * Dictionary definition.
     * @returns {Promise<{word, phonetic, meanings:[{partOfSpeech, definitions:[{definition, example}]}]}>}
     */
    dictionary: function (word) {
      var q = cleanTerm(word);
      if (!q) {
        return Promise.reject(new LookupError('Type a word to define first.', 'empty'));
      }
      /* The dictionary endpoints handle single words only. */
      var single = q.split(' ')[0].replace(/[^A-Za-z'-]/g, '');
      if (!single) {
        return Promise.reject(new LookupError(
          'That does not look like a word the dictionary can define.', 'empty'));
      }
      var notFound = 'No dictionary entry was found for “' + single + '”.';

      return getJson(WIKTIONARY + encodeURIComponent(single.toLowerCase()), notFound)
        .then(function (data) {
          var groups = (data && data.en) || [];
          var meanings = groups.slice(0, 4).map(function (g) {
            return {
              partOfSpeech: String((g && g.partOfSpeech) || '').toLowerCase(),
              definitions: (Array.isArray(g && g.definitions) ? g.definitions : [])
                .slice(0, 3).map(function (d) {
                  var examples = Array.isArray(d && d.examples) ? d.examples : [];
                  return {
                    definition: htmlToText(d && d.definition),
                    example: examples.length ? htmlToText(examples[0]) : ''
                  };
                }).filter(function (d) { return d.definition; })
            };
          }).filter(function (m) { return m.definitions.length; });

          if (!meanings.length) { throw new LookupError(notFound, 'not-found'); }
          return { word: single.toLowerCase(), phonetic: '', meanings: meanings, source: 'Wiktionary' };
        })
        .catch(function (wiktionaryError) {
          /* Second source, in case Wiktionary is unreachable on this network. */
          return Lookup.dictionaryFallback(single).catch(function () {
            throw wiktionaryError;
          });
        });
    },

    /** api.dictionaryapi.dev — used only when Wiktionary fails. */
    dictionaryFallback: function (single) {
      return getJson(DICTIONARY + encodeURIComponent(String(single).toLowerCase()),
        'No dictionary entry was found for “' + single + '”.')
        .then(function (data) {
          var entry = Array.isArray(data) ? data[0] : null;
          if (!entry) {
            throw new LookupError('The dictionary has no entry for “' + single + '”.', 'not-found');
          }
          var phonetic = String(entry.phonetic || '');
          if (!phonetic && Array.isArray(entry.phonetics)) {
            for (var i = 0; i < entry.phonetics.length; i++) {
              if (entry.phonetics[i] && entry.phonetics[i].text) {
                phonetic = String(entry.phonetics[i].text);
                break;
              }
            }
          }
          var meanings = (Array.isArray(entry.meanings) ? entry.meanings : [])
            .slice(0, 4).map(function (m) {
              return {
                partOfSpeech: String((m && m.partOfSpeech) || ''),
                definitions: (Array.isArray(m && m.definitions) ? m.definitions : [])
                  .slice(0, 3).map(function (d) {
                    return {
                      definition: String((d && d.definition) || ''),
                      example: String((d && d.example) || '')
                    };
                  }).filter(function (d) { return d.definition; })
              };
            }).filter(function (m) { return m.definitions.length; });

          if (!meanings.length) {
            throw new LookupError('No usable definition came back for “' + single + '”.', 'empty');
          }
          return { word: String(entry.word || single), phonetic: phonetic,
                   meanings: meanings, source: 'dictionaryapi.dev' };
        });
    },

    /**
     * Look a term up in both sources at once. Neither failing stops the other,
     * so a word with a definition but no article still returns something.
     * @returns {Promise<{term, wiki, wikiError, dict, dictError, suggestions}>}
     */
    both: function (term) {
      var q = cleanTerm(term);
      if (!q) {
        return Promise.reject(new LookupError('Type something to look up first.', 'empty'));
      }
      var wiki = Lookup.wikipedia(q).then(
        function (r) { return { ok: true, value: r }; },
        function (e) { return { ok: false, error: e }; });
      var dict = Lookup.dictionary(q).then(
        function (r) { return { ok: true, value: r }; },
        function (e) { return { ok: false, error: e }; });

      return Promise.all([wiki, dict]).then(function (results) {
        var w = results[0], d = results[1];
        var out = {
          term: q,
          wiki: w.ok ? w.value : null,
          wikiError: w.ok ? null : w.error.message,
          dict: d.ok ? d.value : null,
          dictError: d.ok ? null : d.error.message,
          suggestions: []
        };
        /* Only bother searching for alternatives when the article missed. */
        if (!out.wiki) {
          return Lookup.searchWikipedia(q).then(function (titles) {
            out.suggestions = titles.filter(function (t) {
              return t.toLowerCase() !== q.toLowerCase();
            });
            return out;
          });
        }
        return out;
      });
    }
  };

  global.Lookup = Lookup;
}(window));
