/* =============================================================================
   gemini.js — Gemini REST client for HirePath
   -----------------------------------------------------------------------------
   * Uses fetch() against the Gemini "generateContent" REST endpoint.
   * The API key is sent in the "x-goog-api-key" header and is NEVER logged,
     never placed in a URL and never included in an error message.
   * Every call has a Demo-mode counterpart so the whole application can be
     used, marked and tested with no internet connection and no API key.
   ========================================================================== */
(function (global) {
  'use strict';

  var ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
  var DEFAULT_MODEL = 'gemini-3.6-flash';
  var REQUEST_TIMEOUT_MS = 60000;

  /* ---------------------------------------------------------------------- */
  /* Errors                                                                  */
  /* ---------------------------------------------------------------------- */

  function GeminiError(message, kind) {
    this.name = 'GeminiError';
    this.message = message;
    this.kind = kind || 'unknown';
  }
  GeminiError.prototype = Object.create(Error.prototype);
  GeminiError.prototype.constructor = GeminiError;

  /* Map an HTTP status to safe, user-facing copy. The key is never included. */
  function messageForStatus(status, viaProxy) {
    /* The built-in proxy only exists on the hosted site. Served from a plain
       static server (or opened as a file) there is nothing at /api/gemini, so
       these two statuses mean "no shared key here", not a Gemini fault. */
    if (viaProxy && (status === 404 || status === 501 || status === 405)) {
      return {
        kind: 'no-proxy',
        message: 'This copy of HirePath has no shared Gemini key. Add your own key in ' +
                 'Settings, or switch Demo mode on. (The hosted version supplies a key for you.)'
      };
    }
    if (status === 400) {
      return {
        kind: 'bad-request',
        message: 'Gemini rejected the request (400). The advertisement may be too long or empty, ' +
                 'or the selected model name may be wrong. Shorten the text or check the model in Settings.'
      };
    }
    if (status === 401 || status === 403) {
      return {
        kind: 'auth',
        message: 'Gemini refused the API key (' + status + '). Check that the key is correct, ' +
                 'active and enabled for the Generative Language API in Settings, or switch on Demo mode.'
      };
    }
    if (status === 404) {
      return {
        kind: 'model',
        message: 'Gemini could not find that model (404). Open Settings and check the model name.'
      };
    }
    if (status === 429) {
      return {
        kind: 'quota',
        message: 'Gemini rate limit reached (429), and three attempts did not get through. ' +
                 'Free keys allow only a few requests per minute and a limited number per day, ' +
                 'and images cost far more than text. Wait a minute and try again, use a smaller ' +
                 'image, or switch on Demo mode.'
      };
    }
    if (status === 503) {
      return {
        kind: 'overloaded',
        message: 'Gemini is temporarily busy. Wait a moment and try again, or use Demo mode.'
      };
    }
    if (status >= 500) {
      return {
        kind: 'server',
        message: 'Gemini had a server problem (' + status + '). Wait a moment and try again, or use Demo mode.'
      };
    }
    return {
      kind: 'http',
      message: 'Gemini returned an unexpected response (' + status + '). Try again, or use Demo mode.'
    };
  }

  /* ---------------------------------------------------------------------- */
  /* JSON helpers                                                            */
  /* ---------------------------------------------------------------------- */

  /* Gemini is asked for raw JSON, but models sometimes add fences or prose.
     This recovers the JSON object/array without ever using eval. */
  function parseModelJson(raw) {
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new GeminiError('Gemini returned an empty response. Try again, or use Demo mode.', 'empty');
    }
    var text = raw.trim();

    /* strip ```json ... ``` fences */
    var fence = text.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/);
    if (fence) { text = fence[1].trim(); }

    try {
      return JSON.parse(text);
    } catch (e) { /* fall through to substring recovery */ }

    var first = text.indexOf('{');
    var firstArr = text.indexOf('[');
    if (firstArr !== -1 && (first === -1 || firstArr < first)) { first = firstArr; }
    var last = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
    if (first !== -1 && last > first) {
      try {
        return JSON.parse(text.slice(first, last + 1));
      } catch (e2) { /* fall through */ }
    }
    throw new GeminiError(
      'Gemini did not return valid JSON. Try again, or use Demo mode.', 'invalid-json');
  }

  /* ---------------------------------------------------------------------- */
  /* Response schemas (Gemini structured output)                             */
  /* ---------------------------------------------------------------------- */

  var STR = { type: 'STRING' };
  var STR_ARRAY = { type: 'ARRAY', items: { type: 'STRING' } };

  var JOB_SCHEMA = {
    type: 'OBJECT',
    properties: {
      role: STR,
      company: STR,
      location: STR,
      workplaceType: STR,
      salary: STR,
      qualifications: STR_ARRAY,
      experienceRequirements: STR_ARRAY,
      requiredSkills: STR_ARRAY,
      preferredSkills: STR_ARRAY,
      responsibilities: STR_ARRAY,
      documents: STR_ARRAY,
      deadline: STR,
      unfamiliarTerms: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { term: STR, explanation: STR },
          required: ['term', 'explanation']
        }
      }
    },
    required: ['role', 'company', 'location', 'workplaceType', 'salary', 'qualifications',
               'experienceRequirements', 'requiredSkills', 'preferredSkills',
               'responsibilities', 'documents', 'deadline', 'unfamiliarTerms']
  };

  var PLAN_SCHEMA = {
    type: 'OBJECT',
    properties: {
      goal: STR,
      topics: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            name: STR,
            reason: STR,
            priority: { type: 'STRING', enum: ['High', 'Medium', 'Foundation'] },
            estimatedMinutes: { type: 'INTEGER' }
          },
          required: ['name', 'reason', 'priority', 'estimatedMinutes']
        }
      }
    },
    required: ['goal', 'topics']
  };

  var LESSON_SCHEMA = {
    type: 'OBJECT',
    properties: {
      title: STR,
      overview: STR,
      keyPoints: STR_ARRAY,
      practicalExample: STR,
      jobRelevance: STR,
      interviewTips: STR_ARRAY,
      quiz: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            question: STR,
            options: STR_ARRAY,
            answerIndex: { type: 'INTEGER' },
            explanation: STR
          },
          required: ['question', 'options', 'answerIndex', 'explanation']
        }
      }
    },
    required: ['title', 'overview', 'keyPoints', 'practicalExample', 'jobRelevance', 'interviewTips', 'quiz']
  };

  var SCHEDULE_SCHEMA = {
    type: 'OBJECT',
    properties: {
      strategy: STR,
      sessions: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            topicName: STR,
            activity: STR,
            estimatedMinutes: { type: 'INTEGER' }
          },
          required: ['topicName', 'activity', 'estimatedMinutes']
        }
      }
    },
    required: ['strategy', 'sessions']
  };

  /* ---------------------------------------------------------------------- */
  /* Core request                                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * @param {Object} opts
   *   settings    {apiKey, model}
   *   parts       array of Gemini parts ({text} or {inlineData})
   *   schema      optional responseSchema for structured output
   *   system      optional system instruction text
   *   temperature optional
   * @returns {Promise<string>} raw model text
   */
  function callGemini(opts) {
    var settings = opts.settings || {};
    var apiKey = (settings.apiKey || '').trim();
    var model = (settings.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;

    if (typeof fetch !== 'function') {
      return Promise.reject(new GeminiError('This browser does not support fetch().', 'unsupported'));
    }

    var body = {
      contents: [{ role: 'user', parts: opts.parts }],
      generationConfig: {
        temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.25,
        maxOutputTokens: opts.maxOutputTokens || 8192
      }
    };
    if (opts.schema) {
      body.generationConfig.responseMimeType = 'application/json';
      body.generationConfig.responseSchema = opts.schema;
    }
    if (opts.system) {
      body.systemInstruction = { parts: [{ text: opts.system }] };
    }

    var payload = JSON.stringify(body);
    /* A manually saved key keeps the original direct-browser behaviour. When
       the field is empty, the hosted app uses its server-side default key so
       the credential never appears in the public JavaScript bundle. */
    var url = apiKey
      ? ENDPOINT_BASE + encodeURIComponent(model) + ':generateContent'
      : '/api/gemini';
    var headers = { 'Content-Type': 'application/json' };
    if (apiKey) { headers['x-goog-api-key'] = apiKey; }

    /* Rate limits (429) and overload (503) are both temporary, so they are
       retried automatically with backoff before the user ever sees an error.
       Everything else fails immediately — retrying a bad key or a bad model
       would only waste more of the quota. */
    function sendOnce() {
      var controller = (typeof AbortController === 'function') ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS) : null;

      return fetch(url, {
        method: 'POST',
        headers: headers,
        body: payload,
        signal: controller ? controller.signal : undefined
      }).then(function (res) {
      if (timer) { clearTimeout(timer); }
      if (!res.ok) {
        var info = messageForStatus(res.status, !apiKey);
        /* Honour Retry-After when the server sends it. */
        var retryAfter = 0;
        try {
          var header = res.headers && res.headers.get && res.headers.get('Retry-After');
          if (header) {
            var seconds = parseInt(header, 10);
            if (!isNaN(seconds) && seconds > 0) { retryAfter = Math.min(seconds, 30) * 1000; }
          }
        } catch (e) { /* header not readable; fall back to backoff */ }

        /* The response body is drained but never shown verbatim, because
           provider errors can echo back parts of the request. */
        return res.text().then(function () {
          var err = new GeminiError(info.message, info.kind);
          err.retryAfterMs = retryAfter;
          throw err;
        }, function () {
          var err2 = new GeminiError(info.message, info.kind);
          err2.retryAfterMs = retryAfter;
          throw err2;
        });
      }
      return res.json();
    }, function (networkErr) {
      if (timer) { clearTimeout(timer); }
      if (networkErr && networkErr.name === 'AbortError') {
        throw new GeminiError(
          'Gemini took too long to answer (over 60 seconds). Try again, or use Demo mode.', 'timeout');
      }
      throw new GeminiError(
        'Could not reach Gemini. Check your internet connection and try again, or use Demo mode.', 'network');
    }).then(function (data) {
      if (!data || typeof data !== 'object') {
        throw new GeminiError('Gemini returned an empty response. Try again, or use Demo mode.', 'empty');
      }
      if (data.promptFeedback && data.promptFeedback.blockReason) {
        throw new GeminiError(
          'Gemini blocked this request (' + String(data.promptFeedback.blockReason) +
          '). Try rewording the advertisement or topic.', 'blocked');
      }
      var cand = data.candidates && data.candidates[0];
      if (!cand) {
        throw new GeminiError('Gemini returned no result. Try again, or use Demo mode.', 'empty');
      }
      if (cand.finishReason === 'SAFETY' || cand.finishReason === 'PROHIBITED_CONTENT') {
        throw new GeminiError('Gemini stopped for safety reasons. Try rewording the request.', 'blocked');
      }
      var parts = (cand.content && cand.content.parts) || [];
      var text = parts.map(function (p) {
        return p && typeof p.text === 'string' ? p.text : '';
      }).join('');

      /* Newer models "think" before answering, and those hidden reasoning
         tokens are charged against maxOutputTokens. A budget that is too small
         is therefore spent before any visible text is produced, which arrives
         as MAX_TOKENS with an empty body. Truncated JSON is equally unusable,
         so both cases are reported the same way. */
      if (cand.finishReason === 'MAX_TOKENS' && (!text.trim() || opts.schema)) {
        throw new GeminiError(
          'Gemini used its whole output budget before replying. This usually means the reply ' +
          '(or the model\'s own reasoning) needed more room than was allowed. Try again with a ' +
          'shorter input, or use Demo mode.', 'truncated');
      }
      if (!text.trim()) {
        throw new GeminiError('Gemini returned an empty response. Try again, or use Demo mode.', 'empty');
      }
      return text;
      });
    }

    var MAX_ATTEMPTS = 3;

    function attempt(n) {
      return sendOnce().catch(function (err) {
        var temporary = err && (err.kind === 'quota' || err.kind === 'overloaded' || err.kind === 'server');
        if (!temporary || n >= MAX_ATTEMPTS) { throw err; }
        /* Retry-After when offered, otherwise 2s then 5s, with a little jitter
           so repeated failures do not line up. */
        var wait = err.retryAfterMs || ((n === 1 ? 2000 : 5000) + Math.floor(Math.random() * 600));
        if (typeof opts.onRetry === 'function') {
          opts.onRetry(n, Math.round(wait / 1000), err.kind);
        }
        return new Promise(function (resolve) {
          setTimeout(resolve, wait);
        }).then(function () { return attempt(n + 1); });
      });
    }

    return attempt(1);
  }

  /* ---------------------------------------------------------------------- */
  /* Prompts                                                                 */
  /* ---------------------------------------------------------------------- */

  var EXTRACTION_RULES = [
    'You read job advertisements and return structured data.',
    'RULES:',
    '1. Use ONLY information that is present in the advertisement.',
    '2. Never invent qualifications, salary, deadlines, skills, documents or company details.',
    '3. When information is missing use an empty string "" or an empty array []. Never guess.',
    '4. Keep requiredSkills and preferredSkills strictly separate. "Must have", "required" and',
    '   "essential" belong to requiredSkills. "Nice to have", "preferred", "bonus", "a plus" and',
    '   "desirable" belong to preferredSkills.',
    '5. "deadline" must be an ISO date string "YYYY-MM-DD" if and only if an explicit closing',
    '   date appears in the advertisement. Otherwise use an empty string.',
    '6. "workplaceType" must be exactly "On-site", "Remote", "Hybrid" or an empty string.',
    '7. In unfamiliarTerms list jargon, acronyms, tools or phrases a student may not know,',
    '   and explain each in one or two simple sentences. Maximum 8 terms.',
    '8. Return ONLY valid JSON matching the requested structure.',
    '   No Markdown fences, no commentary, no explanation outside the JSON.'
  ].join('\n');

  var JOB_SHAPE_HINT = [
    'JSON shape:',
    '{',
    '  "role": "", "company": "", "location": "", "workplaceType": "", "salary": "",',
    '  "qualifications": [], "experienceRequirements": [], "requiredSkills": [],',
    '  "preferredSkills": [], "responsibilities": [], "documents": [],',
    '  "deadline": "", "unfamiliarTerms": [{"term": "", "explanation": ""}]',
    '}'
  ].join('\n');

  function profileLine(profile) {
    if (!profile) { return 'The learner did not share a profile.'; }
    var bits = [];
    if (profile.education) { bits.push('stated qualification: ' + profile.education); }
    if (profile.fieldOfStudy) { bits.push('field of study: ' + profile.fieldOfStudy); }
    if (profile.skills && profile.skills.length) {
      bits.push('skills the learner listed: ' + profile.skills.join(', '));
    }
    if (!bits.length) { return 'The learner did not share any background details.'; }
    return 'Learner background (self-reported, may be incomplete): ' + bits.join('; ') + '.';
  }

  function jobContextText(opp) {
    var lines = [];
    function add(label, value) {
      if (value && String(value).trim()) { lines.push(label + ': ' + value); }
    }
    function addList(label, arr) {
      if (arr && arr.length) { lines.push(label + ': ' + arr.join(', ')); }
    }
    add('Role', opp.role);
    add('Company', opp.company);
    add('Location', opp.location);
    add('Workplace type', opp.workplaceType);
    addList('Qualifications', opp.qualifications);
    addList('Experience requirements', opp.experienceRequirements);
    addList('Required skills', opp.requiredSkills);
    addList('Preferred skills', opp.preferredSkills);
    addList('Responsibilities', opp.responsibilities);
    addList('Documents required', opp.documents);
    if (opp.sourceText && opp.sourceText.trim()) {
      lines.push('Full advertisement text:\n' + opp.sourceText.trim().slice(0, 12000));
    }
    return lines.join('\n');
  }

  /* ---------------------------------------------------------------------- */
  /* Public API                                                              */
  /* ---------------------------------------------------------------------- */

  var Gemini = {
    DEFAULT_MODEL: DEFAULT_MODEL,
    GeminiError: GeminiError,
    parseModelJson: parseModelJson,

    /** Analyse a pasted advertisement. */
    analyseText: function (adText, settings, onRetry) {
      if (settings && settings.demoMode) { return Demo.analyseText(adText); }
      var prompt = [
        JOB_SHAPE_HINT,
        '',
        'Advertisement:',
        '"""',
        String(adText).slice(0, 20000),
        '"""'
      ].join('\n');
      return callGemini({
        settings: settings,
        system: EXTRACTION_RULES,
        parts: [{ text: prompt }],
        schema: JOB_SCHEMA,
        temperature: 0.1,
        onRetry: onRetry
      }).then(parseModelJson);
    },

    /** Analyse a photograph or screenshot of an advertisement. */
    analyseImage: function (base64Data, mimeType, settings, onRetry) {
      if (settings && settings.demoMode) { return Demo.analyseImage(); }
      var prompt = [
        'Read every word in this image of a job advertisement and extract the data.',
        'If part of the image is unreadable, leave those fields empty rather than guessing.',
        '',
        JOB_SHAPE_HINT
      ].join('\n');
      return callGemini({
        settings: settings,
        system: EXTRACTION_RULES,
        parts: [
          { inlineData: { mimeType: mimeType, data: base64Data } },
          { text: prompt }
        ],
        schema: JOB_SCHEMA,
        temperature: 0.1,
        onRetry: onRetry
      }).then(parseModelJson);
    },

    /** Build the complete preparation plan for one opportunity. */
    buildStudyPlan: function (opp, profile, settings) {
      if (settings && settings.demoMode) { return Demo.buildStudyPlan(opp); }
      var system = [
        'You are a calm, practical preparation coach for a job applicant.',
        'You design a COMPLETE preparation path from a job advertisement.',
        'RULES:',
        '1. Read the entire advertisement, not only the skill list.',
        '2. Produce between 5 and 10 topics, ordered so that earlier topics support later ones.',
        '3. Cover, where the advertisement justifies it: every listed technical skill, the tools',
        '   named, important concepts implied by the responsibilities, supporting foundation',
        '   topics the learner needs first, portfolio or project preparation, likely interview',
        '   questions for this role, communication or behavioural preparation, and at least one',
        '   role-specific practical task.',
        '4. Never state or imply that the learner already has qualifications, experience or',
        '   skills they did not report. Do not praise or assume their level.',
        '5. "reason" must explain in one or two plain sentences why this topic matters FOR THIS',
        '   advertisement, quoting the requirement it comes from where possible.',
        '6. "priority" must be exactly "High", "Medium" or "Foundation".',
        '7. "estimatedMinutes" is an integer between 20 and 180.',
        '8. Return ONLY valid JSON. No Markdown fences and no commentary.'
      ].join('\n');

      var prompt = [
        'JSON shape:',
        '{ "goal": "", "topics": [{ "name": "", "reason": "", "priority": "High", "estimatedMinutes": 30 }] }',
        '',
        profileLine(profile),
        '',
        'Job advertisement and extracted details:',
        '"""',
        jobContextText(opp),
        '"""'
      ].join('\n');

      return callGemini({
        settings: settings,
        system: system,
        parts: [{ text: prompt }],
        schema: PLAN_SCHEMA,
        temperature: 0.35,
        maxOutputTokens: 6144
      }).then(parseModelJson);
    },

    /** Generate a lesson + 3-question quiz for a topic. */
    generateLesson: function (topicName, opp, profile, settings) {
      if (settings && settings.demoMode) { return Demo.generateLesson(topicName, opp); }
      var system = [
        'You are a patient teacher writing a short lesson for someone preparing for a job.',
        'RULES:',
        '1. Explain from the beginning. Assume no prior knowledge of the topic.',
        '2. Use short sentences and plain language. Define any jargon you use.',
        '3. keyPoints: 4 to 6 short, concrete points worth remembering.',
        '4. practicalExample: one small worked example, code snippet or step-by-step walkthrough.',
        '5. jobRelevance: explain how this topic connects to the specific job described.',
        '6. interviewTips: 3 to 4 tips for talking about this topic in an interview.',
        '7. quiz: EXACTLY 3 multiple-choice questions, each with exactly 4 options,',
        '   a zero-based answerIndex, and an explanation of why that answer is correct.',
        '8. Never claim the learner has experience, projects or qualifications they did not report.',
        '9. Return ONLY valid JSON. No Markdown fences and no commentary.'
      ].join('\n');

      var jobPart = opp
        ? 'The job being prepared for:\n"""\n' + jobContextText(opp) + '\n"""'
        : 'There is no specific job attached. Relate the topic to job interviews and practical work in general.';

      var prompt = [
        'JSON shape:',
        '{ "title": "", "overview": "", "keyPoints": [], "practicalExample": "",',
        '  "jobRelevance": "", "interviewTips": [],',
        '  "quiz": [{ "question": "", "options": [], "answerIndex": 0, "explanation": "" }] }',
        '',
        'Topic to teach: ' + String(topicName).slice(0, 300),
        '',
        profileLine(profile),
        '',
        jobPart
      ].join('\n');

      return callGemini({
        settings: settings,
        system: system,
        parts: [{ text: prompt }],
        schema: LESSON_SCHEMA,
        temperature: 0.4,
        maxOutputTokens: 8192
      }).then(parseModelJson);
    },

    /** Follow-up question inside a lesson. Returns plain text. */
    askCoach: function (question, lesson, opp, profile, settings) {
      if (settings && settings.demoMode) { return Demo.askCoach(question, lesson); }
      var system = [
        'You are a preparation coach answering one follow-up question about a lesson.',
        'RULES:',
        '1. Answer in simple language, 120 words or fewer.',
        '2. Include one short concrete example.',
        '3. Stay on the topic of the lesson. If the question is unrelated, say so briefly',
        '   and point back to the lesson topic.',
        '4. Never invent the learner\'s experience, projects or qualifications.',
        '5. Finish with one line beginning "Try this:" describing one small practice activity',
        '   that takes under 15 minutes.',
        '6. Reply in plain text. No Markdown headings, no bullet characters, no fences.'
      ].join('\n');

      var prompt = [
        'Lesson topic: ' + (lesson && lesson.title ? lesson.title : 'the current topic'),
        'Lesson overview: ' + (lesson && lesson.overview ? String(lesson.overview).slice(0, 1200) : ''),
        opp && opp.role
          ? 'The learner is preparing for this role: ' + opp.role + (opp.company ? ' at ' + opp.company : '')
          : '',
        profileLine(profile),
        '',
        'Question: ' + String(question).slice(0, 800)
      ].filter(Boolean).join('\n');

      return callGemini({
        settings: settings,
        system: system,
        parts: [{ text: prompt }],
        temperature: 0.5,
        maxOutputTokens: 2048
      }).then(function (t) { return t.trim(); });
    },

    /**
     * Ask Gemini to recommend the ORDER and the activity wording only.
     * JavaScript assigns and validates every real calendar date.
     */
    planSessions: function (opp, topics, context, settings) {
      if (settings && settings.demoMode) { return Demo.planSessions(topics, context); }
      var maxSessions = (context && context.maxSessions) || 40;
      var dailyMinutes = (context && context.dailyMinutes) || 60;
      var system = [
        'You sequence study sessions for a job applicant.',
        'RULES:',
        '1. You do NOT choose dates. Never mention a date, a day name or a deadline.',
        '2. Order the sessions so High priority topics come first, then Medium, then Foundation,',
        '   except where a Foundation topic is genuinely needed before a High one.',
        '3. Use ONLY the topic names supplied. Never invent a topic. Use the exact spelling.',
        '4. A topic may appear in more than one session if it needs splitting, but produce',
        '   at most ' + maxSessions + ' sessions in total.',
        '5. "activity" is one short instruction for that sitting, for example',
        '   "Read the basics and write three example queries by hand".',
        '6. "estimatedMinutes" is an integer and must not exceed ' + dailyMinutes + '.',
        '7. Return ONLY valid JSON. No Markdown fences and no commentary.'
      ].join('\n');

      var topicLines = topics.map(function (t, i) {
        return (i + 1) + '. ' + t.name + ' [priority ' + t.priority + ', about ' +
               t.estimatedMinutes + ' minutes]';
      }).join('\n');

      var prompt = [
        'JSON shape:',
        '{ "strategy": "", "sessions": [{ "topicName": "", "activity": "", "estimatedMinutes": 30 }] }',
        '',
        'The learner can study about ' + dailyMinutes + ' minutes per day',
        'and has room for about ' + maxSessions + ' sessions before the application closes.',
        opp && opp.role ? 'Role being prepared for: ' + opp.role : '',
        '',
        'Topics to sequence:',
        topicLines
      ].filter(Boolean).join('\n');

      return callGemini({
        settings: settings,
        system: system,
        parts: [{ text: prompt }],
        schema: SCHEDULE_SCHEMA,
        temperature: 0.3,
        maxOutputTokens: 5120
      }).then(parseModelJson);
    },

    /**
     * Ask the key which models it can actually use.
     * A 404 on generateContent means the model name is not available to THIS
     * key, and the names differ between keys, projects and API versions — so
     * guessing is hopeless. This turns it into a list.
     */
    listModels: function (settings) {
      var apiKey = ((settings && settings.apiKey) || '').trim();
      if (!apiKey) {
        return Promise.reject(new GeminiError(
          'Add your Gemini key first — the list of models depends on the key.', 'no-key'));
      }
      return fetch(ENDPOINT_BASE.replace(/models\/$/, 'models'), {
        method: 'GET',
        headers: { 'x-goog-api-key': apiKey }
      }).then(function (res) {
        if (!res.ok) {
          var info = messageForStatus(res.status, false);
          throw new GeminiError(info.message, info.kind);
        }
        return res.json();
      }, function () {
        throw new GeminiError(
          'Could not reach Gemini to list the models. Check your connection.', 'network');
      }).then(function (data) {
        var models = (data && data.models) || [];
        var usable = models.filter(function (m) {
          var methods = (m && m.supportedGenerationMethods) || [];
          return methods.indexOf('generateContent') !== -1;
        }).map(function (m) {
          return String(m.name || '').replace(/^models\//, '');
        }).filter(Boolean);
        if (!usable.length) {
          throw new GeminiError(
            'That key returned no models that can generate content.', 'empty');
        }
        return usable;
      });
    },

    /** Tiny call used by Settings to verify a saved key. */
    testConnection: function (settings) {
      if (settings && settings.demoMode) {
        return Promise.resolve('Demo mode is on, so HirePath is not calling Gemini.');
      }
      return callGemini({
        settings: settings,
        parts: [{ text: 'Reply with exactly the word: ready' }],
        temperature: 0,
        maxOutputTokens: 512
      }).then(function (t) { return 'Gemini replied: ' + t.trim().slice(0, 40); });
    }
  };

  /* ---------------------------------------------------------------------- */
  /* Demo mode — fixed local samples, no network                             */
  /* ---------------------------------------------------------------------- */

  function delay(value, ms) {
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(value); }, ms || 700);
    });
  }

  /* An ISO date a fixed number of days from today, so demo data never expires. */
  function isoInDays(days) {
    var d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  var Demo = {
    analyseText: function (adText) {
      /* Mirror the real API: too little input means mostly empty output. */
      if (adText && String(adText).trim().length < 40) {
        return delay({
          role: '', company: '', location: '', workplaceType: '', salary: '',
          qualifications: [], experienceRequirements: [], requiredSkills: [],
          preferredSkills: [], responsibilities: [], documents: [],
          deadline: '', unfamiliarTerms: []
        }, 600);
      }
      return delay({
        role: 'Junior Frontend Developer',
        company: 'Northwind Digital',
        location: 'Chennai, India',
        workplaceType: 'Hybrid',
        salary: 'INR 4,50,000 - 6,00,000 per year',
        qualifications: [
          'Bachelor’s degree in Computer Science, IT or a related field',
          'Final-year students may apply'
        ],
        experienceRequirements: [
          '0-2 years of professional or internship experience',
          'A portfolio or GitHub profile with at least one web project'
        ],
        requiredSkills: ['HTML', 'CSS', 'JavaScript', 'Git', 'Responsive Design', 'REST APIs'],
        preferredSkills: ['TypeScript', 'Accessibility (WCAG)', 'Jest', 'Figma'],
        responsibilities: [
          'Build and maintain responsive user interfaces for the customer portal',
          'Work with designers to turn Figma files into accessible HTML and CSS',
          'Consume REST APIs and handle loading and error states',
          'Review teammates’ pull requests and write clear commit messages',
          'Help improve page performance and Lighthouse scores'
        ],
        documents: [
          'Updated résumé (PDF)',
          'Short cover letter',
          'Portfolio or GitHub link',
          'Degree certificate or provisional certificate'
        ],
        deadline: isoInDays(9),
        unfamiliarTerms: [
          { term: 'REST API', explanation: 'A way for your web page to ask a server for data over HTTP, usually receiving JSON back.' },
          { term: 'Lighthouse score', explanation: 'A report built into Chrome that grades a page on speed, accessibility and best practices out of 100.' },
          { term: 'Pull request', explanation: 'A request to merge your code branch into the main project so teammates can review it first.' },
          { term: 'WCAG', explanation: 'Web Content Accessibility Guidelines - rules that make a site usable by people with disabilities.' }
        ]
      }, 800);
    },

    analyseImage: function () {
      return delay({
        role: 'Data Analyst Intern',
        company: 'Blue Harbour Analytics',
        location: 'Bengaluru, India',
        workplaceType: 'On-site',
        salary: 'INR 25,000 per month stipend',
        qualifications: ['Pursuing or completed a degree in Statistics, Mathematics, Economics or Computer Science'],
        experienceRequirements: ['No professional experience required', 'Academic or personal data projects welcome'],
        requiredSkills: ['SQL', 'Excel', 'Data Visualisation', 'Statistics'],
        preferredSkills: ['Python', 'Power BI', 'Tableau'],
        responsibilities: [
          'Write SQL queries to pull data for weekly business reports',
          'Build dashboards that the operations team reads every morning',
          'Clean messy spreadsheets and document the steps taken',
          'Present one short findings summary each fortnight'
        ],
        documents: ['Résumé', 'College ID or enrolment proof', 'Transcript'],
        deadline: isoInDays(4),
        unfamiliarTerms: [
          { term: 'SQL JOIN', explanation: 'A way to combine rows from two tables that share a common column, such as customer_id.' },
          { term: 'Dashboard', explanation: 'A single screen of charts and numbers that people check regularly instead of reading a long report.' },
          { term: 'Data cleaning', explanation: 'Fixing missing values, duplicates and wrong formats so calculations can be trusted.' }
        ]
      }, 900);
    },

    /* Derived from the advertisement itself — there is no fixed topic list.
       If the job records nothing, nothing is invented and the caller says so. */
    buildStudyPlan: function (opp) {
      var job = opp || {};
      var topics = [];
      var seen = {};
      function add(name, reason, priority, minutes) {
        var key = String(name || '').trim().toLowerCase();
        if (!key || seen[key]) { return; }
        seen[key] = true;
        topics.push({ name: String(name).trim(), reason: reason, priority: priority,
                      estimatedMinutes: minutes });
      }
      (job.requiredSkills || []).forEach(function (skill) {
        add(skill, 'Listed as a required skill in this advertisement, so expect to be asked about it.',
            'High', 45);
      });
      (job.preferredSkills || []).forEach(function (skill) {
        add(skill, 'Listed as a preferred skill — useful for standing out, but not essential.',
            'Medium', 30);
      });
      (job.qualifications || []).slice(0, 3).forEach(function (q) {
        add(q, 'Named under the qualifications for this role.', 'Foundation', 30);
      });
      (job.responsibilities || []).slice(0, 3).forEach(function (r) {
        add(r, 'One of the day-to-day responsibilities the advertisement describes.', 'Medium', 40);
      });
      if ((job.documents || []).length) {
        add('Prepare the documents this job asks for',
            'The advertisement asks for: ' + job.documents.slice(0, 5).join(', ') + '.', 'High', 60);
      }
      if (job.role) {
        add('Interview questions for ' + job.role,
            'Prepare spoken answers for the exact requirements in this advertisement.', 'High', 45);
      }
      return delay({
        goal: job.role
          ? 'Be ready to apply for ' + job.role + ' using the requirements this advertisement lists.'
          : 'Prepare using the details recorded for this opportunity.',
        topics: topics.slice(0, 10)
      }, 700);
    },

    generateLesson: function (topicName, opp) {
      var title = String(topicName || 'Preparation topic');
      return delay({
        title: title,
        overview: 'This lesson introduces ' + title + ' from the beginning. You will learn what it is, ' +
          'why employers ask about it, and how to show that you understand it. Work through the example ' +
          'yourself rather than only reading it — typing the example out is what makes it stick.',
        keyPoints: [
          'Start with the smallest working version, then add one piece at a time.',
          'Say out loud what each line or step is doing; if you cannot, you have found your gap.',
          'Write down the one sentence you would use to explain this to a teammate.',
          'Practise on a real file or project, not only on notes.',
          'Keep a short list of mistakes you made — those are the interview stories.'
        ],
        practicalExample:
          '// A small worked example for: ' + title + '\n' +
          '// 1. Write the smallest version that runs.\n' +
          'const items = ["first", "second", "third"];\n\n' +
          '// 2. Do one useful thing with it.\n' +
          'items.forEach(function (item, index) {\n' +
          '  console.log(index + 1, item);\n' +
          '});\n\n' +
          '// 3. Change one thing and predict the output BEFORE running it.\n' +
          '// Being able to predict output is what interviewers actually test.',
        jobRelevance: opp && opp.role
          ? 'This topic appears in the requirements for ' + opp.role +
            (opp.company ? ' at ' + opp.company : '') +
            ', so expect at least one question about it and be ready with a concrete example.'
          : 'This topic comes up in most technical interviews, so a clear example prepared in advance is worth having.',
        interviewTips: [
          'Answer in three beats: what it is, why it is used, one time you used it.',
          'If you have not used it professionally, say "I practised this in a small project" — honesty reads better than bluffing.',
          'Keep your example under 45 seconds, then offer to go deeper.',
          'If you do not know, say so and describe how you would find out.'
        ],
        quiz: [
          {
            question: 'What is the most reliable way to prove you understand ' + title + ' in an interview?',
            options: [
              'Memorising the textbook definition word for word',
              'Describing a concrete example you built or practised yourself',
              'Listing every related buzzword you know',
              'Saying you have used it for years'
            ],
            answerIndex: 1,
            explanation: 'A concrete example you can walk through shows real understanding. Definitions and buzzwords can be memorised, and overstating experience tends to collapse under follow-up questions.'
          },
          {
            question: 'You are asked a question about ' + title + ' and you genuinely do not know the answer. What is the best response?',
            options: [
              'Stay silent until the interviewer moves on',
              'Guess confidently and hope it is right',
              'Say you do not know, then explain how you would work it out',
              'Change the subject to something you do know'
            ],
            answerIndex: 2,
            explanation: 'Interviewers are assessing how you handle gaps. Admitting the gap and describing your approach to finding the answer shows honesty and problem-solving at the same time.'
          },
          {
            question: 'What is the best first step when starting to learn ' + title + '?',
            options: [
              'Read every article about it before writing anything',
              'Build the smallest working version and change one thing at a time',
              'Wait until you have a large block of free time',
              'Copy a finished project without reading it'
            ],
            answerIndex: 1,
            explanation: 'Small working versions give you fast feedback, and changing one thing at a time tells you exactly what caused each result. Reading alone rarely transfers into ability.'
          }
        ]
      }, 1000);
    },

    askCoach: function (question, lesson) {
      var topic = (lesson && lesson.title) || 'this topic';
      return delay(
        'Good question. In short: ' + String(question || '').trim().replace(/\?+$/, '') +
        ' comes down to understanding what ' + topic + ' is doing step by step, rather than memorising the result.\n\n' +
        'Example: take the smallest working version of ' + topic +
        ', change exactly one line, and predict what should happen before you run it. ' +
        'When your prediction is wrong you have found the part you did not actually understand yet, ' +
        'and that is the fastest place to learn.\n\n' +
        'Try this: spend ten minutes writing a two-sentence explanation of ' + topic +
        ' in your own words with no notes open, then check it against the lesson and fix whatever was missing.',
        800);
    },

    planSessions: function (topics, context) {
      var rank = { High: 0, Medium: 1, Foundation: 2 };
      var order = topics.slice().sort(function (a, b) {
        var ra = rank[a.priority] === undefined ? 1 : rank[a.priority];
        var rb = rank[b.priority] === undefined ? 1 : rank[b.priority];
        return ra - rb;
      });
      var daily = (context && context.dailyMinutes) || 60;
      var verbs = [
        'Read the basics and write down the three ideas you want to remember',
        'Work through one small example by hand and predict each result before running it',
        'Rebuild the example from memory, then compare with your notes',
        'Practise explaining this out loud in under 60 seconds',
        'Answer three interview-style questions on this topic in writing'
      ];
      return delay({
        strategy: 'High priority topics first, foundations early where they unlock later topics, ' +
                  'and short repeat sessions for anything longer than ' + daily + ' minutes.',
        sessions: order.map(function (t, i) {
          return {
            topicName: t.name,
            activity: verbs[i % verbs.length] + '.',
            estimatedMinutes: Math.min(daily, t.estimatedMinutes || 45)
          };
        })
      }, 900);
    }
  };

  Gemini.Demo = Demo;
  global.Gemini = Gemini;
}(window));
