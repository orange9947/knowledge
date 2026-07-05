# Standalone Desktop and Android Packaging Design

## Purpose

The application must run independently on both desktop and Android. The user does not have a server and should not need to deploy one. "Standalone" means the app carries or starts its own local backend and stores its own SQLite database and model secrets on the device. Web crawling and model calls still require network access, because they depend on public websites and the configured DeepSeek/GPT-compatible API.

The current system is a React/Vite frontend plus a FastAPI backend with SQLite. The design keeps the existing product behavior: knowledge bases, learning runs, source crawling, AI reading analysis, card approval into the graph, history retention, model connection testing, import/export, and the graph-side AI assistant.

## Confirmed Direction

The user selected the full standalone route for Android. This replaces the earlier Android-client-only idea.

Desktop will use Electron as the native shell and a PyInstaller-packaged FastAPI backend as a sidecar process.

Android will use Capacitor for the React UI and Chaquopy to embed Python. The Android app will start a local Python/FastAPI service inside the app process and load the web UI against `127.0.0.1` after `/health` is ready.

## Current State

Relevant existing behavior:

- Frontend API calls are centralized in `frontend/src/api.ts` and currently call `/api`.
- Vite development proxies `/api` to `http://127.0.0.1:8000`.
- Backend routes are mounted at the root path, not under `/api`.
- SQLite defaults to `sqlite:///./data/knowledge.db`.
- Secrets default to `data/secrets.json` but already support `AILKG_SECRET_FILE`.
- Backend initialization creates and migrates SQLite tables at startup.
- The UI already has basic responsive rules, but Android needs a real touch-first layout pass.

## Architecture

### Shared Backend Contract

Keep FastAPI as the authoritative backend for both desktop and Android. Both shells start the same app module and talk to it over loopback HTTP:

- Desktop: Electron starts a backend executable built from the Python backend.
- Android: Kotlin starts Python via Chaquopy and launches Uvicorn inside the app.
- Web development: Vite continues using the existing proxy.

The frontend API layer will support a runtime base URL:

- Development: `/api`
- Desktop: injected local URL, for example `http://127.0.0.1:<port>`
- Android: `http://127.0.0.1:<port>`

This keeps product code shared and avoids maintaining separate frontend builds for each endpoint layout.

### Desktop Runtime

Add a `desktop/` package using Electron.

Electron main process responsibilities:

- Pick an available loopback port.
- Resolve the app user data directory.
- Set `AILKG_DATABASE_URL` to a SQLite file under that directory.
- Set `AILKG_SECRET_FILE` to a secrets file under that directory.
- Start the packaged backend sidecar.
- Poll `/health` until ready.
- Open the React window with the backend URL injected.
- Stop the backend process when the app exits.

Desktop data paths:

- Windows: `%APPDATA%/AI Learning Knowledge Graph/`
- macOS: `~/Library/Application Support/AI Learning Knowledge Graph/`
- Linux: `~/.config/ai-learning-knowledge-graph/`

The desktop build will use PyInstaller because it packages Python applications with their dependencies into standalone executables for the target operating system. Each OS must build its own backend binary; PyInstaller is not a cross-compiler.

### Android Runtime

Add Capacitor Android to the frontend and integrate Chaquopy into the generated Android app.

Android startup responsibilities:

- Start Python once from the Android application lifecycle.
- Set backend environment variables before importing the backend:
  - `AILKG_DATABASE_URL=sqlite:////<app-files-dir>/knowledge.db`
  - `AILKG_SECRET_FILE=<app-files-dir>/secrets.json`
  - `AILKG_CORS_ORIGINS=http://localhost,http://127.0.0.1,capacitor://localhost`
- Start Uvicorn on `127.0.0.1` with an app-private port.
- Wait for `/health`.
- Load the Capacitor WebView.
- Keep the service local-only; never bind to `0.0.0.0` on Android.

Chaquopy constraints shape the first Android implementation:

- Minimum Android SDK must be at least 24.
- Support `arm64-v8a` for real devices and `x86_64` for emulators.
- Python source can be included from Android source sets or copied from the backend.
- Runtime-writable data must go under app-private storage, not inside bundled Python source directories.
- Python dependencies must be checked against Chaquopy support. `pydantic-core`, SQLAlchemy, httpx, FastAPI, and Uvicorn must be validated in an Android build.

If a dependency cannot be packaged on Android, the fallback is to keep the FastAPI contract but replace the failing dependency with an Android-compatible alternative inside the backend layer. That fallback should be limited to the smallest necessary change.

## Backend Changes

Add a reusable local server entrypoint:

- `backend/app/local_server.py`

Responsibilities:

- Read host, port, database URL, and secret file from environment.
- Start `uvicorn.run("app.main:app", host=host, port=port, reload=False)`.
- Avoid development-only reload and worker settings.
- Provide a small Python function callable from Android to start the server in a background thread.

Update configuration:

- Allow CORS origins to be configured from an environment variable.
- Preserve existing dev origins.
- Support file paths with spaces and Android app-private paths.

Keep data isolation unchanged:

- Knowledge base isolation remains enforced by existing APIs.
- Learning run, source, card, node, and edge flows remain unchanged.
- API keys remain stored through the existing secret store, with platform-specific file locations.

## Frontend Changes

Update `frontend/src/api.ts` so the API base can come from:

- a runtime global injected by Electron or Android
- `import.meta.env.VITE_API_BASE_URL`
- fallback `/api`

Add a small platform/bootstrap module:

- report current runtime: web, desktop, android
- expose backend readiness status
- show a local backend startup error screen if `/health` never becomes ready

Keep the core React app shared across web, desktop, and Android.

## UI Adaptation

The current responsive CSS mostly compresses the desktop layout. The standalone packaging work must include a real device layout pass.

Desktop:

- Preserve the left rail navigation.
- Keep graph canvas and detail panel side-by-side on wide screens.
- Ensure window resize re-fits the G6 graph.
- Keep the AI assistant as a right drawer with an overlay and focus-safe close behavior.

Android:

- Replace the left rail with compact touch navigation.
- Use `100dvh` and safe-area padding for full-height panels.
- Make graph controls wrap or collapse into a filter sheet.
- Prefer graph canvas first; move node details into a bottom sheet or full-width panel.
- Make source settings and history detail forms single-column.
- Ensure the AI assistant works as a full-screen or bottom-sheet panel and is not hidden by the soft keyboard.
- Prevent horizontal page overflow at common device widths.

## Feature Preservation Requirements

The packaged apps must preserve:

- model configuration and connection testing
- knowledge base creation, switching, deletion, and isolation
- source configuration, including custom sources
- learning run creation and collection
- AI reading analysis and summarization
- candidate card selection and approval into the graph
- history retention, deletion, pinning, and source text clearing
- graph exploration and graph-side AI assistant
- import/export without leaking raw API keys
- offline browsing of already saved local data

Network-dependent features may fail offline, but the app must show clear errors and keep local data usable.

## Error Handling

Backend startup:

- Show "local service starting" while waiting for `/health`.
- If startup fails, show port, platform, and log location.
- Desktop should retry with a new port if the first port is occupied.
- Android should stop retrying after a bounded number of attempts and display the startup error.

Long-running AI and crawling requests:

- Do not impose a short frontend timeout.
- Show an in-progress state while the local backend is still working.
- If Android is backgrounded, preserve the UI state and reload latest run status on resume.

Dependency/package failure:

- Desktop build failures are handled per OS build job.
- Android dependency failures are treated as build blockers for the full standalone route and must be fixed or replaced before claiming Android completion.

## Testing and Verification

Existing baseline:

- `npm run test:backend`
- `npm run test:frontend`
- `npm run build:frontend`

Desktop verification:

- Build the backend with PyInstaller on the target OS.
- Run Electron dev mode and confirm it starts the local backend.
- Confirm `/health` becomes ready before the main window loads.
- Create a knowledge base, save model settings, run a learning task, approve cards, restart the app, and confirm data persists in the user data directory.

Android verification:

- Build the Capacitor Android project.
- Confirm Chaquopy packages the Python backend and dependencies.
- Install a debug APK on emulator and, if possible, one real Android device.
- Confirm local backend starts on loopback and `/health` returns ready.
- Run model connection test from the app.
- Run at least one light learning flow with local SQLite persistence.
- Restart the app and confirm data persists.

UI verification:

- Desktop viewports: `1440x900`, `1280x720`, `1024x768`.
- Android viewports: `360x800`, `393x873`, `412x915`.
- Check learn, graph, history, and settings screens.
- Assert there is no horizontal overflow.
- Manually check graph drag/zoom, assistant panel, source editor, and soft keyboard behavior.

## Risks

Android standalone is the risky part. The app currently depends on Python backend libraries that were designed for regular Python environments. Chaquopy supports Python on Android, but dependency packaging must be proven by an actual Gradle build.

Large APK size is expected because the app includes a Python runtime, backend code, dependencies, and the web bundle. The first target should be correctness, then size reduction.

Running an HTTP server inside Android is pragmatic for code reuse, but it must stay bound to loopback and should not be exposed to the local network.

The long-term cleaner architecture may be to move shared domain logic into a portable core and keep platform-specific storage/network adapters. That is larger than this packaging phase and should not block the first standalone build.

## References

- Chaquopy Android Gradle plugin documentation: https://chaquo.com/chaquopy/doc/current/android.html
- Capacitor installation and sync workflow: https://capacitorjs.com/docs/getting-started
- PyInstaller manual: https://pyinstaller.org/en/stable/
- FastAPI manual server deployment notes: https://fastapi.tiangolo.com/deployment/manually/
