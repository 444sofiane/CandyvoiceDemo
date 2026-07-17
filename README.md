# CandyVoice Demo

A web-based demonstrator for CandyVoice's noise filtering and voice-processing features. The web interface talks to a Python API over REST, which in turn relays commands to a separate Windows application that performs the actual audio processing.

🔗 **Live demo:** [demo.candyvoice.com](https://demo.candyvoice.com)

## Architecture

```
┌─────────────────┐      REST HTTP       ┌────────────────┐      commands       ┌──────────────────┐
│   Web Interface  │ ───────────────────► │   Python API   │ ───────────────────► │   Windows App     │
│ (HTML/CSS/JS,    │ ◄─────────────────── │  (bridge/relay)│ ◄─────────────────── │ (audio processing)│
│  Firebase Hosting)│      responses       └────────────────┘      results        └──────────────────┘
└─────────────────┘
        │
        │ Auth / Firestore / Functions
        ▼
┌─────────────────┐      SMTP relay      ┌────────────────┐
│  Firebase Auth /  │ ───────────────────► │    SMTP2GO      │ ──► user's inbox
│  Cloud Functions  │                      │ (custom domain, │
│                    │                      │  SPF/DKIM/DMARC)│
└─────────────────┘                      └────────────────┘
```

- **Web Interface** (this repo) — the front-end the user interacts with: registration/auth, and demo pages for noise filtering, voice imitation, and deepfake detection. Served as a static site via **Firebase Hosting**.
- **Python API** — a lightweight REST server that receives requests from the web interface and forwards them as commands to the Windows app. *(Not yet published — see [Python API](#python-api) below.)*
- **Windows App** — a separate native application that performs the actual audio/voice processing and returns results back through the Python API.
- **Firebase** — provides Hosting, Authentication, Firestore (usage tracking), and Cloud Functions (HubSpot sync, usage quota enforcement).
- **SMTP2GO** — handles outbound transactional email (email verification, etc.) on behalf of `candyvoice.com`, configured with SPF, DKIM, and DMARC for deliverability.

## Features / Pages

| Page | Description |
|---|---|
| `index.html` | Sign-in |
| `register.html` | User registration |
| `verify-email.html` | Email verification flow |
| `noisefilter.html` | Noise filtering demonstrator (NoizeOff) |
| `imitation.html` | Voice imitation demonstrator (placeholder) |
| `deepfake.html` | Deepfake detection demonstrator (placeholder) |

## Tech Stack

- **Frontend:** HTML, CSS, JavaScript (static, no build step)
- **Hosting:** Firebase Hosting, served from `public/`
- **Backend-as-a-Service:** Firebase (Authentication, Firestore, Cloud Functions)
- **Transactional email:** SMTP2GO, connected as a custom SMTP relay for Firebase Auth emails, with SPF/DKIM/DMARC configured on `candyvoice.com`
- **Backend bridge:** Python REST API (separate service, relays to the Windows app)

## Project Structure

```
CandyvoiceDemo/
├── public/              # Everything served by Firebase Hosting
│   ├── css/              # Stylesheets
│   ├── image/            # Image assets
│   ├── js/                # Client-side JavaScript
│   ├── deepfake.html
│   ├── imitation.html
│   ├── index.html
│   ├── noisefilter.html
│   ├── register.html
│   └── verify-email.html
├── functions/            # Firebase Cloud Functions (HubSpot sync, usage quota, etc.)
├── firebase.json          # Firebase project configuration (Hosting + Functions)
├── firestore.rules         # Firestore security rules
├── .firebaserc
└── package-lock.json
```

> Note: `functions/` and its `package.json`/`index.js` live outside `public/` so Firebase Hosting only ever serves static frontend files, and Cloud Functions are deployed separately via the Firebase CLI.

## Prerequisites

- [Node.js](https://nodejs.org/) and npm
- The [Firebase CLI](https://firebase.google.com/docs/cli) (`npm install -g firebase-tools`)
- A [Firebase](https://firebase.google.com/) project (Hosting, Auth, Firestore, Functions)
- A [SMTP2GO](https://www.smtp2go.com/) account configured as the custom SMTP provider for Firebase Auth emails
- The Python API running and reachable (see below)
- The Windows app installed and running on the machine the Python API relays to

## Setup

1. **Clone the repo**
   ```bash
   git clone https://github.com/444sofiane/CandyvoiceDemo.git
   cd CandyvoiceDemo
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Log in and select your Firebase project**
   ```bash
   firebase login
   firebase use candyvoice
   ```

4. **Configure Firebase**
   - Confirm `.firebaserc` points at your Firebase project ID.
   - Adjust `firestore.rules` as needed.
   - Firebase config (API keys, etc.) lives in `public/js/firebase-config.js`.

5. **Configure the Python API endpoint**
   - Point the front-end (in `public/js/`) to the base URL of your running Python API instance.

6. **Run locally**
   ```bash
   firebase emulators:start
   ```
   or serve the `public/` folder with any static file server for frontend-only work.

7. **Deploy**
   ```bash
   firebase deploy
   ```
   Or deploy Hosting and Functions independently:
   ```bash
   firebase deploy --only hosting
   firebase deploy --only functions
   ```

## Custom domain & email deliverability

The app is served at [demo.candyvoice.com](https://demo.candyvoice.com), connected as a custom domain under Firebase Hosting.

Firebase Authentication is configured to send emails (verification, password reset, etc.) through **SMTP2GO** rather than Firebase's default sender, using `candyvoice.com` as the sending domain. To keep those emails out of spam and avoid them being silently dropped by strict corporate mail filters, the domain has:

- **SPF** — authorizes SMTP2GO's sending servers
- **DKIM** — SMTP2GO signs outgoing mail with a `candyvoice.com`-aligned key
- **DMARC** — published at `_dmarc.candyvoice.com`, currently at `p=none` while aggregate reports are monitored
- **A custom Auth email domain** — verified via Firebase's *Templates → Customize domain* flow, so email action links point to `demo.candyvoice.com/__/auth/action` instead of the default `*.firebaseapp.com` / `*.web.app` domains (which some spam filters flag as a phishing signal)

If you fork this project and want to reuse the same setup, you'll need to repeat the SPF/DKIM/DMARC and Firebase custom-domain verification steps for your own domain.

## Python API

The Python API acts as a relay between this web interface and the Windows app:

- Exposes REST endpoints consumed by the web interface.
- Forwards received commands to the Windows app for processing.
- Returns the Windows app's results back to the web interface.

This service is not yet published to a public repository. Once available, add its repo link and setup instructions here.

## Windows App

A separate native Windows application that performs the actual audio processing (noise filtering, voice imitation, deepfake analysis). It runs independently and receives instructions only via the Python API — it does not communicate directly with the web interface.

## Notes

- The full end-to-end demo (web → Python API → Windows app) requires all three components running simultaneously.
- Without the Python API and Windows app running, only the static/UI parts of the web interface (registration, navigation, etc.) will be functional.
- `imitation.html` and `deepfake.html` are currently UI placeholders — no processing is wired into them yet.

## License

Add your license here.
