---
type: spec
created: 2026-04-26
project: neuro-vault-analytics
status: approved
source: ~/Obsidian/Tasks/Add usage analytics workflow for neuro-vault.md
tags: [mcp, obsidian, analytics, product]
---

# Add usage analytics workflow for neuro-vault

> **Source.** This spec is the canonical record of the design first written in the Obsidian task `Tasks/Add usage analytics workflow for neuro-vault.md` (created 2026-04-26). Wiki-links from the original have been rendered as plain text or external links; everything else is preserved verbatim.

Claude Code plugin `neuro-vault-analytics` що ставиться однією командою (`/plugin install ...`) і додає skill `/analyze-vault-usage [period]` + CLI `nv-analytics` у пакеті. Skill читає conversation-records з [Claudian](https://github.com/iansinnott/claudian) (Obsidian-plugin що використовується як основний chat-frontend) за період і видає structured нотатку з паттернами використання, прогалинами в MCP-фічах і структурі vault, та конкретними actionable suggestion-ами. Це meta-tooling: дисципліна продакт-рішень для neuro-vault — гіпотези про корисність нових фіч валідуються даними, а не інтуїцією.

**Архітектура — гібрид:** CLI робить deterministic частину (discover → parse → filter → aggregate → sample), Claude через skill робить тільки LLM-критику + написання markdown-нотатки. Числові агрегати лишаються детерміністичними; токени LLM-а витрачаються тільки там де він реально цінний (паттерни, dead ends, suggestions).

## Контекст

Зараз пріоритет фіч у neuro-vault обирається інтуїтивно: я згадую кейси що боліли, формулюю гіпотезу, реалізую. Проблеми такого підходу:

- **Selection bias** — пам'ятаю болі, не пам'ятаю мовчазних втрат токенів.
- **Hindsight reasoning** — здається що X буде корисно, але це гіпотетично, без даних.
- **Slow loop** — між «здалося» і «зрозумів чи спрацювало» — тижні без feedback signal.

Claudian (Obsidian-plugin що я використовую як chat-frontend) вже зберігає для кожної conversation усе потрібне: token usage з cache breakdown, model, тривалість, прив'язку до `currentNote`, плюс повний message log з усіма tool calls (включно з subagent-traces — окремі sidecar JSONL). Тобто інфраструктура збору вже є — треба лише шар аналізу.

З цим workflow loop стає: **дані → паттерн → задача → реалізація → ефект на тих самих метриках**. Це не лише швидше, це **правильніше** — рішення базуються на тому, як ти реально працюєш з vault, а не на тому, як уявляєш що працюєш.

## Scope

### Поставка

Один git-репо `neuro-vault-analytics` (`~/git/neuro-vault-analytics/`, sibling до `~/git/neuro-vault/`), spakovaniy як **Claude Code plugin** + bundled CLI. Stack як у neuro-vault: Node 20+, TypeScript, tsup, tsx, vitest, ISC.

Структура репо:

```
neuro-vault-analytics/
├── .claude-plugin/
│   └── plugin.json            ← маніфест плагіна (name, version, description)
├── skills/
│   └── analyze-vault-usage/
│       └── SKILL.md           ← skill-wrapper, кличе CLI через Bash:
│                                   bash ${CLAUDE_PLUGIN_ROOT}/dist/cli.js --period {{period}}
├── src/                       ← TS-код CLI (discover, parse, filter, aggregate, sample)
├── dist/                      ← збілжений CLI, чекіниться у git (no post-install build)
├── test/
│   ├── fixtures/              ← anonymized real Claudian records
│   └── *.test.ts
├── package.json               ← bin: { "nv-analytics": "./dist/cli.js" }
├── tsup.config.ts
├── vitest.config.ts
├── tsconfig.json
├── eslint.config.js
└── README.md
```

**Установка для користувача:** `/plugin install AlexMost/neuro-vault-analytics` (через GitHub або локальний marketplace) — skill та CLI з'являються разом, нічого додатково копіювати не треба.

CLI runtime триг (також доступний standalone, бо binary живе в `${CLAUDE_PLUGIN_ROOT}/dist/cli.js`):

```
nv-analytics --period 7d [--vault ~/Obsidian] [--sample-size 15] [--format json|text]
```

За замовчуванням `--format json` (skill його споживає). `--vault` auto-detect: якщо cwd має `.obsidian/` — беремо його. Output: один блок `AnalyticsReport` JSON у stdout (skill його парсить і передає LLM-у).

### Source: Claudian conversation records

Claudian зберігає conversation у **трьох локаціях** (підтверджено читанням `main.js`, версія `claudian` plugin, дата 2026-04-26):

1. **Metadata** — `{vault}/.claude/sessions/{convId}.meta.json`. Один файл на conversation. Містить:
   ```jsonc
   {
     "id": "conv-1777208861415-vrevww6ht",
     "title": "Find MCP development tasks",
     "createdAt": 1777208861415,
     "updatedAt": 1777209062879,
     "currentNote": "Tasks/Add usage analytics workflow for neuro-vault.md",
     "sessionId": "f94b8339-...", // → ключ до SDK-сесії
     "sdkSessionId": "f94b8339-...",
     "usage": {
       "model": "opus",
       "inputTokens": 1,
       "cacheCreationInputTokens": 621,
       "cacheReadInputTokens": 49917,
       "contextWindow": 200000,
       "contextTokens": 50539,
       "percentage": 25,
     },
   }
   ```
2. **Main message log + top-level tool calls** — `~/.claude/projects/{encoded-vault-path}/{sessionId}.jsonl`. Стандартний **Claude Code SDK JSONL** формат (user/assistant turns з `tool_use` / `tool_result` блоками). `encoded-vault-path` = vault path з `/` → `-` (наприклад `/Users/amostovenko/Obsidian` → `-Users-amostovenko-Obsidian`).
3. **Subagent traces** — `~/.claude/projects/{encoded-vault-path}/{sessionId}/subagents/agent-{agentId}.jsonl`. Окремі sidecar-и на subagent dispatch. Парсити через ту ж SDK-схему.

**Discovery алгоритм:**

- glob `{vault}/.claude/sessions/*.meta.json` → metadata-список
- для кожного — join по `sessionId` з `~/.claude/projects/{encoded-vault-path}/{sessionId}.jsonl`
- якщо існує `~/.claude/projects/{encoded-vault-path}/{sessionId}/subagents/` — підтянути всі sidecar-и

**Ключові поля для аналітики:**

- `createdAt`/`updatedAt` (з `.meta.json`) → session duration.
- `currentNote` → anchor, з якої нотатки стартувала сесія.
- `usage.contextTokens`, `usage.percentage` → load на context window.
- `usage.cacheReadInputTokens / (cacheRead + cacheCreation + input)` → cache-hit ratio.
- `usage.model` → opus vs sonnet ratio.
- SDK JSONL `tool_use` блоки → main-agent tool sequence.
- Subagent sidecar-и → traces підзадач, той самий tool_use формат.

**На момент написання у vault уже є 19 `.meta.json` + 89 SDK-сесій** — реальних даних більше ніж достатньо для fixtures.

### Алгоритм

Кроки 1-4 виконує **CLI** (детерміністично, в TypeScript). Кроки 5-6 виконує **skill** (LLM + Obsidian-skills для запису нотатки).

1. **Discovery (CLI)** — glob `{vault}/.claude/sessions/*.meta.json`, фільтр за period; для кожного — join з SDK JSONL у `~/.claude/projects/{encoded-vault}/{sessionId}.jsonl` + усі sidecar-и в `.../{sessionId}/subagents/*.jsonl`. Якщо SDK файл відсутній — записати у `warnings`, не падати.
2. **Filter (CLI)** — лишити тільки сесії що стосуються neuro-vault / vault-роботи. Heuristics:
   - Будь-який `tool_use` з `name` що матчить `mcp__neuro-vault-mcp__*` у main session JSONL або в subagent sidecar.
   - `currentNote` непорожній.
   - Wiki-link pattern (`\[\[.*\]\]`) у user-message text.
3. **Extract (CLI)** — для кожної релевантної сесії — `SessionSummary`:
   - Session-level: id, title, duration (`updatedAt - createdAt`), model, contextTokens%, cache-hit ratio, currentNote.
   - Tool sequence: усі `tool_use` з main + sidecars, у хронологічному порядку, `{ name, args_summary, result_size, status, source: 'main'|'subagent:<id>' }`.
   - Subagent-stats: кількість, бюджет (tool calls per subagent), success rate.
   - Outcome marker (`completed` / `dead_end` / `abandoned`) — з останнього повідомлення.
4. **Aggregate (CLI)** — обчислити:
   - Top-N tools by call count.
   - Найчастіші підпослідовності з 2-3 tool calls (фокус на повторні reads — кандидати для query).
   - Tools що не використовувалися ні разу (порівняно зі списком expected MCP tools).
   - Tools з найбільшим avg result size (кандидати на projection).
   - **Stale-path errors** — окрема категорія: коли `search_notes` повертає шлях, а наступний `read_note` падає `not found` (див. задачу `Fix stale paths in search_notes results` як reference-кейс).
   - Розподіл сесій за currentNote-anchor.
   - Cache-hit distribution.
   - Subagent budget distribution — avg/p95 tool calls per subagent dispatch.

   **Вихід CLI** — один JSON-блок (`AnalyticsReport`) у stdout: `{ period, stats, aggregates, samples: SessionSummary[], warnings }`. `samples` — представницька вибірка ~10-15 сесій (різні часи, довжини, tool-mix), щоб skill міг показати їх LLM-у без читання усіх записів.

5. **LLM-критика (skill)** — skill читає JSON, передає агрегати + samples у структурований prompt (зберігається у `SKILL.md` або поряд як `prompt.md`). Просити:
   - Виявити паттерни «агент робив N кроків там де могло б бути 1» з конкретними прикладами.
   - Виявити dead ends — де агент намагався і не зміг.
   - Розкласти suggestions у три категорії: **mcp-feature** / **vault-structure** / **prompt-tuning** (CLAUDE.md / AGENTS.md).
   - Кожна suggestion з: confidence (low/med/high), evidence (скільки сесій підкріплюють), proposed action (конкретний крок).
6. **Output (skill)** — записати нотатку через obsidian-skills у `Inbox/neuro-vault-usage/YYYY-Www.md`.

### Output: формат нотатки

Шлях: `Inbox/neuro-vault-usage/YYYY-Www.md` (наприклад `2026-W17.md`).

Це **inbox-item, не permanent record** — після прочитання і витягування корисних задач у `Tasks/` нотатку можна видалити (або архівувати, якщо хочеться історії). Якщо через 2-3 місяці виявиться що багато з них треба зберігати — переїдуть у permanent location окремою задачею.

Frontmatter:

```yaml
---
type: review
created: 2026-04-26
period_start: 2026-04-19
period_end: 2026-04-26
sessions_total: 47
sessions_vault: 23
tags: [analytics, neuro-vault, ephemeral]
---
```

Структура тіла:

```markdown
# Usage analytics 2026-W17

## TL;DR

2-3 речення про головне за тиждень.

## Numbers

| Metric | Value |
| Sessions touching vault | 23 / 47 |
| Total tool calls | 312 |
| Avg tool calls per session | 13.6 |
| Top tools | search_notes (87), read_note (62), get_tag (24)... |
| Unused tools | find_duplicates, get_stats |

## Patterns observed

### High-value patterns

- **`get_tag` → `read_property × N` (12 occurrences)** — agent fetched tag, then iterated reading properties. Class candidate for query tool.
  - Example sessions: ...
- ...

### Dead ends

- 3 sessions where agent tried to find notes by date range and failed with workarounds.
- ...

## Suggestions

### MCP features

- [HIGH | 12 sessions] **Implement query tool** — directly addresses N+1 read_property pattern. Already in backlog as `Add query tool to neuro-vault`.
- ...

### Vault structure

- [MED | 4 sessions] **Standardize `status` enum across Tasks** — agent saw inconsistent values (todo/Todo/TODO).
- ...

### Prompt tuning

- [LOW | 2 sessions] **AGENTS.md hint about reading reflections before topical questions** — twice agent answered without checking reflections.

## Raw aggregates

<details>
N+1 sequences, tool counts, etc — для допитливих або наступного аналізатора.
</details>
```

### Поведінка

- **Empty period** — нотатка все одно створюється з honest «sessions_vault: 0, no patterns observed». Це **валідний** результат, не помилка.
- **Privacy** — все локально. Claudian-records не покидають машину; CLI ніяких HTTP-викликів не робить (LLM-крок робить тільки skill, через ту саму Claude Code сесію). Промпти/відповіді в нотатці у vault — той самий vault що й records, trust boundary не змінюється. Але acknowledge: зразки промптів у нотатці — фактично читабельні цитати власних думок.
- **Sampling** — якщо понад N сесій (default 50), CLI відбирає репрезентативний sample (різні часи доби, різні довжини, різні tool-mix). Параметр конфігурується через `--sample-size`.
- **Vault auto-detection** — CLI бере vault з `--vault`, або з `cwd` (якщо `.obsidian/` поряд), або падає з зрозумілою помилкою.
- **Missing SDK file** — якщо `.meta.json` є а SDK JSONL — ні, сесія попадає у `warnings`, але не блокує запуск.
- **Idempotency** — повторний запуск на ту саму неділю **перезаписує** нотатку (з warning в console). Це нормально — аналіз може покращуватись, conversation records незмінні.

### Out of scope (MVP)

- **Інші джерела даних окрім Claudian** (raw Claude Code transcripts, інші chat-frontends). Claudian — primary і єдиний у MVP. Якщо колись поміняю frontend — окрема задача.
- **Auto-creation of tasks** з suggestion-ів — лиш список у нотатці, ти руками створюєш `Tasks/...` за тим, що дійсно резонує. Запобігає шуму і false-confidence.
- **Schedule / cron** — поки тільки manual trigger. Поставити на schedule можна після того як кілька разів зробиш руками і зрозумієш чи воно дійсно полезне на тиждень-ритм.
- **Cross-period порівняння** («цього тижня менше N+1 ніж минулого») — окрема задача після MVP.
- **Структуровані metrics поверх MCP** (NDJSON логи всередині neuro-vault) — це approach B, переходимо коли MVP покаже чого не вистачає в Claudian-records.
- **Privacy filtering / redaction** — все одно все локально, redaction не критичний у MVP.
- **A/B порівняння до/після випуску фічі** — окремий tooling, далекий горизонт.

## Майбутні кроки (поза цим тікетом)

1. **Schedule** через skill `schedule` — пускати щонеділі автоматично, нотатка з'являється сама.
2. **Cross-period diff** — окремий skill `/compare-vault-usage W16 W17` що показує дельту: які паттерни ослабли (фіча допомогла?), які з'явилися.
3. **Structured metrics** в neuro-vault MCP — NDJSON-лог tool calls у `~/.neuro-vault/metrics/` для типізованих агрегатів (latency P95, payload sizes) яких в транскриптах немає.
4. **Outcome tracking** — після випуску фічі (наприклад query) метрики автоматично перевіряють чи зник цільовий паттерн.

## Тести

Vitest, fixtures з реальних Claudian-записів. CLI має покриття deterministic-частини; LLM-крок і написання нотатки перевіряється manual smoke.

- [ ] Fixtures (`test/fixtures/`) з реальних Claudian conversation records (5-10 штук, anonymized якщо треба) — пара `.meta.json` + SDK JSONL + (де треба) subagent sidecars:
  - Conversation з stale-path error (search → read fail) — **аналізатор має ідентифікувати**.
  - Conversation з N+1 read_property pattern — **аналізатор має запропонувати query tool** (це валідатор гіпотези `Add query tool to neuro-vault`).
  - Не-vault conversation — має бути відфільтрована.
  - Heavy session (>50% context) — має з'явитися у numbers.
  - Subagent-heavy session — `tool_use` блоки з sidecar-ів трекаються правильно.
  - Сесія де `.meta.json` є а SDK JSONL відсутній — попадає у `warnings`, не падає.
- [ ] Filter тести: різні комбінації `currentNote` / tool calls / wiki-links → правильна класифікація vault vs non-vault.
- [ ] Aggregator тести: tool sequences, subagent budget, cache-hit ratio розраховуються коректно.
- [ ] Sampling тест: при > N сесій вибирається representative sample (різні часи / довжини / tool-mix).
- [ ] CLI smoke: `nv-analytics --period 7d --format json` на fixture-vault → валідний JSON що матчиться `AnalyticsReport` schema.
- [ ] Manual smoke на реальних conversations за тиждень — ручне читання suggestion-ів, чи вони змістовні чи galimatias.
- [ ] Repeat-run idempotency — другий запуск skill-а перезаписує нотатку без помилки.

## Definition of Done

- [ ] Plugin `neuro-vault-analytics` встановлюється однією командою (`/plugin install AlexMost/neuro-vault-analytics` або з локального marketplace) — skill і CLI з'являються разом
- [ ] `.claude-plugin/plugin.json` валідний; `dist/cli.js` чекіниться у git (post-install build не потрібен)
- [ ] Skill `/analyze-vault-usage` запускається і кличе CLI через `${CLAUDE_PLUGIN_ROOT}/dist/cli.js`
- [ ] CLI `nv-analytics` працює standalone (`--format json` / `--format text`), має `--help`
- [ ] Шлях до Claudian conversation store задокументований у README плагіна — щоб через місяць не довелось знову його шукати, і наступний контриб'ютор побачив
- [ ] Output нотатка пишеться у `Inbox/neuro-vault-usage/YYYY-Www.md` з правильним frontmatter (через obsidian-skills, а не raw write)
- [ ] LLM-prompt критики живе у `skills/analyze-vault-usage/SKILL.md` (або поряд як `prompt.md`) — легко ітерувати без перебілжування CLI
- [ ] Vitest зелений; fixtures покривають кейси зі списку тестів
- [ ] Manual smoke на реальних Claudian-records принаймні за 2 тижні — suggestion-и проходять sanity check (не galimatias)
- [ ] Перший запуск зроблено вручну, перевірено що нотатка з'являється в Inbox і добре читається

## Меми, які варто пам'ятати

- **«Нічого критичного» — теж результат.** Якщо тиждень показав «нічого важливого» — це здоровий сигнал, не привід шукати щось щоб відзвітувати. Інакше аналізатор перетворюється на машину виправдання задач.
- **N=23 — це anecdotes, не статистика.** Не over-react на одиничні паттерни.
- **Аналізатор — теж промпт з біасами.** Час від часу перечитуй output руками і онови критерії в промпті, якщо систематично пропускає клас проблем.

## Connections

- `neuro-vault` (sibling repo) — головний бенефіціар цих insights.
- Backlog task `Add query tool to neuro-vault` — перша задача, яку MVP-аналітика повинна або підтвердити («так, N+1 read_property — реальний паттерн»), або поставити під сумнів («ні, такого паттерну майже немає в records»). Гарний first test для самого аналізатора.
- Backlog task `Fix stale paths in search_notes results` — bug, знайдений при ручному аналізі одного record-а. MVP-аналітика має ідентифікувати такі патерни на масштабі автоматично; цей кейс — фіксований fixture для перевірки.
- Backlog item `Build Vault Operations MCP Tools` — master roadmap, який цей workflow має інформувати.
