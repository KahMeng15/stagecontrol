import asyncio
import logging
import re
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


def is_music_text(text: str) -> bool:
    """Detects whether text contains musical notation, singing/music tags, or known music hallucination phrases."""
    if not text:
        return False
    stripped = text.strip()
    lower = stripped.lower()
    music_keywords = [
        "[music]", "(music)", "{music}",
        "[singing]", "(singing)", "{singing}",
        "[song]", "(song)", "{song}",
        "[instrumental]", "(instrumental)", "{instrumental}",
        "thanks for watching", "thank you for watching",
        "to this dream", "down your face",
        "try to fix you", "stuck in reverse",
        "chopin",
    ]
    if any(kw in lower for kw in music_keywords):
        return True

    if any(ch in stripped for ch in ["♪", "♫", "♩", "♬", "🎶"]):
        return True

    return False


def detect_music_acoustics(audio: np.ndarray, sample_rate: int = 16000) -> bool:
    """
    Evaluates acoustic energy consistency to detect sustained performance audio,
    backing tracks, songs, or dance tracks versus bursty spoken speech.
    Sustained musical audio has steady RMS energy (coefficient of variation < 0.25) and RMS > 0.015,
    whereas spoken dialogue has frequent pauses and high syllable variance (CV > 0.35).
    """
    if len(audio) < sample_rate * 1.0:
        return False

    frame_len = int(sample_rate * 0.25)  # 250ms windows
    energies = []
    for s in range(0, len(audio) - frame_len + 1, frame_len // 2):
        f = audio[s:s + frame_len]
        energies.append(float(np.sqrt(np.mean(f**2))))

    if not energies:
        return False

    mean_energy = float(np.mean(energies))
    if mean_energy < 0.015:  # Low ambient room noise / mic hiss, not loud performance music
        return False

    std_energy = float(np.std(energies))
    coeff_var = std_energy / mean_energy

    # Continuous musical backing track has low CV (< 0.25)
    return coeff_var < 0.25


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
                import os
                from faster_whisper import WhisperModel
                cpu_threads = min(4, os.cpu_count() or 4)
                model_name = settings.TRANSCRIPTION_MODEL
                download_root = os.getenv("TRANSCRIPTION_MODEL_PATH", "/storage/models")
                if os.path.exists("/app/cache/models"):
                    download_root = "/app/cache/models"
                try:
                    os.makedirs(download_root, exist_ok=True)
                except Exception:
                    pass

                logger.info(f"Loading speech-to-text model: {model_name} (download_root={download_root}, cpu_threads={cpu_threads})")
                self.model = WhisperModel(
                    model_name,
                    device="cpu",
                    compute_type="int8",
                    cpu_threads=cpu_threads,
                    download_root=download_root
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

    @staticmethod
    def _is_hallucinated_repetition(text: str) -> bool:
        """Filters out degenerate hallucination loops like 'Ah-ha-ha-ha...' or repeated token loops."""
        import re, zlib
        if not text or len(text) < 2:
            return True
        raw_bytes = text.encode("utf-8")
        compressed = zlib.compress(raw_bytes)
        ratio = len(raw_bytes) / max(1, len(compressed))
        if ratio > 2.2 and len(text) > 15:
            return True
        # Detect token/syllable repetition loops (e.g. ha-ha-ha-ha, ah-ah-ah-ah, bla bla bla bla)
        if re.search(r'([A-Za-z]{1,6}[- ]?)\1{3,}', text, re.IGNORECASE):
            return True
        # Detect repeated phrase loops
        words = text.strip().split()
        if len(words) >= 5:
            unique_words = set(w.lower().strip(".,!?-") for w in words)
            if len(unique_words) <= 2:
                return True
        return False

    def _transcribe_chunk_sync(self, audio_data: np.ndarray) -> tuple[list[dict], bool]:
        """Synchronously runs whisper inference on a float32 16kHz mono audio chunk."""
        model = self._get_model()
        results = []
        is_acoustics = detect_music_acoustics(audio_data)

        try:
            # Clean theatre & stage rehearsal vocabulary priming without hallucinating music symbols
            initial_prompt = "Stage rehearsal and live theatre dialogue in English and Bahasa Melayu."
            segments, info = model.transcribe(
                audio_data,
                task="transcribe",
                language=None,  # Automatically detect language per chunk
                initial_prompt=initial_prompt,
                beam_size=1,  # Fast greedy decoding for low-latency live captions
                temperature=0.0,
                condition_on_previous_text=False,  # Prevents repeating previous text or looping
                without_timestamps=True,  # Significant speedup since timestamps are managed by the audio chunker
                vad_filter=True,  # Silero VAD filters out laughter, breathing, and mic hum before decoding
                vad_parameters=dict(min_silence_duration_ms=350),
                no_speech_threshold=0.6,
                compression_ratio_threshold=2.4,
                repetition_penalty=1.2,  # Penalizes generating identical tokens repeatedly
            )
            for seg in segments:
                text = seg.text.strip()
                if text and len(text) > 1 and not self._is_hallucinated_repetition(text):
                    is_seg_music = is_music_text(text) or (seg.no_speech_prob > 0.45)

                    results.append({
                        "text": text,
                        "raw_text": text,
                        "start": seg.start,
                        "end": seg.end,
                        "language": info.language or "en",
                        "is_music": is_seg_music or is_acoustics,
                    })
        except Exception as e:
            logger.error(f"Error during whisper inference: {e}")
        return results, is_acoustics

    async def _transcription_worker(self, event_id: str, stream_key: str):
        """
        Background worker using a decoupled producer-consumer queue:
        - Producer: Continuously reads 16kHz mono PCM from FFmpeg stdout with zero backpressure on MediaMTX.
        - Consumer: Accumulates speech utterances using voice activity energy detection and transcribes without cutting words in half.
        """
        rtmp_url = f"{settings.MEDIAMTX_RTMP_URL}/live/{stream_key}"
        
        # Audio specs: 16kHz, 16-bit mono PCM = 32,000 bytes/sec
        SAMPLE_RATE = 16000
        BYTES_PER_SEC = SAMPLE_RATE * 2  # 32,000 bytes/sec
        MIN_UTTERANCE_BYTES = int(BYTES_PER_SEC * 1.5)  # At least 1.5s of speech
        MAX_UTTERANCE_BYTES = int(BYTES_PER_SEC * 4.0)  # At most 4.0s before forcing a chunk
        PAUSE_SILENCE_BYTES = int(BYTES_PER_SEC * 0.45) # 0.45s of silence marks end of sentence/phrase
        ENERGY_THRESHOLD = 0.006                         # RMS energy threshold distinguishing speech from mic noise

        logger.info(f"Transcription worker attempting connection to RTMP stream {rtmp_url}")

        cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel", "error",
            "-fflags", "nobuffer",
            "-flags", "low_delay",
            "-probesize", "32768",
            "-analyzeduration", "0",
            "-i", rtmp_url,
            "-vn",
            "-acodec", "pcm_s16le",
            "-ar", str(SAMPLE_RATE),
            "-ac", "1",
            "-f", "s16le",
            "pipe:1"
        ]

        proc = None
        audio_queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=120)
        reader_task = None

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL
            )
            self.active_processes[event_id] = proc

            async def _audio_producer():
                """Continuously drains FFmpeg stdout into audio_queue so FFmpeg never blocks."""
                try:
                    while True:
                        block = await proc.stdout.read(4096)
                        if not block:
                            break
                        # If queue is full (consumer lagged momentarily), drop oldest block to preserve live stream
                        if audio_queue.full():
                            try:
                                audio_queue.get_nowait()
                            except asyncio.QueueEmpty:
                                pass
                        await audio_queue.put(block)
                except asyncio.CancelledError:
                    pass
                except Exception as err:
                    logger.debug(f"Audio producer exception: {err}")
                finally:
                    await audio_queue.put(None)

            reader_task = asyncio.create_task(_audio_producer())

            audio_buffer = bytearray()
            stream_elapsed = 0.0
            has_speech = False
            silence_bytes = 0

            while True:
                block = await audio_queue.get()
                if block is None:
                    # Stream ended
                    logger.info(f"FFmpeg stream finished for event {event_id}")
                    break

                audio_buffer.extend(block)

                # Evaluate RMS of the newly arrived block to determine speech vs silence
                block_np = np.frombuffer(block, dtype=np.int16).astype(np.float32) / 32768.0
                block_rms = float(np.sqrt(np.mean(block_np**2))) if len(block_np) > 0 else 0.0

                if block_rms >= ENERGY_THRESHOLD:
                    has_speech = True
                    silence_bytes = 0
                else:
                    silence_bytes += len(block)

                # Check if we should trigger transcription
                should_transcribe = False
                trigger_reason = ""

                if has_speech and silence_bytes >= PAUSE_SILENCE_BYTES and len(audio_buffer) >= MIN_UTTERANCE_BYTES:
                    # Natural pause after a spoken phrase
                    should_transcribe = True
                    trigger_reason = "pause"
                elif has_speech and len(audio_buffer) >= MAX_UTTERANCE_BYTES:
                    # Continuous speech reached max duration
                    should_transcribe = True
                    trigger_reason = "max_len"
                elif not has_speech and len(audio_buffer) >= int(BYTES_PER_SEC * 1.5):
                    # Pure silence / background noise: discard to conserve CPU and advance clock
                    dropped_sec = len(audio_buffer) / BYTES_PER_SEC
                    stream_elapsed += dropped_sec
                    audio_buffer.clear()
                    silence_bytes = 0
                    continue

                if should_transcribe:
                    raw_audio = bytes(audio_buffer)
                    audio_buffer.clear()
                    has_speech = False
                    silence_bytes = 0

                    duration_sec = len(raw_audio) / BYTES_PER_SEC
                    audio_np = np.frombuffer(raw_audio, dtype=np.int16).astype(np.float32) / 32768.0

                    # Run inference in background thread
                    results, is_acoustics = await asyncio.to_thread(self._transcribe_chunk_sync, audio_np)

                    now = datetime.now(timezone.utc)
                    start_sec = round(stream_elapsed, 1)
                    end_sec = round(stream_elapsed + duration_sec, 1)
                    stream_elapsed += duration_sec

                    combined_text = ""
                    is_chunk_music = False

                    if results:
                        combined_text = " ".join(r["text"] for r in results).strip()
                        is_chunk_music = any(r.get("is_music", False) for r in results) or is_music_text(combined_text) or is_acoustics
                    elif is_acoustics:
                        # Purely instrumental dance performance, backing track, or music without decoded dialogue
                        combined_text = "♪ [Live Music / Performance] ♪"
                        is_chunk_music = True

                    if combined_text:
                        # Save to Database
                            db: Session = SessionLocal()
                            try:
                                import re
                                from pathlib import Path
                                from app.models.recording import Recording

                                sub_rec_id = None
                                # Check if there is an active recording file currently on disk
                                rec_dirs = [Path("/storage/recordings/live") / stream_key, Path("storage/recordings/live") / stream_key]
                                for rd in rec_dirs:
                                    if rd.exists():
                                        files = sorted(rd.glob("*.mp4"), key=lambda f: f.stat().st_mtime, reverse=True)
                                        if files:
                                            latest = files[0]
                                            # If touched within last 45s, this is the active take being recorded
                                            if (time.time() - latest.stat().st_mtime) < 45.0:
                                                rel_path = f"live/{stream_key}/{latest.name}"
                                                active_rec = db.query(Recording).filter(
                                                    Recording.event_id == event_id,
                                                    Recording.filename == rel_path
                                                ).first()

                                                match = re.search(r'(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})', latest.stem)
                                                if match:
                                                    dt_str = f"{match.group(1)} {match.group(2)}:{match.group(3)}:{match.group(4)}"
                                                    start_dt = datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
                                                else:
                                                    start_dt = datetime.fromtimestamp(latest.stat().st_mtime, tz=timezone.utc)

                                                if not active_rec:
                                                    friendly_title = f"{start_dt.strftime('%I:%M:%S %p').lower()} {start_dt.day} {start_dt.strftime('%b %Y')}"
                                                    active_rec = Recording(
                                                        event_id=event_id,
                                                        title=friendly_title,
                                                        filename=rel_path,
                                                        file_size_bytes=latest.stat().st_size,
                                                        duration_seconds=0.0,
                                                        status="recording",
                                                        created_at=start_dt
                                                    )
                                                    db.add(active_rec)
                                                    db.commit()
                                                    db.refresh(active_rec)

                                                sub_rec_id = active_rec.id
                                                diff = max(0.0, (now - start_dt).total_seconds())
                                                start_sec = round(diff, 1)
                                                end_sec = round(diff + duration_sec, 1)
                                                break

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
                                    is_music=bool(is_chunk_music),
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
                                "is_music": is_chunk_music,
                                "created_at": now.isoformat()
                            }
                            await self.broadcast_subtitle(event_id, payload)
                            music_indicator = " [MUSIC/SINGING]" if is_chunk_music else ""
                            logger.info(f"[{event_id[:8]}] Subtitle ({start_sec}s, {trigger_reason}{music_indicator}): {combined_text}")

                            # Auto-sync live speech with event's active script
                            try:
                                await self._match_and_sync_script(event_id, combined_text, is_music=is_chunk_music)
                            except Exception as sync_err:
                                logger.warning(f"Script sync check failed: {sync_err}")

        except asyncio.CancelledError:
            logger.info(f"Transcription worker cancelled for event {event_id}")
        except Exception as e:
            logger.error(f"Error in transcription worker for event {event_id}: {e}", exc_info=True)
        finally:
            if reader_task:
                reader_task.cancel()
            if proc:
                try:
                    proc.kill()
                    await proc.wait()
                except Exception:
                    pass
            self.active_processes.pop(event_id, None)
            self.active_tasks.pop(event_id, None)
            logger.info(f"Transcription worker cleanly exited for event {event_id}")

    async def _match_and_sync_script(self, event_id: str, spoken_text: str, is_music: bool = False):
        """
        Fuzzy matches speech against event's active script blocks with ~75-80% wildcard tolerance,
        with music & singing protection against mistranscription jumps.
        If matched, updates current active block and broadcasts 'script_sync' to all connected crew.
        """
        try:
            from app.models.script import Script
            from app.services.script_parser import match_spoken_text_to_script
            from app.routers.scripts import event_active_blocks, event_last_script_match_time, event_auto_jump

            db: Session = SessionLocal()
            try:
                active_script = db.query(Script).filter(
                    Script.event_id == event_id,
                    Script.is_active == 1
                ).order_by(Script.version.desc()).first()

                if not active_script:
                    return

                blocks = []
                for sec in active_script.sections:
                    blocks.extend(sec.blocks)

                if not blocks:
                    return

                curr_block_id = event_active_blocks.get(event_id)
                curr_idx = None
                if curr_block_id:
                    for b in blocks:
                        if b.id == curr_block_id:
                            curr_idx = b.order_index
                            break

                now = time.time()
                last_time = event_last_script_match_time.get(event_id, 0.0)
                time_since = (now - last_time) if last_time > 0 else 999.0
                allow_jump = event_auto_jump.get(event_id)
                if allow_jump is None:
                    allow_jump = bool(getattr(active_script, "auto_jump", False))
                    event_auto_jump[event_id] = allow_jump

                matched_block, confidence = match_spoken_text_to_script(
                    blocks=blocks,
                    spoken_text=spoken_text,
                    current_block_index=curr_idx,
                    time_since_last_match=time_since,
                    threshold=0.62,
                    local_window_size=5,
                    global_search_delay_seconds=3.0,
                    is_music=is_music,
                    allow_jump=allow_jump
                )

                if matched_block:
                    event_active_blocks[event_id] = matched_block.id
                    event_last_script_match_time[event_id] = now
                    ev = db.query(Event).filter(Event.id == event_id).first()
                    if ev and ev.slug:
                        event_active_blocks[ev.slug] = matched_block.id
                        event_last_script_match_time[ev.slug] = now

                    sync_payload = {
                        "type": "script_sync",
                        "event_id": event_id,
                        "block_id": matched_block.id,
                        "section_id": matched_block.section_id,
                        "order_index": matched_block.order_index,
                        "speaker": matched_block.speaker,
                        "cue": matched_block.cue,
                        "dialogue": matched_block.dialogue,
                        "spoken_text": spoken_text,
                        "confidence": round(confidence, 2),
                        "is_music": is_music,
                    }
                    await self.broadcast_subtitle(event_id, sync_payload)
                    if ev and ev.slug:
                        await self.broadcast_subtitle(ev.slug, sync_payload)
                    logger.info(f"[{event_id[:8]}] Script Auto-Synced to line {matched_block.order_index} ({matched_block.speaker}): {matched_block.dialogue[:50]}... (conf: {confidence:.2f})")
            finally:
                db.close()
        except Exception as e:
            logger.error(f"Error in script sync: {e}", exc_info=True)

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
                                        try:
                                            from app.services.video_processor import post_process_all_event_recordings
                                            asyncio.create_task(asyncio.to_thread(post_process_all_event_recordings, running_id))
                                        except Exception as pp_err:
                                            logger.warning(f"Failed to schedule post-processing for event {running_id}: {pp_err}")
                            finally:
                                db.close()
            except Exception as e:
                # Log only on unexpected failures, avoid flooding logs if server starting up
                pass

            await asyncio.sleep(3.0)

# Global singleton transcription service
transcription_service = TranscriptionService()
