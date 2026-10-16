# StageControl (StageFlow) 🎛️

A lightweight, self-hostable live event production hub for school, university, and community event crews. Supports laptops, tablets, and phones with a high-contrast dark control room interface.

---

## 🚀 MVP Development Milestones

| Milestone | Feature | Status | Description |
|---|---|---|---|
| **01** | **Basic Authentication & Event Access** | ✅ **Complete** | Argon2id auth, JWT sessions, event roles (`admin`, `stage_manager`, `crew`, `presenter`, `viewer`), event isolation & crew management |
| **02** | **Live Video, Recording & AI Subtitles** | ✅ **Complete** | OBS → MediaMTX → WebRTC/HLS + seekable recording archive + chapters & marks + server-side Malaysian Whisper live transcription & subtitles (Manglish & Malay slang) |
| **03** | **Script Import & Synchronized Following** | 🟡 *Next* | DOCX/Text parser, line-by-line stage advancement via WebSockets, presenter teleprompter mode |
| **04** | **Walkie-Talkie Push-to-Talk Comms** | ⚪ *Planned* | WebRTC hold-to-talk voice channel with live speaker indicators and network resilience |

---

## 🛠️ Architecture & Tech Stack

- **Monorepo Layout**:
  - `apps/web`: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, Lucide Icons.
  - `apps/api`: FastAPI, Python 3.12, SQLAlchemy 2.0, SQLite with foreign key enforcement, Alembic migrations, Argon2id (`argon2-cffi`), PyJWT.
  - `services/mediamtx`: MediaMTX configuration for RTMP OBS ingest, WebRTC streaming, and HLS recording.
  - `storage/`: Persistent storage for SQLite database (`storage/db/stageflow.db`) and recorded video files (`storage/recordings/`).
  - `docker-compose.yml`: One-command self-hosting for VPS or local server deployment.

---

## ⚡ Quickstart

### Option A: Local Development (Recommended for Development)

#### 1. Start the FastAPI Backend
```bash
# In apps/api
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Run migrations
alembic upgrade head

# Start API server
uvicorn app.main:app --reload --port 8000
```
API Documentation will be available at [http://localhost:8000/api/docs](http://localhost:8000/api/docs).

#### 2. Start the Next.js Frontend
```bash
# In apps/web
cd apps/web
npm install
npm run dev
```
Web Application will be available at [http://localhost:3000](http://localhost:3000).

---

### Option B: Docker with Hot Reloading (Development)

Run all services with instant hot-reloading for both FastAPI and Next.js:
```bash
docker compose -f docker-compose.dev.yml up --build
```
- Edit Python files in `apps/api/app` → Uvicorn reloads automatically.
- Edit React/TSX files in `apps/web/src` → Fast Refresh updates the browser instantly.

---

### Option C: Production Docker Deployment

```bash
docker compose up -d --build
```
This boots optimized production builds:
- Web UI on `http://localhost:3000`
- API on `http://localhost:8000`
- MediaMTX RTMP on `rtmp://localhost:1935/live`
- MediaMTX WebRTC on `http://localhost:8889`
- MediaMTX HLS on `http://localhost:8888`

---

## 🔐 Role-Based Access Control (RBAC)

| Permission / Action | Admin | Stage Manager | Crew | Presenter | Viewer |
|---|:---:|:---:|:---:|:---:|:---:|
| Create / Delete Event | ✅ | ❌ | ❌ | ❌ | ❌ |
| Invite & Manage Crew | ✅ | ❌ | ❌ | ❌ | ❌ |
| View / Regenerate Stream Key | ✅ | ✅ | ❌ | ❌ | ❌ |
| Advance Script Cues (Milestone 3) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Access Walkie-Talkie (Milestone 4) | ✅ | ✅ | ✅ | ❌ | ❌ |
| Teleprompter View | ✅ | ✅ | ✅ | ✅ | ❌ |
| Watch Program Stream | ✅ | ✅ | ✅ | ✅ | ✅ |
| Manage Public 6-Digit PIN | ✅ | ❌ | ❌ | ❌ | ❌ |

*Note: The first account registered in the system automatically receives Lead Superadmin privileges for initial setup.*

---

## 🎟️ Public 6-Digit PIN Guest Access (No Account Required)

For school/university events and public audiences who should not have to create an account:
- **Admin Control**: An Admin can generate a 6-digit PIN (e.g. `482 910`) and share the direct link (`/view/482910`).
- **Instant Revocation**: Clicking "Revoke Access" instantly closes public entry and revokes existing guest viewer sessions.
- **Audience Entry Flow**:
  1. **Direct Link**: Guests open `http://localhost:3000/view/482910`, enter an optional nickname (e.g. `Audience - Hall A`), and enter with one click.
  2. **Keypad Entry**: On the main login page, guests select the **Guest PIN** tab, type the 6-digit PIN, and enter immediately in read-only **Viewer** mode.

---

## 🌐 Global & Alternative LAN Domain Configuration

Lead Superadmins can configure global domains in **Settings** (`/admin/settings`):
- **Primary Global Domain**: The canonical public domain (e.g. `https://stagecontrol.myschool.edu`) used when generating shareable links, teleprompter views, and guest PIN links.
- **Alternative / LAN Fallback Domain**: Secondary domain or local IP (e.g. `http://192.168.1.100:3000`) for isolated venue Wi-Fi networks where devices cannot access the public internet.
- **Link Switcher**: Event control room includes a one-click toggle to copy links formatted with either the Primary or Alternative domain.

---

## 📺 Live Video Streaming & Recording Playback (Milestone 2)

- **OBS Studio RTMP & WHIP Ingest**:
  - RTMP Endpoint: `rtmp://<host>:1935/live`
  - Stream Key: Secret event stream key generated per event
  - WebRTC WHIP URL: `http://<host>:8889/live/<stream_key>/whip`
- **Dual-Engine Browser Player**:
  - **WebRTC WHEP (Ultra-Low Latency)**: ~150-250ms sub-second delivery for stage managers, lighting ops, and camera directors.
  - **HLS Fallback**: Buffered playback with adaptive sync via `hls.js` or native Safari HLS.
- **Automated Crash-Resilient fMP4 Recording**:
  - Live streams are recorded automatically in fragmented MP4 (`fmp4`) format to persistent storage (`storage/recordings/`).
  - Survives container and service restarts with zero data corruption.
- **Timeline Scrubbing & Replay Archive**:
  - Full HTTP 206 Partial Content (range request) video streaming support.
  - Seek backward/forward 10s, variable speed control (0.5x to 2x), volume control, and full-resolution MP4 downloads.
  - Rename takes and manage recordings with role-based access control.

---


## 🧪 Testing

### Backend Unit & Integration Tests (Argon2id, JWT, RBAC, Event Isolation)
```bash
PYTHONPATH=apps/api apps/api/.venv/bin/pytest apps/api/tests -v
```

### Frontend Build & Typecheck
```bash
cd apps/web && npm run build
```
