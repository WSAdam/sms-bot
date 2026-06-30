# sms-bot — User Stories

These stories are reverse-engineered from the shipped app and trace back to the
goals in [spec.md](spec.md). They describe the existing behavior of the
production sms-bot system, not new work. Three roles appear throughout. The
**operator** is Adam, who runs the dashboard, tunes the live gates, reads the
nightly report, and fires manual cron/admin triggers to recover the pipeline.
The **lead** is the prospect — a cold reservation lead a ReadyMode dialer
exhausted — who gets texted, replies, books, opts out, and ultimately gets
dialed and counted. The **sales rep** is the human who receives the warm
"ODR – Appointments" dialer call and whose productivity the report measures.
Every story below names exactly one of these three roles and one demoable
capability; reference data such as gates, validators, and aggregators is folded
into the story it serves. The prose ends here — everything after the first `##`
heading is a capability area.

## Lead intake & first SMS

- As a **lead** who a dialer called 40+ times without connecting, I want to receive a first text through ReadyMode posting `/trigger/readymode`, so that I get a chance to engage by SMS instead of being dropped.
- As a **lead**, I want every inbound trigger to pass the ordered gate stack (attempts ≥ 40, then DNC, then rate limit) before any send, so that I am only texted when I am genuinely an eligible, exhausted lead.
- As an **operator**, I want the global daily cap of 100 texts (Eastern Time, one shared counter) reserved atomically before each Bland send and released if the send fails, so that we never overshoot the cap and a transient error never silently burns a slot.
- As a **lead**, I want a 30-day per-phone rate limit that reserves my slot before the send and releases it on failure, so that I am never re-texted inside the window yet never locked out by a Bland hiccup.
- As a **lead**, I want my first message enriched from my Quickbase reservation (lookup by ResID) and sent through the Bland pathway opener, so that the text is personalized to my booking instead of generic.
- As a **lead**, I want to be assigned a stable A/B variant on first contact, so that the messaging experiment I am in stays consistent across my conversation.
- As an **operator**, I want `/trigger/manual` with an `override` toggle to fire a real or gatekeeper-bypassing test SMS to a chosen phone, so that I can validate the send path end to end without waiting for a live dialer trigger.
- As an **operator**, I want `/trigger/test-sms` to send raw text through `/v1/sms/send` bypassing the pathway, so that I can sanity-check Bland connectivity with arbitrary copy.

## Conversation handling & history

- As a **lead**, I want each message I send or receive posted to `/sms-callback/conversation/:phone/:callId` and stored keyed by my phone and call, so that my full SMS conversation is preserved and searchable.
- As an **operator**, I want the callId→phone index written before any message is stored, so that conversation lookups by call never fail on a race.
- As an **operator**, I want a `/search` UI and the `/api/conversations/search2` endpoint to find a lead's conversation by phone with a database-side filter, so that I can read any thread without scanning the whole collection.
- As an **operator**, I want a `/review` page that surfaces the day's responses, so that I can eyeball how leads are replying to the bot.
- As an **operator**, I want seed and backfill endpoints (`/sms-callback/seed-conversation(s)`, `/backfill-conversations`, `/list-today`) to pull Bland history into our store, so that I can recover transcripts that arrived before the webhook was wired or that the webhook missed.

## Opt-out & DNC

- As a **lead**, I want texting `STOP` (via `/sms-callback/stop`) to mark me Do-Not-Call across all five ReadyMode domains and set a local opt-out flag, so that I stop receiving texts everywhere at once.
- As an **operator**, I want the local DNC opt-out recorded before any error is returned, so that a guest who opts out is suppressed even if a downstream domain DNC call fails and the endpoint returns 502.
- As a **lead**, I want my DNC status (Quickbase plus the local flag) checked as a gate before any first SMS, so that I am never texted after opting out.

## Appointment booking & scheduling

- As a **lead**, I want to book an appointment through `/cal/schedule`, so that I get a real calendar slot for a sales rep to call me.
- As an **operator**, I want `/cal/available-times` to generate future-only 15-minute slots within business hours, so that a lead is only offered bookable times.
- As a **lead**, I want my booking to scrub me from my current source domain and write a scheduled re-injection for the appointment time, so that I am dialed at the moment I chose rather than randomly.
- As an **operator**, I want every appointment time rejected at the write site unless it carries an unambiguous timezone marker, so that a TZ-naive time can never fire hours early.
- As a **lead**, I want my Cal.com booking to fall back to a scheduled injection even if the calendar write fails, so that I still get dialed at my appointment time when Cal.com errors.
- As an **operator**, I want `/cal/delete-scheduled-injection` to cancel both the Cal.com booking and the pending injection, so that a cancelled appointment does not later trigger a dial.

## Scheduled-injection sweep (booked → dialer)

- As a **lead** with a booked appointment, I want a sweep to inject me into "ODR – Appointments" the minute my appointment time arrives, so that a human rep calls me on time.
- As an **operator**, I want the every-minute sweep paused by default behind a live `scheduledInjectionSweepEnabled` kill-switch, so that a recovering sweep can never fire a backlog of stale injections before I have drained it.
- As an **operator**, I want a 72h dedup guard inside the injection handler that skips and records any phone already injected recently, so that a lead is never double-dialed.
- As an **operator**, I want the sweep to write the injection-history record and delete the pending doc in one atomic batch, so that an injection is never half-recorded.
- As an **operator**, I want a ReadyMode inject judged by the response body rather than the HTTP code, so that an `Accepted:false` rejection at HTTP 200 surfaces loudly instead of phantom-succeeding.

## Talk-now / immediate injection

- As a **lead** who says I want to talk now, I want `/sms-callback/bland-talk-now` to inject me into the ODR dialer immediately, so that a rep calls me right away instead of at a future slot.
- As an **operator**, I want talk-now to delete any companion scheduled-injection doc after firing, so that the sweep does not later re-dial the same lead.
- As an **operator**, I want talk-now to leave the pending marker in place when the ReadyMode inject fails, so that the sweep retries the injection rather than dropping the lead.

## Dialer disposition & recycle

- As a **sales rep**, I want a `sale`/`booked` disposition to exit the lead from the funnel with no further action, so that a closed lead is never re-dialed or recycled.
- As a **lead** in the ODR campaign, I want a non-sale disposition to scrub me from ODR and return me to my original source domain, so that I rejoin the normal dialer rotation after the appointment call.
- As a **lead** in any other campaign, I want a non-sale disposition to scrub my source and recycle me into the mapped target domain, so that I keep moving through the dialer topology correctly.
- As an **operator**, I want `/sms-callback/return-to-source` to scrub ODR and inject me back to my original source, so that I can manually complete a return that a disposition missed.

## ReadyMode call-log pull & "answered" tracking

- As an **operator**, I want a daily `readymode-daily-pull` cron to log into the ReadyMode portal and page yesterday's Appointments call log into `calldispositions`, so that I have a durable per-call record including duration.
- As an **operator**, I want the pull restricted to the Appointments report campaign (id 81), so that the daily import is one cheap page of our own leads rather than every campaign.
- As a **sales rep**, I want a call counted "answered" only when it had a real conversation — a non-No-Answer disposition lasting ≥ 60s, or a "No Answer" that ran ≥ 180s — so that my answered count reflects genuine connects, not mis-dispositions.
- As an **operator**, I want the per-ET-day answered counter applied as deltas (re-imports move a count between days, never double-count), so that the report's "calls answered" stays accurate across re-pulls.
- As an **operator**, I want the pull to self-heal past ReadyMode's single-session lockout via a reactive `logout_other_sessions` takeover, so that a stale session does not silently kill the morning import.

## QuickBase sale matching (activations)

- As an **operator**, I want a daily `daily-qb-sale-match` cron to pull today's Quickbase booking report and mark any phone whose appointment fired within the last 7 days as an activation, so that closed sales are attributed to the funnel.
- As an **operator**, I want activation dedup written transactionally, so that the same sale is never counted twice across re-runs.
- As an **operator**, I want `/api/sales/record` to match a single phone's sale on demand, so that I can attribute a sale manually without waiting for the nightly cron.
- As an **operator**, I want sales that fall outside the 7-day window captured in `salesoutsidewindow` and claimable via `/api/sales/claim-outside-window`, so that I can manually credit a legitimate late sale while preserving its original context.

## Nightly email report

- As a **sales rep**, I want a nightly Eastern-Time Postmark email led by the Yesterday funnel (SMS sent → calls scheduled → calls answered → bookings), so that I see the prior day's productivity at a glance over the week-to-date and lifetime totals.
- As an **operator**, I want the report fired at 6:15 AM ET, after the sale-match and ReadyMode pull have run, so that yesterday's answered and bookings numbers are settled rather than empty.
- As an **operator**, I want "calls answered" and "bookings" flagged ⚠ unverified when the feeding pull did not run and succeed that morning, so that a missing counter is never read as a real zero.
- As an **operator**, I want `/api/report/nightly?force=1` to test-send past the enabled kill-switch without stamping the once-per-day marker, so that I can preview the email without suppressing the real send.
- As an **operator**, I want the report send guarded by a transactional once-per-day claim, so that concurrent fires email the report exactly once.

## Operational dashboard & drill-ins

- As an **operator**, I want a `/dashboard` of top-line stats and daily activity, so that I can see the funnel's health without reading logs.
- As an **operator**, I want drill-in endpoints for Unique Guests (`/api/guests/list`), Activated Guests (`/api/dashboard/activated`), and Answered Guests (`/api/dashboard/answered`) backed by write-side aggregators, so that I can page into any stat card without scanning a collection.
- As an **operator**, I want an `/injections` page showing the pending scheduled-injection queue and history, so that I can see exactly what is about to be dialed.
- As an **operator**, I want `/api/appointments` to list a lead's appointment-tagged conversation history, so that I can verify a booking against the transcript.
- As an **operator**, I want `/api/dashboard/stats` and `/api/dashboard/drill` to serve the card counts and their detail rows, so that the dashboard's numbers always reconcile to underlying records.

## Live gates & cron configuration

- As an **operator**, I want `/api/config/gates` to read and update the attempts threshold, daily SMS cap, rate-limit window, sale-match window, and the sweep kill-switch, so that I can tune the pipeline live without a redeploy.
- As an **operator**, I want `/api/config/cron` to edit the report recipients, subject, report id, and enabled flags, so that I can change reporting behavior without a code change.
- As an **operator**, I want the env-driven inbound-window gate state surfaced read-only in the gates response, so that I can see today's effective send window even though it is not live-editable.

## Manual cron triggers & recovery

- As an **operator**, I want `/api/cron/trigger` to run the injection sweep on demand, so that I can fire due injections immediately for testing or recovery.
- As an **operator**, I want `/api/cron/trigger-single?phone=` to force-fire one phone's scheduled injection, so that I can dial a single lead now without sweeping the whole queue.
- As an **operator**, I want `/api/admin/pull-readymode` to run an arbitrary-range or all-campaigns ReadyMode pull, so that I can backfill answered data for missed days.
- As an **operator**, I want `/api/admin/scan-bookings` and `/api/conversations/reseed` to re-run the nightly booking-scan and conversation reseed for a chosen window, so that I can recover bookings or transcripts the webhooks missed.
- As an **operator**, I want `/api/admin/repopulate-injections` to walk "appointment scheduled" messages and recreate missing scheduled injections, so that I can recover bookings where Cal.com never posted.
- As an **operator**, I want `/api/admin/pull-conversations` to pull one phone's Bland transcript on demand, so that I can recover a conversation that fell outside the nightly reseed window.
- As an **operator**, I want `/api/admin/probe-index` to fire one query per composite index and return the Firestore "create index" URL, so that I can provision indexes from the Test page at deploy time.
- As an **operator**, I want the TPI test tools (`/api/test/tpi/{search,get,lookup,status}`) to exercise the ReadyMode lookup path and inspect throttle state, so that I can debug the dialer integration against real responses.

## Canary monitoring

- As an **operator**, I want `/canary/conversations` to return today's outbound-send count for the external Canary to watch against a floor, so that I am paged if texting stalls.
- As an **operator**, I want `/canary/errors` to return yesterday's persisted terminal errors for Canary to watch against zero, so that I am paged when a hard-break error sticks.
- As an **operator**, I want both canary endpoints bearer-authed and always returning 200 on a real reading, so that the watched value signals the problem and a non-2xx means the service itself is down.

## Cron health & observability

- As an **operator**, I want every cron handler wrapped to stamp a `recordCronRun` marker with last-run status and duration, so that a stalled cron surfaces within hours instead of days.
- As an **operator**, I want `/api/admin/cron-health` to report each cron's freshness against an expected interval, so that I can spot a silently dead job from the dashboard.
- As an **operator**, I want a `list()` tripwire that logs a stack trace when any single query exceeds 500 docs, so that an accidental unbounded scan is caught before it exhausts the read quota.

## Auth & access

- As an **operator**, I want the dashboard and all `/api/*` routes gated behind Firebase Google sign-in restricted to the `monsterrg.com` domain, so that only my team can see the data or trigger actions.
- As an **operator**, I want ID tokens verified locally against Google's JWKs and the session cookie signed with a key derived from the service account, so that auth adds no per-request network call and there is no extra secret to manage.
- As an **operator**, I want the webhook prefixes (`/trigger`, `/sms-callback`, `/cal`, `/sms-flow`, `/canary`, `/healthz`) to bypass the session gate, so that ReadyMode, Bland, Cal.com, and Canary can reach us without a login.
- As an **operator**, I want auth to disable and every route to go public when the Firebase API key is missing, so that a typo'd env var can never lock my team out of the dashboard.
