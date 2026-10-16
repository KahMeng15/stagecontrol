import asyncio
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any
import httpx
import numpy as np
from fastapi import WebSocket
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models.event import Event
from app.models.subtitle import Subtitle

logger = logging.getLogger("stagecontrol.transcription")

class TranscriptionService:
    def __init__(self):
        self.model = None
        self._model_loading = False
        self._model_lock = asyncio.Lock()
        
        # Active streaming tasks and processes keyed by event_id
        self.active_tasks: dict[str, asyncio.Task] = {}
        self.active_processes: dict[str, asyncio.subprocess.Process] = {}
        
        # Connected WebSocket clients keyed by event_id
        self.subscribers: dict[str, set[WebSocket]] = {}
        
        # Background monitor task for auto-starting/stopping
        self.monitor_task: asyncio.Task | None = None

    def _get_model(self):
        """Lazy loads the faster-whisper model on CPU with INT8 quantization."""
        if self.model is None:
            try:
                from faster_whisper import WhisperModel
                logger.info(f"Loading speech-to-text model: {settings.TRANSCRIPTION_MODEL} (device=cpu, int8)")
                self.model = WhisperModel(
                    settings.TRANSCRIPTION_MODEL,
                    device="cpu",
                    compute_type="int8"
                )
                logger.info("Speech-to-text model loaded successfully.")
            except Exception as e:
                logger.error(f"Failed to load speech-to-text model: {e}", exc_info=True)
                raise
        return self.model

    async def register_subscriber(self, event_id: str, websocket: WebSocket):
        """Registers a viewer or crew WebSocket to receive real-time subtitles."""
        if event_id not in self.subscribers:
            self.subscribers[event_id] = set()
        self.subscribers[event_id].add(websocket)

    async def unregister_subscriber(self, event_id: str, websocket: WebSocket):
        """Unregisters a WebSocket subscriber."""
        if event_id in self.subscribers:
            self.subscribers[event_id].discard(websocket)
            if not self.subscribers[event_id]:
                del self.subscribers[event_id]

    async def broadcast_subtitle(self, event_id: str, payload: dict[str, Any]):
        """Broadcasts a subtitle event to all connected clients for this event."""
        if event_id not in self.subscribers:
            return
        
        dead_sockets = set()
        for ws in self.subscribers[event_id]:
            try:
                await ws.send_json(payload)
            except Exception:
                dead_sockets.add(ws)
                
        for dead in dead_sockets:
            self.subscribers[event_id].discard(dead)

    def is_transcribing(self, event_id: str) -> bool:
        """Returns True if live transcription is actively running for this event."""
        return event_id in self.active_tasks and not self.active_tasks[event_id].done()

    async def start_event_transcription(self, event_id: str, stream_key: str):
        """Starts the audio capture and transcription pipeline for an event's live stream."""
        if self.is_transcribing(event_id):
            logger.info(f"Restarting transcription for event {event_id} to ensure real-time sync.")
            await self.stop_event_transcription(event_id)

        logger.info(f"Starting live transcription for event {event_id} (stream_key: {stream_key[:8]}...)")
        task = asyncio.create_task(self._transcription_worker(event_id, stream_key))
        self.active_tasks[event_id] = task

    async def stop_event_transcription(self, event_id: str):
        """Stops live transcription for an event."""
        logger.info(f"Stopping live transcription for event {event_id}")
        if event_id in self.active_processes:
            proc = self.active_processes.pop(event_id)
            try:
                proc.kill()
            except Exception:
                pass

        if event_id in self.active_tasks:
            task = self.active_tasks.pop(event_id)
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    def _transcribe_chunk_sync(self, audio_data: np.ndarray) -> list[dict]:
        """Synchronously runs whisper inference on a float32 16kHz mono audio chunk."""
        model = self._get_model()
        results = []
        try:
            # Balanced bilingual prompt supporting English, Bahasa Melayu, and Manglish code-switching
            initial_prompt = (
                "Live stage rehearsal, sound check, cue standby, microphone test. "
                "Can you hear me? Boleh dengar tak? Jom start now, okay lah, thanks everyone."
            )
            segments, info = model.transcribe(
                audio_data,
                task="transcribe",
                language=None,  # Automatically detect language per chunk (transcribe English as English, Malay as Malay)
                initial_prompt=initial_prompt,
                beam_size=1,  # Fast greedy decoding for low-latency live captions
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=400)
            )
            for seg in segments:
                text = seg.text.strip()
                if text and len(text) > 1:
                    results.append({
                        "text": text,
                        "start": seg.start,
                        "end": seg.end,
                        "language": info.language or "en"
                    })
        except Exception as e:
            logger.error(f"Error during whisper inference: {e}")
        return results

    async def _transcription_worker(self, event_id: str, stream_key: str):
        """
        Background worker that continuously streams audio from MediaMTX via ffmpeg,
        accumulates ~3-second chunks, transcribes them, stores them in the database,
        and broadcasts closed captions to all viewers.
        """
        rtmp_url = f"{settings.MEDIAMTX_RTMP_URL}/live/{stream_key}"
        hls_url = f"{settings.MEDIAMTX_HLS_URL}/live/{stream_key}/index.m3u8"
        
        # Audio specs: 16kHz, 16-bit mono PCM = 32,000 bytes/sec
        SAMPLE_RATE = 16000
        BYTES_PER_SEC = SAMPLE_RATE * 2  # 16-bit = 2 bytes
        CHUNK_DURATION = 3.0             # 3 seconds per segment
        CHUNK_BYTES = int(BYTES_PER_SEC * CHUNK_DURATION)

        logger.info(f"Transcription worker attempting connection to RTMP stream {rtmp_url}")

        # Choose stream source (RTMP preferred, fallback to HLS)
        input_source = rtmp_url

        cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel", "error",
            "-fflags", "nobuffer",
            "-flags", "low_delay",
            "-probesize", "32768",
            "-analyzeduration", "0",
            "-i", input_source,
            "-vn",
            "-acodec", "pcm_s16le",
            "-ar", str(SAMPLE_RATE),
            "-ac", "1",
            "-f", "s16le",
            "pipe:1"
        ]

        proc = None
        stream_elapsed = 0.0

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            self.active_processes[event_id] = proc

            audio_buffer = bytearray()

            while True:
                # Read incoming audio in 4KB blocks
                chunk = await proc.stdout.read(4096)
                if not chunk:
                    # FFmpeg process ended or stream closed
                    logger.info(f"FFmpeg stream closed for event {event_id}")
                    break

                audio_buffer.extend(chunk)

                # Lag protection: if worker takes longer or stream stuttered,
                # discard stale audio beyond 1 chunk so captions never fall behind live
                if len(audio_buffer) > CHUNK_BYTES * 2:
                    audio_buffer = audio_buffer[-CHUNK_BYTES:]

                if len(audio_buffer) >= CHUNK_BYTES:
                    # Extract the chunk
                    raw_audio = bytes(audio_buffer[:CHUNK_BYTES])
                    # Keep slight overlap (0.5s = 16000 bytes) for word boundary continuity
                    overlap_bytes = int(BYTES_PER_SEC * 0.5)
                    audio_buffer = audio_buffer[CHUNK_BYTES - overlap_bytes:]

                    # Convert raw 16-bit PCM bytes to numpy float32 [-1.0, 1.0]
                    audio_np = np.frombuffer(raw_audio, dtype=np.int16).astype(np.float32) / 32768.0

                    # Calculate RMS energy to skip dead silence and conserve CPU
                    rms = np.sqrt(np.mean(audio_np**2))
                    if rms < 0.003:
                        stream_elapsed += (CHUNK_DURATION - 0.5)
                        continue

                    # Run inference in worker thread
                    results = await asyncio.to_thread(self._transcribe_chunk_sync, audio_np)

                    now = datetime.now(timezone.utc)
                    start_sec = round(stream_elapsed, 1)
                    end_sec = round(stream_elapsed + CHUNK_DURATION, 1)
                    stream_elapsed += (CHUNK_DURATION - 0.5)

                    if results:
                        combined_text = " ".join(r["text"] for r in results).strip()
                        if combined_text:
                            # Save to Database
                            db: Session = SessionLocal()
                            try:
                                from app.models.recording import Recording
                                active_rec = (
                                    db.query(Recording)
                                    .filter(Recording.event_id == event_id, Recording.status.in_(["recording", "ready"]))
                                    .order_by(Recording.created_at.desc())
                                    .first()
                                )
                                sub_rec_id = None
                                if active_rec:
                                    rec_start = active_rec.created_at
                                    if rec_start.tzinfo is None:
                                        rec_start = rec_start.replace(tzinfo=timezone.utc)
                                    diff = (now - rec_start).total_seconds()
                                    if 0 <= diff <= (active_rec.duration_seconds + 30 if active_rec.duration_seconds > 0 else 7200):
                                        sub_rec_id = active_rec.id
                                        start_sec = round(diff, 1)
                                        end_sec = round(diff + CHUNK_DURATION, 1)

                                sub = Subtitle(
                                    id=str(uuid.uuid4()),
                                    event_id=event_id,
                                    stream_key=stream_key,
                                    recording_id=sub_rec_id,
                                    text=combined_text,
                                    language=results[0].get("language", "en"),
                                    start_seconds=start_sec,
                                    end_seconds=end_sec,
                                    confidence=0.9,
                                    created_at=now
                                )
                                db.add(sub)
                                db.commit()
                                sub_id = sub.id
                            except Exception as db_err:
                                db.rollback()
                                logger.error(f"Failed to persist subtitle to DB: {db_err}")
                                sub_id = str(uuid.uuid4())
                                sub_rec_id = None
                            finally:
                                db.close()

                            # Broadcast closed captions via WebSocket to all listeners
                            payload = {
                                "type": "subtitle",
                                "id": sub_id,
                                "event_id": event_id,
                                "recording_id": sub_rec_id,
                                "text": combined_text,
                                "language": results[0].get("language", "en"),
                                "start_seconds": start_sec,
                                "end_seconds": end_sec,
                                "created_at": now.isoformat()
                            }
                            await self.broadcast_subtitle(event_id, payload)
                            logger.info(f"[{event_id[:8]}] Subtitle ({start_sec}s): {combined_text}")

        except asyncio.CancelledError:
            logger.info(f"Transcription worker cancelled for event {event_id}")
        except Exception as e:
            logger.error(f"Error in transcription worker for event {event_id}: {e}", exc_info=True)
        finally:
            if proc:
                try:
                    proc.kill()
                    await proc.wait()
                except Exception:
                    pass
            self.active_processes.pop(event_id, None)
            self.active_tasks.pop(event_id, None)
            logger.info(f"Transcription worker cleanly exited for event {event_id}")

    async def start_monitor(self):
        """Starts the background loop that monitors MediaMTX active streams and triggers transcription."""
        if self.monitor_task is None or self.monitor_task.done():
            self.monitor_task = asyncio.create_task(self._monitor_loop())

    async def _monitor_loop(self):
        """Polls MediaMTX every 4 seconds to discover live streams and trigger automatic transcription."""
        logger.info("Starting MediaMTX stream monitor for automatic live transcription...")
        api_url = settings.MEDIAMTX_API_URL.rstrip("/")
        
        while True:
            try:
                if settings.TRANSCRIPTION_AUTO_START:
                    async with httpx.AsyncClient(timeout=3.0) as client:
                        resp = await client.get(f"{api_url}/v3/paths/list")
                        if resp.status_code == 200:
                            data = resp.json()
                            items = data.get("items", []) or []
                            
                            active_stream_keys = set()
                            for item in items:
                                name = item.get("name", "")
                                is_ready = item.get("ready", False)
                                if name.startswith("live/") and is_ready:
                                    sk = name.split("live/", 1)[1]
                                    active_stream_keys.add(sk)

                            # Find matching events in database for active streams
                            active_event_ids = set()
                            db: Session = SessionLocal()
                            try:
                                if active_stream_keys:
                                    events = db.query(Event).filter(Event.stream_key.in_(active_stream_keys)).all()
                                    for ev in events:
                                        active_event_ids.add(ev.id)
                                        if not self.is_transcribing(ev.id):
                                            await self.start_event_transcription(ev.id, ev.stream_key)

                                # Automatically terminate workers for streams that stopped publishing
                                currently_running = list(self.active_tasks.keys())
                                for running_id in currently_running:
                                    if running_id not in active_event_ids:
                                        logger.info(f"Stream stopped for event {running_id}. Cleaning up transcription worker.")
                                        await self.stop_event_transcription(running_id)
                            finally:
                                db.close()
            except Exception as e:
                # Log only on unexpected failures, avoid flooding logs if server starting up
                pass

            await asyncio.sleep(3.0)

# Global singleton transcription service
transcription_service = TranscriptionService()
