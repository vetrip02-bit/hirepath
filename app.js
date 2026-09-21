/* =============================================================================
   app.js — HirePath
   -----------------------------------------------------------------------------
   Plain browser JavaScript. No framework, no build step.

   The three assignment behaviours:
     GET SOMETHING FROM THE INTERNET : gemini.js uses fetch() against the
                                       Gemini REST API (see callGemini there).
     REMEMBER SOMETHING              : every change is persisted to
                                       localStorage under the key "hirepath-v2".
     REACT TO TIME                   : Date.now() drives all urgency, and a
                                       60 second timer recalculates everything.

   SECURITY NOTE: all user text and all Gemini output reaches the DOM through
   textContent / createTextNode only. innerHTML is never used anywhere.
   ========================================================================== */
(function () {
  'use strict';

  var STORAGE_KEY = 'hirepath-v2';
  var TICK_MS = 60000;

  /* =========================================================================
     1. DOM HELPERS  (no innerHTML, ever)
     ====================================================================== */

  /**
   * h('div', {class:'x', onclick:fn}, child, child...)
   * Children may be nodes, strings, numbers, null/undefined (skipped) or arrays.
   */
  function h(tag, props, var_args) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (key) {
        var value = props[key];
        if (value === null || value === undefined || value === false) { return; }
        if (key === 'class') { node.className = value; }
        else if (key === 'text') { node.textContent = String(value); }
        else if (key === 'html') { throw new Error('innerHTML is not allowed in HirePath'); }
        else if (key.indexOf('on') === 0 && typeof value === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key === 'dataset') {
          Object.keys(value).forEach(function (d) { node.dataset[d] = value[d]; });
        } else if (value === true) {
          node.setAttribute(key, '');
        } else {
          node.setAttribute(key, String(value));
        }
      });
    }
    for (var i = 2; i < arguments.length; i++) { append(node, arguments[i]); }
    return node;
  }

  function append(parent, child) {
    if (child === null || child === undefined || child === false) { return; }
    if (Array.isArray(child)) {
      child.forEach(function (c) { append(parent, c); });
      return;
    }
    if (child instanceof Node) { parent.appendChild(child); return; }
    parent.appendChild(document.createTextNode(String(child)));
  }

  function clear(node) {
    while (node.firstChild) { node.removeChild(node.firstChild); }
  }

  function $(sel, root) { return (root || document).querySelector(sel); }

  /* Split a possibly multi-line block of text into paragraph nodes. */
  function paragraphs(textValue, className) {
    var raw = String(textValue || '').split(/\n{2,}/);
    return raw.filter(function (p) { return p.trim(); }).map(function (p) {
      return h('p', { class: className || '' }, p.trim());
    });
  }

  /* =========================================================================
     2. SMALL UTILITIES
     ====================================================================== */

  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' +
      Math.random().toString(36).slice(2, 8);
  }

  function asArray(value) {
    if (Array.isArray(value)) {
      return value
        .map(function (v) { return v === null || v === undefined ? '' : String(v).trim(); })
        .filter(function (v) { return v.length > 0; });
    }
    if (typeof value === 'string' && value.trim()) {
      return value.split(/[\n;]|,(?![^(]*\))/)
        .map(function (s) { return s.trim(); })
        .filter(function (s) { return s.length > 0; });
    }
    return [];
  }

  /* Textareas that hold one item per line. */
  function linesToArray(value) {
    return String(value || '').split('\n')
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }

  function asText(value) {
    if (value === null || value === undefined) { return ''; }
    if (typeof value === 'string') { return value.trim(); }
    if (typeof value === 'number' || typeof value === 'boolean') { return String(value); }
    return '';
  }

  function clampInt(value, min, max, fallback) {
    var n = parseInt(value, 10);
    if (isNaN(n)) { return fallback; }
    return Math.min(max, Math.max(min, n));
  }

  /** Only http(s) URLs are ever stored or rendered as links. */
  function safeUrl(value) {
    var raw = asText(value);
    if (!raw) { return ''; }
    var candidate = raw;
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) { candidate = 'https://' + candidate; }
    try {
      var u = new URL(candidate);
      if (u.protocol === 'http:' || u.protocol === 'https:') { return u.href; }
    } catch (e) { /* invalid */ }
    return '';
  }

  function pluralise(n, one, many) { return n === 1 ? one : (many || one + 's'); }

  /* =========================================================================
     3. TIME  —  every value recomputed from Date.now(), never decremented
     ====================================================================== */

  var DAY_MS = 86400000;
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];
  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function startOfDay(d) {
    var x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function toISO(date) {
    return date.getFullYear() + '-' +
      String(date.getMonth() + 1).padStart(2, '0') + '-' +
      String(date.getDate()).padStart(2, '0');
  }

  function todayISO() { return toISO(new Date(Date.now())); }

  /** Parse "YYYY-MM-DD" as a LOCAL date (never UTC, which shifts the day). */
  function fromISO(iso) {
    if (typeof iso !== 'string') { return null; }
    var m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) { return null; }
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1) { return null; }
    return d;
  }

  function isValidISO(iso) { return fromISO(iso) !== null; }

  function addDaysISO(iso, days) {
    var d = fromISO(iso) || new Date(Date.now());
    d.setDate(d.getDate() + days);
    return toISO(d);
  }

  /** Whole days from today to an ISO date. Negative = in the past. */
  function daysUntil(iso) {
    var target = fromISO(iso);
    if (!target) { return null; }
    var now = startOfDay(new Date(Date.now()));
    return Math.round((startOfDay(target).getTime() - now.getTime()) / DAY_MS);
  }

  function daysSince(timestamp) {
    if (!timestamp) { return null; }
    var then = new Date(timestamp);
    if (isNaN(then.getTime())) { return null; }
    var now = startOfDay(new Date(Date.now()));
    return Math.round((now.getTime() - startOfDay(then).getTime()) / DAY_MS);
  }

  /**
   * Urgency levels required by the brief:
   *   >14 normal | 8-14 soon | 3-7 warning | 0-2 urgent | past expired
   */
  function urgencyOf(iso) {
    var d = daysUntil(iso);
    if (d === null) { return null; }
    if (d < 0) { return { level: 'expired', days: d }; }
    if (d <= 2) { return { level: 'urgent', days: d }; }
    if (d <= 7) { return { level: 'warning', days: d }; }
    if (d <= 14) { return { level: 'soon', days: d }; }
    return { level: 'normal', days: d };
  }

  function deadlineLabel(iso) {
    var d = daysUntil(iso);
    if (d === null) { return ''; }
    if (d === 0) { return 'Closes today'; }
    if (d === 1) { return 'Closes tomorrow'; }
    if (d < 0) {
      var ago = Math.abs(d);
      return 'Closed ' + ago + ' ' + pluralise(ago, 'day') + ' ago';
    }
    return d + ' days remaining';
  }

  function appliedLabel(appliedAt) {
    var d = daysSince(appliedAt);
    if (d === null) { return ''; }
    if (d === 0) { return 'Applied today'; }
    if (d === 1) { return 'Applied yesterday'; }
    return 'Applied ' + d + ' days ago';
  }

  function followUpLabel(iso) {
    var d = daysUntil(iso);
    if (d === null) { return ''; }
    if (d === 0) { return 'Follow-up due today'; }
    if (d === 1) { return 'Follow-up due tomorrow'; }
    if (d < 0) {
      var ago = Math.abs(d);
      return 'Follow-up overdue by ' + ago + ' ' + pluralise(ago, 'day');
    }
    return 'Follow-up in ' + d + ' days';
  }

  function formatDateLong(iso) {
    var d = fromISO(iso);
    if (!d) { return ''; }
    return WEEKDAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  function formatDateShort(iso) {
    var d = fromISO(iso);
    if (!d) { return ''; }
    return d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getFullYear();
  }

  function formatStamp(ts) {
    if (!ts) { return ''; }
    var d = new Date(ts);
    if (isNaN(d.getTime())) { return ''; }
    return d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getFullYear() + ', ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function greeting() {
    var hour = new Date(Date.now()).getHours();
    if (hour < 5) { return 'Good evening'; }
    if (hour < 12) { return 'Good morning'; }
    if (hour < 17) { return 'Good afternoon'; }
    return 'Good evening';
  }

  function minutesFromHHMM(value) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
    if (!m) { return null; }
    var hh = Number(m[1]), mm = Number(m[2]);
    if (hh > 23 || mm > 59) { return null; }
    return hh * 60 + mm;
  }

  /* =========================================================================
     4. STATE  —  localStorage with validation and corruption recovery
     ====================================================================== */

  var VALID_STATUSES = ['Saved', 'Preparing', 'Applied', 'Interview Scheduled',
                        'Offer Received', 'Rejected', 'Closed'];
  var VALID_PRIORITIES = ['High', 'Medium', 'Foundation'];
  var VALID_WORKPLACE = ['', 'On-site', 'Remote', 'Hybrid'];

  function defaultState() {
    return {
      version: 2,
      onboarded: false,
      profile: {
        name: '', age: '', education: '', fieldOfStudy: '', goal: '',
        skills: [], dailyMinutes: 60, reminderTime: '19:00', createdAt: null
      },
      opportunities: [],
      /* Daily tasks that belong to no job — created by hand on Today's Plan. */
      ownTasks: [],
      general: { studyPlan: null },
      settings: {
        apiKey: '',
        model: (window.Gemini && window.Gemini.DEFAULT_MODEL) || 'gemini-3.6-flash',
        demoMode: false,
        notificationsEnabled: false
      },
      lastNotificationDate: null
    };
  }

  /* ---- validators: never let bad data reach the renderer ---------------- */

  function normaliseQuizQuestion(raw) {
    if (!raw || typeof raw !== 'object') { return null; }
    var question = asText(raw.question);
    var options = asArray(raw.options);
    if (!question || options.length < 2) { return null; }
    var answerIndex = clampInt(raw.answerIndex, 0, options.length - 1, 0);
    return {
      question: question.slice(0, 600),
      options: options.slice(0, 6).map(function (o) { return o.slice(0, 300); }),
      answerIndex: answerIndex,
      explanation: asText(raw.explanation).slice(0, 1200)
    };
  }

  function normaliseLesson(raw) {
    if (!raw || typeof raw !== 'object') { return null; }
    var title = asText(raw.title);
    if (!title) { return null; }
    var quiz = Array.isArray(raw.quiz)
      ? raw.quiz.map(normaliseQuizQuestion).filter(Boolean).slice(0, 6) : [];
    return {
      title: title.slice(0, 200),
      overview: asText(raw.overview).slice(0, 4000),
      keyPoints: asArray(raw.keyPoints).slice(0, 12),
      practicalExample: typeof raw.practicalExample === 'string'
        ? raw.practicalExample.slice(0, 6000) : '',
      jobRelevance: asText(raw.jobRelevance).slice(0, 2000),
      interviewTips: asArray(raw.interviewTips).slice(0, 10),
      quiz: quiz,
      generatedAt: asText(raw.generatedAt) || null,
      /* 'demo' or 'gemini' — lessons are cached forever, so without this a
         sample written in Demo mode is indistinguishable from a real one. */
      source: raw.source === 'gemini' ? 'gemini' : (raw.source === 'demo' ? 'demo' : null)
    };
  }

  function normaliseQuizState(raw) {
    if (!raw || typeof raw !== 'object') { return null; }
    var answers = Array.isArray(raw.answers) ? raw.answers.map(function (a) {
      var n = parseInt(a, 10);
      return isNaN(n) ? null : n;
    }) : [];
    return {
      answers: answers,
      submitted: raw.submitted === true,
      score: clampInt(raw.score, 0, 20, 0),
      total: clampInt(raw.total, 0, 20, answers.length),
      completedAt: asText(raw.completedAt) || null
    };
  }

  function normaliseTopic(raw) {
    if (!raw || typeof raw !== 'object') { return null; }
    var name = asText(raw.name);
    if (!name) { return null; }
    var priority = asText(raw.priority);
    if (VALID_PRIORITIES.indexOf(priority) === -1) { priority = 'Medium'; }
    return {
      id: asText(raw.id) || uid('topic'),
      name: name.slice(0, 200),
      reason: asText(raw.reason).slice(0, 800),
      priority: priority,
      estimatedMinutes: clampInt(raw.estimatedMinutes, 10, 240, 45),
      custom: raw.custom === true,
      completed: raw.completed === true,
      completedAt: asText(raw.completedAt) || null,
      lesson: normaliseLesson(raw.lesson),
      quizState: normaliseQuizState(raw.quizState),
      qa: Array.isArray(raw.qa) ? raw.qa.slice(0, 20).map(function (item) {
        return {
          q: asText(item && item.q).slice(0, 1000),
          a: typeof (item && item.a) === 'string' ? item.a.slice(0, 4000) : '',
          at: asText(item && item.at) || null
        };
      }).filter(function (i) { return i.q && i.a; }) : []
    };
  }

  function normaliseStudyPlan(raw) {
    if (!raw || typeof raw !== 'object') { return null; }
    var topics = Array.isArray(raw.topics)
      ? raw.topics.map(normaliseTopic).filter(Boolean).slice(0, 40) : [];
    if (!topics.length) { return null; }
    return {
      goal: asText(raw.goal).slice(0, 600),
      topics: topics,
      createdAt: asText(raw.createdAt) || null,
      source: ['gemini', 'demo', 'own'].indexOf(raw.source) !== -1 ? raw.source : null
    };
  }

  function normaliseTask(raw) {
    if (!raw || typeof raw !== 'object') { return null; }
    var date = asText(raw.date);
    if (!isValidISO(date)) { return null; }
    var title = asText(raw.topicName);
    if (!title) { return null; }
    return {
      id: asText(raw.id) || uid('task'),
      date: date,
      topicId: asText(raw.topicId) || null,
      topicName: title.slice(0, 200),
      activity: asText(raw.activity).slice(0, 600),
      minutes: clampInt(raw.minutes, 5, 480, 30),
      done: raw.done === true,
      doneAt: asText(raw.doneAt) || null,
      manual: raw.manual === true
    };
  }

  function normaliseChecklistItem(raw) {
    if (!raw || typeof raw !== 'object') { return null; }
    var text = asText(raw.text);
    if (!text) { return null; }
    return {
      id: asText(raw.id) || uid('chk'),
      text: text.slice(0, 300),
      done: raw.done === true,
      doneAt: asText(raw.doneAt) || null
    };
  }

  function normaliseOpportunity(raw) {
    if (!raw || typeof raw !== 'object') { return null; }
    var role = asText(raw.role);
    var company = asText(raw.company);
    if (!role && !company) { return null; }
    var status = asText(raw.status);
    if (VALID_STATUSES.indexOf(status) === -1) { status = 'Saved'; }
    var workplace = asText(raw.workplaceType);
    if (VALID_WORKPLACE.indexOf(workplace) === -1) { workplace = ''; }
    var deadline = asText(raw.deadline);
    if (!isValidISO(deadline)) { deadline = ''; }
    var followUp = asText(raw.followUpDate);
    if (!isValidISO(followUp)) { followUp = ''; }

    return {
      id: asText(raw.id) || uid('opp'),
      createdAt: asText(raw.createdAt) || new Date().toISOString(),
      updatedAt: asText(raw.updatedAt) || new Date().toISOString(),
      role: role.slice(0, 200) || 'Untitled role',
      company: company.slice(0, 200),
      location: asText(raw.location).slice(0, 200),
      workplaceType: workplace,
      salary: asText(raw.salary).slice(0, 200),
      jobUrl: safeUrl(raw.jobUrl),
      qualifications: asArray(raw.qualifications).slice(0, 40),
      experienceRequirements: asArray(raw.experienceRequirements).slice(0, 40),
      requiredSkills: asArray(raw.requiredSkills).slice(0, 60),
      preferredSkills: asArray(raw.preferredSkills).slice(0, 60),
      responsibilities: asArray(raw.responsibilities).slice(0, 40),
      documents: asArray(raw.documents).slice(0, 40),
      unfamiliarTerms: Array.isArray(raw.unfamiliarTerms) ? raw.unfamiliarTerms.map(function (t) {
        return {
          term: asText(t && t.term).slice(0, 160),
          explanation: asText(t && t.explanation).slice(0, 800)
        };
      }).filter(function (t) { return t.term && t.explanation; }).slice(0, 12) : [],
      deadline: deadline,
      followUpDate: followUp,
      notes: typeof raw.notes === 'string' ? raw.notes.slice(0, 8000) : '',
      sourceText: typeof raw.sourceText === 'string' ? raw.sourceText.slice(0, 40000) : '',
      sourceImageName: asText(raw.sourceImageName).slice(0, 260),
      sourceType: asText(raw.sourceType) || 'manual',
      status: status,
      appliedAt: asText(raw.appliedAt) || null,
      checklist: Array.isArray(raw.checklist)
        ? raw.checklist.map(normaliseChecklistItem).filter(Boolean).slice(0, 80) : [],
      studyPlan: normaliseStudyPlan(raw.studyPlan),
      schedule: Array.isArray(raw.schedule)
        ? raw.schedule.map(normaliseTask).filter(Boolean).slice(0, 400) : []
    };
  }

  function normaliseState(raw) {
    var base = defaultState();
    if (!raw || typeof raw !== 'object') { return base; }

    var p = raw.profile && typeof raw.profile === 'object' ? raw.profile : {};
    base.profile = {
      name: asText(p.name).slice(0, 80),
      age: asText(p.age).slice(0, 4),
      education: asText(p.education).slice(0, 160),
      fieldOfStudy: asText(p.fieldOfStudy).slice(0, 160),
      goal: asText(p.goal).slice(0, 80),
      skills: asArray(p.skills).slice(0, 80),
      dailyMinutes: clampInt(p.dailyMinutes, 10, 600, 60),
      reminderTime: minutesFromHHMM(p.reminderTime) === null ? '19:00' : asText(p.reminderTime),
      createdAt: asText(p.createdAt) || null
    };

    var s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    var savedModel = asText(s.model).slice(0, 80);
    /* Anyone still carrying the previous default is moved to the current one:
       a saved value would otherwise pin them to a model that returns 404. */
    var usedPreviousDefault = savedModel === 'gemini-3.5-flash-lite';
    if (usedPreviousDefault) { savedModel = ''; }
    base.settings = {
      apiKey: asText(s.apiKey).slice(0, 200),
      model: savedModel || base.settings.model,
      demoMode: usedPreviousDefault ? false : s.demoMode === true,
      notificationsEnabled: s.notificationsEnabled === true
    };

    base.opportunities = Array.isArray(raw.opportunities)
      ? raw.opportunities.map(normaliseOpportunity).filter(Boolean).slice(0, 300) : [];

    base.ownTasks = Array.isArray(raw.ownTasks)
      ? raw.ownTasks.map(normaliseTask).filter(Boolean).slice(0, 400) : [];
    base.general = { studyPlan: normaliseStudyPlan(raw.general && raw.general.studyPlan) };
    base.onboarded = raw.onboarded === true || !!base.profile.name;
    base.lastNotificationDate = isValidISO(asText(raw.lastNotificationDate))
      ? asText(raw.lastNotificationDate) : null;
    return base;
  }

  var state = defaultState();
  var pendingNotice = null;

  function loadState() {
    var raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      /* Storage blocked entirely (private mode, disabled cookies). */
      state = defaultState();
      pendingNotice = 'This browser is blocking local storage, so HirePath cannot remember your ' +
                      'data after a refresh. Everything else still works for this session.';
      return;
    }
    if (!raw) { state = defaultState(); return; }

    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      /* Corrupted JSON: keep a copy, start clean, keep running. */
      try { localStorage.setItem(STORAGE_KEY + '-corrupt-backup', raw.slice(0, 200000)); } catch (e2) { /* ignore */ }
      state = defaultState();
      pendingNotice = 'Saved HirePath data could not be read, so a fresh notebook was started. ' +
                      'The unreadable copy was kept under the key "hirepath-v2-corrupt-backup".';
      return;
    }
    try {
      state = normaliseState(parsed);
    } catch (e) {
      state = defaultState();
      pendingNotice = 'Saved HirePath data was not in a usable shape, so a fresh notebook was started.';
    }
  }

  function saveState() {
    state.savedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
        toast('Browser storage is full, so that change was not saved. Export your data and remove an ' +
              'opportunity from Settings.', 'error');
      } else {
        toast('This browser refused to save data (private browsing can cause this). ' +
              'Changes will be lost on refresh.', 'error');
      }
      return false;
    }
  }

  /** Persist + re-render. Every mutating action funnels through here. */
  function commit(options) {
    saveState();
    if (!options || options.render !== false) { render(); }
  }

  function findOpp(id) {
    for (var i = 0; i < state.opportunities.length; i++) {
      if (state.opportunities[i].id === id) { return state.opportunities[i]; }
    }
    return null;
  }

  function touch(opp) { opp.updatedAt = new Date().toISOString(); }

  /* =========================================================================
     5. FEEDBACK: toasts, modal confirmation, status lines
     ====================================================================== */

  function toast(message, kind) {
    var region = $('#toast-region');
    if (!region) { return; }
    var node = h('div', { class: 'toast' + (kind ? ' ' + kind : '') }, message);
    region.appendChild(node);
    setTimeout(function () {
      if (node.parentNode) { node.parentNode.removeChild(node); }
    }, kind === 'error' ? 8000 : 4200);
  }

  /** Accessible confirm dialog; resolves true/false. */
  function confirmDialog(opts) {
    return new Promise(function (resolve) {
      var root = $('#modal-root');
      var lastFocus = document.activeElement;
      clear(root);
      root.hidden = false;

      function close(result) {
        root.hidden = true;
        clear(root);
        document.removeEventListener('keydown', onKey, true);
        if (lastFocus && lastFocus.focus) { lastFocus.focus(); }
        resolve(result);
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); close(false); return; }
        if (e.key === 'Tab') {
          var focusables = root.querySelectorAll('button, [href], input, select, textarea');
          if (!focusables.length) { return; }
          var first = focusables[0], last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      document.addEventListener('keydown', onKey, true);

      var confirmBtn = h('button', {
        type: 'button',
        class: 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary'),
        onclick: function () { close(true); }
      }, opts.confirmText || 'Confirm');

      var dialog = h('div', {
        class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title'
      },
        h('h2', { id: 'modal-title' }, opts.title || 'Are you sure?'),
        paragraphs(opts.message, 'soft'),
        h('div', { class: 'modal-actions' },
          h('button', {
            type: 'button', class: 'btn btn-secondary',
            onclick: function () { close(false); }
          }, opts.cancelText || 'Cancel'),
          confirmBtn
        )
      );
      root.appendChild(dialog);
      root.addEventListener('mousedown', function (e) {
        if (e.target === root) { close(false); }
      });
      confirmBtn.focus();
    });
  }

  /** aria-live status line used by every async Gemini action. */
  function statusLine(id) {
    return h('p', { class: 'status-msg', id: id, role: 'status', 'aria-live': 'polite' });
  }

  function setStatus(node, message, kind) {
    if (!node) { return; }
    clear(node);
    node.className = 'status-msg' + (kind ? ' is-' + kind : '');
    if (kind === 'busy') {
      node.appendChild(h('span', { class: 'spinner', 'aria-hidden': 'true' }));
      node.appendChild(document.createTextNode(' '));
    }
    node.appendChild(document.createTextNode(message || ''));
  }

  function setBusy(button, busy, busyLabel) {
    if (!button) { return; }
    if (busy) {
      if (!button.dataset.label) { button.dataset.label = button.textContent; }
      button.disabled = true;
      clear(button);
      button.appendChild(h('span', { class: 'spinner', 'aria-hidden': 'true' }));
      button.appendChild(document.createTextNode(' ' + (busyLabel || 'Working...')));
    } else {
      button.disabled = false;
      var label = button.dataset.label || 'Done';
      clear(button);
      button.appendChild(document.createTextNode(label));
    }
  }

  function geminiErrorMessage(err) {
    if (err && err.name === 'GeminiError') { return err.message; }
    return 'Something went wrong while talking to Gemini. Try again, or use Demo mode.';
  }

  /* =========================================================================
     6. SHARED UI PIECES
     ====================================================================== */

  function badge(label, tone, opts) {
    var props = { class: 'badge ' + (tone || 'neutral') };
    if (opts && opts.title) { props.title = opts.title; }
    /* Colour is never the only signal: the label always carries the meaning. */
    return h('span', props,
      opts && opts.dot ? h('span', { class: 'badge-dot', 'aria-hidden': 'true' }) : null,
      label);
  }

  var STATUS_TONE = {
    'Saved': 'neutral',
    'Preparing': 'info',
    'Applied': 'teal',
    'Interview Scheduled': 'navy',
    'Offer Received': 'ok',
    'Rejected': 'danger',
    'Closed': 'neutral'
  };

  function statusBadge(status) {
    return badge(status, STATUS_TONE[status] || 'neutral', { dot: true });
  }

  function deadlineBadge(iso) {
    var u = urgencyOf(iso);
    if (!u) { return null; }
    return badge(deadlineLabel(iso), 'u-' + u.level, {
      title: 'Deadline ' + formatDateLong(iso), dot: true
    });
  }

  function progressBar(done, total, labelText) {
    var pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return h('div', { class: 'progress' },
      h('div', {
        class: 'progress-track', role: 'progressbar',
        'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100',
        'aria-label': labelText || 'Progress'
      }, h('div', {
        class: 'progress-fill' + (pct === 100 ? ' is-complete' : ''),
        style: 'width:' + pct + '%'
      })),
      h('span', { class: 'progress-label' }, pct + '%')
    );
  }

  /* ---------------------------------------------------------------------
     Inline SVG icons.
     Built with createElementNS (document.createElement cannot make real SVG
     nodes), so the "no innerHTML anywhere" rule still holds.
     Every icon is decorative: the label beside it always carries the meaning.
     --------------------------------------------------------------------- */

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgNode(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (key) {
      node.setAttribute(key, String(attrs[key]));
    });
    return node;
  }

  /* Each icon is a list of shapes drawn on a 24x24 grid. */
  var ICONS = {
    briefcase: [
      { d: 'M4 8h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z' },
      { d: 'M9 8V6.5A2.5 2.5 0 0 1 11.5 4h1A2.5 2.5 0 0 1 15 6.5V8' },
      { d: 'M3 13h18' }
    ],
    send: [
      { d: 'M21 3 3 10.5l7.5 3L13.5 21 21 3z' },
      { d: 'M10.5 13.5 21 3' }
    ],
    clock: [
      { c: [12, 12, 8.5] },
      { d: 'M12 7.5V12l3 2' }
    ],
    target: [
      { c: [12, 12, 8.5] },
      { d: 'M8.5 12.2l2.4 2.4 4.6-5' }
    ],
    calendar: [
      { d: 'M4 6h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z' },
      { d: 'M3 10.5h18' }, { d: 'M8 3.5V6' }, { d: 'M16 3.5V6' }
    ],
    bell: [
      { d: 'M18 9.5a6 6 0 1 0-12 0c0 4.5-2 5.5-2 5.5h16s-2-1-2-5.5' },
      { d: 'M10.4 19a2 2 0 0 0 3.2 0' }
    ],
    trending: [
      { d: 'M3 16.5l5.5-5.5 3.5 3.5 7-7' },
      { d: 'M15.5 7.5H19v3.5' }
    ],
    compass: [
      { c: [12, 12, 8.5] },
      { d: 'M15.5 8.5 13.2 13.2 8.5 15.5l2.3-4.7z' }
    ],
    bulb: [
      { d: 'M12 3.5a5.5 5.5 0 0 1 3.5 9.7V15h-7v-1.8A5.5 5.5 0 0 1 12 3.5z' },
      { d: 'M9.5 18h5' }, { d: 'M10.5 20.5h3' }
    ],
    plus: [{ d: 'M12 5.5v13' }, { d: 'M5.5 12h13' }],
    flag: [{ d: 'M5.5 21V4' }, { d: 'M5.5 5h11l-2.2 3.2L16.5 11.5h-11' }],
    sparkle: [
      { d: 'M12 4l1.7 4.3L18 10l-4.3 1.7L12 16l-1.7-4.3L6 10l4.3-1.7z' },
      { d: 'M18.5 16.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z' }
    ]
  };

  function icon(name, className) {
    var shapes = ICONS[name] || [];
    var svg = svgNode('svg', {
      viewBox: '0 0 24 24',
      class: 'icon' + (className ? ' ' + className : ''),
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '1.7',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      focusable: 'false'
    });
    shapes.forEach(function (shape) {
      if (shape.c) {
        svg.appendChild(svgNode('circle', { cx: shape.c[0], cy: shape.c[1], r: shape.c[2] }));
      } else {
        svg.appendChild(svgNode('path', { d: shape.d }));
      }
    });
    return svg;
  }

  /** Heading with a small leading icon, used across the dashboard sections. */
  function iconHeading(level, iconName, text, tone) {
    return h(level, { class: 'with-icon' },
      h('span', { class: 'heading-icon' + (tone ? ' ' + tone : '') }, icon(iconName)),
      h('span', null, text));
  }

  /** Circular progress ring for the welcome area. */
  function progressRing(pct, labelText) {
    var r = 32;
    var circumference = 2 * Math.PI * r;
    var offset = circumference * (1 - Math.max(0, Math.min(100, pct)) / 100);

    var svg = svgNode('svg', {
      class: 'ring', viewBox: '0 0 80 80', role: 'img',
      'aria-label': labelText + ': ' + pct + ' per cent'
    });
    svg.appendChild(svgNode('circle', {
      class: 'ring-track', cx: 40, cy: 40, r: r, fill: 'none', 'stroke-width': 8
    }));
    svg.appendChild(svgNode('circle', {
      class: 'ring-fill' + (pct === 100 ? ' is-complete' : ''),
      cx: 40, cy: 40, r: r, fill: 'none', 'stroke-width': 8, 'stroke-linecap': 'round',
      'stroke-dasharray': circumference.toFixed(2),
      'stroke-dashoffset': offset.toFixed(2),
      transform: 'rotate(-90 40 40)'
    }));
    var text = svgNode('text', {
      class: 'ring-text', x: 40, y: 40, 'text-anchor': 'middle', 'dominant-baseline': 'central'
    });
    text.appendChild(document.createTextNode(pct + '%'));
    svg.appendChild(text);
    return svg;
  }

  function emptyState(glyph, title, message, actionNode) {
    return h('div', { class: 'empty' },
      h('span', { class: 'empty-icon', 'aria-hidden': 'true' }, glyph),
      h('h3', null, title),
      h('p', null, message),
      actionNode || null
    );
  }

  function listBlock(title, items, emptyText) {
    if (!items || !items.length) {
      return h('div', { class: 'lesson-block' },
        h('h3', null, title),
        h('p', { class: 'muted small' }, emptyText || 'Not listed in the advertisement.'));
    }
    return h('div', { class: 'lesson-block' },
      h('h3', null, title),
      h('ul', { class: 'bullets' }, items.map(function (i) { return h('li', null, i); })));
  }

  function chipList(items, toneFn) {
    return h('ul', { class: 'chip-list' }, items.map(function (item) {
      return h('li', { class: 'chip' + (toneFn ? ' ' + toneFn(item) : '') }, item);
    }));
  }

  function field(id, labelText, inputNode, helpText, wide) {
    return h('div', { class: 'field' + (wide ? ' field-wide' : '') },
      h('label', { for: id }, labelText),
      inputNode,
      helpText ? h('p', { class: 'field-help' }, helpText) : null);
  }

  function textInput(id, value, attrs) {
    var props = { id: id, name: id, type: 'text' };
    if (attrs) { Object.keys(attrs).forEach(function (k) { props[k] = attrs[k]; }); }
    var node = h('input', props);
    node.value = value === null || value === undefined ? '' : String(value);
    return node;
  }

  function textArea(id, value, rows, placeholder) {
    var node = h('textarea', {
      id: id, name: id, rows: String(rows || 4), placeholder: placeholder || ''
    });
    node.value = value || '';
    return node;
  }

  function listTextArea(id, arr, rows) {
    var node = h('textarea', {
      id: id, name: id, rows: String(rows || 4), placeholder: 'One item per line'
    });
    node.value = (arr || []).join('\n');
    return node;
  }

  function selectInput(id, options, current) {
    var node = h('select', { id: id, name: id });
    options.forEach(function (opt) {
      var value = typeof opt === 'string' ? opt : opt.value;
      var label = typeof opt === 'string' ? (opt || 'Not specified') : opt.label;
      var o = h('option', { value: value }, label);
      if (value === current) { o.selected = true; }
      node.appendChild(o);
    });
    return node;
  }

  /* =========================================================================
     7. DERIVED DATA
     ====================================================================== */

  var DEFAULT_CHECKLIST = [
    'Read the full advertisement again and highlight every requirement',
    'Tailor résumé to this role',
    'Prepare portfolio or work samples',
    'Write cover letter',
    'Collect required documents',
    'Review application for spelling and accuracy',
    'Submit application',
    'Schedule follow-up'
  ];

  /* A new opportunity starts with an EMPTY checklist. Nothing is assumed on
     the user's behalf; they add what they actually need, either one at a time
     or with the optional "suggested steps" button on the opportunity page. */
  function buildChecklist() { return []; }

  /** Only ever called when the user explicitly asks for suggestions. */
  function suggestedChecklistItems(opp) {
    var items = DEFAULT_CHECKLIST.slice();
    (opp.documents || []).slice(0, 10).forEach(function (doc) {
      items.push('Prepare document: ' + doc);
    });
    return items;
  }

  function checklistProgress(opp) {
    var total = opp.checklist.length;
    var done = opp.checklist.filter(function (c) { return c.done; }).length;
    return { done: done, total: total, pct: total ? Math.round((done / total) * 100) : 0 };
  }

  function planProgress(opp) {
    var topics = (opp.studyPlan && opp.studyPlan.topics) || [];
    var done = topics.filter(function (t) { return t.completed; }).length;
    return {
      done: done, total: topics.length,
      pct: topics.length ? Math.round((done / topics.length) * 100) : 0
    };
  }

  function tasksForDate(opp, iso) {
    return (opp.schedule || []).filter(function (t) { return t.date === iso; });
  }

  function allTasksForDate(iso) {
    var out = [];
    state.opportunities.forEach(function (opp) {
      tasksForDate(opp, iso).forEach(function (t) { out.push({ opp: opp, task: t }); });
    });
    /* Personal tasks carry opp === null. */
    (state.ownTasks || []).forEach(function (t) {
      if (t.date === iso) { out.push({ opp: null, task: t }); }
    });
    return out;
  }

  function allOverdueTasks() {
    var today = todayISO();
    var out = [];
    state.opportunities.forEach(function (opp) {
      (opp.schedule || []).forEach(function (t) {
        if (!t.done && t.date < today) { out.push({ opp: opp, task: t }); }
      });
    });
    (state.ownTasks || []).forEach(function (t) {
      if (!t.done && t.date < today) { out.push({ opp: null, task: t }); }
    });
    return out.sort(function (a, b) { return a.task.date < b.task.date ? -1 : 1; });
  }

  /** Skills comparison — case-insensitive EXACT match only.
      Substring matching is deliberately avoided: "Java" must not match "JavaScript". */
  function normaliseSkill(s) { return String(s || '').trim().toLowerCase(); }

  function compareSkills(opp) {
    var mine = {};
    (state.profile.skills || []).forEach(function (s) {
      var k = normaliseSkill(s);
      if (k) { mine[k] = true; }
    });
    var all = (opp.requiredSkills || []).concat(opp.preferredSkills || []);
    var seen = {};
    var inProfile = [], notInProfile = [];
    all.forEach(function (skill) {
      var k = normaliseSkill(skill);
      if (!k || seen[k]) { return; }
      seen[k] = true;
      if (mine[k] === true) { inProfile.push(skill); } else { notInProfile.push(skill); }
    });
    return {
      inProfile: inProfile,
      notInProfile: notInProfile,
      total: inProfile.length + notInProfile.length
    };
  }

  /** The single most useful thing to do next for one opportunity. */
  function nextAction(opp) {
    var today = todayISO();
    var todays = tasksForDate(opp, today).filter(function (t) { return !t.done; });
    var overdue = (opp.schedule || []).filter(function (t) { return !t.done && t.date < today; });
    var dl = daysUntil(opp.deadline);

    if (opp.status === 'Rejected' || opp.status === 'Closed') {
      return 'No action needed — this application is closed.';
    }
    if (opp.status === 'Offer Received') { return 'Respond to the offer.'; }
    if (opp.status === 'Interview Scheduled') {
      return 'Revise your study plan topics before the interview.';
    }
    if (overdue.length) {
      return 'Catch up on ' + overdue.length + ' missed preparation ' + pluralise(overdue.length, 'task') + '.';
    }
    if (todays.length) { return 'Do today’s preparation: ' + todays[0].topicName + '.'; }
    if (opp.status !== 'Applied' && dl !== null && dl >= 0 && dl <= 2) {
      return 'Submit the application — the deadline is very close.';
    }
    if (opp.status === 'Applied' && opp.followUpDate && daysUntil(opp.followUpDate) <= 0) {
      return 'Send your follow-up message.';
    }
    if (!opp.studyPlan) { return 'Build your complete preparation plan.'; }
    if (!(opp.schedule || []).length) { return 'Create your preparation schedule.'; }
    var chk = checklistProgress(opp);
    if (opp.status !== 'Applied' && chk.done < chk.total) {
      var pending = opp.checklist.filter(function (c) { return !c.done; })[0];
      return pending ? pending.text + '.' : 'Finish the application checklist.';
    }
    if (opp.status === 'Saved' || opp.status === 'Preparing') { return 'Submit the application.'; }
    return 'Keep working through your preparation plan.';
  }

  var APPLIED_STATUSES = ['Applied', 'Interview Scheduled', 'Offer Received', 'Rejected'];

  function dashboardStats() {
    var opps = state.opportunities;
    var today = todayISO();
    var approaching = opps.filter(function (o) {
      var u = urgencyOf(o.deadline);
      return u && u.level !== 'expired' && u.level !== 'normal' &&
             o.status !== 'Rejected' && o.status !== 'Closed';
    });
    var todayTasks = allTasksForDate(today);
    var planTotals = opps.reduce(function (acc, o) {
      var p = planProgress(o);
      acc.done += p.done; acc.total += p.total;
      return acc;
    }, { done: 0, total: 0 });
    var followUps = opps.filter(function (o) {
      return o.followUpDate && daysUntil(o.followUpDate) <= 0 &&
             o.status !== 'Rejected' && o.status !== 'Closed';
    });
    return {
      total: opps.length,
      applied: opps.filter(function (o) { return APPLIED_STATUSES.indexOf(o.status) !== -1; }).length,
      interviews: opps.filter(function (o) { return o.status === 'Interview Scheduled'; }).length,
      approaching: approaching.length,
      approachingList: approaching,
      tasksToday: todayTasks.filter(function (t) { return !t.task.done; }).length,
      tasksTodayTotal: todayTasks.length,
      planPct: planTotals.total ? Math.round((planTotals.done / planTotals.total) * 100) : 0,
      planTotals: planTotals,
      followUps: followUps,
      overdue: allOverdueTasks().length
    };
  }

  /* =========================================================================
     8. ROUTER
     ====================================================================== */

  var KNOWN_ROUTES = ['dashboard', 'opportunities', 'add', 'opportunity', 'coach', 'today',
                      'quickwiki', 'profile', 'settings'];
  var route = { name: 'dashboard', params: {} };

  function parseHash() {
    var raw = (location.hash || '#/dashboard').replace(/^#\/?/, '');
    var parts = raw.split('/').filter(Boolean).map(function (p) {
      try { return decodeURIComponent(p); } catch (e) { return p; }
    });
    if (!parts.length) { return { name: 'dashboard', params: {} }; }
    if (KNOWN_ROUTES.indexOf(parts[0]) === -1) { return { name: 'dashboard', params: {} }; }
    return {
      name: parts[0],
      params: { id: parts[1] || null, sub: parts[2] || null, extra: parts[3] || null }
    };
  }

  function go(path) {
    if (location.hash === '#' + path) { render(); return; }
    location.hash = path;
  }

  function closeMenu() {
    var menu = $('#app-menu');
    var toggle = $('#menu-toggle');
    if (menu) { menu.hidden = true; }
    if (toggle) { toggle.setAttribute('aria-expanded', 'false'); }
  }

  window.addEventListener('hashchange', function () {
    route = parseHash();
    closeMenu();
    render();
    var main = $('#main');
    if (main) { main.focus(); }
    window.scrollTo(0, 0);
  });

  /* =========================================================================
     9. DASHBOARD
     ====================================================================== */

  function opportunityCard(opp) {
    var chk = checklistProgress(opp);
    var plan = planProgress(opp);
    var metaBadges = [];

    metaBadges.push(statusBadge(opp.status));
    if (opp.workplaceType) { metaBadges.push(badge(opp.workplaceType, 'navy')); }
    if (opp.salary) { metaBadges.push(badge(opp.salary, 'neutral')); }
    var dl = deadlineBadge(opp.deadline);
    if (dl) { metaBadges.push(dl); }
    if (opp.appliedAt) { metaBadges.push(badge(appliedLabel(opp.appliedAt), 'teal')); }
    if (opp.followUpDate && opp.status !== 'Rejected' && opp.status !== 'Closed') {
      var fd = daysUntil(opp.followUpDate);
      if (fd !== null && fd <= 2) {
        metaBadges.push(badge(followUpLabel(opp.followUpDate), fd <= 0 ? 'warn' : 'info'));
      }
    }

    var open = function () { go('/opportunity/' + opp.id); };

    return h('article', { class: 'opp-card', tabindex: '0', role: 'link',
      'aria-label': 'Open ' + opp.role + (opp.company ? ' at ' + opp.company : ''),
      onclick: open,
      onkeydown: function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      }
    },
      h('div', { class: 'opp-card-top' },
        h('div', null,
          h('h3', { class: 'opp-role' }, opp.role),
          h('p', { class: 'opp-company' },
            [opp.company, opp.location].filter(Boolean).join(' · ') || 'No company recorded')
        )
      ),
      h('div', { class: 'opp-meta' }, metaBadges),
      h('div', { class: 'stack' },
        h('div', null,
          h('p', { class: 'small soft mb-0' }, 'Application checklist (' + chk.done + '/' + chk.total + ')'),
          progressBar(chk.done, chk.total, 'Application checklist progress')),
        h('div', null,
          h('p', { class: 'small soft mb-0' },
            plan.total ? 'Preparation plan (' + plan.done + '/' + plan.total + ' topics)' : 'Preparation plan not built yet'),
          progressBar(plan.done, plan.total, 'Preparation plan progress'))
      ),
      h('p', { class: 'next-action mb-0' },
        h('strong', null, 'Next'), nextAction(opp))
    );
  }

  /**
   * One metric tile.
   * opts: {value, label, iconName, tone, hint}
   * The hint line is where a secondary number lives, so the row stays at four
   * tiles instead of six while keeping the detail on screen.
   */
  function statTile(opts) {
    return h('div', { class: 'stat' + (opts.tone ? ' ' + opts.tone : '') },
      h('div', { class: 'stat-top' },
        h('span', { class: 'stat-icon' }, icon(opts.iconName)),
        h('div', { class: 'stat-value' }, String(opts.value))),
      h('div', { class: 'stat-label' }, opts.label),
      opts.hint ? h('div', { class: 'stat-hint' }, opts.hint) : null);
  }

  /** Overall readiness: checklist items plus plan topics across open applications. */
  function overallReadiness() {
    var done = 0, total = 0;
    state.opportunities.forEach(function (o) {
      if (o.status === 'Rejected' || o.status === 'Closed') { return; }
      var c = checklistProgress(o);
      var p = planProgress(o);
      done += c.done + p.done;
      total += c.total + p.total;
    });
    return { done: done, total: total, pct: total ? Math.round((done / total) * 100) : 0 };
  }

  /** The opportunity that most deserves attention right now. */
  function topPriorityOpp() {
    var today = todayISO();
    var active = state.opportunities.filter(function (o) {
      return o.status !== 'Rejected' && o.status !== 'Closed';
    });
    if (!active.length) { return null; }

    function score(o) {
      var points = 0;
      var overdue = (o.schedule || []).filter(function (t) { return !t.done && t.date < today; }).length;
      var dueToday = tasksForDate(o, today).filter(function (t) { return !t.done; }).length;
      var days = daysUntil(o.deadline);
      if (overdue) { points += 1000; }
      if (dueToday) { points += 500; }
      if (o.followUpDate && daysUntil(o.followUpDate) <= 0) { points += 400; }
      if (days !== null && days >= 0) { points += Math.max(0, 200 - days * 6); }
      return points;
    }
    return active.slice().sort(function (a, b) { return score(b) - score(a); })[0];
  }

  /* --------------------------- welcome areas ---------------------------- */

  /** Progress-led dashboard hero shown once there is something to track. */
  function progressWelcome(name, today) {
    var readiness = overallReadiness();
    var focus = topPriorityOpp();
    var summary = readiness.total
      ? readiness.done + ' of ' + readiness.total +
        ' preparation steps completed across your open applications.'
      : 'Build a preparation plan and your progress will show up here.';

    return h('section', { class: 'dashboard-hero' },
      h('div', { class: 'hero-copy' },
        h('p', { class: 'hero-kicker' },
          h('span', { class: 'hero-kicker-dot', 'aria-hidden': 'true' }),
          formatDateLong(today)),
        h('h1', { class: 'hero-title' }, greeting() + ', ' + name),
        h('p', { class: 'hero-summary' }, summary),
        focus
          ? h('p', { class: 'hero-focus' },
              h('span', { class: 'hero-focus-icon' }, icon('flag')),
              h('span', null,
                h('strong', null, 'Priority · '),
                focus.role + (focus.company ? ' at ' + focus.company : '') + ' — ' + nextAction(focus)))
          : null,
        h('div', { class: 'hero-actions' },
          focus
            ? h('a', { class: 'btn hero-btn-primary', href: '#/opportunity/' + focus.id },
                'Continue preparation', h('span', { 'aria-hidden': 'true' }, '→'))
            : h('a', { class: 'btn hero-btn-primary', href: '#/add' }, 'Add an opportunity'),
          h('a', { class: 'btn hero-btn-secondary', href: '#/today' }, 'View today’s plan'))
      ),
      h('div', { class: 'hero-progress' },
        h('p', { class: 'hero-progress-label' }, 'Overall readiness'),
        h('div', { class: 'hero-progress-main' },
          progressRing(readiness.pct, 'Overall preparation progress'),
          h('div', { class: 'hero-progress-copy' },
            h('strong', null, readiness.done + ' of ' + readiness.total),
            h('span', null, 'steps complete'))),
        h('div', { class: 'hero-progress-track', 'aria-hidden': 'true' },
          h('span', { style: 'width:' + readiness.pct + '%' })),
        h('p', { class: 'hero-progress-note' },
          readiness.pct >= 75 ? 'You’re close — keep the momentum going.' :
          readiness.pct >= 35 ? 'Good progress. Your next step is ready.' :
          'Small steps today build interview confidence.'))
    );
  }

  /** First-run hero: explains the value without filling the page with zeroes. */
  function firstRunWelcome(name, today) {
    var milestones = [
      { iconName: 'briefcase', title: 'Save', text: 'a job post' },
      { iconName: 'sparkle', title: 'Shape', text: 'your plan' },
      { iconName: 'target', title: 'Prepare', text: 'with focus' }
    ];

    return h('section', { class: 'dashboard-hero dashboard-hero-first' },
      h('div', { class: 'hero-copy' },
        h('p', { class: 'hero-kicker' },
          h('span', { class: 'hero-kicker-dot', 'aria-hidden': 'true' }),
          formatDateLong(today)),
        h('h1', { class: 'hero-title' }, greeting() + ', ' + name + '.'),
        h('p', { class: 'hero-summary' },
          'Turn your next job advertisement into a clear application checklist, ' +
          'personalised study plan and daily preparation schedule.'),
        h('div', { class: 'hero-actions' },
          h('a', { class: 'btn hero-btn-primary', href: '#/add' },
            h('span', { 'aria-hidden': 'true' }, '+'), 'Add your first opportunity'),
          h('a', { class: 'btn hero-btn-secondary', href: '#/coach' }, 'Explore preparation coach'))
      ),
      h('div', { class: 'hero-roadmap', 'aria-label': 'How HirePath works' },
        h('p', { class: 'hero-roadmap-label' }, 'Your path, clearly mapped'),
        h('ol', { class: 'hero-milestones' }, milestones.map(function (item, i) {
          return h('li', { class: 'hero-milestone' },
            h('span', { class: 'hero-milestone-icon' }, icon(item.iconName)),
            h('span', { class: 'hero-milestone-copy' },
              h('strong', null, item.title),
              h('small', null, item.text)),
            i < milestones.length - 1
              ? h('span', { class: 'hero-milestone-line', 'aria-hidden': 'true' })
              : null);
        })))
    );
  }

  /** Guided first-run state with concrete value and a short workflow. */
  function gettingStarted() {
    var steps = [
      {
        iconName: 'plus',
        title: 'Save a job advertisement',
        text: 'Paste the text, upload a photo, or type it yourself.'
      },
      {
        iconName: 'bulb',
        title: 'Build your preparation plan',
        text: 'An ordered learning path with lessons and quizzes.'
      },
      {
        iconName: 'calendar',
        title: 'Create your daily schedule',
        text: 'Topics spread across the time you have left.'
      }
    ];

    return h('section', { class: 'section launch-grid' },
      h('article', { class: 'launch-card' },
        h('div', { class: 'launch-card-glow', 'aria-hidden': 'true' }),
        h('p', { class: 'eyebrow launch-eyebrow' }, 'Quick start'),
        h('h2', { class: 'launch-title' }, 'Go from job post to game plan in minutes.'),
        h('p', { class: 'launch-lede' },
          'Paste the advertisement or upload a photo. HirePath builds the plan.'),
        h('div', { class: 'launch-outcomes' },
          h('span', null, icon('target'), 'Skills gap'),
          h('span', null, icon('calendar'), 'Daily plan'),
          h('span', null, icon('bulb'), 'Lessons & quizzes')),
        h('a', { class: 'btn btn-primary btn-lg launch-action', href: '#/add' },
          'Create my first plan', h('span', { 'aria-hidden': 'true' }, '→'))),
      h('article', { class: 'start-panel' },
        h('div', { class: 'start-panel-head' },
          h('span', { class: 'start-panel-icon' }, icon('compass')),
          h('div', null,
            h('p', { class: 'eyebrow' }, 'A simple workflow'),
            h('h2', { class: 'start-title' }, 'Three steps to get moving'))),
        h('ol', { class: 'steps' }, steps.map(function (step, i) {
          return h('li', { class: 'step' + (i === 0 ? ' is-next' : '') },
            h('span', { class: 'step-num' }, i + 1),
            h('div', { class: 'step-body' },
              h('h3', { class: 'step-title' }, step.title),
              h('p', { class: 'step-text' }, step.text)),
            h('span', { class: 'step-icon', 'aria-hidden': 'true' }, icon(step.iconName)));
        })))
    );
  }

  function viewDashboard() {
    var s = dashboardStats();
    var name = state.profile.name || 'there';
    var today = todayISO();
    var todaysTasks = allTasksForDate(today);
    var hasOpportunities = state.opportunities.length > 0;
    var frag = document.createDocumentFragment();

    /* Once there is something to track, the tall banner gives way to progress. */
    frag.appendChild(hasOpportunities
      ? progressWelcome(name, today)
      : firstRunWelcome(name, today));

    if (!hasOpportunities) {
      frag.appendChild(gettingStarted());
      /* Tasks written by hand exist without any job, so the dashboard must not
         claim there is nothing to do just because no opportunity is saved. */
      if (todaysTasks.length) {
        frag.appendChild(h('section', { class: 'section card' },
          h('div', { class: 'card-head' },
            iconHeading('h2', 'calendar', 'Your tasks for today'),
            h('a', { class: 'btn btn-sm btn-secondary', href: '#/today' }, 'Open Today’s Plan')),
          todaysTasks.map(function (entry) {
            return taskRow(entry.opp, entry.task, { showOpp: true });
          })));
      }
      return frag;
    }

    /* Four headline metrics. Interviews and missed tasks live on the hint
       lines of the tiles they belong to, rather than as tiles of their own. */
    var doneToday = s.tasksTodayTotal - s.tasksToday;
    var openCount = state.opportunities.filter(function (o) {
      return o.status !== 'Rejected' && o.status !== 'Closed';
    }).length;
    var nextDeadline = s.approachingList.slice().sort(function (a, b) {
      return a.deadline < b.deadline ? -1 : 1;
    })[0];

    frag.appendChild(h('section', { class: 'section stats' },
      statTile({
        value: s.total, label: 'Opportunities', iconName: 'briefcase', tone: 'is-navy',
        hint: openCount === s.total
          ? 'All still open'
          : openCount + ' still open, ' + (s.total - openCount) + ' closed'
      }),
      statTile({
        value: s.approaching, label: 'Deadlines approaching', iconName: 'clock',
        tone: s.approaching > 0 ? 'is-warn' : null,
        hint: nextDeadline
          ? 'Soonest: ' + deadlineLabel(nextDeadline.deadline)
          : 'Nothing closing in the next two weeks'
      }),
      statTile({
        value: s.tasksToday, label: 'Preparation due today', iconName: 'target',
        tone: s.overdue > 0 ? 'is-alert' : (s.tasksToday > 0 ? 'is-warn' : null),
        hint: s.overdue
          ? s.overdue + ' missed from earlier days'
          : (doneToday > 0 ? doneToday + ' already done today' : 'Nothing overdue')
      })
    ));

    /* The day's work gets the largest area; supporting signals sit beside it. */
    frag.appendChild(h('section', { class: 'section dashboard-workspace' },
      h('div', { class: 'card dashboard-today' },
        h('div', { class: 'card-head' },
          h('div', null,
            h('p', { class: 'eyebrow' }, 'Your focus'),
            iconHeading('h2', 'calendar', 'Today’s preparation')),
          h('a', { class: 'btn btn-sm btn-secondary', href: '#/today' }, 'View full plan')),
        todaysTasks.length
          ? h('div', null, todaysTasks.slice(0, 5).map(function (entry) {
              return taskRow(entry.opp, entry.task, { showOpp: true });
            }))
          : h('div', { class: 'dashboard-calm-state' },
              h('span', { class: 'dashboard-calm-icon' }, icon('sparkle')),
              h('div', null,
                h('h3', null, 'Your schedule is clear today'),
                h('p', null,
                  'Open an opportunity and create a schedule to plan your next focused study session.')),
              h('a', { class: 'btn btn-sm btn-secondary', href: '#/coach' }, 'Open coach'))),
      h('div', { class: 'dashboard-side' },
        h('div', { class: 'card dashboard-mini-card' },
          h('div', { class: 'card-head' }, iconHeading('h2', 'trending', 'Study-plan progress')),
          s.planTotals.total
            ? h('div', null,
                progressBar(s.planTotals.done, s.planTotals.total, 'Overall study plan progress'),
                h('p', { class: 'small soft mt-1 mb-0' },
                  s.planTotals.done + ' of ' + s.planTotals.total +
                  ' topics completed across all opportunities.'))
            : h('p', { class: 'muted small mb-0' },
                'Build a complete preparation plan to see your progress here.')),
        h('div', { class: 'card dashboard-mini-card' },
          h('div', { class: 'card-head' }, iconHeading('h2', 'bell', 'Follow-up reminders')),
          s.followUps.length
            ? h('ul', { class: 'check-list' }, s.followUps.map(function (o) {
                return h('li', { class: 'check-item' },
                  h('div', { class: 'task-body' },
                    h('p', { class: 'task-title' }, o.role + (o.company ? ' — ' + o.company : '')),
                    h('div', { class: 'task-tools' },
                      badge(followUpLabel(o.followUpDate), daysUntil(o.followUpDate) < 0 ? 'danger' : 'warn', { dot: true }),
                      h('a', { class: 'btn btn-sm btn-secondary', href: '#/opportunity/' + o.id }, 'Open'))));
              }))
            : h('p', { class: 'muted small mb-0' },
                'You’re all caught up. Add a follow-up date after submitting an application.'))
      )
    ));

    /* Recent opportunities */
    var recent = state.opportunities.slice().sort(function (a, b) {
      return (b.updatedAt || '') < (a.updatedAt || '') ? -1 : 1;
    });

    frag.appendChild(h('section', { class: 'section' },
      h('div', { class: 'card-head' },
        iconHeading('h2', 'compass', 'Recent opportunities'),
        h('div', { class: 'row' },
          h('a', { class: 'small', href: '#/opportunities' },
            'View all ' + recent.length),
          /* Secondary, contextual entry point — the one prominent
             "+ Add Opportunity" lives in the navigation bar. */
          h('a', { class: 'btn btn-sm btn-secondary', href: '#/add' }, 'Add opportunity'))),
      h('div', { class: 'opp-list' }, recent.slice(0, 12).map(opportunityCard))
    ));

    return frag;
  }

  /* =========================================================================
     9b. MY OPPORTUNITIES  —  every saved job in one place
     ====================================================================== */

  var oppFilter = 'all';

  function viewOpportunities() {
    var frag = document.createDocumentFragment();
    var all = state.opportunities;

    /* Most urgent first: an open deadline outranks a distant one, and anything
       closed drops to the bottom. */
    var sorted = all.slice().sort(function (a, b) {
      var closedA = (a.status === 'Rejected' || a.status === 'Closed') ? 1 : 0;
      var closedB = (b.status === 'Rejected' || b.status === 'Closed') ? 1 : 0;
      if (closedA !== closedB) { return closedA - closedB; }
      var da = daysUntil(a.deadline);
      var db = daysUntil(b.deadline);
      if (da === null && db === null) { return (b.updatedAt || '') < (a.updatedAt || '') ? -1 : 1; }
      if (da === null) { return 1; }
      if (db === null) { return -1; }
      return da - db;
    });

    var counts = { all: all.length };
    VALID_STATUSES.forEach(function (st) { counts[st] = 0; });
    all.forEach(function (o) { counts[o.status] = (counts[o.status] || 0) + 1; });

    var shown = oppFilter === 'all'
      ? sorted
      : sorted.filter(function (o) { return o.status === oppFilter; });

    frag.appendChild(h('div', { class: 'page-head' },
      h('div', null,
        h('p', { class: 'eyebrow' }, 'My opportunities'),
        h('h1', null, all.length
          ? all.length + ' ' + pluralise(all.length, 'job', 'jobs') + ' saved'
          : 'No jobs saved yet'),
        h('p', { class: 'lede' }, 'Every job you have added, most urgent first.')),
      h('a', { class: 'btn btn-primary', href: '#/add' }, '+ Add Opportunity')));

    if (!all.length) {
      frag.appendChild(emptyState('📋', 'Nothing here yet',
        'Add a job advertisement and it will appear here with its deadline and progress.',
        h('a', { class: 'btn btn-primary', href: '#/add' }, 'Add your first opportunity')));
      return frag;
    }

    /* Status filter — only statuses actually in use are offered. */
    var chips = [{ value: 'all', label: 'All', n: counts.all }];
    VALID_STATUSES.forEach(function (st) {
      if (counts[st]) { chips.push({ value: st, label: st, n: counts[st] }); }
    });

    frag.appendChild(h('div', { class: 'opp-filter' }, chips.map(function (c) {
      return h('button', {
        type: 'button',
        class: 'coach-example' + (oppFilter === c.value ? ' is-on' : ''),
        'aria-pressed': oppFilter === c.value ? 'true' : 'false',
        onclick: function () { oppFilter = c.value; render(); }
      }, c.label + ' (' + c.n + ')');
    })));

    frag.appendChild(shown.length
      ? h('div', { class: 'opp-list section' }, shown.map(opportunityCard))
      : h('div', { class: 'section' }, emptyState('🔍', 'Nothing with that status',
          'No saved job is marked “' + oppFilter + '” right now.',
          h('button', {
            type: 'button', class: 'btn btn-secondary',
            onclick: function () { oppFilter = 'all'; render(); }
          }, 'Show all'))));

    return frag;
  }

  /* =========================================================================
     10. ADD OPPORTUNITY  (text / image / manual  ->  review  ->  save)
     ====================================================================== */

  var ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
  var MAX_IMAGE_BYTES = 4 * 1024 * 1024;

  var addState = {
    tab: 'text',
    adText: '',
    image: null,          /* {name, size, mimeType, base64, dataUrl} */
    mode: 'input',        /* 'input' | 'review' */
    draft: null,          /* extracted / manual values under review */
    editingId: null       /* set when editing an existing opportunity */
  };

  function resetAddState() {
    addState = { tab: 'text', adText: '', image: null, mode: 'input', draft: null, editingId: null };
  }

  function blankDraft() {
    return {
      role: '', company: '', location: '', workplaceType: '', salary: '', jobUrl: '',
      qualifications: [], experienceRequirements: [], requiredSkills: [], preferredSkills: [],
      responsibilities: [], documents: [], unfamiliarTerms: [],
      deadline: '', followUpDate: '', notes: '', sourceText: '', sourceImageName: '',
      sourceType: 'manual'
    };
  }

  /** Accept whatever Gemini returned, keeping only known fields. */
  function draftFromGemini(data, sourceText, imageName, sourceType) {
    var draft = blankDraft();
    if (data && typeof data === 'object') {
      draft.role = asText(data.role);
      draft.company = asText(data.company);
      draft.location = asText(data.location);
      var wp = asText(data.workplaceType);
      draft.workplaceType = VALID_WORKPLACE.indexOf(wp) === -1 ? '' : wp;
      draft.salary = asText(data.salary);
      draft.qualifications = asArray(data.qualifications);
      draft.experienceRequirements = asArray(data.experienceRequirements);
      draft.requiredSkills = asArray(data.requiredSkills);
      draft.preferredSkills = asArray(data.preferredSkills);
      draft.responsibilities = asArray(data.responsibilities);
      draft.documents = asArray(data.documents);
      var dl = asText(data.deadline);
      draft.deadline = isValidISO(dl) ? dl : '';
      draft.unfamiliarTerms = Array.isArray(data.unfamiliarTerms)
        ? data.unfamiliarTerms.map(function (t) {
            return { term: asText(t && t.term), explanation: asText(t && t.explanation) };
          }).filter(function (t) { return t.term && t.explanation; }).slice(0, 12)
        : [];
    }
    draft.sourceText = sourceText || '';
    draft.sourceImageName = imageName || '';
    draft.sourceType = sourceType || 'manual';
    return draft;
  }

  function missingFieldsIn(draft) {
    var missing = [];
    if (!draft.role) { missing.push('role'); }
    if (!draft.company) { missing.push('company'); }
    if (!draft.deadline) { missing.push('application deadline'); }
    if (!draft.requiredSkills.length) { missing.push('required skills'); }
    if (!draft.documents.length) { missing.push('required documents'); }
    return missing;
  }

  /** Reads the review/manual form back into a draft object. */
  function readDraftForm(root) {
    var get = function (id) {
      var node = $('#' + id, root);
      return node ? node.value : '';
    };
    var draft = addState.draft ? addState.draft : blankDraft();
    return {
      role: asText(get('f-role')),
      company: asText(get('f-company')),
      location: asText(get('f-location')),
      workplaceType: asText(get('f-workplace')),
      salary: asText(get('f-salary')),
      jobUrl: asText(get('f-url')),
      qualifications: linesToArray(get('f-qualifications')),
      experienceRequirements: linesToArray(get('f-experience')),
      requiredSkills: linesToArray(get('f-required')),
      preferredSkills: linesToArray(get('f-preferred')),
      responsibilities: linesToArray(get('f-responsibilities')),
      documents: linesToArray(get('f-documents')),
      deadline: asText(get('f-deadline')),
      followUpDate: asText(get('f-followup')),
      notes: get('f-notes'),
      unfamiliarTerms: draft.unfamiliarTerms || [],
      sourceText: draft.sourceText || '',
      sourceImageName: draft.sourceImageName || '',
      sourceType: draft.sourceType || 'manual'
    };
  }

  /** The shared editable form used by manual entry, the review screen and editing. */
  function draftForm(draft, options) {
    options = options || {};
    var form = h('form', {
      class: 'form-grid', novalidate: true,
      onsubmit: function (e) { e.preventDefault(); options.onSave(readDraftForm(form), form); }
    },
      field('f-role', 'Vacancy role', textInput('f-role', draft.role, {
        required: true, placeholder: 'e.g. Junior Frontend Developer'
      })),
      field('f-company', 'Company name', textInput('f-company', draft.company, {
        placeholder: 'e.g. Northwind Digital'
      })),
      field('f-location', 'Job location', textInput('f-location', draft.location, {
        placeholder: 'e.g. Chennai, India'
      })),
      field('f-workplace', 'Workplace type',
        selectInput('f-workplace', [
          { value: '', label: 'Not specified' },
          { value: 'On-site', label: 'On-site' },
          { value: 'Remote', label: 'Remote' },
          { value: 'Hybrid', label: 'Hybrid' }
        ], draft.workplaceType)),
      field('f-salary', 'Salary or salary range', textInput('f-salary', draft.salary, {
        placeholder: 'Leave blank if the advertisement does not say'
      })),
      field('f-url', 'Job URL', textInput('f-url', draft.jobUrl, {
        type: 'url', placeholder: 'https://…'
      }), 'Only http and https links are saved.'),
      field('f-deadline', 'Application deadline',
        textInput('f-deadline', draft.deadline, { type: 'date' })),
      field('f-followup', 'Follow-up date',
        textInput('f-followup', draft.followUpDate, { type: 'date' }),
        'HirePath reminds you when this date arrives.'),

      field('f-qualifications', 'Educational qualifications',
        listTextArea('f-qualifications', draft.qualifications, 3), 'One item per line.', true),
      field('f-experience', 'Experience requirements',
        listTextArea('f-experience', draft.experienceRequirements, 3), 'One item per line.', true),
      field('f-required', 'Required skills',
        listTextArea('f-required', draft.requiredSkills, 4),
        'One skill per line. These are compared with your profile skills.', true),
      field('f-preferred', 'Preferred skills',
        listTextArea('f-preferred', draft.preferredSkills, 3),
        'Nice-to-have skills, kept separate from required skills.', true),
      field('f-responsibilities', 'Job responsibilities',
        listTextArea('f-responsibilities', draft.responsibilities, 4), 'One item per line.', true),
      field('f-documents', 'Documents required',
        listTextArea('f-documents', draft.documents, 3),
        'Each document also becomes a checklist item.', true),
      field('f-notes', 'Notes',
        textArea('f-notes', draft.notes, 3, 'Anything you want to remember about this application'),
        null, true),

      h('div', { class: 'form-actions field-wide' },
        h('button', { type: 'submit', class: 'btn btn-primary' },
          options.saveLabel || 'Save Opportunity'),
        options.onBack
          ? h('button', { type: 'button', class: 'btn btn-secondary', onclick: options.onBack },
              options.backLabel || 'Return to Advertisement')
          : null,
        h('button', {
          type: 'button', class: 'btn btn-ghost',
          onclick: options.onCancel || function () { resetAddState(); go('/dashboard'); }
        }, 'Cancel')
      )
    );
    return form;
  }

  function unfamiliarTermsBlock(terms) {
    if (!terms || !terms.length) { return null; }
    return h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Words explained')),
      h('p', { class: 'small soft' },
        'Gemini flagged these terms from the advertisement as worth explaining.'),
      terms.map(function (t) {
        return h('div', { class: 'term' },
          h('strong', null, t.term),
          h('p', null, t.explanation),
          h('a', {
            class: 'btn btn-sm btn-ghost',
            href: '#/quickwiki',
            onclick: function () {
              lookupState.term = t.term;
              lookupState.result = null;
              lookupState.error = '';
              /* Rendered on the next tick, once the route has changed. */
              setTimeout(function () {
                var input = $('#lookup-term');
                var btn = $('#view .coach-ask-row .btn');
                if (input && btn) { input.value = t.term; runLookup(t.term, $('#lookup-status'), btn); }
              }, 60);
            }
          }, 'Look up “' + t.term + '”'));
      })
    );
  }

  function tabButton(id, label, current, onSelect) {
    return h('button', {
      type: 'button', class: 'tab', role: 'tab', id: 'tab-' + id,
      'aria-selected': current === id ? 'true' : 'false',
      'aria-controls': 'tabpanel-' + id,
      tabindex: current === id ? '0' : '-1',
      onclick: function () { onSelect(id); },
      onkeydown: function (e) {
        var order = ['text', 'image', 'manual'];
        var i = order.indexOf(id);
        if (e.key === 'ArrowRight') { e.preventDefault(); onSelect(order[(i + 1) % order.length]); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); onSelect(order[(i + 2) % order.length]); }
      }
    }, label);
  }

  function analyse(kind, statusNode, button) {
    var settings = state.settings;
    setStatus(statusNode, settings.demoMode
      ? 'Reading the advertisement using Demo mode…'
      : 'Sending the advertisement to Gemini…', 'busy');
    setBusy(button, true, 'Analysing…');

    /* A rate limit is retried automatically; say so rather than looking stuck. */
    function onRetry(attemptNo, seconds, kind2) {
      setStatus(statusNode,
        (kind2 === 'quota'
          ? 'Gemini is rate-limiting requests. '
          : 'Gemini is busy. ') +
        'Waiting ' + seconds + ' ' + pluralise(seconds, 'second') +
        ' and trying again (attempt ' + (attemptNo + 1) + ' of 3)…', 'busy');
    }

    var request;
    if (kind === 'image') {
      request = Gemini.analyseImage(
        addState.image.base64, addState.image.mimeType, settings, onRetry);
    } else {
      request = Gemini.analyseText(addState.adText, settings, onRetry);
    }

    request.then(function (data) {
      addState.draft = draftFromGemini(
        data,
        kind === 'image' ? '' : addState.adText,
        kind === 'image' ? addState.image.name : '',
        kind === 'image' ? 'image' : 'text'
      );
      addState.mode = 'review';
      render();
      toast('Analysis finished. Check every field before saving.', 'ok');
    }, function (err) {
      setBusy(button, false);
      setStatus(statusNode, geminiErrorMessage(err), 'error');
    });
  }

  /* Gemini charges images by 768x768 tile, so a full-resolution poster costs
     several thousand tokens and can exhaust a free-tier per-minute budget in a
     single request. Downscaling to a long edge of 1536 keeps advertisement text
     readable while cutting the tile count dramatically. */
  var MAX_IMAGE_EDGE = 1536;
  var IMAGE_QUALITY = 0.85;

  function compressImage(dataUrl) {
    return new Promise(function (resolve) {
      try {
        var img = new Image();
        img.onload = function () {
          var w = img.naturalWidth || img.width;
          var hh = img.naturalHeight || img.height;
          if (!w || !hh) { resolve(null); return; }

          var scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(w, hh));
          var tw = Math.max(1, Math.round(w * scale));
          var th = Math.max(1, Math.round(hh * scale));

          var canvas = document.createElement('canvas');
          canvas.width = tw;
          canvas.height = th;
          var ctx = canvas.getContext('2d');
          if (!ctx) { resolve(null); return; }
          /* JPEG has no alpha channel, so flatten onto white first. */
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, tw, th);
          ctx.drawImage(img, 0, 0, tw, th);

          var out;
          try {
            out = canvas.toDataURL('image/jpeg', IMAGE_QUALITY);
          } catch (e) { resolve(null); return; }
          var comma = out.indexOf(',');
          if (comma === -1) { resolve(null); return; }

          resolve({
            dataUrl: out,
            base64: out.slice(comma + 1),
            mimeType: 'image/jpeg',
            width: tw, height: th,
            sourceWidth: w, sourceHeight: hh,
            /* base64 is ~4/3 of the byte size */
            bytes: Math.round((out.length - comma - 1) * 0.75)
          });
        };
        img.onerror = function () { resolve(null); };
        img.src = dataUrl;
      } catch (e) { resolve(null); }
    });
  }

  function readImageFile(file, statusNode) {
    var typeOk = ALLOWED_IMAGE_TYPES.indexOf(String(file.type).toLowerCase()) !== -1;
    if (!typeOk) {
      setStatus(statusNode, 'That file type is not supported. Use a PNG, JPG, JPEG or WEBP image.', 'error');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setStatus(statusNode,
        'That image is ' + (file.size / 1048576).toFixed(1) + ' MB. The limit is 4 MB — ' +
        'take a smaller screenshot or compress the image.', 'error');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var dataUrl = String(reader.result || '');
      var comma = dataUrl.indexOf(',');
      if (comma === -1) {
        setStatus(statusNode, 'That image could not be read. Try a different file.', 'error');
        return;
      }
      setStatus(statusNode, 'Preparing the image…', 'busy');
      compressImage(dataUrl).then(function (small) {
        if (small) {
          addState.image = {
            name: file.name,
            size: file.size,
            sentBytes: small.bytes,
            width: small.width, height: small.height,
            sourceWidth: small.sourceWidth, sourceHeight: small.sourceHeight,
            resized: small.width < small.sourceWidth,
            mimeType: small.mimeType,
            base64: small.base64,
            dataUrl: small.dataUrl
          };
        } else {
          /* Canvas unavailable — send the original rather than failing. */
          addState.image = {
            name: file.name,
            size: file.size,
            sentBytes: file.size,
            resized: false,
            /* jpg is not a real MIME type; Gemini expects image/jpeg */
            mimeType: file.type === 'image/jpg' ? 'image/jpeg' : file.type,
            base64: dataUrl.slice(comma + 1),
            dataUrl: dataUrl
          };
        }
        render();
      });
    };
    reader.onerror = function () {
      setStatus(statusNode, 'That image could not be read. Try a different file.', 'error');
    };
    reader.readAsDataURL(file);
  }

  function viewAdd() {
    var frag = document.createDocumentFragment();

    frag.appendChild(h('div', { class: 'page-head' },
      h('div', null,
        h('p', { class: 'eyebrow' }, 'New opportunity'),
        h('h1', null, addState.mode === 'review' ? 'Review before saving' : 'Add an opportunity'),
        h('p', { class: 'lede' }, addState.mode === 'review'
          ? 'Everything below can be edited. Nothing is saved until you choose Save Opportunity.'
          : 'Paste the advertisement, upload a picture, or type the details yourself.'))
    ));

    /* ---------------- review mode ---------------- */
    if (addState.mode === 'review' && addState.draft) {
      var missing = missingFieldsIn(addState.draft);

      /* An unsaved draft used to take over this page for the rest of the
         session: coming back to "Add Opportunity" showed the review form with
         no way back to the paste box except a button far below the fold. The
         tabs stay on screen so the three input methods are always one click
         away, and a draft is never discarded without asking. */
      function leaveReview(goToTab) {
        confirmDialog({
          title: 'Discard this draft?',
          message: 'The extracted details have not been saved yet. Starting again will lose them.',
          confirmText: 'Discard and start again', danger: true
        }).then(function (ok) {
          if (!ok) { return; }
          addState.draft = null;
          addState.mode = 'input';
          if (goToTab) { addState.tab = goToTab; }
          render();
        });
      }

      /* Plain buttons, not tabs: in review mode there is no tab panel to
         control, so tab semantics would be wrong for a screen reader. */
      frag.appendChild(h('div', { class: 'tabs' },
        [['text', '1. Paste advertisement text'],
         ['image', '2. Upload advertisement image'],
         ['manual', '3. Enter information manually']].map(function (pair) {
          return h('button', {
            type: 'button', class: 'tab',
            onclick: function () { leaveReview(pair[0]); }
          }, pair[1]);
        })));

      frag.appendChild(h('div', { class: 'notice', role: 'status' },
        h('p', null,
          h('strong', null, 'Unsaved draft. '),
          'You are reviewing details from an earlier analysis. Pick a tab above to start a ' +
          'different job, or save this one below.')));

      frag.appendChild(h('div', { class: 'notice warn', role: 'status' },
        h('p', null, 'Gemini can make mistakes. Review the extracted information before saving.')));

      if (missing.length) {
        frag.appendChild(h('div', { class: 'notice', role: 'status' },
          h('p', null, 'Gemini did not find a ' + missing.join(', a ') +
            ' in this advertisement, so those fields were left empty. ' +
            'Fill them in yourself if you know them.')));
      }

      frag.appendChild(h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, 'Extracted details')),
        draftForm(addState.draft, {
          saveLabel: 'Save Opportunity',
          onSave: function (values) { saveDraft(values); },
          onBack: function () {
            addState.mode = 'input';
            render();
          },
          backLabel: addState.draft.sourceType === 'image'
            ? 'Return to the image' : 'Return to Advertisement',
          onCancel: function () {
            confirmDialog({
              title: 'Discard this opportunity?',
              message: 'The extracted details have not been saved. They will be lost.',
              confirmText: 'Discard', danger: true
            }).then(function (ok) {
              if (ok) { resetAddState(); go('/dashboard'); }
            });
          }
        })
      ));

      var terms = unfamiliarTermsBlock(addState.draft.unfamiliarTerms);
      if (terms) { frag.appendChild(terms); }
      return frag;
    }

    /* ---------------- input mode ---------------- */
    var selectTab = function (id) { addState.tab = id; render(); };

    frag.appendChild(h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'How to add this job' },
      tabButton('text', '1. Paste advertisement text', addState.tab, selectTab),
      tabButton('image', '2. Upload advertisement image', addState.tab, selectTab),
      tabButton('manual', '3. Enter information manually', addState.tab, selectTab)
    ));

    var panel = h('div', {
      class: 'card mt-1', role: 'tabpanel',
      id: 'tabpanel-' + addState.tab,
      'aria-labelledby': 'tab-' + addState.tab, tabindex: '0'
    });

    if (addState.tab === 'text') {
      var textStatus = statusLine('analyse-text-status');
      var area = textArea('ad-text', addState.adText, 12,
        'Paste the complete job advertisement here, including requirements, responsibilities and any closing date.');
      area.addEventListener('input', function () { addState.adText = area.value; });

      var analyseBtn = h('button', { type: 'button', class: 'btn btn-primary' }, 'Analyse with Gemini');
      analyseBtn.addEventListener('click', function () {
        addState.adText = area.value;
        if (addState.adText.trim().length < 20) {
          setStatus(textStatus, 'Paste the advertisement first — at least a couple of sentences.', 'error');
          area.focus();
          return;
        }
        analyse('text', textStatus, analyseBtn);
      });

      append(panel, [
        h('div', { class: 'field' },
          h('label', { for: 'ad-text' }, 'Advertisement text'),
          area,
          h('p', { class: 'field-help' }, 'Saved with the opportunity.')),
        h('div', { class: 'form-actions' },
          analyseBtn,
          h('button', {
            type: 'button', class: 'btn btn-secondary',
            onclick: function () {
              addState.adText = area.value;
              addState.draft = blankDraft();
              addState.draft.sourceText = addState.adText;
              addState.draft.sourceType = 'text';
              addState.mode = 'review';
              render();
            }
          }, 'Skip analysis and fill in myself')),
        textStatus,
        state.settings.demoMode
          ? h('p', { class: 'small muted' },
              'Demo mode is on, so HirePath returns a fixed sample analysis instead of calling Gemini.')
          : null
      ]);
    }

    if (addState.tab === 'image') {
      var imgStatus = statusLine('analyse-image-status');
      var fileInput = h('input', {
        type: 'file', id: 'ad-image', name: 'ad-image',
        accept: 'image/png,image/jpeg,image/webp'
      });
      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files[0]) { readImageFile(fileInput.files[0], imgStatus); }
      });

      var body = [
        h('div', { class: 'field' },
          h('label', { for: 'ad-image' }, 'Advertisement image'),
          fileInput,
          h('p', { class: 'field-help' },
            'PNG, JPG, JPEG or WEBP, up to 4 MB. The picture itself is not saved.'))
      ];

      if (addState.image) {
        var analyseImgBtn = h('button', { type: 'button', class: 'btn btn-primary' },
          'Analyse image with Gemini');
        analyseImgBtn.addEventListener('click', function () {
          analyse('image', imgStatus, analyseImgBtn);
        });

        var preview = h('img', {
          class: 'preview-img', alt: 'Preview of the advertisement image you selected'
        });
        preview.src = addState.image.dataUrl;

        body.push(h('div', { class: 'preview-wrap mt-1' },
          preview,
          h('div', { class: 'file-meta' },
            h('strong', null, addState.image.name),
            h('p', { class: 'small mb-0' },
              addState.image.resized
                ? (addState.image.size / 1024).toFixed(0) + ' KB → ' +
                  (addState.image.sentBytes / 1024).toFixed(0) + ' KB sent (' +
                  addState.image.width + ' × ' + addState.image.height + ')'
                : (addState.image.size / 1024).toFixed(0) + ' KB · ' + addState.image.mimeType),
            addState.image.resized
              ? h('p', { class: 'small muted mb-0' },
                  'Resized before sending. The text stays readable.')
              : null,
            h('div', { class: 'form-actions' },
              analyseImgBtn,
              h('button', {
                type: 'button', class: 'btn btn-secondary',
                onclick: function () { addState.image = null; render(); }
              }, 'Remove image')))));
      } else {
        body.push(h('div', { class: 'dropzone' },
          h('p', { class: 'mb-0 soft' },
            'Choose a screenshot or photo of the advertisement.')));
      }

      body.push(imgStatus);
      if (state.settings.demoMode) {
        body.push(h('p', { class: 'small muted' },
          'Demo mode is on, so HirePath returns a fixed sample analysis instead of sending the image to Gemini.'));
      }
      append(panel, body);
    }

    if (addState.tab === 'manual') {
      append(panel, [
        h('p', { class: 'small soft' },
          'Fill in whatever you know. Only the role is required — everything else can be added later.'),
        draftForm(addState.draft && addState.draft.sourceType === 'manual' ? addState.draft : blankDraft(), {
          saveLabel: 'Save Opportunity',
          onSave: function (values) { saveDraft(values); }
        })
      ]);
    }

    frag.appendChild(panel);
    return frag;
  }

  /** Validate a draft and store it as a new opportunity. */
  function saveDraft(values) {
    if (!values.role && !values.company) {
      toast('Add at least a role or a company name before saving.', 'error');
      var roleField = $('#f-role');
      if (roleField) { roleField.classList.add('input-invalid'); roleField.focus(); }
      return;
    }
    if (values.deadline && !isValidISO(values.deadline)) { values.deadline = ''; }

    var opp = normaliseOpportunity({
      role: values.role || 'Untitled role',
      company: values.company,
      location: values.location,
      workplaceType: values.workplaceType,
      salary: values.salary,
      jobUrl: values.jobUrl,
      qualifications: values.qualifications,
      experienceRequirements: values.experienceRequirements,
      requiredSkills: values.requiredSkills,
      preferredSkills: values.preferredSkills,
      responsibilities: values.responsibilities,
      documents: values.documents,
      unfamiliarTerms: values.unfamiliarTerms,
      deadline: values.deadline,
      followUpDate: values.followUpDate,
      notes: values.notes,
      sourceText: values.sourceText,
      sourceImageName: values.sourceImageName,
      sourceType: values.sourceType,
      status: 'Saved'
    });
    opp.checklist = buildChecklist(opp);

    state.opportunities.push(opp);
    resetAddState();
    saveState();
    toast('Opportunity saved.', 'ok');
    go('/opportunity/' + opp.id);
  }

  /* =========================================================================
     11. TASK ROW  (shared by dashboard, detail page and Today's Plan)
     ====================================================================== */

  function taskRow(opp, task, opts) {
    opts = opts || {};
    var today = todayISO();
    var isOverdue = !task.done && task.date < today;
    var cls = 'task-row' + (task.done ? ' done' : '') + (isOverdue ? ' overdue' : '');

    var checkbox = h('input', {
      type: 'checkbox', id: 'task-' + task.id,
      'aria-label': 'Mark "' + task.topicName + '" as completed'
    });
    checkbox.checked = task.done;
    checkbox.addEventListener('change', function () {
      task.done = checkbox.checked;
      task.doneAt = checkbox.checked ? new Date().toISOString() : null;
      if (opp) { touch(opp); }
      commit();
    });

    var tools = [];
    if (isOverdue) {
      tools.push(badge('Missed — was due ' + formatDateShort(task.date), 'danger', { dot: true }));
      tools.push(h('button', {
        type: 'button', class: 'btn btn-sm btn-secondary',
        onclick: function () { rescheduleTask(opp, task, today); }
      }, 'Move to today'));
    }
    if (opts.showDate && !isOverdue) {
      tools.push(badge(formatDateShort(task.date), 'neutral'));
    }
    tools.push(badge(task.minutes + ' min', 'teal'));
    if (opts.showOpp) {
      tools.push(opp
        ? h('a', { class: 'btn btn-sm btn-ghost', href: '#/opportunity/' + opp.id }, opp.role)
        : badge('My own task', 'teal'));
    }
    if (!opts.hideTools) {
      tools.push(h('button', {
        type: 'button', class: 'btn btn-sm btn-ghost',
        onclick: function () {
          var next = window.prompt(
            'Move "' + task.topicName + '" to which date? Use YYYY-MM-DD.', task.date);
          if (next === null) { return; }
          if (!isValidISO(next)) { toast('That date was not understood. Use YYYY-MM-DD.', 'error'); return; }
          rescheduleTask(opp, task, next);
        }
      }, 'Reschedule'));
      tools.push(h('button', {
        type: 'button', class: 'btn btn-sm btn-ghost',
        onclick: function () {
          if (opp) {
            opp.schedule = opp.schedule.filter(function (t) { return t.id !== task.id; });
            touch(opp);
          } else {
            state.ownTasks = (state.ownTasks || []).filter(function (t) { return t.id !== task.id; });
          }
          commit();
          toast('Task removed.');
        }
      }, 'Remove'));
    }

    return h('div', { class: cls },
      checkbox,
      h('div', { class: 'task-body' },
        h('label', {
          class: 'task-title' + (task.done ? ' struck' : ''), for: 'task-' + task.id
        }, task.topicName),
        task.activity ? h('p', { class: 'task-activity' }, task.activity) : null,
        h('div', { class: 'task-tools' }, tools))
    );
  }

  function rescheduleTask(opp, task, iso) {
    if (opp && opp.deadline && iso > opp.deadline) {
      toast('That date is after the application deadline (' + formatDateShort(opp.deadline) + ').', 'error');
      return;
    }
    task.date = iso;
    task.done = false;
    task.doneAt = null;
    if (opp) { touch(opp); }
    commit();
    toast('Task moved to ' + formatDateShort(iso) + '.');
  }

  /* =========================================================================
     12. OPPORTUNITY DETAIL
     ====================================================================== */

  var detailEditing = false;

  function statusControl(opp) {
    var sel = selectInput('status-' + opp.id, VALID_STATUSES, opp.status);
    sel.addEventListener('change', function () {
      var next = sel.value;
      if (VALID_STATUSES.indexOf(next) === -1) { return; }
      /* appliedAt is stamped the FIRST time the status becomes Applied. */
      if (next === 'Applied' && !opp.appliedAt) {
        opp.appliedAt = new Date().toISOString();
        if (!opp.followUpDate) {
          opp.followUpDate = addDaysISO(todayISO(), 7);
          toast('Marked as applied. A follow-up reminder was set for one week from today.', 'ok');
        } else {
          toast('Marked as applied today.', 'ok');
        }
      }
      opp.status = next;
      touch(opp);
      commit();
    });
    return h('div', { class: 'field' },
      h('label', { for: 'status-' + opp.id }, 'Application status'), sel);
  }

  function checklistSection(opp) {
    var chk = checklistProgress(opp);
    var list = h('ul', { class: 'check-list' }, opp.checklist.map(function (item) {
      var box = h('input', { type: 'checkbox', id: 'chk-' + item.id });
      box.checked = item.done;
      box.addEventListener('change', function () {
        item.done = box.checked;
        item.doneAt = box.checked ? new Date().toISOString() : null;
        touch(opp);
        commit();
      });
      return h('li', { class: 'check-item' + (item.done ? ' done' : '') },
        h('label', { for: 'chk-' + item.id }, box, h('span', null, item.text)),
        h('button', {
          type: 'button', class: 'btn btn-sm btn-ghost',
          'aria-label': 'Remove checklist item: ' + item.text,
          onclick: function () {
            opp.checklist = opp.checklist.filter(function (c) { return c.id !== item.id; });
            touch(opp);
            commit();
          }
        }, 'Remove'));
    }));

    var newItem = textInput('new-checklist-' + opp.id, '', {
      placeholder: 'Add your own checklist item',
      'aria-label': 'New checklist item'
    });
    function addItem() {
      var value = asText(newItem.value);
      if (!value) { newItem.focus(); return; }
      opp.checklist.push({ id: uid('chk'), text: value.slice(0, 300), done: false, doneAt: null });
      touch(opp);
      commit();
    }
    newItem.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addItem(); }
    });

    return h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', null, 'Application checklist'),
        h('span', { class: 'small soft' }, chk.done + ' of ' + chk.total + ' done')),
      progressBar(chk.done, chk.total, 'Application checklist progress'),
      opp.checklist.length
        ? list
        : h('div', { class: 'mt-1' },
            h('p', { class: 'muted small' }, 'Add the steps this application needs.'),
            h('button', {
              type: 'button', class: 'btn btn-sm btn-secondary',
              onclick: function () {
                var items = suggestedChecklistItems(opp);
                items.forEach(function (text) {
                  opp.checklist.push({ id: uid('chk'), text: text, done: false, doneAt: null });
                });
                touch(opp);
                commit();
                toast('Added ' + items.length + ' suggested steps. Remove any you do not need.', 'ok');
              }
            }, 'Add suggested steps instead')),
      h('div', { class: 'inline-add' },
        newItem,
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: addItem }, 'Add item'))
    );
  }

  function skillsSection(opp) {
    var cmp = compareSkills(opp);
    if (!cmp.total) {
      return h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, 'Skills profile')),
        h('p', { class: 'muted small mb-0' },
          'This opportunity has no skills listed yet. Add required or preferred skills to compare ' +
          'them with your profile.'));
    }
    if (!(state.profile.skills || []).length) {
      return h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, 'Skills profile')),
        h('p', { class: 'small soft' },
          'Your profile has no skills listed, so nothing can be compared yet.'),
        h('p', { class: 'small soft' }, 'Skills this job asks for:'),
        chipList(cmp.notInProfile),
        h('a', { class: 'btn btn-sm btn-secondary mt-1', href: '#/profile' }, 'Add skills to my profile'));
    }

    return h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Skills profile')),
      h('p', { class: 'small soft' },
        'Matched by exact name, so “Java” never matches “JavaScript”.'),
      h('div', { class: 'lesson-block' },
        h('h4', null, 'In your profile (' + cmp.inProfile.length + ')'),
        cmp.inProfile.length
          ? chipList(cmp.inProfile, function () { return 'match'; })
          : h('p', { class: 'muted small mb-0' }, 'None of the listed skills are in your profile yet.')),
      h('div', { class: 'lesson-block' },
        h('h4', null, 'Not in your profile (' + cmp.notInProfile.length + ')'),
        cmp.notInProfile.length
          ? chipList(cmp.notInProfile, function () { return 'gap'; })
          : h('p', { class: 'muted small mb-0' }, 'Every listed skill is already in your profile.')),
      cmp.notInProfile.length
        ? h('p', { class: 'small soft mb-0' },
            'You may simply not have added it yet. Suggested: ' +
            cmp.notInProfile.slice(0, 5).join(', ') + '.')
        : null,
      h('div', { class: 'form-actions' },
        h('a', { class: 'btn btn-sm btn-secondary', href: '#/profile' }, 'Update my skills'),
        h('a', { class: 'btn btn-sm btn-primary', href: '#/coach/' + opp.id }, 'Open Prep Coach'))
    );
  }

  function detailsSection(opp) {
    var dl = h('dl', { class: 'definition-list' });
    function row(label, value) {
      if (!value) { return; }
      dl.appendChild(h('dt', null, label));
      dl.appendChild(h('dd', null, value));
    }
    row('Company', opp.company);
    row('Role', opp.role);
    row('Location', opp.location);
    row('Workplace type', opp.workplaceType);
    row('Salary', opp.salary);
    row('Deadline', opp.deadline ? formatDateLong(opp.deadline) + ' — ' + deadlineLabel(opp.deadline) : '');
    row('Follow-up date', opp.followUpDate ? formatDateLong(opp.followUpDate) + ' — ' + followUpLabel(opp.followUpDate) : '');
    row('Applied', opp.appliedAt ? appliedLabel(opp.appliedAt) + ' (' + formatStamp(opp.appliedAt) + ')' : '');
    row('Saved', formatStamp(opp.createdAt));
    if (opp.sourceImageName) { row('Advertisement image', opp.sourceImageName); }

    if (opp.jobUrl) {
      dl.appendChild(h('dt', null, 'Job URL'));
      dl.appendChild(h('dd', { class: 'wrap-anywhere' },
        h('a', { href: opp.jobUrl, target: '_blank', rel: 'noopener noreferrer' }, opp.jobUrl)));
    }

    return h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', null, 'Application details'),
        h('button', {
          type: 'button', class: 'btn btn-sm btn-secondary',
          onclick: function () { detailEditing = true; render(); }
        }, 'Edit details')),
      dl,
      h('hr', { class: 'divider' }),
      listBlock('Educational qualifications', opp.qualifications),
      listBlock('Experience requirements', opp.experienceRequirements),
      listBlock('Required skills', opp.requiredSkills),
      listBlock('Preferred skills', opp.preferredSkills, 'No preferred skills listed.'),
      listBlock('Responsibilities', opp.responsibilities),
      listBlock('Documents required', opp.documents),
      opp.notes
        ? h('div', { class: 'lesson-block' }, h('h3', null, 'Notes'), paragraphs(opp.notes, 'soft'))
        : null
    );
  }

  function sourceSection(opp) {
    if (!opp.sourceText) { return null; }
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Original advertisement')),
      h('details', null,
        h('summary', null, 'Show the advertisement text you saved'),
        h('div', { class: 'mt-1' }, paragraphs(opp.sourceText, 'soft')))
    );
  }

  function viewOpportunity(id) {
    var opp = findOpp(id);
    if (!opp) {
      return emptyState('🔍', 'That opportunity is no longer saved',
        'It may have been deleted, or the link may be out of date.',
        h('a', { class: 'btn btn-primary', href: '#/dashboard' }, 'Back to dashboard'));
    }

    var frag = document.createDocumentFragment();
    var metaBadges = [statusBadge(opp.status)];
    if (opp.workplaceType) { metaBadges.push(badge(opp.workplaceType, 'navy')); }
    if (opp.salary) { metaBadges.push(badge(opp.salary, 'neutral')); }
    var dlBadge = deadlineBadge(opp.deadline);
    if (dlBadge) { metaBadges.push(dlBadge); }
    if (opp.appliedAt) { metaBadges.push(badge(appliedLabel(opp.appliedAt), 'teal')); }
    if (opp.followUpDate) {
      metaBadges.push(badge(followUpLabel(opp.followUpDate),
        daysUntil(opp.followUpDate) <= 0 ? 'warn' : 'info'));
    }

    frag.appendChild(h('div', { class: 'page-head' },
      h('div', null,
        h('a', { class: 'small', href: '#/dashboard' }, '← Back to dashboard'),
        h('h1', { class: 'mt-0' }, opp.role),
        h('p', { class: 'lede' }, [opp.company, opp.location].filter(Boolean).join(' · ')),
        h('div', { class: 'opp-meta mt-1' }, metaBadges)),
      h('div', { class: 'row' },
        h('a', { class: 'btn btn-primary', href: '#/coach/' + opp.id }, 'Prep Coach'))
    ));

    frag.appendChild(h('p', { class: 'next-action' }, h('strong', null, 'Next'), nextAction(opp)));

    if (detailEditing) {
      frag.appendChild(h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, 'Edit application details')),
        draftForm({
          role: opp.role, company: opp.company, location: opp.location,
          workplaceType: opp.workplaceType, salary: opp.salary, jobUrl: opp.jobUrl,
          qualifications: opp.qualifications, experienceRequirements: opp.experienceRequirements,
          requiredSkills: opp.requiredSkills, preferredSkills: opp.preferredSkills,
          responsibilities: opp.responsibilities, documents: opp.documents,
          deadline: opp.deadline, followUpDate: opp.followUpDate, notes: opp.notes,
          unfamiliarTerms: opp.unfamiliarTerms, sourceText: opp.sourceText,
          sourceImageName: opp.sourceImageName, sourceType: opp.sourceType
        }, {
          saveLabel: 'Save changes',
          onSave: function (values) {
            opp.role = values.role || opp.role;
            opp.company = values.company;
            opp.location = values.location;
            opp.workplaceType = VALID_WORKPLACE.indexOf(values.workplaceType) === -1 ? '' : values.workplaceType;
            opp.salary = values.salary;
            opp.jobUrl = safeUrl(values.jobUrl);
            opp.qualifications = values.qualifications;
            opp.experienceRequirements = values.experienceRequirements;
            opp.requiredSkills = values.requiredSkills;
            opp.preferredSkills = values.preferredSkills;
            opp.responsibilities = values.responsibilities;
            opp.documents = values.documents;
            opp.deadline = isValidISO(values.deadline) ? values.deadline : '';
            opp.followUpDate = isValidISO(values.followUpDate) ? values.followUpDate : '';
            opp.notes = values.notes;
            touch(opp);
            detailEditing = false;
            commit();
            toast('Changes saved.', 'ok');
          },
          onCancel: function () { detailEditing = false; render(); }
        })
      ));
      return frag;
    }

    var plan = planProgress(opp);
    var upcoming = (opp.schedule || []).filter(function (t) { return !t.done; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(0, 5);

    frag.appendChild(h('div', { class: 'layout-main-side section' },
      h('div', null,
        detailsSection(opp),
        sourceSection(opp),
        unfamiliarTermsBlock(opp.unfamiliarTerms)
      ),
      h('div', null,
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, 'Status')),
          statusControl(opp),
          opp.appliedAt
            ? h('p', { class: 'small soft mt-1 mb-0' },
                appliedLabel(opp.appliedAt) + ' · ' + formatStamp(opp.appliedAt))
            : h('p', { class: 'small muted mt-1 mb-0' },
                'The date you applied is recorded automatically the first time you choose “Applied”.')),
        checklistSection(opp),
        h('section', { class: 'card' },
          h('div', { class: 'card-head' },
            h('h2', null, 'Preparation'),
            h('a', { class: 'btn btn-sm btn-secondary', href: '#/coach/' + opp.id }, 'Open Coach')),
          plan.total
            ? h('div', null,
                progressBar(plan.done, plan.total, 'Preparation plan progress'),
                h('p', { class: 'small soft mt-1' },
                  plan.done + ' of ' + plan.total + ' topics completed.'))
            : h('p', { class: 'small muted' },
                'No preparation plan yet. The Coach reads the whole advertisement and builds one.'),
          upcoming.length
            ? h('div', null,
                h('h3', null, 'Next scheduled sessions'),
                upcoming.map(function (t) {
                  return taskRow(opp, t, { showDate: true, hideTools: true });
                }))
            : null),
        skillsSection(opp),
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, 'Danger zone')),
          h('p', { class: 'small soft' },
            'Removes this opportunity, its checklist, plan and schedule.'),
          h('button', {
            type: 'button', class: 'btn btn-danger',
            onclick: function () {
              confirmDialog({
                title: 'Delete this opportunity?',
                message: 'This permanently removes "' + opp.role +
                  (opp.company ? ' at ' + opp.company : '') +
                  '", including its checklist, preparation plan and schedule. This cannot be undone.',
                confirmText: 'Delete permanently', danger: true
              }).then(function (ok) {
                if (!ok) { return; }
                state.opportunities = state.opportunities.filter(function (o) { return o.id !== opp.id; });
                saveState();
                toast('Opportunity deleted.');
                go('/dashboard');
              });
            }
          }, 'Delete opportunity'))
      )
    ));

    return frag;
  }

  /* =========================================================================
     13. PREPARATION COACH
     ====================================================================== */

  /** Resolve a coach context: a real opportunity, or the general notebook. */
  function coachContext(id) {
    if (id === 'general') {
      return {
        id: 'general', opp: null, isGeneral: true,
        label: 'General preparation',
        getPlan: function () { return state.general.studyPlan; },
        setPlan: function (plan) { state.general.studyPlan = plan; }
      };
    }
    var opp = findOpp(id);
    if (!opp) { return null; }
    return {
      id: opp.id, opp: opp, isGeneral: false,
      label: opp.role + (opp.company ? ' — ' + opp.company : ''),
      getPlan: function () { return opp.studyPlan; },
      setPlan: function (plan) { opp.studyPlan = plan; touch(opp); }
    };
  }

  function findTopic(plan, topicId) {
    if (!plan) { return null; }
    for (var i = 0; i < plan.topics.length; i++) {
      if (plan.topics[i].id === topicId) { return plan.topics[i]; }
    }
    return null;
  }

  var PRIORITY_TONE = { High: 'danger', Medium: 'warn', Foundation: 'info' };

  /* ---------------------------- coach hub ------------------------------- */

  /**
   * Shown wherever the Coach generates content. Returns null when Demo mode is
   * off, so it costs nothing once a real key is connected.
   */
  function demoModeNotice() {
    if (!state.settings.demoMode) { return null; }
    return h('div', { class: 'notice warn', role: 'status' },
      h('p', null,
        h('strong', null, 'Demo mode is on. '),
        'Gemini is not being called. Plans are built from this job’s own details, but every ' +
        'lesson comes from one built-in template, so each topic produces the same text with ' +
        'only the name changed.'),
      h('p', null,
        h('a', { href: '#/settings' }, 'Open Settings'),
        ' to add your key and switch Demo mode off for real, topic-specific material.'));
  }

  /**
   * A small, honest preview of the Coach's output. The mock rows are marked
   * aria-hidden because they are an illustration of the interface; the
   * surrounding text carries the same information for screen readers.
   */
  function coachPreview() {
    var sampleTopics = [
      { n: 1, name: 'CSS layout with Flexbox and Grid', priority: 'High' },
      { n: 2, name: 'Fetching REST APIs with error states', priority: 'High' },
      { n: 3, name: 'Interview questions for this role', priority: 'Medium' }
    ];
    var lessonParts = ['Overview', 'Key points', 'Worked example', 'Interview tips', '3-question quiz'];

    return h('article', { class: 'coach-preview' },
      h('p', { class: 'eyebrow' }, 'What the Coach builds'),
      h('h2', { class: 'coach-preview-title' }, 'An ordered plan, from one advertisement'),
      h('div', { class: 'coach-mock', 'aria-hidden': 'true' },
        sampleTopics.map(function (t) {
          return h('div', { class: 'coach-mock-row' },
            h('span', { class: 'coach-mock-num' }, String(t.n)),
            h('span', { class: 'coach-mock-name' }, t.name),
            h('span', {
              class: 'coach-mock-badge' + (t.priority === 'High' ? ' is-high' : '')
            }, t.priority));
        })),
      h('p', { class: 'coach-preview-caption' }, 'Each topic opens into a lesson:'),
      h('ul', { class: 'coach-parts' }, lessonParts.map(function (part) {
        return h('li', null, icon('target'), part);
      })),
      h('p', { class: 'coach-preview-foot' }, 'Plus a day-by-day schedule.')
    );
  }

  function viewCoachHub() {
    var frag = document.createDocumentFragment();
    var hasOpportunities = state.opportunities.length > 0;

    frag.appendChild(h('div', { class: 'page-head' },
      h('div', null,
        h('p', { class: 'eyebrow' }, 'Prep Coach'),
        h('h1', null, 'Learn exactly what each job asks for'),
        h('p', { class: 'lede' },
          'Turn a job advertisement into an ordered learning path with lessons and quizzes.'))
    ));

    /* append() skips null, which demoModeNotice() returns when Demo mode is off. */
    append(frag, demoModeNotice());

    if (hasOpportunities) {
      frag.appendChild(h('section', { class: 'section' },
        iconHeading('h2', 'compass', 'Your opportunities'),
        h('div', { class: 'opp-list' }, state.opportunities.map(function (opp) {
          var plan = planProgress(opp);
          var open = function () { go('/coach/' + opp.id); };
          return h('article', {
            class: 'opp-card', tabindex: '0', role: 'link',
            'aria-label': 'Open the preparation plan for ' + opp.role,
            onclick: open,
            onkeydown: function (e) {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
            }
          },
            h('h3', { class: 'opp-role' }, opp.role),
            h('p', { class: 'opp-company' }, opp.company || 'No company recorded'),
            h('div', { class: 'opp-meta' },
              opp.studyPlan
                ? badge(plan.done + ' of ' + plan.total + ' topics done', 'teal')
                : badge('No plan yet', 'neutral'),
              deadlineBadge(opp.deadline)),
            progressBar(plan.done, plan.total, 'Preparation progress'));
        }))
      ));
    } else {
      /* Compact, branded empty state sitting beside a preview of the output,
         so the page explains itself without a tall placeholder card.
         The prominent "+ Add Opportunity" lives in the navigation bar, so this
         one is deliberately quiet. */
      frag.appendChild(h('section', { class: 'section coach-empty-grid' },
        h('article', { class: 'coach-empty' },
          h('div', { class: 'coach-empty-head' },
            h('span', { class: 'start-panel-icon' }, icon('briefcase')),
            h('div', null,
              h('p', { class: 'eyebrow' }, 'No job plans yet'),
              h('h2', { class: 'coach-empty-title' }, 'Coach a real vacancy'))),
          h('p', { class: 'coach-empty-text' },
            'Save a job advertisement and the Coach works from its requirements.'),
          h('a', { class: 'btn btn-sm btn-secondary', href: '#/add' },
            'Add an opportunity', h('span', { 'aria-hidden': 'true' }, '→')),
          h('p', { class: 'coach-empty-foot' },
            'Or learn any topic you like below — no job needed.')),
        coachPreview()
      ));
    }

    /* Custom learning. On this page it is the main action, so it gets the
       prominent panel treatment rather than a small field at the bottom. */
    /* Custom topic and dictionary, paired on one row. */
    frag.appendChild(learningToolsRow(coachContext('general'), { prominent: true }));

    /* Saved general topics, listed only once some exist. */
    var generalPlan = state.general.studyPlan;
    if (generalPlan) {
      var generalDone = generalPlan.topics.filter(function (t) { return t.completed; }).length;
      frag.appendChild(h('section', { class: 'section card' },
        h('div', { class: 'card-head' },
          iconHeading('h2', 'bulb', 'Your own topics'),
          h('span', { class: 'small soft' },
            generalDone + ' of ' + generalPlan.topics.length + ' topics done')),
        generalPlan.topics.map(function (topic, i) {
          return topicRow(coachContext('general'), topic, i);
        }),
        clearPlanButton(coachContext('general'))
      ));
    }

    return frag;
  }

  /* ------------------------- custom learning input ----------------------- */

  var CUSTOM_TOPIC_EXAMPLES = [
    'JavaScript promises', 'Git branches', 'CSS Grid', 'REST APIs',
    'Interview communication', 'Explaining my final-year project'
  ];

  /**
   * @param {Object} ctx      coach context
   * @param {Object} [options] {prominent:true} renders the larger panel variant
   *                           used on the Coach hub, where this is the main action.
   */
  function customTopicForm(ctx, options) {
    options = options || {};
    var status = statusLine('custom-topic-status-' + ctx.id);
    var input = textInput('custom-topic-' + ctx.id, '', {
      placeholder: options.prominent
        ? 'Type any topic — for example, JavaScript promises'
        : 'e.g. JavaScript promises, Git branches, CSS Grid, how to explain my final-year project',
      'aria-describedby': 'custom-topic-help-' + ctx.id
    });
    if (options.prominent) { input.className = 'coach-ask-input'; }

    var button = h('button', {
      type: 'button',
      class: 'btn btn-primary' + (options.prominent ? ' btn-lg' : '')
    }, options.prominent ? 'Write my lesson' : 'Create lesson');

    function submit() {
      var topicName = asText(input.value);
      if (!topicName) {
        setStatus(status, 'Type a topic first — anything you want to understand.', 'error');
        input.focus();
        return;
      }
      setBusy(button, true, 'Writing lesson…');
      setStatus(status, state.settings.demoMode
        ? 'Writing a sample lesson using Demo mode…'
        : 'Asking Gemini to write a lesson on “' + topicName + '”…', 'busy');

      Gemini.generateLesson(topicName, ctx.opp, state.profile, state.settings)
        .then(function (data) {
          var lesson = normaliseLesson(data);
          if (!lesson) { throw new Gemini.GeminiError('Gemini returned a lesson HirePath could not read. Try again.', 'invalid-json'); }
          lesson.generatedAt = new Date().toISOString();
          lesson.source = state.settings.demoMode ? 'demo' : 'gemini';

          var plan = ctx.getPlan();
          if (!plan) {
            plan = { goal: ctx.isGeneral ? 'Topics you chose to learn.' : 'Extra topics for this role.',
                     topics: [], createdAt: new Date().toISOString() };
            ctx.setPlan(plan);
          }
          var topic = normaliseTopic({
            name: topicName, reason: 'You asked to learn this topic.',
            priority: 'Medium', estimatedMinutes: 30, custom: true
          });
          topic.lesson = lesson;
          plan.topics.push(topic);
          saveState();
          go('/coach/' + ctx.id + '/topic/' + topic.id);
        }, function (err) {
          setBusy(button, false);
          setStatus(status, geminiErrorMessage(err), 'error');
        });
    }

    button.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });

    /* Example chips double as an explanation of what can be asked for. */
    var examples = h('div', { class: 'coach-examples' },
      h('span', { class: 'coach-examples-label' }, 'Try:'),
      CUSTOM_TOPIC_EXAMPLES.slice(0, options.prominent ? 5 : 3).map(function (sample) {
        return h('button', {
          type: 'button', class: 'coach-example',
          onclick: function () {
            input.value = sample;
            input.focus();
            setStatus(status, '');
          }
        }, sample);
      }));

    var help = h('p', {
      class: 'field-help', id: 'custom-topic-help-' + ctx.id
    }, 'It does not have to appear in a job advertisement.');

    if (!options.prominent) {
      return h('div', null,
        h('div', { class: 'field' },
          h('label', { for: 'custom-topic-' + ctx.id }, 'What else do you want to learn?'),
          h('div', { class: 'inline-add mt-0' }, input, button),
          help),
        examples,
        status);
    }

    return h('section', { class: 'coach-ask' },
      h('div', { class: 'coach-ask-head' },
        h('span', { class: 'start-panel-icon' }, icon('sparkle')),
        h('div', null,
          h('p', { class: 'eyebrow' }, 'Custom topic'),
          h('h2', { class: 'coach-ask-title', id: 'coach-ask-title' },
            h('label', { for: 'custom-topic-' + ctx.id }, 'What do you want to learn?')))),
      h('p', { class: 'coach-ask-lede' },
        'Any subject. You get a lesson, a worked example and a three-question quiz.'),
      h('div', { class: 'coach-ask-row' }, input, button),
      help,
      examples,
      status);
  }

  /* ----------------------------- topic row ------------------------------ */

  function topicRow(ctx, topic, index) {
    var quizNode = null;
    if (topic.quizState && topic.quizState.submitted) {
      quizNode = badge('Quiz ' + topic.quizState.score + '/' + topic.quizState.total,
        topic.quizState.score === topic.quizState.total ? 'ok' : 'warn');
    }

    var toggle = h('button', {
      type: 'button', class: 'btn btn-sm btn-ghost',
      onclick: function () {
        topic.completed = !topic.completed;
        topic.completedAt = topic.completed ? new Date().toISOString() : null;
        if (ctx.opp) { touch(ctx.opp); }
        commit();
      }
    }, topic.completed ? 'Mark as not done' : 'Mark as done');

    return h('div', { class: 'topic-row' + (topic.completed ? ' done' : '') },
      h('span', { class: 'topic-num', 'aria-hidden': 'true' }, String(index + 1)),
      h('div', { class: 'topic-body' },
        h('h4', null, topic.name),
        topic.reason ? h('p', { class: 'topic-reason' }, topic.reason) : null,
        h('div', { class: 'topic-actions' },
          badge(topic.priority + ' priority', PRIORITY_TONE[topic.priority] || 'neutral', { dot: true }),
          badge('About ' + topic.estimatedMinutes + ' min', 'neutral'),
          topic.custom ? badge('Your own topic', 'teal') : null,
          topic.completed ? badge('Completed ' + (topic.completedAt ? formatDateShort(topic.completedAt.slice(0, 10)) : ''), 'ok') : null,
          quizNode,
          h('a', {
            class: 'btn btn-sm ' + (topic.lesson ? 'btn-secondary' : 'btn-primary'),
            href: '#/coach/' + ctx.id + '/topic/' + topic.id
          }, topic.lesson ? 'Open lesson' : 'Learn Topic'),
          toggle,
          topic.custom ? h('button', {
            type: 'button', class: 'btn btn-sm btn-ghost',
            onclick: function () {
              confirmDialog({
                title: 'Remove this topic?',
                message: 'The lesson, quiz result and any questions you asked about “' + topic.name +
                  '” will be removed.',
                confirmText: 'Remove', danger: true
              }).then(function (ok) {
                if (!ok) { return; }
                var plan = ctx.getPlan();
                plan.topics = plan.topics.filter(function (t) { return t.id !== topic.id; });
                if (!plan.topics.length) { ctx.setPlan(null); }
                commit();
              });
            }
          }, 'Remove') : null
        ))
    );
  }

  /* --------------------------- plan for one job -------------------------- */

  function viewCoachPlan(ctx) {
    var frag = document.createDocumentFragment();
    var plan = ctx.getPlan();
    var opp = ctx.opp;

    frag.appendChild(h('div', { class: 'page-head' },
      h('div', null,
        h('a', { class: 'small', href: opp ? '#/opportunity/' + opp.id : '#/coach' },
          opp ? '← Back to the opportunity' : '← Back to the Coach'),
        h('p', { class: 'eyebrow mt-0' }, 'Prep Coach'),
        h('h1', { class: 'mt-0' }, ctx.label),
        opp && opp.deadline
          ? h('p', { class: 'lede' },
              'Application closes ' + formatDateLong(opp.deadline) + ' · ' + deadlineLabel(opp.deadline))
          : null)
    ));

    /* Demo mode silently replaces every Gemini call with a fixed sample, which
       is confusing here: each lesson comes out with the same text. Say so. */
    /* append() skips null, which demoModeNotice() returns when Demo mode is off. */
    append(frag, demoModeNotice());

    /* ---- build plan: two independent routes ---- */
    var planStatus = statusLine('plan-status');
    var buildBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg' },
      plan ? 'Rebuild with Gemini' : 'Build with Gemini');

    /* The no-AI route. Uses only what the advertisement already says. */
    var ownBtn = null;
    if (opp) {
      ownBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-lg' },
        plan ? 'Rebuild from this job' : 'Build from this job');
      ownBtn.addEventListener('click', function () {
        var topics = localPlanFromJob(opp);
        if (!topics.length) {
          setStatus(planStatus,
            'This opportunity has no skills, qualifications or documents recorded yet, so there is ' +
            'nothing to build from. Edit the opportunity to add them, or add topics by hand below.',
            'error');
          return;
        }
        function apply() {
          var previous = ctx.getPlan();
          var incoming = {
            goal: 'Prepare for ' + (opp.role || 'this role') +
                  ' using the requirements listed in the advertisement.',
            topics: topics,
            createdAt: new Date().toISOString(),
            source: 'own'
          };
          if (previous) {
            previous.topics.filter(function (t) { return t.custom; })
              .forEach(function (t) { incoming.topics.push(t); });
            incoming.topics.forEach(function (t) {
              var old = previous.topics.filter(function (o) { return o.name === t.name; })[0];
              if (old) {
                t.id = old.id; t.completed = old.completed; t.completedAt = old.completedAt;
                t.lesson = old.lesson; t.quizState = old.quizState; t.qa = old.qa;
              }
            });
          }
          ctx.setPlan(normaliseStudyPlan(incoming));
          saveState();
          render();
          toast('Plan built from this job — ' + topics.length + ' topics, Gemini was not used.', 'ok');
        }
        if (plan) {
          confirmDialog({
            title: 'Rebuild the plan?',
            message: 'The topic list is replaced with one built from this advertisement. ' +
                     'Completed topics and your own added topics are kept.',
            confirmText: 'Rebuild plan'
          }).then(function (ok) { if (ok) { apply(); } });
        } else {
          apply();
        }
      });
    }

    buildBtn.addEventListener('click', function () {
      function build() {
        setBusy(buildBtn, true, 'Building plan…');
        setStatus(planStatus, state.settings.demoMode
          ? 'Building a sample preparation plan using Demo mode…'
          : 'Gemini is reading the whole advertisement and designing your learning path…', 'busy');

        Gemini.buildStudyPlan(opp || { role: 'general preparation' }, state.profile, state.settings)
          .then(function (data) {
            var incoming = normaliseStudyPlan({
              goal: data && data.goal,
              topics: (data && data.topics) || [],
              createdAt: new Date().toISOString(),
              source: state.settings.demoMode ? 'demo' : 'gemini'
            });
            if (!incoming) {
              throw new Gemini.GeminiError(
                'Gemini did not return any usable topics. Try again, or use Demo mode.', 'empty');
            }
            /* Keep the learner's own custom topics and any completed work. */
            var previous = ctx.getPlan();
            if (previous) {
              previous.topics.filter(function (t) { return t.custom; })
                .forEach(function (t) { incoming.topics.push(t); });
              incoming.topics.forEach(function (t) {
                var old = previous.topics.filter(function (o) { return o.name === t.name; })[0];
                if (old) {
                  t.id = old.id;
                  t.completed = old.completed;
                  t.completedAt = old.completedAt;
                  t.lesson = old.lesson;
                  t.quizState = old.quizState;
                  t.qa = old.qa;
                }
              });
            }
            ctx.setPlan(incoming);
            saveState();
            render();
            toast('Preparation plan ready — ' + incoming.topics.length + ' topics.', 'ok');
          }, function (err) {
            setBusy(buildBtn, false);
            setStatus(planStatus, geminiErrorMessage(err), 'error');
          });
      }

      if (plan) {
        confirmDialog({
          title: 'Rebuild the plan?',
          message: 'A new plan replaces the current topic list. Topics you have already completed ' +
                   'and your own added topics are kept.',
          confirmText: 'Rebuild plan'
        }).then(function (ok) { if (ok) { build(); } });
      } else {
        build();
      }
    });

    if (!plan) {
      frag.appendChild(h('section', { class: 'card' },
        emptyState('🧠', 'No preparation plan yet',
          opp
            ? 'The Coach reads the complete advertisement — every skill, tool, responsibility and ' +
              'document — and turns it into an ordered path of 5 to 10 topics with lessons and quizzes.'
            : 'Add topics you want to learn, or build a general plan.',
          h('div', { class: 'form-actions', style: 'justify-content:center' }, buildBtn, ownBtn)),
        opp
          ? h('p', { class: 'small soft' },
              'Gemini reads the whole advertisement. “Build from this job” uses the skills and ' +
              'documents already recorded — instant and offline.')
          : null,
        planStatus,
        /* The schedule is built FROM the plan, so without one there is no
           "Create My Schedule" button at all. Say that, instead of leaving a
           feature mysteriously missing. */
        opp
          ? h('p', { class: 'small soft mt-1 mb-0' },
              'Your schedule is built from these topics, so this step comes first.')
          : null));
      if (ctx.isGeneral || opp) {
        frag.appendChild(learningToolsRow(ctx));
      }
      return frag;
    }

    var done = plan.topics.filter(function (t) { return t.completed; }).length;

    frag.appendChild(h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', null, 'Your learning path'),
        h('div', { class: 'row' },
          plan.source === 'gemini' ? badge('Built by Gemini', 'teal', { dot: true }) : null,
          plan.source === 'own' ? badge('Built from this job', 'navy', { dot: true }) : null,
          plan.source === 'demo' ? badge('Demo sample', 'warn', { dot: true }) : null,
          h('span', { class: 'small soft' },
            done + ' of ' + plan.topics.length + ' topics completed'))),
      plan.goal ? h('p', { class: 'soft' }, plan.goal) : null,
      progressBar(done, plan.topics.length, 'Overall preparation progress'),
      h('div', { class: 'mt-1' }, plan.topics.map(function (topic, i) {
        return topicRow(ctx, topic, i);
      })),
      h('div', { class: 'form-actions' }, buildBtn, ownBtn),
      clearPlanButton(ctx),
      planStatus
    ));

    if (opp) { frag.appendChild(scheduleSection(ctx, plan)); }
    frag.appendChild(learningToolsRow(ctx));
    return frag;
  }

  /* =========================================================================
     14. SCHEDULE GENERATOR
        Gemini may suggest the order and the wording of each activity.
        JavaScript assigns and validates every real calendar date.
     ====================================================================== */

  /**
   * Builds a preparation plan from the job's OWN details, with no AI at all:
   * required skills become High priority, preferred skills Medium, and named
   * documents a portfolio task. Nothing generic is invented — if the job lists
   * nothing, this returns nothing and the user adds topics by hand.
   */
  function localPlanFromJob(opp) {
    var topics = [];
    var seen = {};
    function add(name, reason, priority, minutes) {
      var key = normaliseSkill(name);
      if (!key || seen[key]) { return; }
      seen[key] = true;
      topics.push(normaliseTopic({
        name: name, reason: reason, priority: priority, estimatedMinutes: minutes
      }));
    }
    (opp.requiredSkills || []).forEach(function (skill) {
      add(skill, 'Listed as a required skill in this advertisement.', 'High', 45);
    });
    (opp.preferredSkills || []).forEach(function (skill) {
      add(skill, 'Listed as a preferred skill in this advertisement.', 'Medium', 30);
    });
    (opp.qualifications || []).slice(0, 3).forEach(function (q) {
      add(q, 'Listed under the qualifications for this role.', 'Foundation', 30);
    });
    if ((opp.documents || []).length) {
      add('Prepare the documents this job asks for',
          'The advertisement asks for: ' + opp.documents.slice(0, 5).join(', ') + '.',
          'High', 60);
    }
    if (opp.role) {
      add('Interview questions for ' + opp.role,
          'Prepare spoken answers for the exact requirements in this advertisement.',
          'High', 45);
    }
    return topics;
  }

  /**
   * Priority-first ordering done entirely in JavaScript. Used when Gemini is
   * unavailable, so a rate limit can never stop you from building a schedule.
   */
  function localSessions(pending, dailyMinutes) {
    var rank = { High: 0, Medium: 1, Foundation: 2 };
    return pending.slice().sort(function (a, b) {
      var ra = rank[a.priority] === undefined ? 1 : rank[a.priority];
      var rb = rank[b.priority] === undefined ? 1 : rank[b.priority];
      return ra - rb;
    }).map(function (t) {
      return {
        topicId: t.id,
        topicName: t.name,
        activity: 'Study this topic and write down the three ideas you want to remember.',
        estimatedMinutes: Math.min(dailyMinutes, t.estimatedMinutes || 45)
      };
    });
  }

  function buildScheduleFromSessions(opp, sessions, dailyMinutes) {
    var today = todayISO();
    var lastAllowed = (opp.deadline && opp.deadline >= today) ? opp.deadline : null;

    /* How many days are actually available? */
    var availableDays = lastAllowed ? (daysUntil(lastAllowed) + 1) : Math.max(sessions.length, 1);
    if (availableDays < 1) { availableDays = 1; }

    var totalMinutes = sessions.reduce(function (sum, s) {
      return sum + clampInt(s.estimatedMinutes, 5, 480, 30);
    }, 0);

    /* If the work cannot fit in the learner's daily time before the deadline,
       raise the per-day budget rather than silently dropping topics. */
    var neededPerDay = Math.ceil(totalMinutes / availableDays);
    var effectiveDaily = Math.max(dailyMinutes, neededPerDay);

    var tasks = [];
    var date = today;
    var usedToday = 0;

    sessions.forEach(function (s) {
      var minutes = clampInt(s.estimatedMinutes, 5, 480, 30);
      if (usedToday > 0 && usedToday + minutes > effectiveDaily) {
        var nextDate = addDaysISO(date, 1);
        /* Never schedule past the deadline: keep stacking on the last day instead. */
        if (!lastAllowed || nextDate <= lastAllowed) {
          date = nextDate;
          usedToday = 0;
        }
      }
      tasks.push(normaliseTask({
        date: date,
        topicId: s.topicId || null,
        topicName: s.topicName,
        activity: s.activity,
        minutes: minutes,
        done: false
      }));
      usedToday += minutes;
    });

    return {
      tasks: tasks.filter(Boolean),
      effectiveDaily: effectiveDaily,
      stretched: effectiveDaily > dailyMinutes,
      availableDays: availableDays
    };
  }

  /** Writes a freshly built session list onto an opportunity. */
  function applySchedule(opp, sessions, dailyMinutes) {
    var result = buildScheduleFromSessions(opp, sessions, dailyMinutes);
    var keptDone = (opp.schedule || []).filter(function (t) { return t.done; });
    opp.schedule = keptDone.concat(result.tasks);
    touch(opp);
    saveState();
    return result;
  }

  /**
   * Builds a schedule for one opportunity, either by asking Gemini to order the
   * sessions or by ordering them here. Dates are always assigned by HirePath.
   * Shared by the Prep Coach and Today's Plan.
   */
  function buildScheduleFor(opp, useGemini, statusNode, button, onDone) {
    var plan = opp.studyPlan;
    var pending = (plan && plan.topics || []).filter(function (t) { return !t.completed; });
    if (!pending.length) {
      setStatus(statusNode, 'That job has no unfinished topics, so there is nothing to schedule.', 'error');
      return;
    }
    var dailyMinutes = state.profile.dailyMinutes || 60;

    function finish(result, note) {
      render();
      toast(note, 'ok');
      if (result.stretched) {
        toast('To finish before the deadline you would need about ' + result.effectiveDaily +
              ' minutes a day instead of ' + dailyMinutes + '.', 'error');
      }
      if (typeof onDone === 'function') { onDone(); }
    }

    if (!useGemini) {
      var local = applySchedule(opp, localSessions(pending, dailyMinutes), dailyMinutes);
      finish(local, 'Schedule created — ' + local.tasks.length + ' sessions, highest priority first.');
      return;
    }

    setBusy(button, true, 'Creating…');
    setStatus(statusNode, state.settings.demoMode
      ? 'Ordering your sessions using Demo mode…'
      : 'Asking Gemini to order your study sessions…', 'busy');

    var today = todayISO();
    var maxSessions = opp.deadline && opp.deadline >= today
      ? Math.max(pending.length, daysUntil(opp.deadline) + 1)
      : pending.length * 2;

    Gemini.planSessions(opp, pending, {
      dailyMinutes: dailyMinutes, maxSessions: Math.min(maxSessions, 60)
    }, state.settings).then(function (data) {
      var raw = (data && Array.isArray(data.sessions)) ? data.sessions : [];
      var byName = {};
      pending.forEach(function (t) { byName[t.name.toLowerCase()] = t; });
      var sessions = raw.map(function (sx) {
        var topic = byName[asText(sx && sx.topicName).toLowerCase()];
        if (!topic) { return null; }
        return {
          topicId: topic.id, topicName: topic.name,
          activity: asText(sx.activity) || 'Study this topic and write down what you learned.',
          estimatedMinutes: clampInt(sx.estimatedMinutes, 5, 480, topic.estimatedMinutes)
        };
      }).filter(Boolean);

      var covered = {};
      sessions.forEach(function (sx) { covered[sx.topicId] = true; });
      pending.forEach(function (t) {
        if (!covered[t.id]) {
          sessions.push({
            topicId: t.id, topicName: t.name,
            activity: 'Study this topic and write down what you learned.',
            estimatedMinutes: t.estimatedMinutes
          });
        }
      });
      if (!sessions.length) { sessions = localSessions(pending, dailyMinutes); }

      var res = applySchedule(opp, sessions, dailyMinutes);
      finish(res, 'Schedule created — ' + res.tasks.length + ' sessions.');
    }, function (err) {
      /* Gemini only suggested the order, so a failure never blocks the schedule. */
      var res2 = applySchedule(opp, localSessions(pending, dailyMinutes), dailyMinutes);
      finish(res2, 'Schedule created without Gemini — ' + res2.tasks.length + ' sessions.');
      toast('Gemini was unavailable, so HirePath ordered the topics itself. Reason: ' +
            geminiErrorMessage(err), 'error');
    });
  }

  function scheduleSection(ctx, plan) {
    var opp = ctx.opp;
    var status = statusLine('schedule-status');
    var makeBtn = h('button', { type: 'button', class: 'btn btn-primary' },
      (opp.schedule && opp.schedule.length) ? 'Regenerate with Gemini' : 'Create with Gemini');

    /* Identical result minus the wording suggestions, with no network call. */
    var ownScheduleBtn = h('button', { type: 'button', class: 'btn btn-secondary' },
      (opp.schedule && opp.schedule.length) ? 'Rebuild it myself' : 'Create it myself');
    ownScheduleBtn.addEventListener('click', function () {
      function buildLocally() {
        var pending = plan.topics.filter(function (t) { return !t.completed; });
        if (!pending.length) {
          setStatus(status, 'Every topic is already marked as done, so there is nothing to schedule.', 'error');
          return;
        }
        var dailyMinutes = state.profile.dailyMinutes || 60;
        var result = buildScheduleFromSessions(opp, localSessions(pending, dailyMinutes), dailyMinutes);
        var keptDone = (opp.schedule || []).filter(function (t) { return t.done; });
        opp.schedule = keptDone.concat(result.tasks);
        touch(opp);
        saveState();
        render();
        toast('Schedule created without Gemini — ' + result.tasks.length + ' sessions, ' +
              'highest priority first.', 'ok');
        if (result.stretched) {
          toast('To finish before the deadline you would need about ' + result.effectiveDaily +
                ' minutes a day instead of ' + dailyMinutes + '.', 'error');
        }
      }
      if (opp.schedule && opp.schedule.length) {
        confirmDialog({
          title: 'Rebuild the schedule?',
          message: 'Unfinished sessions are replaced. Sessions you already completed are kept.',
          confirmText: 'Rebuild'
        }).then(function (ok) { if (ok) { buildLocally(); } });
      } else {
        buildLocally();
      }
    });

    makeBtn.addEventListener('click', function () {
      function create() {
        var pending = plan.topics.filter(function (t) { return !t.completed; });
        if (!pending.length) {
          setStatus(status, 'Every topic is already marked as done, so there is nothing to schedule.', 'error');
          return;
        }
        setBusy(makeBtn, true, 'Creating…');
        setStatus(status, state.settings.demoMode
          ? 'Ordering your sessions using Demo mode…'
          : 'Asking Gemini to order your study sessions…', 'busy');

        var dailyMinutes = state.profile.dailyMinutes || 60;
        var today = todayISO();
        var maxSessions = opp.deadline && opp.deadline >= today
          ? Math.max(pending.length, daysUntil(opp.deadline) + 1)
          : pending.length * 2;

        Gemini.planSessions(opp, pending, {
          dailyMinutes: dailyMinutes, maxSessions: Math.min(maxSessions, 60)
        }, state.settings).then(function (data) {
          var raw = (data && Array.isArray(data.sessions)) ? data.sessions : [];

          /* Only topic names that actually exist in the plan are accepted. */
          var byName = {};
          pending.forEach(function (t) { byName[t.name.toLowerCase()] = t; });

          var sessions = raw.map(function (s) {
            var name = asText(s && s.topicName);
            var topic = byName[name.toLowerCase()];
            if (!topic) { return null; }
            return {
              topicId: topic.id,
              topicName: topic.name,
              activity: asText(s.activity) || 'Study this topic and write down what you learned.',
              estimatedMinutes: clampInt(s.estimatedMinutes, 5, 480, topic.estimatedMinutes)
            };
          }).filter(Boolean);

          /* Anything Gemini skipped is added back so no topic is silently lost. */
          var covered = {};
          sessions.forEach(function (s) { covered[s.topicId] = true; });
          pending.forEach(function (t) {
            if (!covered[t.id]) {
              sessions.push({
                topicId: t.id, topicName: t.name,
                activity: 'Study this topic and write down what you learned.',
                estimatedMinutes: t.estimatedMinutes
              });
            }
          });

          if (!sessions.length) {
            throw new Gemini.GeminiError('No usable sessions came back. Try again, or use Demo mode.', 'empty');
          }

          var result = buildScheduleFromSessions(opp, sessions, dailyMinutes);
          /* Completed tasks from a previous schedule are kept as a record. */
          var keptDone = (opp.schedule || []).filter(function (t) { return t.done; });
          opp.schedule = keptDone.concat(result.tasks);
          touch(opp);
          saveState();
          render();

          var message = 'Schedule created: ' + result.tasks.length + ' sessions';
          if (opp.deadline) { message += ' finishing on or before ' + formatDateShort(opp.deadline); }
          toast(message + '.', 'ok');
          if (result.stretched) {
            toast('To finish before the deadline you would need about ' + result.effectiveDaily +
                  ' minutes a day instead of ' + dailyMinutes + '.', 'error');
          }
        }, function (err) {
          /* Gemini only suggests the ORDER and the wording here — JavaScript
             assigns and validates every date either way. So a failed call must
             not block the schedule: order the topics locally instead. */
          var fallback = localSessions(pending, dailyMinutes);
          var result = buildScheduleFromSessions(opp, fallback, dailyMinutes);
          var keptDone = (opp.schedule || []).filter(function (t) { return t.done; });
          opp.schedule = keptDone.concat(result.tasks);
          touch(opp);
          saveState();
          render();

          toast('Schedule created without Gemini — ' + result.tasks.length + ' sessions.', 'ok');
          toast('Gemini was unavailable, so HirePath ordered the topics itself by priority. ' +
                'The dates are unaffected. Reason: ' + geminiErrorMessage(err), 'error');
        });
      }

      if (opp.schedule && opp.schedule.length) {
        confirmDialog({
          title: 'Regenerate the schedule?',
          message: 'Unfinished sessions are replaced with a new schedule. Sessions you already ' +
                   'completed are kept.',
          confirmText: 'Regenerate'
        }).then(function (ok) { if (ok) { create(); } });
      } else {
        create();
      }
    });

    /* manual task adder */
    var manualName = textInput('manual-task-name-' + opp.id, '', {
      placeholder: 'Task name', 'aria-label': 'New task name'
    });
    var manualDate = textInput('manual-task-date-' + opp.id, todayISO(), {
      type: 'date', 'aria-label': 'New task date'
    });
    var manualMinutes = textInput('manual-task-min-' + opp.id, '30', {
      type: 'number', min: '5', max: '480', 'aria-label': 'New task minutes'
    });

    function addManualTask() {
      var name = asText(manualName.value);
      if (!name) { manualName.focus(); return; }
      if (!isValidISO(manualDate.value)) {
        toast('Choose a valid date for the task.', 'error');
        return;
      }
      if (opp.deadline && manualDate.value > opp.deadline) {
        toast('That date is after the application deadline (' + formatDateShort(opp.deadline) + ').', 'error');
        return;
      }
      var task = normaliseTask({
        date: manualDate.value, topicName: name,
        activity: 'Added by you.', minutes: clampInt(manualMinutes.value, 5, 480, 30),
        manual: true
      });
      opp.schedule.push(task);
      touch(opp);
      commit();
      toast('Task added.');
    }

    var groups = groupTasksByDate(opp.schedule || []);

    return h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', null, 'Preparation schedule'),
        h('a', { class: 'btn btn-sm btn-secondary', href: '#/today' }, 'Today’s Plan')),
      h('p', { class: 'small soft' },
        (state.profile.dailyMinutes || 60) + ' minutes a day' +
        (opp.deadline ? ', finishing by ' + formatDateShort(opp.deadline) : '') + '.'),
      h('div', { class: 'form-actions' }, makeBtn, ownScheduleBtn),
      h('p', { class: 'small soft' },
        'HirePath sets the dates either way — Gemini only suggests the order.'),
      status,
      groups.length
        ? h('div', { class: 'mt-1' }, groups.map(function (group) {
            return h('div', { class: 'day-group' },
              h('div', { class: 'day-head' },
                h('h3', null, formatDateLong(group.date)),
                dayBadge(group.date),
                badge(group.tasks.reduce(function (s, t) { return s + t.minutes; }, 0) + ' min total', 'neutral')),
              group.tasks.map(function (t) { return taskRow(opp, t, {}); }));
          }))
        : h('p', { class: 'muted small' },
            'No sessions scheduled yet. Choose “Create My Schedule” and HirePath will spread your ' +
            'topics across the days you have left.'),
      h('hr', { class: 'divider' }),
      h('h3', null, 'Add a task yourself'),
      h('div', { class: 'inline-add' },
        manualName, manualDate, manualMinutes,
        h('button', { type: 'button', class: 'btn btn-secondary', onclick: addManualTask }, 'Add task'))
    );
  }

  function groupTasksByDate(tasks) {
    var map = {};
    tasks.forEach(function (t) {
      if (!map[t.date]) { map[t.date] = []; }
      map[t.date].push(t);
    });
    return Object.keys(map).sort().map(function (date) {
      return { date: date, tasks: map[date] };
    });
  }

  function dayBadge(iso) {
    var d = daysUntil(iso);
    if (d === null) { return null; }
    if (d === 0) { return badge('Today', 'teal', { dot: true }); }
    if (d === 1) { return badge('Tomorrow', 'info'); }
    if (d < 0) { return badge(Math.abs(d) + ' ' + pluralise(Math.abs(d), 'day') + ' ago', 'u-expired'); }
    return badge('In ' + d + ' days', 'neutral');
  }

  /* =========================================================================
     15. LESSON, QUIZ AND "ASK THE COACH"
     ====================================================================== */

  function quizBlock(ctx, topic) {
    var lesson = topic.lesson;
    if (!lesson || !lesson.quiz.length) {
      return h('p', { class: 'muted small' }, 'This lesson did not come with a quiz.');
    }

    var st = topic.quizState || { answers: [], submitted: false, score: 0, total: lesson.quiz.length };
    var selections = lesson.quiz.map(function (_, i) {
      var a = st.answers[i];
      return (typeof a === 'number' && a >= 0) ? a : null;
    });
    var status = statusLine('quiz-status-' + topic.id);
    var wrap = h('div', null);

    lesson.quiz.forEach(function (q, qi) {
      var name = 'quiz-' + topic.id + '-' + qi;
      var options = h('div', { class: 'quiz-options', role: 'radiogroup', 'aria-labelledby': name + '-label' });

      q.options.forEach(function (optionText, oi) {
        var input = h('input', { type: 'radio', name: name, id: name + '-' + oi, value: String(oi) });
        input.checked = selections[qi] === oi;
        input.disabled = st.submitted;
        input.addEventListener('change', function () {
          selections[qi] = oi;
          setStatus(status, '');
        });

        var cls = 'quiz-option';
        if (st.submitted) {
          if (oi === q.answerIndex) { cls += ' correct'; }
          else if (selections[qi] === oi) { cls += ' wrong'; }
        }
        options.appendChild(h('label', { class: cls, for: name + '-' + oi },
          input,
          h('span', null, optionText),
          st.submitted && oi === q.answerIndex ? badge('Correct answer', 'ok') : null,
          st.submitted && selections[qi] === oi && oi !== q.answerIndex
            ? badge('Your answer', 'danger') : null));
      });

      var feedback = null;
      if (st.submitted) {
        var right = selections[qi] === q.answerIndex;
        feedback = h('div', null,
          h('p', { class: 'quiz-verdict' }, right ? '✓ Correct' : '✗ Not quite'),
          q.explanation ? h('p', { class: 'quiz-explain' }, q.explanation) : null);
      }

      wrap.appendChild(h('div', { class: 'quiz-q' },
        h('p', { class: 'q-text', id: name + '-label' }, 'Question ' + (qi + 1) + '. ' + q.question),
        options,
        feedback));
    });

    var actions;
    if (st.submitted) {
      actions = h('div', { class: 'form-actions' },
        h('p', { class: 'mb-0' },
          h('strong', null, 'Score: ' + st.score + ' out of ' + st.total),
          st.completedAt ? h('span', { class: 'small soft' }, ' · completed ' + formatStamp(st.completedAt)) : null),
        h('button', {
          type: 'button', class: 'btn btn-secondary',
          onclick: function () {
            topic.quizState = null;
            if (ctx.opp) { touch(ctx.opp); }
            commit();
          }
        }, 'Try the quiz again'));
    } else {
      actions = h('div', { class: 'form-actions' },
        h('button', {
          type: 'button', class: 'btn btn-primary',
          onclick: function () {
            var unanswered = [];
            selections.forEach(function (s, i) { if (s === null) { unanswered.push(i + 1); } });
            if (unanswered.length) {
              setStatus(status,
                'Answer ' + (unanswered.length === 1 ? 'question ' : 'questions ') +
                unanswered.join(', ') + ' before checking your answers.', 'error');
              return;
            }
            var score = 0;
            lesson.quiz.forEach(function (q, i) { if (selections[i] === q.answerIndex) { score++; } });
            topic.quizState = {
              answers: selections.slice(),
              submitted: true,
              score: score,
              total: lesson.quiz.length,
              completedAt: new Date().toISOString()
            };
            if (score === lesson.quiz.length && !topic.completed) {
              topic.completed = true;
              topic.completedAt = new Date().toISOString();
            }
            if (ctx.opp) { touch(ctx.opp); }
            commit();
            toast('You scored ' + score + ' out of ' + lesson.quiz.length + '.',
              score === lesson.quiz.length ? 'ok' : undefined);
          }
        }, 'Check my answers'));
    }

    return h('div', null, wrap, status, actions);
  }

  function askCoachBlock(ctx, topic) {
    var status = statusLine('ask-status-' + topic.id);
    var input = textArea('ask-' + topic.id, '', 3,
      'e.g. Can you explain that example again more slowly?');
    var button = h('button', { type: 'button', class: 'btn btn-primary' }, 'Ask the Coach');

    button.addEventListener('click', function () {
      var question = asText(input.value);
      if (!question) {
        setStatus(status, 'Type your question first.', 'error');
        input.focus();
        return;
      }
      setBusy(button, true, 'Asking…');
      setStatus(status, state.settings.demoMode
        ? 'Answering using Demo mode…' : 'Asking Gemini…', 'busy');

      Gemini.askCoach(question, topic.lesson, ctx.opp, state.profile, state.settings)
        .then(function (answer) {
          topic.qa = topic.qa || [];
          topic.qa.unshift({ q: question, a: String(answer || '').slice(0, 4000), at: new Date().toISOString() });
          topic.qa = topic.qa.slice(0, 20);
          if (ctx.opp) { touch(ctx.opp); }
          commit();
        }, function (err) {
          setBusy(button, false);
          setStatus(status, geminiErrorMessage(err), 'error');
        });
    });

    return h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Ask the Coach')),
      h('p', { class: 'small soft' }, 'Answers are saved here.'),
      h('div', { class: 'field' },
        h('label', { for: 'ask-' + topic.id }, 'Your question'),
        input),
      h('div', { class: 'form-actions' }, button),
      status,
      (topic.qa && topic.qa.length)
        ? h('div', { class: 'mt-1' },
            h('h3', null, 'Recent questions'),
            topic.qa.map(function (item) {
              return h('div', { class: 'qa-item' },
                h('p', { class: 'qa-q' }, item.q),
                h('p', { class: 'qa-a' }, item.a),
                item.at ? h('p', { class: 'qa-time mb-0' }, formatStamp(item.at)) : null);
            }))
        : null
    );
  }

  function viewLesson(ctx, topicId) {
    var plan = ctx.getPlan();
    var topic = findTopic(plan, topicId);
    if (!topic) {
      return emptyState('🔍', 'That topic is no longer in your plan',
        'It may have been removed, or the plan may have been rebuilt.',
        h('a', { class: 'btn btn-primary', href: '#/coach/' + ctx.id }, 'Back to the plan'));
    }

    var frag = document.createDocumentFragment();
    frag.appendChild(h('div', { class: 'page-head' },
      h('div', null,
        h('a', { class: 'small', href: '#/coach/' + ctx.id }, '← Back to the plan'),
        h('p', { class: 'eyebrow mt-0' }, ctx.label),
        h('h1', { class: 'mt-0' }, topic.name),
        h('div', { class: 'opp-meta' },
          badge(topic.priority + ' priority', PRIORITY_TONE[topic.priority] || 'neutral', { dot: true }),
          badge('About ' + topic.estimatedMinutes + ' min', 'neutral'),
          topic.completed ? badge('Completed', 'ok', { dot: true }) : null,
          topic.quizState && topic.quizState.submitted
            ? badge('Quiz ' + topic.quizState.score + '/' + topic.quizState.total, 'teal') : null))
    ));

    if (topic.reason) {
      frag.appendChild(h('p', { class: 'next-action' }, h('strong', null, 'Why'), topic.reason));
    }

    /* ---- lesson not generated yet ---- */
    if (!topic.lesson) {
      var status = statusLine('lesson-status');
      var btn = h('button', { type: 'button', class: 'btn btn-primary btn-lg' }, 'Generate this lesson');
      btn.addEventListener('click', function () {
        setBusy(btn, true, 'Writing lesson…');
        setStatus(status, state.settings.demoMode
          ? 'Writing a sample lesson using Demo mode…'
          : 'Gemini is writing your lesson and quiz…', 'busy');

        Gemini.generateLesson(topic.name, ctx.opp, state.profile, state.settings)
          .then(function (data) {
            var lesson = normaliseLesson(data);
            if (!lesson) {
              throw new Gemini.GeminiError(
                'Gemini returned a lesson HirePath could not read. Try again.', 'invalid-json');
            }
            lesson.generatedAt = new Date().toISOString();
            lesson.source = state.settings.demoMode ? 'demo' : 'gemini';
            topic.lesson = lesson;
            if (ctx.opp) { touch(ctx.opp); }
            commit();
            toast('Lesson ready.', 'ok');
          }, function (err) {
            setBusy(btn, false);
            setStatus(status, geminiErrorMessage(err), 'error');
          });
      });

      frag.appendChild(h('section', { class: 'card' },
        emptyState('📘', 'This lesson has not been written yet',
          'The Coach will write a beginner-friendly explanation, key points, a worked example, ' +
          'interview tips and a three-question quiz for this topic.',
          btn),
        status));
      return frag;
    }

    var lesson = topic.lesson;

    /* Rewrites this lesson from scratch, used by the "sample lesson" notice. */
    function rewriteLesson(button, statusNode) {
      setBusy(button, true, 'Rewriting…');
      setStatus(statusNode, 'Asking Gemini to write this lesson…', 'busy');
      Gemini.generateLesson(topic.name, ctx.opp, state.profile, state.settings)
        .then(function (data) {
          var fresh = normaliseLesson(data);
          if (!fresh) {
            throw new Gemini.GeminiError(
              'Gemini returned a lesson HirePath could not read. Try again.', 'invalid-json');
          }
          fresh.generatedAt = new Date().toISOString();
          fresh.source = state.settings.demoMode ? 'demo' : 'gemini';
          topic.lesson = fresh;
          topic.quizState = null;
          if (ctx.opp) { touch(ctx.opp); }
          commit();
          toast('Lesson rewritten by Gemini.', 'ok');
        }, function (err) {
          setBusy(button, false);
          setStatus(statusNode, geminiErrorMessage(err), 'error');
        });
    }

    var rewriteStatus = statusLine('lesson-rewrite-status');
    var rewriteBtn = h('button', { type: 'button', class: 'btn btn-sm btn-primary' },
      'Rewrite this lesson with Gemini');
    rewriteBtn.addEventListener('click', function () { rewriteLesson(rewriteBtn, rewriteStatus); });

    frag.appendChild(h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', null, lesson.title),
        h('div', { class: 'row' },
          /* Say plainly where this content came from. */
          lesson.source === 'demo'
            ? badge('Sample lesson · Demo mode', 'warn', { dot: true })
            : (lesson.source === 'gemini' ? badge('Written by Gemini', 'teal', { dot: true }) : null),
          lesson.generatedAt
            ? h('span', { class: 'small muted' }, formatStamp(lesson.generatedAt)) : null)),

      lesson.source === 'demo'
        ? h('div', { class: 'notice warn' },
            h('p', null,
              'This is the built-in sample lesson. Demo mode was on when it was written, so Gemini ' +
              'was not called — every topic gets the same text, with only the topic name changed.'),
            state.settings.demoMode
              ? h('p', null,
                  'Turn Demo mode off in Settings, then rewrite this lesson to get real material ' +
                  'for this topic.')
              : h('div', null,
                  h('p', null, 'Demo mode is now off, so this lesson can be replaced with a real one.'),
                  h('div', { class: 'form-actions' }, rewriteBtn),
                  rewriteStatus))
        : h('div', { class: 'notice' },
            h('p', null, 'Gemini can make mistakes. Check anything important before an interview.')),
      lesson.overview
        ? h('div', { class: 'lesson-block' }, h('h4', null, 'Overview'), paragraphs(lesson.overview, 'soft'))
        : null,
      lesson.keyPoints.length
        ? h('div', { class: 'lesson-block' },
            h('h4', null, 'Key points'),
            h('ul', { class: 'bullets' }, lesson.keyPoints.map(function (p) { return h('li', null, p); })))
        : null,
      lesson.practicalExample
        ? h('div', { class: 'lesson-block' },
            h('h4', null, 'Practical example'),
            h('pre', { class: 'example-box' }, lesson.practicalExample))
        : null,
      lesson.jobRelevance
        ? h('div', { class: 'lesson-block' },
            h('h4', null, ctx.opp ? 'How this relates to the job' : 'Why this matters'),
            paragraphs(lesson.jobRelevance, 'soft'))
        : null,
      lesson.interviewTips.length
        ? h('div', { class: 'lesson-block' },
            h('h4', null, 'Interview tips'),
            h('ul', { class: 'bullets' }, lesson.interviewTips.map(function (t) { return h('li', null, t); })))
        : null,
      h('div', { class: 'form-actions' },
        h('button', {
          type: 'button', class: 'btn ' + (topic.completed ? 'btn-secondary' : 'btn-primary'),
          onclick: function () {
            topic.completed = !topic.completed;
            topic.completedAt = topic.completed ? new Date().toISOString() : null;
            if (ctx.opp) { touch(ctx.opp); }
            commit();
          }
        }, topic.completed ? 'Mark as not completed' : 'Mark topic as completed'),
        h('button', {
          type: 'button', class: 'btn btn-ghost',
          onclick: function () {
            confirmDialog({
              title: 'Rewrite this lesson?',
              message: 'A new lesson and a new quiz replace the current ones. Your quiz score and ' +
                       'saved questions for this topic are cleared.',
              confirmText: 'Rewrite lesson'
            }).then(function (ok) {
              if (!ok) { return; }
              topic.lesson = null;
              topic.quizState = null;
              if (ctx.opp) { touch(ctx.opp); }
              commit();
            });
          }
        }, 'Rewrite lesson'))
    ));

    frag.appendChild(h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Check your understanding')),
      h('p', { class: 'small soft' }, 'Checked in your browser; your score is saved.'),
      quizBlock(ctx, topic)));

    frag.appendChild(askCoachBlock(ctx, topic));
    return frag;
  }

  function viewCoach(params) {
    if (!params.id) { return viewCoachHub(); }
    var ctx = coachContext(params.id);
    if (!ctx) {
      return emptyState('🔍', 'That opportunity is no longer saved',
        'It may have been deleted.',
        h('a', { class: 'btn btn-primary', href: '#/coach' }, 'Back to the Coach'));
    }
    if (params.sub === 'topic' && params.extra) { return viewLesson(ctx, params.extra); }
    return viewCoachPlan(ctx);
  }

  /* =========================================================================
     15b. LOOK UP  —  Wikipedia + Dictionary, no API key, no Gemini
     ====================================================================== */

  var lookupState = { term: '', result: null, error: '', busy: false, suggestions: [] };
  /* The dictionary lives on the Prep Coach page, with its own state. */
  var dictState = { word: '', result: null, error: '' };

  /** Renders one Wikipedia summary. */
  function wikiCard(wiki) {
    return h('article', { class: 'card lookup-card' },
      h('div', { class: 'card-head' },
        iconHeading('h2', 'compass', 'Wikipedia'),
        badge('en.wikipedia.org', 'neutral')),
      h('h3', { class: 'lookup-title' }, wiki.title),
      wiki.description ? h('p', { class: 'lookup-kicker' }, wiki.description) : null,
      paragraphs(wiki.extract, 'soft'),
      wiki.url
        ? h('a', { class: 'btn btn-sm btn-secondary', href: wiki.url,
                   target: '_blank', rel: 'noopener noreferrer' }, 'Read the full article')
        : null);
  }

  /** Renders the body of one dictionary entry (word, parts of speech, senses). */
  function dictBody(dict) {
    return h('div', null,
      h('h3', { class: 'lookup-title' },
        dict.word,
        dict.phonetic ? h('span', { class: 'lookup-phonetic' }, ' ' + dict.phonetic) : null,
        h('span', { class: 'dict-source' }, dict.source || 'Dictionary')),
      dict.meanings.map(function (m) {
        return h('div', { class: 'lesson-block' },
          m.partOfSpeech ? h('h4', null, m.partOfSpeech) : null,
          h('ol', { class: 'bullets' }, m.definitions.map(function (d) {
            return h('li', null,
              h('span', null, d.definition),
              d.example ? h('p', { class: 'lookup-example' }, '“' + d.example + '”') : null);
          })));
      }));
  }

  function runLookup(term, statusNode, button) {
    var q = asText(term);
    if (!q) {
      setStatus(statusNode, 'Type a word or phrase to look up.', 'error');
      return;
    }
    lookupState.term = q;
    lookupState.busy = true;
    lookupState.error = '';
    setBusy(button, true, 'Searching…');
    setStatus(statusNode, 'Searching…', 'busy');

    Lookup.wikipedia(q).then(function (wiki) {
      lookupState.result = wiki;
      lookupState.suggestions = [];
      lookupState.busy = false;
      lookupState.error = '';
      render();
    }, function (err) {
      lookupState.result = null;
      lookupState.busy = false;
      lookupState.error = (err && err.message) || 'That search failed. Try again.';
      /* A miss is far more useful with alternative titles attached. */
      Lookup.searchWikipedia(q).then(function (titles) {
        lookupState.suggestions = titles.filter(function (t) {
          return t.toLowerCase() !== q.toLowerCase();
        });
        render();
      }, function () { render(); });
    });
  }

  function viewQuickwiki() {
    var frag = document.createDocumentFragment();

    frag.appendChild(h('div', { class: 'page-head' },
      h('div', null,
        h('p', { class: 'eyebrow' }, 'Quickwiki'),
        h('h1', null, 'Look anything up on Wikipedia'),
        h('p', { class: 'lede' },
          'Search Wikipedia for any company, tool or industry term.'))
    ));

    var status = statusLine('lookup-status');
    var input = textInput('lookup-term', lookupState.term, {
      placeholder: 'e.g. Property management system, front office, hospitality industry',
      'aria-label': 'Search Wikipedia'
    });
    input.className = 'coach-ask-input';
    var button = h('button', { type: 'button', class: 'btn btn-primary btn-lg' }, 'Search');
    button.addEventListener('click', function () { runLookup(input.value, status, button); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); runLookup(input.value, status, button); }
    });

    var examples = ['Hospitality industry', 'Front office', 'Stakeholder', 'Onboarding', 'Accessibility'];

    frag.appendChild(h('section', { class: 'coach-ask' },
      h('div', { class: 'coach-ask-head' },
        h('span', { class: 'start-panel-icon' }, icon('compass')),
        h('div', null,
          h('p', { class: 'eyebrow' }, 'Wikipedia'),
          h('h2', { class: 'coach-ask-title' },
            h('label', { for: 'lookup-term' }, 'What would you like explained?')))),
      h('div', { class: 'coach-ask-row' }, input, button),
      h('p', { class: 'field-help' },
        'Looking for the meaning of a single word instead? The dictionary lives on the ' +
        'Prep Coach page.'),
      h('div', { class: 'coach-examples' },
        h('span', { class: 'coach-examples-label' }, 'Try:'),
        examples.map(function (sample) {
          return h('button', {
            type: 'button', class: 'coach-example',
            onclick: function () { input.value = sample; runLookup(sample, status, button); }
          }, sample);
        })),
      status));

    if (lookupState.result) {
      frag.appendChild(h('div', { class: 'section lookup-grid' }, wikiCard(lookupState.result)));
    }

    if (lookupState.error) {
      frag.appendChild(h('div', { class: 'notice section' },
        h('p', null, lookupState.error),
        (lookupState.suggestions && lookupState.suggestions.length)
          ? h('div', null,
              h('p', null, 'Wikipedia suggests these instead:'),
              h('div', { class: 'coach-examples' }, lookupState.suggestions.map(function (title) {
                return h('button', {
                  type: 'button', class: 'coach-example',
                  onclick: function () { input.value = title; runLookup(title, status, button); }
                }, title);
              })))
          : null));
    }

    return frag;
  }

  /**
   * The two learning tools sit side by side and top-aligned: the custom-topic
   * form at about 70% and the dictionary at about 30%. They stack on mobile.
   */
  function learningToolsRow(ctx, options) {
    options = options || {};
    var ask = options.prominent
      ? customTopicForm(ctx, { prominent: true })
      : h('section', { class: 'card' }, customTopicForm(ctx));
    return h('div', { class: 'learning-tools' },
      ask,
      h('aside', { class: 'learning-aside', 'aria-label': 'Dictionary' }, dictionaryPanel()));
  }

  /** Deletes every topic in a plan — including any left over from an old build. */
  function clearPlanButton(ctx) {
    var plan = ctx.getPlan();
    if (!plan || !plan.topics.length) { return null; }
    return h('div', { class: 'form-actions' },
      h('button', {
        type: 'button', class: 'btn btn-sm btn-danger',
        onclick: function () {
          confirmDialog({
            title: 'Remove all ' + plan.topics.length + ' topics?',
            message: 'Every topic here is deleted, along with its lesson, quiz score and saved ' +
                     'questions. Your opportunities and schedule are not touched.',
            confirmText: 'Remove all topics', danger: true
          }).then(function (ok) {
            if (!ok) { return; }
            ctx.setPlan(null);
            commit();
            toast('All topics removed.');
          });
        }
      }, 'Remove all topics'));
  }

  /**
   * Dictionary panel for the Prep Coach page. Independent of Gemini, so
   * it keeps working when the quota is spent or no key has been added.
   */
  function dictionaryPanel() {
    var status = statusLine('dict-status');
    var input = textInput('dict-word', dictState.word, {
      placeholder: 'e.g. hospitality, stakeholder, liaise',
      'aria-label': 'Word to define'
    });
    var button = h('button', { type: 'button', class: 'btn btn-primary' }, 'Define');

    function run(word) {
      var q = asText(word);
      if (!q) {
        setStatus(status, 'Type a word to define first.', 'error');
        input.focus();
        return;
      }
      dictState.word = q;
      setBusy(button, true, 'Looking up…');
      setStatus(status, 'Checking the dictionary…', 'busy');
      Lookup.dictionary(q).then(function (entry) {
        dictState.result = entry;
        dictState.error = '';
        render();
      }, function (err) {
        dictState.result = null;
        dictState.error = (err && err.message) || 'That word could not be defined.';
        render();
      });
    }

    button.addEventListener('click', function () { run(input.value); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); run(input.value); }
    });

    var samples = ['Hospitality', 'Stakeholder', 'Liaise', 'Proficiency'];

    return h('section', { class: 'card dict-panel' },
      h('div', { class: 'card-head' },
        iconHeading('h2', 'bulb', 'Dictionary'),
        badge('Works without Gemini', 'teal')),
      h('p', { class: 'small soft' },
        'Define any word from an advertisement or a lesson.'),
      h('div', { class: 'inline-add mt-0' }, input, button),
      h('div', { class: 'coach-examples' },
        h('span', { class: 'coach-examples-label' }, 'Try:'),
        samples.map(function (sample) {
          return h('button', {
            type: 'button', class: 'coach-example',
            onclick: function () { input.value = sample; run(sample); }
          }, sample);
        })),
      status,
      dictState.error ? h('p', { class: 'small', style: 'color:var(--danger-700)' }, dictState.error) : null,
      dictState.result ? h('div', { class: 'dict-result' }, dictBody(dictState.result)) : null
    );
  }

  /* =========================================================================
     16. TODAY'S PLAN
     ====================================================================== */

  function viewToday() {
    var today = todayISO();
    var entries = allTasksForDate(today);
    var overdue = allOverdueTasks();
    var doneToday = entries.filter(function (e) { return e.task.done; });
    var pct = entries.length ? Math.round((doneToday.length / entries.length) * 100) : 0;

    var upcomingDeadlines = state.opportunities.filter(function (o) {
      var u = urgencyOf(o.deadline);
      return u && u.level !== 'expired' && o.status !== 'Rejected' && o.status !== 'Closed';
    }).sort(function (a, b) { return a.deadline < b.deadline ? -1 : 1; });

    var frag = document.createDocumentFragment();

    frag.appendChild(h('div', { class: 'page-head' },
      h('div', null,
        h('p', { class: 'eyebrow' }, 'Today’s Plan'),
        h('h1', null, formatDateLong(today)),
        h('p', { class: 'lede' },
          entries.length
            ? 'You have ' + entries.length + ' ' + pluralise(entries.length, 'session') +
              ' scheduled for today.'
            : 'Nothing is scheduled for today.'))
    ));

    frag.appendChild(h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', null, 'Daily progress'),
        h('span', { class: 'small soft' }, doneToday.length + ' of ' + entries.length + ' completed')),
      progressBar(doneToday.length, entries.length, 'Today’s progress'),
      h('p', { class: 'small soft mt-1 mb-0' },
        entries.length
          ? (pct === 100
              ? 'Every session for today is done. Well done.'
              : pct + '% of today’s preparation is complete.')
          : 'No sessions to complete today.')
    ));

    /* ---- add a task by hand ---- */
    var ownName = textInput('own-task-name', '', {
      placeholder: 'e.g. Rewrite my CV summary', 'aria-label': 'Task name'
    });
    var ownDate = textInput('own-task-date', today, { type: 'date', 'aria-label': 'Date' });
    var ownMinutes = textInput('own-task-min', '30', {
      type: 'number', min: '5', max: '480', 'aria-label': 'Minutes'
    });
    var ownJob = selectInput('own-task-job',
      [{ value: '', label: 'Not linked to a job' }].concat(
        state.opportunities.map(function (o) {
          return { value: o.id, label: o.role + (o.company ? ' — ' + o.company : '') };
        })), '');
    var ownStatus = statusLine('own-task-status');

    function addOwnTask() {
      var name = asText(ownName.value);
      if (!name) {
        setStatus(ownStatus, 'Give the task a name first.', 'error');
        ownName.focus();
        return;
      }
      if (!isValidISO(ownDate.value)) {
        setStatus(ownStatus, 'Choose a valid date.', 'error');
        return;
      }
      var task = normaliseTask({
        date: ownDate.value, topicName: name, activity: 'Added by you.',
        minutes: clampInt(ownMinutes.value, 5, 480, 30), manual: true
      });
      var linked = ownJob.value ? findOpp(ownJob.value) : null;
      if (linked) {
        if (linked.deadline && task.date > linked.deadline) {
          setStatus(ownStatus, 'That date is after that job’s deadline (' +
            formatDateShort(linked.deadline) + ').', 'error');
          return;
        }
        linked.schedule.push(task);
        touch(linked);
      } else {
        state.ownTasks = state.ownTasks || [];
        state.ownTasks.push(task);
      }
      commit();
      toast('Task added for ' + formatDateShort(task.date) + '.', 'ok');
    }
    ownName.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addOwnTask(); }
    });

    frag.appendChild(h('section', { class: 'card own-task-card' },
      h('div', { class: 'card-head' },
        iconHeading('h2', 'calendar', 'Plan your day')),
      h('p', { class: 'small soft' },
        'A task can stand alone or be attached to a job.'),
      h('div', { class: 'own-task-grid' },
        field('own-task-name', 'Task', ownName),
        field('own-task-date', 'Date', ownDate),
        field('own-task-min', 'Minutes', ownMinutes),
        field('own-task-job', 'Link to a job (optional)', ownJob)),
      h('div', { class: 'form-actions' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: addOwnTask }, 'Add task')),
      ownStatus));

    frag.appendChild(h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Scheduled for today')),
      entries.length
        ? h('div', null, entries.map(function (e) {
            return taskRow(e.opp, e.task, { showOpp: true });
          }))
        : emptyState('🗓️', 'Nothing scheduled for today',
            'Add a task above, or let the Prep Coach build a schedule from a job’s topics.',
            h('a', { class: 'btn btn-secondary', href: state.opportunities.length ? '#/coach' : '#/add' },
              state.opportunities.length ? 'Open the Prep Coach' : 'Add an opportunity'))
    ));

    if (overdue.length) {
      frag.appendChild(h('section', { class: 'card' },
        h('div', { class: 'card-head' },
          h('h2', null, 'Missed preparation tasks'),
          badge(overdue.length + ' missed', 'danger', { dot: true })),
        h('p', { class: 'small soft' },
          'Move them to today, or tick them off if you already did them.'),
        overdue.map(function (e) { return taskRow(e.opp, e.task, { showOpp: true }); })
      ));
    }

    frag.appendChild(h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Upcoming deadlines')),
      upcomingDeadlines.length
        ? h('ul', { class: 'check-list' }, upcomingDeadlines.slice(0, 6).map(function (o) {
            return h('li', { class: 'check-item' },
              h('div', { class: 'task-body' },
                h('p', { class: 'task-title' }, o.role + (o.company ? ' — ' + o.company : '')),
                h('div', { class: 'task-tools' },
                  deadlineBadge(o.deadline),
                  badge(formatDateShort(o.deadline), 'neutral'),
                  statusBadge(o.status),
                  h('a', { class: 'btn btn-sm btn-secondary', href: '#/opportunity/' + o.id }, 'Open'))));
          }))
        : h('p', { class: 'muted small mb-0' },
            'No open deadlines. Add a closing date to an opportunity and it will appear here.')
    ));

    if (doneToday.length) {
      frag.appendChild(h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, 'Completed today')),
        h('ul', { class: 'bullets' }, doneToday.map(function (e) {
          /* A task you added yourself has no job attached, so opp is null. */
          var source = e.opp ? e.opp.role : 'Your own task';
          return h('li', null, e.task.topicName + ' — ' + source +
            (e.task.doneAt ? ' (' + formatStamp(e.task.doneAt) + ')' : ''));
        }))
      ));
    }

    return frag;
  }

  /* =========================================================================
     17. SETTINGS
     ====================================================================== */

  function profileCard() {
    var p = state.profile;
    var status = statusLine('profile-status');

    var name = textInput('p-name', p.name, { required: true });
    var age = textInput('p-age', p.age, { type: 'number', min: '14', max: '100' });
    var education = textInput('p-education', p.education);
    var fieldOfStudy = textInput('p-field', p.fieldOfStudy);
    var skills = textArea('p-skills', (p.skills || []).join(', '), 3, 'e.g. HTML, CSS, JavaScript, SQL');
    var minutes = textInput('p-minutes', String(p.dailyMinutes), { type: 'number', min: '10', max: '600', step: '5' });
    var reminder = textInput('p-reminder', p.reminderTime, { type: 'time' });

    var form = h('form', {
      class: 'form-grid', novalidate: true,
      onsubmit: function (e) {
        e.preventDefault();
        var nameValue = asText(name.value);
        if (!nameValue) {
          name.classList.add('input-invalid');
          setStatus(status, 'Your name cannot be empty.', 'error');
          name.focus();
          return;
        }
        name.classList.remove('input-invalid');
        state.profile = {
          name: nameValue.slice(0, 80),
          age: asText(age.value).slice(0, 4),
          education: asText(education.value).slice(0, 160),
          fieldOfStudy: asText(fieldOfStudy.value).slice(0, 160),
          goal: p.goal || '',
          skills: asArray(skills.value).slice(0, 80),
          dailyMinutes: clampInt(minutes.value, 10, 600, 60),
          reminderTime: minutesFromHHMM(reminder.value) === null ? '19:00' : reminder.value,
          createdAt: p.createdAt || new Date().toISOString()
        };
        saveState();
        render();
        toast('Profile saved.', 'ok');
      }
    },
      field('p-name', 'Name', name),
      field('p-age', 'Age (optional)', age),
      field('p-education', 'Educational qualification', education),
      field('p-field', 'Field of study', fieldOfStudy),
      field('p-skills', 'Current skills', skills,
        'Comma separated. Write them the way advertisements do — "JavaScript", not "JS".', true),
      field('p-minutes', 'Daily preparation time (minutes)', minutes,
        'Used to spread your study schedule across the days before a deadline.'),
      field('p-reminder', 'Preferred reminder time', reminder,
        'HirePath shows your daily reminder at this time while the application is open.'),
      h('div', { class: 'form-actions field-wide' },
        h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save profile'))
    );

    return h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Your profile')),
      form, status);
  }

  function geminiCard() {
    var s = state.settings;
    var status = statusLine('gemini-settings-status');

    var keyInput = textInput('s-key', s.apiKey, {
      type: 'password', autocomplete: 'off', spellcheck: 'false',
      placeholder: s.apiKey ? '' : 'Paste your Gemini key'
    });
    var showKey = h('input', { type: 'checkbox', id: 's-show-key' });
    showKey.addEventListener('change', function () {
      keyInput.type = showKey.checked ? 'text' : 'password';
    });

    var modelInput = textInput('s-model', s.model, { placeholder: Gemini.DEFAULT_MODEL });

    var demoToggle = h('input', { type: 'checkbox', id: 's-demo' });
    demoToggle.checked = s.demoMode;
    demoToggle.addEventListener('change', function () {
      state.settings.demoMode = demoToggle.checked;
      saveState();
      render();
      toast(demoToggle.checked
        ? 'Demo mode is on. HirePath will not call Gemini.'
        : 'Demo mode is off. HirePath will call Gemini with your saved key.', 'ok');
    });

    var testBtn = h('button', { type: 'button', class: 'btn btn-secondary' }, 'Test connection');
    testBtn.addEventListener('click', function () {
      setBusy(testBtn, true, 'Testing…');
      setStatus(status, 'Contacting Gemini…', 'busy');
      Gemini.testConnection(state.settings).then(function (msg) {
        setBusy(testBtn, false);
        setStatus(status, msg, 'ok');
      }, function (err) {
        setBusy(testBtn, false);
        setStatus(status, geminiErrorMessage(err), 'error');
      });
    });

    return h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', null, 'Gemini'),
        badge(s.demoMode ? 'Demo mode on' : 'Live Gemini', s.demoMode ? 'info' : 'ok', { dot: true })),

      h('div', { class: 'check-item' },
        h('label', { for: 's-demo' }, demoToggle,
          h('span', null, 'Demo mode — use built-in sample answers instead of calling Gemini')),
      ),
      h('p', { class: 'small soft' },
        'Works offline with no key, using built-in samples.'),

      h('hr', { class: 'divider' }),

      h('div', { class: 'notice warn' },
        h('p', null, 'This classroom version stores the Gemini key in your browser. ' +
                     'A public production application must use a secure server-side proxy.')),

      h('form', {
        class: 'form-grid', novalidate: true,
        onsubmit: function (e) {
          e.preventDefault();
          state.settings.apiKey = asText(keyInput.value).slice(0, 200);
          state.settings.model = asText(modelInput.value).slice(0, 80) || Gemini.DEFAULT_MODEL;
          saveState();
          render();
          toast('Gemini settings saved.', 'ok');
        }
      },
        field('s-key', 'Gemini key', keyInput,
          'Stored only in this browser, and never written to the console or to any log.', true),
        h('div', { class: 'check-item field-wide' },
          h('label', { for: 's-show-key' }, showKey, h('span', null, 'Show the key while I check it'))),
        field('s-model', 'Gemini model', modelInput,
          'Default: ' + Gemini.DEFAULT_MODEL + '. Change this if your key uses a different model.', true),
        h('div', { class: 'form-actions field-wide' },
          h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save Gemini settings'),
          testBtn)
      ),
      status,
      h('p', { class: 'small muted mb-0' },
        'No key? Keep Demo mode on.')
    );
  }

  function notificationsCard() {
    var supported = ('Notification' in window);
    var permission = supported ? Notification.permission : 'unsupported';
    var status = statusLine('notification-status');

    var enableBtn = h('button', { type: 'button', class: 'btn btn-primary' },
      'Enable Browser Notifications');
    enableBtn.disabled = !supported || permission === 'denied';

    enableBtn.addEventListener('click', function () {
      if (!supported) {
        setStatus(status, 'This browser does not support notifications.', 'error');
        return;
      }
      /* Permission is only ever requested from this explicit click. */
      Notification.requestPermission().then(function (result) {
        if (result === 'granted') {
          state.settings.notificationsEnabled = true;
          saveState();
          render();
          toast('Daily reminders are on for this browser.', 'ok');
          try {
            new Notification('HirePath reminders are on', {
              body: 'You will get one reminder each day at ' + state.profile.reminderTime +
                    ' while HirePath is open.'
            });
          } catch (e) { /* some browsers block constructing notifications directly */ }
        } else if (result === 'denied') {
          setStatus(status,
            'Your browser blocked notifications. You can still see the in-app reminder banner. ' +
            'To change this, allow notifications for this site in your browser settings.', 'error');
        } else {
          setStatus(status, 'No choice was made, so notifications stay off.', 'error');
        }
      }, function () {
        setStatus(status, 'The notification request could not be completed.', 'error');
      });
    });

    var offBtn = h('button', {
      type: 'button', class: 'btn btn-secondary',
      onclick: function () {
        state.settings.notificationsEnabled = false;
        saveState();
        render();
        toast('Daily browser notifications turned off. The in-app banner still appears.');
      }
    }, 'Turn off daily notifications');

    var permissionLabel = {
      granted: 'Allowed by this browser',
      denied: 'Blocked by this browser',
      'default': 'Not asked yet',
      unsupported: 'Not supported by this browser'
    }[permission] || permission;

    return h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', null, 'Daily reminders'),
        badge(state.settings.notificationsEnabled && permission === 'granted' ? 'On' : 'Off',
          state.settings.notificationsEnabled && permission === 'granted' ? 'ok' : 'neutral', { dot: true })),
      h('dl', { class: 'definition-list' },
        h('dt', null, 'Browser permission'), h('dd', null, permissionLabel),
        h('dt', null, 'Reminder time'), h('dd', null, state.profile.reminderTime),
        h('dt', null, 'Last reminder shown'),
        h('dd', null, state.lastNotificationDate
          ? formatDateLong(state.lastNotificationDate) : 'Not yet shown')),
      h('div', { class: 'form-actions' },
        state.settings.notificationsEnabled && permission === 'granted' ? offBtn : enableBtn),
      status,
      h('div', { class: 'notice' },
        h('p', null, 'Notifications only work while HirePath is open in a tab. Reminders with the ' +
                     'browser closed would need a server.'))
    );
  }

  function dataCard() {
    var status = statusLine('data-status');

    var exportBtn = h('button', {
      type: 'button', class: 'btn btn-secondary',
      onclick: function () {
        try {
          var payload = JSON.stringify(state, null, 2);
          var blob = new Blob([payload], { type: 'application/json' });
          var url = URL.createObjectURL(blob);
          var a = h('a', { href: url, download: 'hirepath-backup-' + todayISO() + '.json' });
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
          setStatus(status, 'Your data was exported as a JSON file. It includes your Gemini key, ' +
                            'so keep the file private.', 'ok');
        } catch (e) {
          setStatus(status, 'The export could not be created in this browser.', 'error');
        }
      }
    }, 'Export data as JSON');

    var importInput = h('input', {
      type: 'file', id: 'import-file', name: 'import-file', accept: 'application/json,.json'
    });
    importInput.addEventListener('change', function () {
      var file = importInput.files && importInput.files[0];
      if (!file) { return; }
      if (file.size > 12 * 1024 * 1024) {
        setStatus(status, 'That file is too large to be a HirePath backup.', 'error');
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var parsed;
        try {
          parsed = JSON.parse(String(reader.result || ''));
        } catch (e) {
          setStatus(status, 'That file is not valid JSON, so nothing was imported.', 'error');
          importInput.value = '';
          return;
        }
        if (!parsed || typeof parsed !== 'object' ||
            (!Array.isArray(parsed.opportunities) && !parsed.profile)) {
          setStatus(status, 'That file does not look like a HirePath backup, so nothing was imported.', 'error');
          importInput.value = '';
          return;
        }
        var incoming;
        try {
          incoming = normaliseState(parsed);
        } catch (e) {
          setStatus(status, 'That backup could not be read, so nothing was imported.', 'error');
          importInput.value = '';
          return;
        }
        confirmDialog({
          title: 'Replace everything with this backup?',
          message: 'The backup contains ' + incoming.opportunities.length + ' ' +
            pluralise(incoming.opportunities.length, 'opportunity', 'opportunities') +
            ' and the profile name "' + (incoming.profile.name || 'not set') + '". ' +
            'Your current HirePath data in this browser will be replaced.',
          confirmText: 'Replace my data', danger: true
        }).then(function (ok) {
          importInput.value = '';
          if (!ok) { setStatus(status, 'Import cancelled. Nothing changed.'); return; }
          state = incoming;
          saveState();
          go('/dashboard');
          render();
          toast('Backup imported.', 'ok');
        });
      };
      reader.onerror = function () {
        setStatus(status, 'That file could not be read.', 'error');
        importInput.value = '';
      };
      reader.readAsText(file);
    });

    var clearBtn = h('button', {
      type: 'button', class: 'btn btn-danger',
      onclick: function () {
        confirmDialog({
          title: 'Clear all HirePath data?',
          message: 'This removes your profile, every opportunity, every preparation plan, every ' +
            'lesson and your Gemini settings from this browser. This cannot be undone. ' +
            'Export a backup first if you want to keep a copy.',
          confirmText: 'Delete everything', danger: true
        }).then(function (ok) {
          if (!ok) { return; }
          try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
          state = defaultState();
          resetAddState();
          location.hash = '#/dashboard';
          render();
          toast('All HirePath data cleared.');
        });
      }
    }, 'Clear application data');

    return h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Your data')),
      h('p', { class: 'small soft' },
        'Stored in this browser under "' + STORAGE_KEY + '".'),
      h('dl', { class: 'definition-list' },
        h('dt', null, 'Opportunities'), h('dd', null, String(state.opportunities.length)),
        h('dt', null, 'Scheduled sessions'),
        h('dd', null, String(state.opportunities.reduce(function (n, o) {
          return n + (o.schedule ? o.schedule.length : 0);
        }, 0))),
        h('dt', null, 'Last saved'), h('dd', null, formatStamp(state.savedAt) || 'Not saved yet')),
      h('div', { class: 'form-actions' }, exportBtn),
      h('div', { class: 'field mt-1' },
        h('label', { for: 'import-file' }, 'Import data from JSON'),
        importInput,
        h('p', { class: 'field-help' }, 'Replaces everything stored here.')),
      status,
      h('hr', { class: 'divider' }),
      h('div', { class: 'form-actions' }, clearBtn));
  }

  /* Profile and Settings are separate pages, reached from the menu beside the
     logo. Your details live in one, the application's configuration in the other. */
  function viewProfile() {
    var frag = document.createDocumentFragment();
    frag.appendChild(h('div', { class: 'page-head' },
      h('div', null,
        h('p', { class: 'eyebrow' }, 'Your profile'),
        h('h1', null, 'About you'),
        h('p', { class: 'lede' },
          'Used to size your daily schedule and compare your skills with each job. Stored in this browser.'))
    ));
    frag.appendChild(h('div', { class: 'grid grid-2' },
      h('div', null, profileCard()),
      h('div', null, notificationsCard())));
    return frag;
  }

  function viewSettings() {
    var frag = document.createDocumentFragment();
    frag.appendChild(h('div', { class: 'page-head' },
      h('div', null,
        h('p', { class: 'eyebrow' }, 'Settings'),
        h('h1', null, 'Application settings'),
        h('p', { class: 'lede' },
          'Your name, skills and study time live on ',
          h('a', { href: '#/profile' }, 'Your profile'), '.'))
    ));
    frag.appendChild(h('div', { class: 'grid grid-2' },
      h('div', null, geminiCard()),
      h('div', null, dataCard())));
    return frag;
  }

  /* =========================================================================
     18. REMINDERS  (in-app banner + one browser notification per day)
     ====================================================================== */

  var bannerDismissedFor = null;   /* session-only dismissal, keyed by date */

  function reminderDue() {
    var mins = minutesFromHHMM(state.profile.reminderTime);
    if (mins === null) { return false; }
    var now = new Date(Date.now());
    return (now.getHours() * 60 + now.getMinutes()) >= mins;
  }

  function reminderSummary() {
    var today = todayISO();
    var tasks = allTasksForDate(today).filter(function (e) { return !e.task.done; });
    var overdue = allOverdueTasks();
    var urgent = state.opportunities.filter(function (o) {
      var u = urgencyOf(o.deadline);
      return u && (u.level === 'urgent' || u.level === 'warning') &&
             o.status !== 'Rejected' && o.status !== 'Closed' && o.status !== 'Applied';
    });
    var followUps = state.opportunities.filter(function (o) {
      return o.followUpDate && daysUntil(o.followUpDate) <= 0 &&
             o.status !== 'Rejected' && o.status !== 'Closed';
    });
    return { tasks: tasks, overdue: overdue, urgent: urgent, followUps: followUps };
  }

  function renderReminderBanner() {
    var slot = $('#reminder-banner-slot');
    if (!slot) { return; }
    clear(slot);

    var today = todayISO();
    if (!state.onboarded || bannerDismissedFor === today) { return; }

    var info = reminderSummary();
    var due = reminderDue();
    var hasSomething = info.tasks.length || info.overdue.length || info.urgent.length || info.followUps.length;
    if (!hasSomething) { return; }
    /* Before the reminder time, only genuinely urgent things interrupt. */
    if (!due && !info.overdue.length && !info.urgent.length && !info.followUps.length) { return; }

    var lines = [];
    if (info.tasks.length) {
      lines.push(info.tasks.length + ' preparation ' + pluralise(info.tasks.length, 'task') +
        ' still to do today: ' + info.tasks.map(function (e) { return e.task.topicName; })
          .slice(0, 3).join(', ') + (info.tasks.length > 3 ? '…' : ''));
    }
    if (info.overdue.length) {
      lines.push(info.overdue.length + ' missed ' + pluralise(info.overdue.length, 'task') +
        ' from earlier days.');
    }
    info.urgent.forEach(function (o) {
      lines.push(o.role + (o.company ? ' at ' + o.company : '') + ' — ' + deadlineLabel(o.deadline) + '.');
    });
    info.followUps.forEach(function (o) {
      lines.push(o.role + ' — ' + followUpLabel(o.followUpDate) + '.');
    });

    var tone = (info.overdue.length || info.urgent.some(function (o) {
      var u = urgencyOf(o.deadline);
      return u && u.level === 'urgent';
    })) ? ' danger' : (info.urgent.length ? ' warn' : '');

    slot.appendChild(h('div', { class: 'banner-wrap' },
      h('div', { class: 'banner' + tone, role: 'status' },
        h('div', null,
          h('h3', null, due ? 'Your daily HirePath reminder' : 'Needs your attention today'),
          h('ul', null, lines.slice(0, 6).map(function (l) { return h('li', null, l); })),
          h('div', { class: 'form-actions' },
            h('a', { class: 'btn btn-sm btn-primary', href: '#/today' }, 'Open Today’s Plan'))),
        h('button', {
          type: 'button', class: 'btn btn-sm btn-ghost banner-close',
          onclick: function () { bannerDismissedFor = today; renderReminderBanner(); }
        }, 'Dismiss'))));
  }

  /** One browser notification per day, at or after the chosen reminder time. */
  function maybeNotify() {
    if (!state.onboarded) { return; }
    if (!state.settings.notificationsEnabled) { return; }
    if (!('Notification' in window) || Notification.permission !== 'granted') { return; }
    if (!reminderDue()) { return; }

    var today = todayISO();
    if (state.lastNotificationDate === today) { return; }

    var info = reminderSummary();
    if (!info.tasks.length && !info.overdue.length && !info.urgent.length && !info.followUps.length) { return; }

    var body = [];
    if (info.tasks.length) {
      body.push(info.tasks.length + ' preparation ' + pluralise(info.tasks.length, 'task') + ' due today');
    }
    if (info.overdue.length) {
      body.push(info.overdue.length + ' missed ' + pluralise(info.overdue.length, 'task'));
    }
    if (info.urgent.length) {
      body.push(info.urgent.length + ' ' + pluralise(info.urgent.length, 'deadline') + ' closing soon');
    }
    if (info.followUps.length) {
      body.push(info.followUps.length + ' follow-' + pluralise(info.followUps.length, 'up') + ' due');
    }

    try {
      new Notification('HirePath — ' + greeting() + ', ' + (state.profile.name || 'there'), {
        body: body.join(' · '),
        tag: 'hirepath-daily-' + today
      });
      state.lastNotificationDate = today;
      saveState();
    } catch (e) { /* notification could not be shown; the banner still appears */ }
  }

  /* =========================================================================
     19. RENDER
     ====================================================================== */

  function updateNav() {
    var links = document.querySelectorAll('[data-nav]');
    Array.prototype.forEach.call(links, function (link) {
      var isActive = link.dataset.nav === route.name;
      link.classList.toggle('is-active', isActive);
      if (isActive) { link.setAttribute('aria-current', 'page'); }
      else { link.removeAttribute('aria-current'); }
    });

    var pill = $('#nav-today-count');
    if (pill) {
      var count = allTasksForDate(todayISO()).filter(function (e) { return !e.task.done; }).length +
                  allOverdueTasks().length;
      if (count > 0) {
        pill.hidden = false;
        pill.textContent = String(count);
        pill.setAttribute('aria-label', count + ' preparation tasks need attention');
      } else {
        pill.hidden = true;
        pill.textContent = '';
      }
    }
  }

  function render() {
    var onboarding = $('#onboarding');
    var app = $('#app');

    if (!state.onboarded) {
      onboarding.hidden = false;
      app.hidden = true;
      document.title = 'Welcome to HirePath';
      return;
    }
    onboarding.hidden = true;
    app.hidden = false;

    updateNav();
    renderReminderBanner();

    var view = $('#view');
    clear(view);

    var content;
    switch (route.name) {
      case 'opportunities': content = viewOpportunities(); break;
      case 'add': content = viewAdd(); break;
      case 'opportunity': content = viewOpportunity(route.params.id); break;
      case 'coach': content = viewCoach(route.params); break;
      case 'today': content = viewToday(); break;
      case 'quickwiki': content = viewQuickwiki(); break;
      case 'profile': content = viewProfile(); break;
      case 'settings': content = viewSettings(); break;
      default: content = viewDashboard();
    }
    view.appendChild(content);

    var titles = {
      dashboard: 'Dashboard', add: 'Add Opportunity', opportunity: 'Opportunity',
      coach: 'Prep Coach', today: 'Today’s Plan', settings: 'Settings',
      quickwiki: 'Quickwiki', profile: 'Your profile', opportunities: 'My opportunities'
    };
    document.title = 'HirePath — ' + (titles[route.name] || 'Dashboard');

    if (pendingNotice) {
      toast(pendingNotice, 'error');
      pendingNotice = null;
    }
  }

  /* =========================================================================
     20. ONBOARDING
     ====================================================================== */

  function wireOnboarding() {
    var form = $('#onboarding-form');
    if (!form) { return; }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var nameInput = $('#ob-name');
      var errorNode = $('#ob-name-err');
      var nameValue = asText(nameInput.value);

      if (!nameValue) {
        nameInput.classList.add('input-invalid');
        nameInput.setAttribute('aria-invalid', 'true');
        errorNode.textContent = 'Please enter your name so HirePath can greet you.';
        nameInput.focus();
        return;
      }
      nameInput.classList.remove('input-invalid');
      nameInput.removeAttribute('aria-invalid');
      errorNode.textContent = '';

      state.profile = {
        name: nameValue.slice(0, 80),
        age: asText($('#ob-age').value).slice(0, 4),
        education: asText($('#ob-education').value).slice(0, 160),
        fieldOfStudy: asText($('#ob-field').value).slice(0, 160),
        goal: asText($('#ob-goal').value).slice(0, 80),
        skills: asArray($('#ob-skills').value).slice(0, 80),
        dailyMinutes: 60,
        reminderTime: '19:00',
        createdAt: new Date().toISOString()
      };
      state.onboarded = true;
      saveState();
      location.hash = '#/dashboard';
      route = parseHash();
      render();
      toast('Welcome to HirePath, ' + state.profile.name + '.', 'ok');
    });
  }

  /* =========================================================================
     21. TIME LOOP  —  recalculate every 60 seconds
     ====================================================================== */

  /* A re-render would discard half-typed text, so the tick waits while the
     user is actually typing. Time labels catch up on the next tick. */
  function isUserTyping() {
    var el = document.activeElement;
    if (!el) { return false; }
    var tag = el.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') { return false; }
    return !!$('#view').contains(el);
  }

  function tick() {
    maybeNotify();
    if (!state.onboarded) { return; }
    var modalOpen = !$('#modal-root').hidden;
    /* The add and edit forms hold unsaved text, so they are never rebuilt by the timer. */
    if (modalOpen || isUserTyping() || route.name === 'add' || detailEditing) {
      updateNav();
      renderReminderBanner();
      return;
    }
    render();
  }

  /* =========================================================================
     22. BOOT
     ====================================================================== */

  function wireMenu() {
    var toggle = $('#menu-toggle');
    var menu = $('#app-menu');
    if (!toggle || !menu) { return; }

    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = menu.hidden;
      menu.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        var first = menu.querySelector('.menu-item');
        if (first) { first.focus(); }
      }
    });

    menu.addEventListener('click', function (e) {
      if (e.target.closest('a')) { closeMenu(); }
    });

    /* Click anywhere else, or press Escape, to dismiss. */
    document.addEventListener('click', function (e) {
      if (menu.hidden) { return; }
      if (!menu.contains(e.target) && e.target !== toggle && !toggle.contains(e.target)) {
        closeMenu();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menu.hidden) {
        closeMenu();
        toggle.focus();
      }
    });
  }

  function boot() {
    loadState();
    route = parseHash();
    wireOnboarding();
    wireMenu();
    render();
    maybeNotify();
    window.setInterval(tick, TICK_MS);

    /* Another tab may have changed the same notebook. */
    window.addEventListener('storage', function (e) {
      if (e.key !== STORAGE_KEY) { return; }
      loadState();
      render();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}());
