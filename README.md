# StageControl (StageFlow) 🎛️

A lightweight, self-hostable live event production hub for school, university, and community event crews. Supports laptops, tablets, and phones with a high-contrast dark control room interface.

---

## 🚀 MVP Development Milestones

| Milestone | Feature | Status | Description |
|---|---|---|---|
| **01** | **Basic Authentication & Event Access** | ✅ **Complete** | Argon2id auth, JWT sessions, event roles (`admin`, `stage_manager`, `crew`, `presenter`, `viewer`), event isolation & crew management |
| **02** | **Live Video & Recording Playback** | 🟡 *Next* | OBS → MediaMTX → WebRTC ultra-low-latency player + FFmpeg seekable HLS recording archive |
| **03** | **Script Import & Synchronized Following** | ⚪ *Planned* | DOCX/Text parser, line-by-line stage advancement via WebSockets, presenter teleprompter mode |
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

### Option B: Run with Docker Compose

```bash
docker compose up --build
```
This boots:
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

*Note: The first account registered in the system automatically receives Lead Superadmin privileges for initial setup.*

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
