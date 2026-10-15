# Gather — a little closer

Gather is a working small-group meeting application using **Laravel 12 / PHP 8.2+, jQuery 3.7.1, plain CSS, SQLite, native WebRTC, and Pusher Channels**. It uses no external meeting SDK, public STUN server, CDN, analytics service, or hosted identity provider. Pusher provides room update events; meeting audio and video remain peer-to-peer. Composer and optional npm dependencies are downloaded during development/setup.

## Included

- Registration, login, remember-me, logout, and password-protected account settings.
- Meeting dashboard, instant rooms, scheduled rooms, agendas, invitation links/codes, history, and search of the current dashboard page.
- Guest entry without an account, camera/microphone preview, join without devices, waiting room and host admission.
- Up to **8 participants including the host**, with a slot reserved so waiting guests cannot prevent the host entering.
- Peer-to-peer audio/video, camera/microphone toggles, screen sharing by replacing the video track, raised hands, grid/focus view, participant list, and room-wide chat.
- Speaking indicators on the microphone and participant tiles, emoji reactions, and weak/offline connection warnings based on WebRTC latency, loss, jitter, and signaling failures.
- Host admission/removal, lock/unlock, end for everyone, mute all, individual mute, and permission to speak after raising a hand. Host permission unlocks a microphone; the participant chooses when to enable it.
- Local recording of a screen/tab the user chooses, saved as WebM (or the browser’s supported format), with an automatic mix of the local microphone and incoming participant voices. Participants joining during recording are included; muted microphones are excluded. System/tab audio is not captured separately, avoiding duplicated call audio.
- English/Arabic language selection, Arabic validation messages, RTL layouts, and language switching during a meeting without disconnecting it. Participant names, meeting titles, and chat messages remain as written; this does not translate speech or user content.
- Responsive landing, authentication, dashboard, lobby, and meeting screens. All fonts, illustrations, SVG icons, CSS, and JavaScript work without external asset requests.

This is a functional foundation with the common meeting workflow, not feature parity with Zoom, Meet, or Teams. It uses a small-room mesh instead of an SFU: each browser sends media to every other browser. Large conferences, enterprise administration, calendar integrations, mail invitations, transcription, breakout rooms, file sharing, and server-side recordings are outside this version. Invitations are copied and shared manually. Scheduling reserves a link and displays a planned start; it does not prohibit early entry or automatically end the meeting at its planned duration. Meeting history stores metadata; there is no transcript export interface.

## Run locally

PHP must include `pdo_sqlite`, `mbstring`, `openssl`, `fileinfo`, `curl`, `xml`, and `zip`. Composer is required only for installing PHP dependencies. Node is optional and only used by browser tests; there is no frontend build or Node service.

```powershell
# From D:\meeting\app (dependencies and .env are already installed in this workspace)
php artisan migrate
php artisan serve --host=127.0.0.1 --port=8000
```

Open http://127.0.0.1:8000 and register. Start a meeting, turn on devices if desired, and send the invitation to another browser/device. For two users on the same computer, use a separate browser profile or private window; tabs in one profile share the same participant session. Returning to the lobby and joining again retires that session's old participant and negotiates a fresh connection. A removed guest is blocked for that browser session; guests can use a fresh session, so keep admission enabled or lock a room to control re-entry.

For a fresh checkout:

```powershell
Copy-Item .env.example .env
composer install
# This workspace also includes Composer at ..\composer.phar:
# php ..\composer.phar install
php artisan key:generate
New-Item database\database.sqlite -ItemType File -ErrorAction SilentlyContinue
php artisan migrate
php artisan serve
```

On Linux, use `cp .env.example .env` and `touch database/database.sqlite`. Do not overwrite an existing environment, database, or application key.

## Architecture

Blade renders pages. Local jQuery handles interactions and JSON requests. Laravel session authentication, CSRF verification, validation, throttling, and meeting-scoped participant checks protect the room routes. An authenticated owner is the host; guest membership is scoped to a UUID stored in the session.

WebRTC carries media directly between browsers. Pusher presence channels deliver meeting-scoped changes and membership events. The browser fetches an initial snapshot and refreshes it on socket events, with no recurring HTTP poll or heartbeat. Pusher's own keepalive stays on the WebSocket; HTTP streaming/polling fallbacks are disabled. Each participant, including an unauthenticated guest, authorizes the channel using their meeting-session UUID. The scheduler checks Pusher presence to retire disconnected members without expiring people in idle meetings. Laravel stores offer/answer/ICE signals in `meeting_events`, delivered only to the intended admitted participant. Guests awaiting admission receive no chat or signaling. Chat is persisted in `messages` and rendered as escaped text.

Pusher app credentials are required for realtime updates. Set `BROADCAST_CONNECTION=pusher` and `PUSHER_APP_ID`, `PUSHER_APP_KEY`, `PUSHER_APP_SECRET`, and `PUSHER_APP_CLUSTER` in `.env`. The Pusher browser library is served locally from `public/vendor/`.

SQLite is convenient for local development. Use MySQL or PostgreSQL and a normal multi-worker PHP-FPM server for a deployed workspace. The PHP development server on Windows handles requests serially and is not a production meeting server. Pusher delivers room notifications; each event triggers one update request per connected participant. Failed media connections show a rejoin instruction; automatic ICE restart is not implemented.

Main code:

| Area | Location |
| --- | --- |
| Routes | `routes/web.php` |
| Accounts | `app/Http/Controllers/AuthController.php` |
| Dashboard and scheduling | `app/Http/Controllers/MeetingController.php` |
| Admission, signaling, messages, moderation | `app/Http/Controllers/RoomController.php` |
| Peer connections and media | `public/js/room.js` |
| jQuery interactions | `public/js/app.js` |
| UI | `resources/views/`, `public/css/` |
| Capacity and self-hosted ICE config | `config/meeting.php` |
| Schema | `database/migrations/2026_10_10_000001_create_meeting_tables.php` |

## HTTPS and self-hosted TURN

Camera, microphone, and display capture need **HTTPS**, except browsers permit localhost/127.0.0.1 for development. Plain HTTP over a LAN IP does not provide a valid camera/microphone context. Use a trusted TLS certificate for your deployed hostname and set `APP_URL` to the actual HTTPS URL. The default ICE server list is empty; direct same-computer/LAN connections can work, but cross-network calls commonly need STUN/TURN. Run **coturn on infrastructure you control**; do not add Google's or another provider's public STUN/TURN services.

1. Install coturn on your own public Linux server. Start from `deploy/turnserver.conf.example`, replacing realm, addresses, secret, and certificate paths. The sample includes blocked private peer ranges to avoid using the relay to reach private services; adapt deliberately if your topology needs internal peers.
2. Allow TCP/UDP 3478, TLS TCP 5349, and your configured relay UDP range (49160–49200 in the sample). Map both listening and relay ports if the server is behind NAT. The relay range must be sized for actual use. Valid TURN DNS, public addresses, TLS files, and firewall configuration are your deployment responsibilities.
3. Put your own addresses and matching shared secret in `.env`:

```dotenv
APP_URL=https://meet.your-domain.example
APP_ENV=production
APP_DEBUG=false
SESSION_SECURE_COOKIE=true
STUN_URL=stun:turn.your-domain.example:3478
TURN_URLS=turn:turn.your-domain.example:3478?transport=udp,turn:turn.your-domain.example:3478?transport=tcp,turns:turn.your-domain.example:5349?transport=tcp
TURN_SECRET=the-same-long-random-secret-as-coturn
```

Laravel generates 24-hour TURN usernames and HMAC credentials for joined participants. The shared secret stays on the servers. Credentials refresh on rejoin; meetings lasting beyond 24 hours should rejoin. TURN is a network relay protocol, not a third-party API. If all peers can route directly on your private network, you can leave these values empty.

4. Serve only `public/` through Nginx/PHP-FPM. `deploy/nginx.conf.example` is a template: replace hostname, PHP socket, root, and TLS files. Run:

```sh
composer install --no-dev --optimize-autoloader
php artisan migrate --force
php artisan config:cache
php artisan route:cache
php artisan view:cache
```

Set write permissions for `storage/` and `bootstrap/cache/`, use database credentials appropriate to your own server, and back up the database and `APP_KEY`. Keep `.env` out of source control. Run the Laravel scheduler every minute on your host:

```cron
* * * * * cd /var/www/gather && php artisan schedule:run >> /dev/null 2>&1
```

`meetings:prune` deletes signals older than ten minutes and retires stale participants. It retains chat/history. Decide your own message and metadata retention policy before production. Registration is open in this version; restrict access at your own reverse proxy if you need a private deployment.

## Testing

Verified in this workspace: **26 PHP tests / 466 assertions passed**, JavaScript syntax checks passed, the complete three-person meeting browser suite passed in Chrome, and the device-permission regression suite passed in Chrome and Brave. Browser checks cover finished document loading with devices off, host unmute, rejected/ignored permissions, stopping late permission results, and no recurring HTTP requests while idle. The tests use generated cameras/microphones and a local Pusher protocol fixture: the real Pusher.js library connects, Laravel signs subscriptions and broadcasts, and the fixture checks the signatures and delivers socket events. This verifies the application without requiring hosted Pusher credentials or touching the user's database; it does not validate your hosted Pusher account settings or physical microphone.

```powershell
php artisan test
node --check public/js/app.js
node --check public/js/room.js
node --check public/js/media.js
```

The PHP tests use an isolated in-memory SQLite database. They cover account flows, scheduling, ownership, admission isolation, capacity, lock/removal/end, targeted signaling, chat validation, temporary TURN credentials, profile changes, cleanup, host muting and speaking permissions, reaction isolation/validation, persisted locale, Arabic validation, and translation catalog coverage.

For the browser integration test, start the local server, then:

```powershell
npm install
npx playwright install chromium
npm run test:browser
node tests/browser/locales.cjs
```

For isolated Pusher integration tests, use `npm run test:local`. This creates a disposable SQLite database, runs Laravel on port 8011, and runs the local Pusher protocol fixture. Set `E2E_MEDIA_ONLY=1` to run only the loading/permission/unmute tests, and `E2E_PORT` to choose another unused test port. Use `CHROME_PATH` for an installed Chrome or Brave executable. A blank camera preview has no attached MediaStream; ignored device permissions time out after 15 seconds and leave the control available for another attempt.

To use an installed Chrome instead of downloading Chromium, set `CHROME_PATH` to its executable. `TEST_URL` defaults to http://127.0.0.1:8000. The test creates three isolated browser contexts and uses fake browser cameras/microphones. Screen-track replacement and local recording use a generated canvas display stream; manually verify real OS screen selection and physical microphones on your target browsers. The test removes only its generated account and meetings after finishing. It writes screenshots and a local recording into `storage/app/qa/`.

Real devices, cross-network TURN relay, production TLS/firewall configuration, Safari/mobile screen capture, eight simultaneous physical participants, and sustained load require deployment testing. The local browser suite does not validate those conditions.

## Local third-party asset

`public/vendor/jquery-3.7.1.min.js` is jQuery under its MIT license. See `public/vendor/jquery-LICENSE.txt`. Laravel and Composer dependencies retain their licenses in `vendor/`. jQuery is served from this project, not a CDN.

References: [Laravel deployment](https://laravel.com/docs/12.x/deployment), [MDN WebRTC](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API), [MDN media permissions](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [coturn](https://github.com/coturn/coturn).
