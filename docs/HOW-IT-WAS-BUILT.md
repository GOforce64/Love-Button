# How the Love Button was built

The [Field Manual](Love%20Button%20Field%20Manual.pdf) explains how the app
works. This is the other half: the way the work was done, the order it was
done in, and what went wrong on real phones before it went right. Dates come
from the git history; everything happened in 2026.

- **153 commits** over 11 working days, 21 August to 11 September.
- **One spec**, three design documents and seven implementation plans.
- **Built with Claude Code.** The ledgers in `.superpowers/sdd/` show how:
  each plan was worked through as briefed tasks, and each task's diff was
  reviewed against the plan before the next one started.

---

## 1. The way of working

Every feature went through the same seven stages. Each stage leaves a file
behind, so the reasoning can be read afterwards, not just the result.

| Stage | Leaves behind | What it decides |
|---|---|---|
| **1. Spec** | [`love-button-spec.md`](../love-button-spec.md) | The binding plan: architecture, security, server, app, build order. Most of it is a record of what was *cut*, and why. |
| **2. Design** | [`docs/superpowers/specs/`](superpowers/specs/) | One per feature. Argues from the spec, and may propose a change to it. The phone choosing its own `send_id` started here, and was approved before any code was written. |
| **3. Plan** | [`docs/superpowers/plans/`](superpowers/plans/) | Numbered tasks. Each names its files, what it uses and what it provides, and spells out the failing tests to write first. |
| **4. Preflight** | `.superpowers/sdd/*/progress.md` | Before any code: a scan of every pair of tasks for mismatches ("this one produces X, that one expects Y"), each marked *Clean* or *DEFECT*. Defects become numbered **rulings** that override the plan. |
| **5. Build** | `task-N-brief.md`, `task-N-report.md` | One task at a time, tests first. A brief goes in, a report comes out. |
| **6. Review** | The ledger | Each task's diff checked against the plan and its rulings before moving on. |
| **7. Gate** | Real phones | "Do not proceed until the current milestone is verified on real hardware." |

### Why the preflight scan earned its place

It catches mistakes while they cost a sentence rather than a rewrite. A few
real ones:

- **Two sources of truth for one number.** Two receipt tasks each defined the
  20-second window, one as `PENDING_WINDOW_MS` and one as a literal `20_000L`.
  A later change to one would have quietly put the tile and its lookup out of
  step. *Ruling: import the constant.*
- **A decision that decided nothing.** A plan contained
  `Result.success().takeIf { ok } ?: Result.success()`, which is `success` on
  both branches. Caught by reading; never run.
- **A task that couldn't stand alone.** One Android task called a screen that
  only the *next* task created, so it couldn't be built or reviewed on its own.
  *Ruling: a placeholder the next task replaces.*
- **A theme that would never have appeared.** A plan invented a new theme name
  for the splash screen while the manifest still pointed at the old one: no
  error, just no splash. *Ruling: extend the existing theme.*
- **A hand edit the generator didn't know about.** Regenerating the icons gave
  one file 9 cells different from the committed one. They were the face removed
  from the resting speech bubble by hand, at the user's request, and never fed
  back into the generator, which would have quietly put the face back. *Ruling:
  teach the generator, and correct its docstring in the same edit.*

---

## 2. The timeline

The spec's build order was followed milestone by milestone. Milestone 2 was
the whole hard part: once a tap on one phone buzzed the other, everything
after it was built on something already seen working.

| Date | Work | What it delivered |
|---|---|---|
| 21 Aug | Spec rewritten; **Worker core** plan (milestones 0&ndash;1) | Firebase Auth and the pairing flow dropped. The Worker, test-first: `/health`, enrolment, bearer auth and device registration, the Google token, the FCM module, `/v1/send`. A push could be triggered with one `curl`. |
| 22 Aug | **Android buzz loop** plan (milestones 2&ndash;3) begins | App scaffold, message list, API client, DataStore, enrol screen. |
| 23 Aug | The manual setup | Firebase project, D1 and KV created, secrets set, Worker deployed. Both phones confirmed EEA ROM. |
| 24 Aug | **Milestone 2** | Receiving pushes: tap one phone, hear the other. Then the send button, the Xiaomi checklist, and the overnight check. |
| 24 Aug | **Sounds and widgets** plan (milestones 4, 5, 7) | Four channels with four sounds, the widget state model, the four widgets, half-filled frames, redraw after reboot. |
| 24&ndash;25 Aug | **Receipts** plan (milestone 6) | Phone-made `send_id`, `/v1/receipts`, delivered and seen on the widget. |
| 26 Aug | Receipts reworked after testing on the phones | Seen on unlock, the read-receipt toggle removed, the ladder colours swapped, Robolectric added. Also the retention cron and the secrets backup scripts. |
| 26&ndash;28 Aug | **In-app redesign** | The Sticker Book theme, `CurrentSend`, pixel icons drawn on a Canvas, the animated ladder, the guide, the splash, the pandas, and a home screen that fits any phone. |
| 30 Aug | **Cuter labels and swaying faces** | The display-voice buttons, the kaomoji faces, and grey when nothing comes back. |
| 30 Aug | **Shared bubble and release** (milestone 8) | One shared latest message, `UNREGISTERED`-only cleanup, the pre-commit hook, and a signed 1.0. |
| 30&ndash;31 Aug | After 1.0 | Send-only enrolment for the overnight check, her heart in the notification tray, one release updated in place. |
| 1 Sep | The first field manual | |
| 11 Sep | Going public | Secrets bundle out of the repo, the hook hardened, MIT licence, the README front page. |

The plan the spec set out, for reference:

| # | Milestone | What you can do at the end of it |
|---|---|---|
| 0 | Accounts, keys, project skeleton | &mdash; |
| 1 | Worker: `/health`, `/v1/enroll`, `/v1/send` | Trigger a push with a single `curl` |
| 2 | **Minimal app: enrol screen, one button, receiving service** | **Tap your phone, hear hers buzz** |
| 3 | Xiaomi checklist screen and the overnight test | Trust it |
| 4 | Four messages, four channels, four sounds | Hear the difference between them |
| 5 | One widget: send, vibration, idle/sending/sent/failed | Send from the home screen |
| 6 | Receipts: endpoint, reverse push, 20-second timeout, seen | See it land |
| 7 | The other three widgets | &mdash; |
| 8 | Hardening: abuse ceiling, retention cron, dead-token cleanup | Publish it |

---

## 3. Found on real phones

Each of these was wrong on hardware first. None would have been caught by
the unit tests that existed at the time, and most now have a test of their
own.

### Sounds that played as silence

The first channel code built each sound's address from its **resource
number**: `android.resource://<package>/<number>`. Adding the twelve widget
pictures shifted every resource number, so all four channels pointed at
numbers that no longer existed. Android's answer to a sound it can't find is
to play nothing and log nothing: the phones vibrated in silence. It was found
by comparing the numbers stored in `dumpsys` with the build's `R.txt`, not by
reasoning. The earlier check had confirmed the numbers matched *at that
moment*, which was true and not enough.

A channel's sound can never be changed, so the four channels couldn't be
repaired: the app had to be uninstalled on both phones. The address now uses
the sound's **file name**, and `SoundUriTest` pins that form.

### A redraw that could only reach one widget

`setWidgetState` was written when only the heart widget existed, and asked
`LoveWidget` to redraw. It would have written the right state for the other
three and then drawn nothing. Caught while building them, before it shipped.
The writer now asks whichever widget class owns the tile.

### Blank widgets after a reboot

Glance only draws when something runs its receiver, and nothing does at boot,
so the tiles sat on the loading layout. A tap on an undrawn tile falls through
to the launcher, which opens the app, and opening the app is what seemed to
fix it. `BootReceiver` now redraws all four on `BOOT_COMPLETED`.

### A tile that never went back to rest

After waiting out its 20 seconds, `SendWorker` only reset the tile if the send
was still in `PendingSends`. But entries there expire at exactly 20 seconds,
so after waiting 20 seconds the answer was "gone" every time, and the tile
stayed lit for minutes. The fix asks the *tile* what it's showing
(`clearWidgetStateIf`) instead. The trap is written into the spec so it can't
come back.

### Seen, 54 milliseconds before delivered

The two receipts are reported by separate jobs, and on hardware `seen` was
seen arriving 54 ms *before* the `delivered` for the same message. Written in
the order they arrived, the late `delivered` turned the gold tile back to
pink, and it never went gold again. Since then every receipt goes through
`advancesTo()`, and the ladder only moves up.

### An old timer wiping a newer tile

Each receipt starts its own hold timer. A `delivered` at 0 s and a `seen` at
1 s meant the delivered timer, firing at 4 s, reset a tile that was by then
showing gold, a second early. `clearWidgetStateIf(expected)` now lets a timer
reset only the picture it put there.

### The pink tile that blinked

`delivered` used to hold for four seconds. On the phones, the tile went dark
and then lit gold a moment later when she unlocked. One event, shown as two.
`delivered` now holds for whatever is left of the 20-second window, measured
from the send, not from when the receipt happened to arrive.

### A tap with no signal

`SendWorker` waits for a network, and at first it also made the send's id and
wrote the app screen's record. So a tap with no signal did *nothing* on the
app screen, and on the widget left the heart half-filled and crimson forever.
The fix came in three parts: the record and the id are made at the tap
(`beginSend`); `TimeoutWorker` has no network constraint, so it fires in
exactly that case; and a send that only finds a connection after its window
is dropped, because the sender was already told it didn't get through.

### Two bubbles, two answers

With the shared bubble, the phones compared the server's clock, in whole
seconds. Two sends in the same second left each phone keeping its own. Fixed
with a tie-break on `send_id`. Then a second case showed up on hardware, before
it was written down: a tap one second *newer* than her message lost the bubble
to it, because while a send is in flight it has no server time to compare.
`markSentAt()` now takes the bubble back when the reply lands.

### The error code that would have locked her out

The first FCM module deleted a phone's row when Google answered
`UNREGISTERED` *or* `INVALID_ARGUMENT`. The spec flagged the second on day
one: Google returns it for a malformed *request* as readily as for a dead
token, and a malformed request fails for every one of her phones at once.
Deleting them all would delete her bearer token's row too, so her app would get
401 on everything until she enrolled again from the password manager. Resolved
at milestone 8: only `UNREGISTERED` counts.

### Force stop loses messages for good

Tested on 24 August: messages sent while the app is force-stopped aren't
queued; they're gone, and reopening the app replays nothing. FCM only stores
messages for a phone it can't *reach*. Decided then: no catch-up endpoint,
because four stale buzzes arriving an hour late is worse than none.

### A footer squeezed to nothing

On a slightly shorter phone, or with the setup nudge showing, the home screen's
last row got zero height: two empty, squashed buttons with their labels
clipped away. The screen is now measured first, and the flexible parts give
way in order: the gaps, then the focal card, then the pandas.

### Pixel art that looked wrong

- **Rings around every eye.** The Canvas renderer treated holes as outside the
  shape and outlined them in dark pink, which is why the speech bubble's face
  looked uncanny. It also disagreed with the generator on 22 cells of the old
  bubble while a comment claimed they matched.
- **A shade that flipped.** A fixed shade colour is darker than the fill in
  one state and lighter in another. It's now each state's fill times 0.72.
- **Pale squares around every pixel.** Grids that didn't divide the screen
  evenly left hairline gaps between cells, and the white card showed through.
  Cells are now rounded to whole pixels.

### The hook that could miss a key

Two ways a private key got past the pre-commit hook, both reproduced before
the fix: a staged file with a space in its name was split in two by the shell
and never scanned; and in a large commit with a key near the top, `grep -q`
stopped early, git died writing the rest, and under `pipefail` that failure
read as "no key". The scan now reads the whole staged diff from a redirect,
and file names are NUL-separated.

And one about the machine, not the code: on a checkout where files lost their
executable bit, git **silently skips** a non-executable hook. The only sign is
a hint at commit time. `chmod +x .githooks/pre-commit` if in doubt.

---

## 4. Decisions that changed along the way

- **No Firebase Auth, no pairing.** The first draft used Google Sign-In. For
  exactly two accounts that meant a sign-in screen, SHA-1 fingerprints and JWT
  checks against Google's rotating keys. Enrolment codes and opaque tokens give
  the same safety with far less machinery. (Spec rewrite, 21 Aug.)
- **The phone chooses the `send_id`.** Proposed in the receipts design as a
  deviation from the spec, approved before any code, because it makes the
  receipt-beats-reply race impossible rather than handled.
- **The read-receipt toggle, built and then removed.** The spec asked for one,
  so it was built (25 Aug). After using it, the user decided against it, and it
  was removed along with the two spec sections that asked for it (26 Aug).
  Leaving the spec unchanged would have had the next plan rebuild it.
- **Seen means looked, not tapped.** Chosen on hardware: a message read on the
  lock screen and swiped away was still read. Seen now fires at once if the
  phone is awake and unlocked, otherwise at the next unlock.
- **The ladder's colours swapped.** Crimson now means "on its way" and pink
  means "landed", with the delivered and seen art changed to match.
- **Icon-only tiles.** The spec's small label under each widget was dropped:
  the picture is the tile, and the state lives in the artwork. A half-filled
  frame was added so the tile reads as filling up rather than jumping between
  two pictures.
- **Pixel art, not Material icons**, drawn as letter grids, with the outline
  worked out rather than drawn.
- **Her heart in the tray, not an envelope.** The notification icon is the
  widget's heart, as a silhouette, tinted with `setColor`.
- **1.0 stays 1.0.** `versionName` never changes; `versionCode` goes up with
  every build that reaches a phone. Settings therefore always shows "1.0", and
  `adb shell dumpsys package com.lovebutton.app | grep versionCode` is how to
  tell builds apart.
- **One night, not two.** The plan asked for two quiet nights in a row before
  moving on, because Xiaomi's killer depends on memory pressure and one quiet
  night proves only that the setup *can* hold. The second night was skipped by
  an explicit decision (Ruling 14), recorded so any later silent failure is
  judged against a one-night sample.

---

## 5. Standing it up

[`MANUAL-SETUP.md`](MANUAL-SETUP.md) has every step. These are the traps in
it, the ones that fail without saying why:

- **The package name must be exactly `com.lovebutton.app`** in Firebase. Get it
  wrong and the app builds and installs fine, and FCM simply never delivers.
- **`FIREBASE_PROJECT_ID` must match the service account's `project_id`**
  character for character. It goes straight into the FCM address, and a wrong
  one makes Google answer 404, which looks exactly like a dead token.
- **The service-account JSON must arrive as one line:**
  `cat key.json | tr -d '\n' | wrangler secret put FCM_SERVICE_ACCOUNT`.
- **Save both enrolment codes in a password manager before setting them.**
  Cloudflare never shows a secret again, and without the codes a phone can't
  enrol after a factory reset.
- **Don't carry on past a failing `/health`.** Everything after assumes a
  reachable Worker, and fails confusingly if it isn't.
- **Prove the push path before writing app code:** enrol a fake device with
  `curl`, then send. If Google accepts that, the hard half is done.
- **The `workers.dev` subdomain comes from the account's email** and Cloudflare
  offers no way to change it, so the Worker's address lives in
  `local.properties`, outside git. The build refuses to run without it.

On the phones (both Xiaomi, HyperOS):

- **Check the ROM first.** Settings &rarr; About phone &rarr; build number:
  `.MIXM` (Global) or `.EUXM` (EEA) are fine; `.CN` (China) has no Play
  Services and FCM can't work at all.
- **Developer options** appear after tapping **OS version** seven times (not
  "MIUI version"), and live under **Additional settings**, not System.
- **Install via USB** needs a signed-in Mi account (a *new* account can be
  blocked for up to 96 hours) and, on some phones, a SIM card present. The way
  round it is **wireless debugging**: pair with a code, then
  `adb pair <ip>:<pairPort>` and `adb connect <ip>:<mainPort>`. The two ports
  are different. The region-change trick works too, but moves an EEA phone off
  EEA privacy defaults.
- **USB mode must be File transfer (MTP).** "Charging only" silently hides the
  phone from adb.
- **Tick "Always allow from this computer"** on the USB debugging prompt, or
  it asks on every reconnect.

---

## 6. Choosing the four sounds

A channel's sound is frozen when the channel is first created, so the four
real channel ids (`msg_1` to `msg_4`) were kept unused during development, and
a throwaway channel, `dev_buzz_v1`, took the test buzzes. The sounds had to be
final before the real channels existed.

- **Where from:** Pixabay sound effects (the biggest library, no attribution),
  Mixkit, Kenney's CC0 interface sounds. Freesound only file by file: it
  mixes CC0 and CC-BY licences, and its filter isn't always right.
- **Under about a second.** Longer clips get cut off anyway.
- **Different in kind, not just length.** She hears them from a pocket,
  muffled, without looking, and two different bells are the same bell through
  fabric. Aim for four different kinds: a soft chime, a wooden knock, a
  two-note rise, a low pluck.
- **Nothing like stock Android or WhatsApp.** The point is knowing it's you
  without looking.
- **Audition all four back to back, quietly, from another room.** That's how
  they'll really be heard.

They were converted to OGG, trimmed and volume-matched (by peak rather than
by loudness standard) before going into `res/raw`.

---

## 7. Releasing

- The release is signed with a keystore kept outside the repo, read through
  `keystore.properties`. The build only asks for it when building a release,
  so anyone can build a debug copy.
- The keystore is backed up inside an encrypted bundle
  (`gpg --symmetric --cipher-algo AES256`), with the passphrase in the password
  manager. Losing it would mean the app can never be updated in place: Android
  refuses an update signed with a different key.
- Moving a phone from a debug build to the release build means uninstalling
  and enrolling again, for the same reason.
- Every build that goes to a phone gets a higher `versionCode`. Android refuses
  an install over an equal or lower one with `INSTALL_FAILED_VERSION_DOWNGRADE`,
  which says nothing about having forgotten to bump it.

---

## 8. The overnight check

On a Xiaomi, a loop that works while you're watching may not work at 3 a.m.
So the gate for milestone 3 was a night's sleep: in the morning, send a
message to each phone from the laptop, without touching either one, because
picking a phone up revives a killed app and hides the very failure being
tested.

The first version read each phone's own bearer token off the handset with
`run-as`, which only works on a debuggable build. At 1.0 the release build
stopped being debuggable, as it should: the alternative was a public build
whose private files anyone with adb could read. The replacement is the
**send-only device**: enrolled from the laptop with the enrolment code, no
push address, so it can send as a person but never receives, and can't take
a push meant for a real phone. It grants nothing the code didn't already
grant.

---

## 9. Dependency and toolchain traps

All of these fail with messages that name neither the library nor a version.
Each pin in [`gradle/libs.versions.toml`](../gradle/libs.versions.toml)
carries a comment saying why.

- **Compose BOM 2026.08.00** needs AGP 9.1+ and compileSdk 37. Without them it
  fails as 22 opaque "AAR metadata" errors. Pinned to 2026.06.01.
- **Glance 1.3.0-alpha02** needs compileSdk 37 and fails the same way. Pinned
  to 1.1.1, the newest stable.
- **`firebase-messaging-ktx` no longer exists.** Google folded it into
  `firebase-messaging`; recent BOMs have no version for it, so it fails as
  "Could not find".
- **Gradle 9.5.0, exactly.** Under JDK 26, Gradle 8.13 won't start, and Gradle
  9.6+ removes an internal API that AGP 8.13 still calls.
- **A JDK 21 toolchain for compiling.** AGP 8.13's `jlink` step fails on JDK 26
  with an error about a "build signature" in `java.base`.
- **Robolectric 4.16** is the first with Android 16 (SDK 36) support, and it
  needs a JDK 21+ runtime.
- **OkHttp sets `Content-Type` itself** from the request body, and overwrites
  one set by hand, so the tests assert it starts with `application/json`
  rather than matching it exactly.

---

## 10. Habits worth keeping

- **Comments explain why, not what.** `fcm.ts` spends fifteen lines on why
  `INVALID_ARGUMENT` isn't trusted; `TimeoutWorker` explains why it has no
  network constraint. Code you can maintain in six months is code that says
  what was tried and what broke.
- **Commit messages in the same voice.** *"only UNREGISTERED means the token
  is dead"*, *"a send reclaims the bubble from an older message that jumped
  it"*.
- **Every subtle rule becomes a plain function with a test.** `receivedWins`,
  `advancesTo`, `windowClosed`, `couldBeLookingNow`, `isBorderCell`.
- **Check, don't assume.** Android's list of broadcasts still allowed in the
  manifest was checked *before* designing the unlock listener, not after it
  silently failed.
- **Stop at a failing gate.** A build that can't be tested isn't reported as
  done. Plan 2 halted after its first task until an Android SDK existed to run
  the tests.
