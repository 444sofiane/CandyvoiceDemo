# CandyVoice Demo

A web-based demonstrator for CandyVoice's noise filtering and voice-processing features. The web interface talks to a Python API over REST, which in turn relays commands to a separate Windows application that performs the actual audio processing.

🔗 **Live demo:** [candyvoice-demo.vercel.app](https://candyvoice-demo.vercel.app)

## Architecture

```
┌─────────────────┐      REST HTTP       ┌────────────────┐      commands       ┌──────────────────┐
│   Web Interface  │ ───────────────────► │   Python API   │ ───────────────────► │   Windows App     │
│ (HTML/CSS/JS,    │ ◄─────────────────── │  (bridge/relay)│ ◄─────────────────── │ (audio processing)│
│  Firebase-hosted)│      responses       └────────────────┘      results        └──────────────────┘
└─────────────────┘
```

- **Web Interface** (this repo) — the front-end the user interacts with: registration/auth, and demo pages for noise filtering, voice imitation, and deepfake detection.
- **Python API** — a lightweight REST server that receives requests from the web interface and forwards them as commands to the Windows app. *(Not yet published — see [Python API](#python-api) below.)*
- **Windows App** — a separate native application that performs the actual audio/voice processing and returns results back through the Python API.

## Features / Pages

| Page | Description |
|---|---|
| `index.html` | Landing / entry point |
| `register.html` | User registration |
| `verify-email.html` | Email verification flow |
| `noisefilter.html` | Noise filtering demonstrator |
| `imitation.html` | Voice imitation demonstrator |
| `deepfake.html` | Deepfake detection/demo |

## Tech Stack

- **Frontend:** HTML, CSS, JavaScript
- **Hosting / Backend-as-a-Service:** Firebase (Hosting, Firestore, Auth)
- **Deployment:** Vercel
- **Backend bridge:** Python REST API (separate service, relays to the Windows app)

## Project Structure

```
CandyvoiceDemo/
├── css/                # Stylesheets
├── functions/          # Firebase Cloud Functions
├── image/              # Image assets
├── js/                 # Client-side JavaScript
├── deepfake.html
├── imitation.html
├── index.html
├── noisefilter.html
├── register.html
├── verify-email.html
├── firebase.json        # Firebase project configuration
├── firestore.rules       # Firestore security rules
├── .firebaserc
└── package-lock.json
```

## Prerequisites

- [Node.js](https://nodejs.org/) and npm
- A [Firebase](https://firebase.google.com/) project (for Hosting, Auth, and Firestore)
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

3. **Configure Firebase**
   - Update `.firebaserc` with your Firebase project ID.
   - Adjust `firestore.rules` as needed.
   - Make sure your Firebase config (API keys, etc.) is set in the relevant JS files.

4. **Configure the Python API endpoint**
   - Point the front-end (in `js/`) to the base URL of your running Python API instance.

5. **Run locally**
   ```bash
   firebase serve
   ```
   or open `index.html` directly / serve the folder with any static file server.

6. **Deploy**
   ```bash
   firebase deploy
   ```
   The demo is currently deployed via [Vercel](https://candyvoice-demo.vercel.app).

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

## License

Add your license here.
