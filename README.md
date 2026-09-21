# HirePath

**A personal notebook for job applications and an AI-powered preparation coach.**

HirePath saves the jobs you want, explains long advertisements in plain language, tracks every
deadline and document, and then builds a complete preparation plan — lessons, quizzes and a
day-by-day schedule — from the advertisement itself.

Built with **HTML, CSS and vanilla JavaScript only**. No framework, no build step, no npm
packages. Open it with any static server and it runs.

---

## Contents

- [What HirePath does](#what-hirepath-does)
- [The three required behaviours](#the-three-required-behaviours)
- [Running the application](#running-the-application)
- [Demo mode](#demo-mode)
- [Connecting a Gemini API key](#connecting-a-gemini-api-key)
- [Image analysis](#image-analysis)
- [Quickwiki and the Dictionary](#quickwiki-and-the-dictionary)
- [API key security warning](#api-key-security-warning)
- [Notification limitation](#notification-limitation)
- [How data is stored](#how-data-is-stored)
- [Project structure](#project-structure)
- [Accessibility and security notes](#accessibility-and-security-notes)
- [Manual test checklist](#manual-test-checklist)

---

## What HirePath does

**Save and organise opportunities**

- Add a job three ways: paste the advertisement text, upload a picture of it, or type the
  details in yourself.
- Track company, role, location, workplace type, salary, qualifications, experience, required
  and preferred skills, responsibilities, documents, deadline, follow-up date, notes and the
  original job URL.
- Seven application statuses: Saved, Preparing, Applied, Interview Scheduled, Offer Received,
  Rejected, Closed. The date you applied is recorded automatically the first time you choose
  **Applied**.

**Understand long advertisements**

- Gemini extracts a structured summary and keeps required and preferred skills separate.
- A **Words explained** panel defines jargon and acronyms from the advertisement in simple
  language.
- Nothing is saved automatically. Every extracted field appears on an editable review screen
  first, under the reminder: *"Gemini can make mistakes. Review the extracted information
  before saving."*

**Track the application**

- Every opportunity gets an automatic checklist (tailor résumé, prepare portfolio, write cover
  letter, collect documents, review, submit, schedule follow-up) plus one row for each document
  the advertisement asks for. You can add, tick and remove items; each change saves instantly.
- A **Skills profile** panel compares the job's skills with your own, using case-insensitive
  **exact** matching, so "Java" never matches "JavaScript".

**Learn what the job needs**

- **Build Complete Preparation Plan** asks Gemini to read the whole advertisement and produce
  5–10 ordered topics covering the technical skills, the tools, concepts implied by the
  responsibilities, supporting foundations, portfolio work, interview questions, communication
  and a role-specific practical task. Each topic carries a reason, a priority
  (High / Medium / Foundation) and an estimated time.
- **Learn Topic** generates a beginner-friendly lesson: overview, key points, a worked example,
  how it relates to this specific job, interview tips and a three-question quiz. Quiz answers
  are checked locally; your choices, score and completion date are saved.
- **Ask the Coach** answers a follow-up question about the lesson and saves the conversation
  with it.
- **What else do you want to learn?** creates a lesson and quiz for any topic you type, even
  one that is not in the advertisement.

**See where you stand**

- The dashboard opens with a compact welcome strip: today's date, a greeting for the time of
  day, a readiness ring combining checklist and plan progress across your open applications, and
  a single **Next up** line naming the application that most needs attention.
- Three headline metrics — opportunities, deadlines approaching and preparation due today —
  each with an icon and a hint line carrying the secondary number (how many are still open,
  the soonest deadline, tasks missed from earlier days).
- Before your first opportunity, the dashboard shows an illustrated three-step getting-started
  checklist instead of empty counters.

**Plan the days that are left**

- **Create My Schedule** turns the plan into dated sessions. Gemini may suggest the order and
  wording; **JavaScript assigns and validates every calendar date**, works from your daily
  preparation time, puts higher-priority topics first and never schedules anything after the
  application deadline.
- Because the dates are HirePath's work either way, **the schedule never depends on the API**.
  If Gemini is rate-limited or unreachable, the topics are ordered locally by priority
  (High, then Medium, then Foundation), the schedule is still created, and you are told plainly
  that Gemini was not involved.
- The schedule is built **from the preparation plan**, so the plan has to exist first. With no
  plan there is no schedule and Today's Plan is empty — the Coach now says so rather than
  leaving the button missing.
- Complete, reschedule, add or remove tasks, or regenerate the whole schedule.
- **Today's Plan** shows today's date, today's sessions, overdue sessions, completed sessions,
  a daily progress percentage and upcoming deadlines.

---

## The three required behaviours

### 1. GET SOMETHING FROM THE INTERNET

`gemini.js` uses `fetch()` to call the Gemini **Generate Content REST API** at
`https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`.

Five different live requests are made:

| Feature | What is sent | What comes back |
| --- | --- | --- |
| Analyse advertisement text | The pasted advertisement | Structured job JSON |
| Analyse advertisement image | Base64 image as `inlineData` | Structured job JSON |
| Build preparation plan | The whole advertisement + your profile | Ordered topic list |
| Generate lesson | Topic name + job context | Lesson + 3-question quiz |
| Ask the Coach | Your question + lesson context | A short plain-text answer |

Two further sources need **no key at all** and are used by the Look up screen (`lookup.js`):

| Source | Request | Returns |
| --- | --- | --- |
| Wikipedia | `GET en.wikipedia.org/api/rest_v1/page/summary/<title>` | Article summary + link |
| Wiktionary | `GET en.wiktionary.org/api/rest_v1/page/definition/<word>` | Parts of speech + definitions |
| Wikipedia search | `GET en.wikipedia.org/w/api.php?action=query&list=search` | Suggested titles when a lookup misses |

These are plain HTTP **GET** requests, so the application demonstrates both GET and POST against
live external APIs.

Gemini uses HTTP **POST**, but the requirement is still satisfied: the application receives live
information from an external API over the network, and the whole interface is driven by what
comes back. Where the API supports it, HirePath uses **structured output**
(`responseMimeType: "application/json"` plus a `responseSchema`) so the reply parses reliably.

### 2. REMEMBER SOMETHING

Everything is persisted to `localStorage` under the single key **`hirepath-v2`**: your profile,
every opportunity, application statuses, requirements, documents, notes, deadlines, study plans,
daily preparation tasks, completed lessons, quiz results, saved coach answers, follow-up dates
and your Gemini settings.

All of it survives a browser refresh. Reading is wrapped in `try`/`catch` and every field is
re-validated on load, so damaged data can never crash the application (see the corrupted-storage
test below).

### 3. REACT TO TIME

The current date and a 60-second timer drive the whole interface:

- Days remaining, "Closes today", "Closes tomorrow", "Closed 3 days ago".
- "Applied today", "Applied 6 days ago", "Follow-up due today", "Follow-up overdue by 2 days".
- Today's preparation tasks, and missed tasks from earlier days.
- Daily reminder banner and the once-a-day browser notification.

Urgency levels, recalculated from `Date.now()` every time:

| Days until deadline | Level |
| --- | --- |
| More than 14 | Normal |
| 8 – 14 | Soon |
| 3 – 7 | Warning |
| 0 – 2 | Urgent |
| In the past | Expired |

No countdown is ever stored and decremented. Every value is recomputed from `Date.now()` when
the page loads, whenever data changes, and every 60 seconds — so leaving the tab open overnight
shows the correct numbers in the morning. (The timer skips the rebuild while you are actually
typing in a form, so nothing you have half-written is lost; the labels catch up on the next tick.)

---

## Running the application

HirePath is a static site. It needs a server only because browsers restrict `file://` pages —
there is **no build command**.

**Python (already installed on macOS and Linux):**

```bash
cd hirepath && python3 serve.py
```

Then open <http://localhost:4180>.

`serve.py` is an ordinary static server with one difference: it sends
`Cache-Control: no-store`. Python's built-in `python3 -m http.server` sends no cache headers at
all, so browsers cache `app.js` and `styles.css` heuristically — you edit a file, reload, and
still get the old build, which looks like a broken page rather than a caching problem. If you
prefer the built-in server, use `python3 -m http.server 4180` and hard-reload
(**Cmd/Ctrl + Shift + R**) after every edit.

`index.html` also versions its assets (`app.js?v=2`), so a plain static host will serve fresh
files to returning visitors after a deploy. Bump the number when you change a file.

**Node, if you prefer:**

```bash
npx serve hirepath
```

**VS Code:** right-click `index.html` and choose *Open with Live Server*.

On first run you will see the onboarding screen. Enter your name (age is optional), your
qualification, field of study, current skills, how many minutes a day you can prepare, and the
time you would like your daily reminder. Everything is saved in your browser.

---

## Demo mode

**Demo mode is enabled by default**, so every AI feature works immediately with **no API key and
no internet connection**. It provides:

- a sample job analysis for pasted text,
- a different sample analysis for an uploaded image,
- a sample 10-topic preparation plan,
- a sample lesson with key points, a worked example and interview tips,
- a sample three-question quiz with explanations,
- sample answers from Ask the Coach and a sample session ordering.

Demo mode is a clearly-labelled offline fallback, shown on screen wherever it is active. When
Demo mode is **off**, HirePath only ever shows real Gemini responses — it never invents one.

Turn it off in **Settings → Gemini**.

**Demo content is always labelled.** Because a Demo lesson is the same template for every topic
(only the topic name changes), and because lessons are cached in `localStorage` once written,
HirePath records whether each lesson and plan came from Demo mode or from Gemini:

- a lesson written in Demo mode carries a **"Sample lesson · Demo mode"** badge and a note
  explaining that Gemini was not called;
- a real one carries **"Written by Gemini"**;
- the Prep Coach shows a banner whenever Demo mode is on, before you generate anything;
- once Demo mode is off, any lesson still holding sample text offers a one-click
  **"Rewrite this lesson with Gemini"**.

That last point matters: turning Demo mode off does **not** retroactively change lessons you
already generated. They were saved to `localStorage` as they were. Rewrite them, or delete the
topic and add it again.

---

## Connecting a Gemini API key

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey) and create an API key.
2. Open **Settings → Gemini** in HirePath.
3. Paste the key into **Gemini API key** and press **Save Gemini settings**.
4. Untick **Demo mode**.
5. Press **Test connection** to confirm the key works.

The default model is **`gemini-3.6-flash`** and can be changed in the same panel if your key uses
a different one. HirePath previously defaulted to `gemini-3.5-flash-lite`; a browser still
carrying that saved value is moved to the current default on load, because the old name now
returns 404.

**Errors are handled and explained in plain language**, never with a raw provider dump:

| Problem | What you see |
| --- | --- |
| 400 invalid request | Advertisement may be too long or empty, or the model name is wrong |
| 401 / 403 key problem | The key was refused — check it in Settings, or use Demo mode |
| 404 unknown model | Check the model name in Settings |
| 429 quota limit | Too many requests — wait a minute, or use Demo mode |
| 503 overloaded | *"Gemini is temporarily busy. Wait a moment and try again, or use Demo mode."* |
| Invalid or empty JSON | HirePath recovers the JSON if it can, otherwise asks you to try again |
| Output budget exhausted | Explains that the reply needed more room than was allowed, and suggests a shorter input |

**429 and 503 are retried automatically.** Both are temporary, so HirePath retries up to three
times with backoff (honouring `Retry-After` when the server sends it) and tells you what it is
doing: *"Gemini is rate-limiting requests. Waiting 3 seconds and trying again (attempt 2 of 3)."*
Only when all three attempts fail do you see an error. Everything else — a bad key, an unknown
model — fails immediately, because retrying those would only burn more of the quota.

Free API keys allow only a few requests per minute and a limited number per day. Images cost far
more than text, which is why HirePath downscales them before sending.
| Network failure / timeout | Check your connection and try again, or use Demo mode |

### A note on "thinking" models

Newer Gemini models reason internally before answering, and those hidden tokens are charged
against `maxOutputTokens`. A budget that is too small is spent before any visible text is
produced, which comes back as `finishReason: MAX_TOKENS` with an empty body — so the request
looks broken when the key is perfectly fine.

Every budget in `gemini.js` is therefore set generously (512 for the connection test, 6144 for a
study plan, 8192 for an advertisement or a lesson). If you switch to a model that reasons more
heavily and start seeing the output-budget message, raise `maxOutputTokens` for that call rather
than shortening your advertisement.

The API key is **never** included in an error message, written to the console, or put in a URL.

---

## Image analysis

On the **Upload advertisement image** tab you can add a screenshot or photograph of a job
advertisement.

- Accepted types: **PNG, JPG, JPEG, WEBP**. Maximum size: **4 MB**. Both are validated before
  anything is sent.
- The file is converted to base64 with `FileReader.readAsDataURL()`, then sent to Gemini as an
  `inlineData` part with the correct MIME type (`image/jpg` is normalised to `image/jpeg`).
- **It is downscaled first.** Gemini charges images by 768x768 tile, so a 300 dpi poster can cost
  several thousand tokens and exhaust a free key's per-minute budget in one request. HirePath
  resizes to a long edge of 1536 px and re-encodes as JPEG before sending — a 2480x3508 flyer
  becomes 1086x1536, which is roughly five times fewer tiles while the advertisement text stays
  readable. The panel shows the saving (for example `211 KB -> 24 KB sent`).
- You see a preview, the file name and size, a **Remove image** button and an
  **Analyse image with Gemini** button.
- **The image itself is never saved.** Only the extracted details and the original file name go
  into `localStorage`, which keeps stored data small — base64 images would fill the storage quota
  very quickly.

---

## Quickwiki and the Dictionary

The two keyless sources are split by purpose:

**Quickwiki** (navigation bar) searches **Wikipedia** — companies, tools, industry terms and
concepts. It returns a plain-language summary and a link to the full article, and when an
article misses it offers Wikipedia's own search suggestions as one-click chips. Every
**Words explained** term on an opportunity has a **Look up** button that jumps straight here.

**Dictionary** sits on the **Prep Coach** page, paired with the custom-topic card so the two
learning tools read as one group:

- "Your opportunities" spans the full row above.
- Below it, one row holds **What do you want to learn?** at about 70% and the **Dictionary** at
  about 30%, with a 24px gap.
- The two cards share **one height** (`align-items: stretch`), so their tops and bottoms line up.
  A long definition scrolls inside the dictionary card rather than dragging the row taller than
  the card beside it.
- Below 900px the dictionary stacks underneath the custom-topic card and each takes its natural
  height again, with the definition shown in full. It returns parts of speech, numbered
definitions and an example sentence.

Neither needs an API key, an account or a quota, so both keep working when Gemini is
rate-limited or has never been configured. Wiktionary is the primary dictionary (same Wikimedia
REST API as Wikipedia, so if one reaches the network the other does too), with
`api.dictionaryapi.dev` as an automatic fallback. Wiktionary returns wiki markup, which is
converted to plain text with `DOMParser` + `textContent` — nothing is ever inserted as HTML.

## Navigation

- **Navigation bar:** Dashboard, Prep Coach, Today's Plan, Quickwiki, + Add Opportunity.
- **Menu beside the logo:** **Your profile** (name, skills, study time, reminders) and
  **Settings** (Gemini key, Demo mode, export and import) as two separate entries.
  On screens narrower than 780px the same menu also carries the primary links, so the
  navigation bar hides entirely rather than collapsing into a second menu.

## Two ways to do everything

HirePath deliberately does not depend on Gemini. Every AI feature has a manual counterpart:

| Task | With Gemini | Without Gemini |
| --- | --- | --- |
| Preparation plan | **Build with Gemini** reads the whole advertisement and adds reasoning, foundations and interview topics | **Build from this job** turns the skills, qualifications and documents already recorded into an ordered plan, instantly and offline |
| Daily schedule | **Create with Gemini** asks for a suggested order and wording | **Create it myself** orders by priority. HirePath assigns the dates either way, so the result is the same shape |
| Today's tasks | **Plan your day → Generate from a job** turns a job's topics into dated sessions | **Plan your day → Write it myself** adds a task by hand, standalone or attached to a job |
| Topics to study | Generated from the advertisement | Type any topic into **What do you want to learn?** |
| Understanding jargon | Gemini's **Words explained** | **Look up** (Wikipedia + dictionary), no key required |

Where content came from is always labelled: a plan carries **Built by Gemini**,
**Built from this job** or **Demo sample**, and lessons carry the same distinction.

## Nothing is assumed for you

- **No default checklist.** A new opportunity starts with an empty checklist. Add the steps this
  application actually needs, one at a time — or press **Add suggested steps instead** once, and
  remove whatever does not apply.
- **No default topics.** There is no built-in topic list anywhere. Both the no-AI plan *and*
  Demo mode build topics only from what the advertisement itself records — required skills
  (High), preferred skills (Medium), qualifications and responsibilities (Foundation/Medium),
  the documents it asks for, and interview questions for that exact role. If a job lists
  nothing, nothing is invented; you add topics by hand.
- **Topics can be cleared.** Every topic list has a **Remove all topics** button, so anything
  left over from an earlier build (or a plan you no longer want) can be deleted in one step.
  Plans generated before this change are kept in `localStorage` until you remove them.

## API key security warning

> **This classroom version stores the API key in your browser. A public production application
> must use a secure server-side proxy.**

Anyone with access to your browser profile — or to a backup JSON you export — can read the key.
For a real deployment, keep the key on a server and have the browser call your own endpoint,
which then calls Gemini.

The key is **not** hard-coded anywhere in this repository. It exists only if you type it into
the Settings screen, and it is sent only in the `x-goog-api-key` request header.

---

## Notification limitation

> **Because this is a browser-only application, notifications are guaranteed only while the
> application is open. Reliable notifications while the browser is closed require a server and a
> push-notification service.**

What HirePath actually does:

- The browser's permission prompt appears **only** after you press **Enable Browser
  Notifications** in Settings — never on page load.
- While a HirePath tab is open, it checks the time every 60 seconds. At or after your chosen
  reminder time it shows **one** browser notification per day, listing today's tasks, missed
  tasks, closing deadlines and due follow-ups.
- An in-app reminder banner appears at the top of the application with the same summary, and
  genuinely urgent items (missed tasks, deadlines within a week, due follow-ups) show up even
  before the reminder time.
- If you block notifications, the in-app banner still works.

HirePath does not pretend to send notifications when it is closed, because it cannot.

---

## How data is stored

One key: **`hirepath-v2`**.

```json
{
  "profile": {
    "name": "", "age": "", "education": "", "fieldOfStudy": "",
    "skills": [], "dailyMinutes": 60, "reminderTime": "19:00"
  },
  "opportunities": [],
  "general": { "studyPlan": null },
  "settings": {
    "apiKey": "",
    "model": "gemini-3.6-flash",
    "demoMode": true,
    "notificationsEnabled": false
  },
  "lastNotificationDate": null
}
```

Each opportunity holds its own checklist, study plan (topics, lessons, quiz results, saved coach
answers) and schedule.

**Robustness**

- Parsing is wrapped in `try`/`catch`.
- Every field is re-validated and clamped on load: unknown statuses fall back to `Saved`, invalid
  dates become empty, oversized text is trimmed, malformed topics and tasks are dropped.
- If the stored JSON is unreadable, HirePath keeps a copy under
  `hirepath-v2-corrupt-backup`, starts a fresh notebook and tells you — it never shows a blank
  broken page.
- If the browser refuses to save (private browsing, full quota), you are told that the change was
  not stored rather than being left to discover it after a refresh.

**Export and import** are in **Settings → Your data**. Export downloads
`hirepath-backup-YYYY-MM-DD.json`; import validates the file, shows you what it contains and asks
for confirmation before replacing anything. *The export contains your API key, so keep the file
private.*

---

## Project structure

```
hirepath/
├── index.html      Static shell: onboarding, navigation, live regions, modal host
├── styles.css      Design system built from the logo's navy and teal, plus responsive rules
├── serve.py        Static server for development, with caching disabled
├── gemini.js       Gemini REST client, prompts, JSON schemas, error mapping, Demo mode
├── lookup.js       Wikipedia + Wiktionary/dictionary clients (no API key needed)
├── app.js          State, validation, routing, all views, time engine, reminders
├── README.md       This file
└── assets/
    └── hirepath-logo.png
```

The palette is sampled directly from the supplied logo: deep navy `#00244A`, bright teal
`#018B8F`, with light blue-grey backgrounds and soft grey text.

---

## Accessibility and security notes

**Accessibility**

- Semantic HTML: `header`, `nav`, `main`, `section`, `article`, `dl`, `fieldset`-style grouping.
- Every input has a real `<label>`; icons are `aria-hidden` and buttons carry accessible names.
- Visible keyboard focus everywhere (a 3px teal outline); the whole application — tabs, quizzes,
  checklists, the confirm dialog — is usable by keyboard alone, and a skip link jumps to the
  main content.
- `aria-live` regions announce API progress, save confirmations and validation errors.
- Status and urgency are never signalled by colour alone: every badge carries a word such as
  "Closes today", "2 days remaining" or "Missed".
- Progress bars expose `role="progressbar"` with current values; the modal uses `role="dialog"`,
  `aria-modal` and traps Tab.
- Respects `prefers-reduced-motion`.

**Security**

- **`innerHTML` is never used.** All user text and all Gemini output reaches the page through
  `textContent` / `createTextNode`. The DOM helper actively throws if anyone passes an `html`
  property, so the rule cannot be broken by accident.
- Job URLs are parsed with `new URL()` and only `http:` and `https:` links are stored or rendered;
  external links use `rel="noopener noreferrer"`.
- Image type and size are validated before reading.
- Deleting an opportunity, clearing all data, importing a backup, rebuilding a plan and
  regenerating a schedule all require confirmation.
- The API key is never logged, never placed in a URL and never shown in an error message.

---

## Manual test checklist

Work through these with Demo mode on unless a test says otherwise.

| # | Test | Expected result |
| --- | --- | --- |
| 1 | **First-time onboarding** — open in a fresh browser profile | Onboarding appears; submitting with an empty name shows an inline error; age can be left blank |
| 2 | **Refresh after onboarding** | Dashboard loads straight away with the correct greeting for the time of day |
| 3 | **Add job manually** — tab 3, role only | Saves and opens the detail page with a generated checklist |
| 4 | **Analyse a text advertisement** — tab 1 | Review screen appears with fields filled and the "Gemini can make mistakes" warning |
| 5 | **Analyse an image advertisement** — tab 2 | Preview, file name and Remove button appear; analysis fills the review screen |
| 6 | **Missing fields in the Gemini response** — paste fewer than 40 characters in Demo mode | Fields come back empty and a notice lists what was not found; nothing is invented |
| 7 | **Invalid API key** — Demo off, key `invalid`, press Test connection | Plain-language key error; the key never appears in the message |
| 8 | **Gemini 503** — in the console: `const f=window.fetch; window.fetch=()=>Promise.resolve({ok:false,status:503,text:()=>Promise.resolve('')})`, then Test connection | *"Gemini is temporarily busy. Wait a moment and try again, or use Demo mode."* Restore with `window.fetch=f` |
| 9 | **Demo mode** — disconnect from the internet | Every AI feature still works |
| 10 | **Deadline today** — set a deadline to today's date | Card shows "Closes today" in the urgent style |
| 11 | **Past deadline** — set a deadline to last week | Card shows "Closed N days ago" in the expired style |
| 12 | **Follow-up due** — set a follow-up date of today | "Follow-up due today" appears on the card, the dashboard and the reminder banner |
| 13 | **Complete a checklist item** | Progress updates immediately and survives a refresh |
| 14 | **Generate a complete study plan** | 5–10 ordered topics, each with a reason, priority and estimated time |
| 15 | **Generate a lesson** | Overview, key points, worked example, job relevance, interview tips and 3 questions |
| 16 | **Submit an incomplete quiz** | Blocked, naming exactly which questions are unanswered |
| 17 | **Complete a quiz, then refresh** | Score, chosen answers and explanations are still shown |
| 18 | **Create a schedule** | Sessions are dated from today, highest priority first, and never past the deadline |
| 19 | **Today's task display** | Today's Plan lists today's sessions, daily progress and any missed tasks |
| 20 | **Custom learning topic** — type "JavaScript promises" | A lesson and quiz are created for a topic not in the advertisement |
| 21 | **Empty profile skills** — clear skills in Settings | Skills panel explains nothing can be compared yet, with no false claims |
| 22 | **Exact skill matching** — profile has "JavaScript", job asks for "Java" | "Java" is listed as *not* in your profile |
| 23 | **Corrupted localStorage** — `localStorage.setItem('hirepath-v2','{broken')` then refresh | Fresh notebook, a message explaining what happened, a copy kept in `hirepath-v2-corrupt-backup`, no crash |
| 24 | **Export and import** | Export downloads a JSON file; importing it shows a confirmation summary and restores the data; an invalid file is rejected with a message |
| 25 | **360px viewport** | No horizontal scrolling, collapsed hamburger navigation, stacked cards, readable text |
| 26 | **Keyboard-only navigation** | Tab reaches every control with a visible focus ring; Enter and Space open cards; Escape closes dialogs |
| 27 | **Dashboard empty state** — delete every opportunity | Illustration plus a three-step getting-started checklist, with one primary "Add your first opportunity" button |
| 28 | **Dashboard with opportunities** | Tall banner is replaced by the progress strip and readiness ring; exactly three metric tiles; the only prominent "+ Add Opportunity" is in the navigation bar |
| 29 | **Coach with no opportunities** — open Prep Coach | Compact empty card with a branded icon (no emoji) beside a preview of what the Coach builds; "Add an opportunity" is a small secondary button, not a second primary CTA |
| 30 | **Coach custom-topic panel** — click a "Try:" chip | The chip fills the input and focuses it; "Write my lesson" creates the topic, lesson and quiz, then opens the lesson |
| 31 | **Output budget exhausted** — stub `fetch` to return `{candidates:[{finishReason:'MAX_TOKENS',content:{parts:[]}}]}` | The output-budget message appears, not "empty response"; a truncated JSON reply reports truncation rather than "invalid JSON" |
| 32 | **Demo content is labelled** — with Demo mode on, create a lesson | It shows a "Sample lesson · Demo mode" badge and explains Gemini was not called |
| 33 | **Demo lesson after switching to live** — turn Demo mode off, reopen that lesson | A "Rewrite this lesson with Gemini" button appears; using it replaces the text and the badge becomes "Written by Gemini" |
| 34 | **Large image is downscaled** — upload a poster-sized image | The panel shows `<original> KB -> <smaller> KB sent` with the new pixel size, and explains why |
| 35 | **429 is retried** — stub `fetch` to return 429 twice then a valid reply | The status line announces each retry and the analysis still succeeds on the third attempt |
| 36 | **Every route renders in both modes** — with Demo mode on and again off, visit Dashboard, Add, an opportunity, Coach, a job plan, general topics, Today's Plan and Settings | Every page renders content; none is blank. A helper that returns `null` must be appended with `append()`, never `appendChild()`, which throws on null |
| 37 | **Schedule works without Gemini** — with Demo mode off, stub `fetch` to return 429, then press Create My Schedule | The schedule is still created, ordered High to Foundation from today, and two messages explain that Gemini was unavailable |
| 38 | **No plan, no schedule** — open a job's Coach before building a plan | The page explains that the schedule and Today's Plan are built from the topics, so the plan comes first |
| 39 | **Look up works with no key** — clear the API key, turn Demo mode off, search "REST API" | Wikipedia and Dictionary cards both render; a missed article offers suggestion chips |
| 40 | **Plan without AI** — press "Build from this job (no AI)" | Topics come from the job's own required skills (High), preferred skills (Medium) and qualifications (Foundation), badged "Built from this job · no AI" |
| 41 | **Schedule without AI** — press "Create it myself (no AI)" | Sessions are dated from today, highest priority first, none past the deadline |
| 42 | **Own task** — add a task on Today's Plan | It appears in today's list and in the progress count; unlinked tasks show "My own task" and survive a refresh |
| 43 | **Empty checklist** — save a new opportunity | The checklist is empty; suggested steps are added only when you press the button |
| 44 | **No default topics in Demo mode** — with Demo mode on, build a plan for two different jobs | Each plan reflects that job's own skills and role; the old fixed ten-topic frontend list never appears |
| 45 | **Dictionary on the Coach** — type "hospitality" and press Define | Parts of speech and definitions appear, with no Gemini call and no key |
| 46 | **Quickwiki** — search "Hospitality industry" | A Wikipedia summary and article link appear; the page holds no dictionary |
| 47 | **Menu beside the logo** — press the hamburger | Your profile and Settings appear as separate entries; at 360px the same menu also lists the primary links and the navigation bar is hidden |
| 48 | **Dictionary position** — open the Prep Coach on a wide screen | The dictionary sits in the top-right corner and stays in view while scrolling; below 1000px it moves under the plan |
| 49 | **Remove all topics** — open a topic list and press Remove all topics | The confirmation names the count, and confirming empties the list without touching opportunities or the schedule |
| 50 | **Paired learning tools** — open the Prep Coach on a wide screen | "Your opportunities" spans the full row; below it the custom-topic and Dictionary cards sit at roughly 70/30 with a 24px gap and matching heights. Under 900px the Dictionary stacks below |
| 51 | **Equal heights with a long entry** — define a word with many senses, such as "set" | Both cards stay the same height and their bottoms line up; the definition scrolls inside the dictionary card |
| 52 | **Both ways to plan today** — open Today's Plan | "Plan your day" offers *Write it myself* and *Generate from a job*; generating builds the chosen job's schedule from today and it appears in today's list |
| 53 | **Wording** — visit every page in both Demo modes | No rendered text, placeholder, aria-label or title uses the words "AI" or "API" |
| 54 | **Personal task completed** — add your own task on Today's Plan and tick it off | Today's Plan still renders; "Completed today" lists it as "Your own task" rather than crashing on a missing job |
| 55 | **Personal tasks with no jobs saved** — add a task before saving any opportunity | The dashboard shows "Your tasks for today" underneath the getting-started panel |
| 56 | **Copy and spacing** — read any page | Help text is one short line per control, and no page carries an explanatory paragraph longer than a sentence or two |
| 57 | **Unsaved draft does not trap the page** — analyse an advertisement, leave without saving, then return to Add Opportunity | The three input tabs are still shown above the draft; picking one asks before discarding and returns you to the paste box |
| 58 | **No stale files** — edit `app.js`, reload | The change appears without a hard reload when served by `serve.py` |
| 59 | **Default model** — clear all data, open Settings | The model field reads `gemini-3.6-flash`, and a browser still holding the old `gemini-3.5-flash-lite` is migrated to it on load |

### Verified during development

Tests 1–26 were run against this build with `python3 -m http.server`. Confirmed live:

- Onboarding saved the profile and the dashboard greeted the user by name.
- Text analysis → review → save produced a 12-item checklist (8 standard plus 4 documents).
- A 10-topic plan and a 10-session schedule were generated; the last session landed exactly on
  the deadline and none fell past it.
- The quiz refused an incomplete submission, then scored 2/3 and persisted across a reload.
- Ask the Coach saved its answer with the lesson.
- Deadline labels rendered as "Closes today", "Closed 3 days ago", "2 days remaining",
  "Applied 6 days ago" and "Follow-up due today".
- "Java" did not match the profile's "JavaScript".
- A live request with an invalid key returned a safe 400 message; simulated 503 and network
  failures produced their intended messages.
- Corrupted storage recovered into a fresh notebook with the backup kept and no console errors.
- Import replaced the data after confirmation; a non-JSON file was rejected.
- An uploaded PNG was analysed and saved with only its file name — no base64 in storage.
- At 360px there was no horizontal scroll and the hamburger menu worked.
- Tabbing showed a 3px teal focus ring on every control.
