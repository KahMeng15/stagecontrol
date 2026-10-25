import asyncio
import gc
import logging
import os
import re
import shutil
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any
import httpx
import numpy as np
from fastapi import WebSocket
from sqlalchemy.orm import Session

from app.config import settings, MODELS_DIR
from app.database import SessionLocal
from app.models.event import Event
from app.models.subtitle import Subtitle
from app.models.settings import SystemSettings

logger = logging.getLogger("stagecontrol.transcription")

ALLOWED_LANGUAGES = {"en", "ms", "zh"}
INITIAL_PROMPT = "English, Bahasa Melayu, and Mandarin Chinese 华语 dialogue, stage communications, cues, and theatre rehearsal."

AVAILABLE_MODELS = [
    {
        "id": "mesolitica-large-v3-turbo",
        "name": "Mesolitica Malaysian Whisper Large-v3-Turbo (v3)",
        "repo_id": "SeamlessX/malaysian-faster-whisper-large-v3-turbo-v3-ct2",
        "aliases": ["mesolitica/Malaysian-whisper-large-v3-turbo-v3", "SeamlessX/malaysian-faster-whisper-large-v3-turbo-v3-ct2"],
        "category": "Mesolitica Malaysian",
        "description": "Mesolitica's flagship Malaysian Whisper Large-v3-Turbo fine-tuned for Bahasa Melayu, Malaysian English (Manglish), Mandarin code-switching, and local Malaysian accents.",
        "size_estimate": "1.6 GB",
        "recommended": True,
    },
    {
        "id": "mesolitica-medium-v2",
        "name": "Mesolitica Malaysian Whisper Medium-v2",
        "repo_id": "KeemOnHFace/malaysian-whisper-medium-v2-ct2",
        "aliases": ["mesolitica/malaysian-whisper-medium-v2", "KeemOnHFace/malaysian-whisper-medium-v2-ct2"],
        "category": "Mesolitica Malaysian",
        "description": "Mesolitica's medium Malaysian model, balanced for accuracy and lower RAM requirements.",
        "size_estimate": "1.5 GB",
        "recommended": False,
    },
    {
        "id": "mesolitica-small-v3",
        "name": "Mesolitica Malaysian Whisper Small-v3",
        "repo_id": "SeamlessX/malaysian-faster-whisper-small-v3-ct2",
        "aliases": ["mesolitica/malaysian-whisper-small-v3", "SeamlessX/malaysian-faster-whisper-small-v3-ct2"],
        "category": "Mesolitica Malaysian",
        "description": "Mesolitica's small Malaysian model, optimized for low memory usage and ultra-fast CPU inference.",
        "size_estimate": "480 MB",
        "recommended": False,
    },
    {
        "id": "whisper-large-v3-turbo",
        "name": "Stock Whisper Large-v3-Turbo",
        "repo_id": "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
        "aliases": ["large-v3-turbo", "mobiuslabsgmbh/faster-whisper-large-v3-turbo"],
        "category": "Stock Whisper",
        "description": "OpenAI official Whisper Large-v3-Turbo architecture with 4 decoder layers for fast real-time transcription.",
        "size_estimate": "1.6 GB",
        "recommended": False,
    },
    {
        "id": "whisper-large-v3",
        "name": "Stock Whisper Large-v3",
        "repo_id": "Systran/faster-whisper-large-v3",
        "aliases": ["large-v3", "Systran/faster-whisper-large-v3"],
        "category": "Stock Whisper",
        "description": "OpenAI official full Whisper Large-v3 model with complete 32 decoder layers for maximum acoustic accuracy.",
        "size_estimate": "3.1 GB",
        "recommended": False,
    },
    {
        "id": "whisper-tiny",
        "name": "Stock Whisper Tiny (Dev / Fallback)",
        "repo_id": "Systran/faster-whisper-tiny",
        "aliases": ["tiny", "Systran/faster-whisper-tiny"],
        "category": "Stock Whisper",
        "description": "Ultra-lightweight fallback model for quick testing and low-spec environments.",
        "size_estimate": "78 MB",
        "recommended": False,
    },
]


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
        self._inference_lock = threading.Lock()
        
        self.active_model_name: str | None = None
        self.loaded_model_repo: str | None = None
        self.download_status: dict[str, dict] = {}
        
        # Active streaming tasks and processes keyed by event_id
        self.active_tasks: dict[str, asyncio.Task] = {}
        self.active_processes: dict[str, asyncio.subprocess.Process] = {}
        
        # Connected WebSocket clients keyed by event_id
        self.subscribers: dict[str, set[WebSocket]] = {}
        
        # Background monitor task for auto-starting/stopping
        self.monitor_task: asyncio.Task | None = None

        # Rolling spoken context history keyed by event_id: list of {"text": str, "timestamp": float}
        self.event_spoken_history: dict[str, list[dict]] = {}

    @staticmethod
    def resolve_repo_id(model_identifier: str) -> str:
        """Resolves a model id or alias to the exact Hugging Face CTranslate2 repo id."""
        clean_id = model_identifier.strip()
        for m in AVAILABLE_MODELS:
            if clean_id.lower() == m["id"].lower() or clean_id.lower() == m["repo_id"].lower():
                return m["repo_id"]
            for alias in m.get("aliases", []):
                if clean_id.lower() == alias.lower():
                    return m["repo_id"]
        return clean_id

    def _get_active_setting_from_db(self) -> str:
        """Reads active model from system settings table, defaulting to Mesolitica Large v3 Turbo."""
        db = SessionLocal()
        try:
            sys_setting = db.query(SystemSettings).filter(SystemSettings.id == "default").first()
            if sys_setting and getattr(sys_setting, "transcription_model", None):
                return sys_setting.transcription_model
        except Exception as e:
            logger.debug(f"Could not read transcription_model from DB: {e}")
        finally:
            db.close()
        return settings.TRANSCRIPTION_MODEL

    def _get_model(self):
        """Lazy loads the unified faster-whisper model on CPU with INT8 quantization."""
        if self.model is None:
            try:
                from faster_whisper import WhisperModel
                from huggingface_hub import scan_cache_dir

                cpu_threads = min(4, os.cpu_count() or 4)
                download_root = os.getenv("TRANSCRIPTION_MODEL_PATH", str(MODELS_DIR))
                os.makedirs(download_root, exist_ok=True)

                raw_model = self.active_model_name or self._get_active_setting_from_db()
                target_repo = self.resolve_repo_id(raw_model)

                # Scan local cache to verify whether the target model is downloaded
                cached_repos = set()
                try:
                    report = scan_cache_dir(download_root)
                    for r in report.repos:
                        cached_repos.add(r.repo_id)
                except Exception as cache_err:
                    logger.debug(f"Error scanning local model cache: {cache_err}")

                model_to_load = target_repo
                if target_repo not in cached_repos:
                    # If target is not downloaded, check if any model is available on disk to avoid crash
                    if "Systran/faster-whisper-tiny" in cached_repos:
                        model_to_load = "Systran/faster-whisper-tiny"
                        logger.warning(
                            f"Requested transcription model '{target_repo}' is not yet downloaded on disk. "
                            f"Using cached fallback '{model_to_load}' until downloaded by client."
                        )
                    elif cached_repos:
                        model_to_load = next(iter(cached_repos))
                        logger.warning(
                            f"Requested model '{target_repo}' not found. Using local cached model '{model_to_load}'."
                        )
                    else:
                        logger.info(
                            f"No models found in local cache. Loading '{target_repo}' (will download if internet is reachable)."
                        )

                logger.info(
                    f"Loading unified speech-to-text model: {model_to_load} "
                    f"(target: {target_repo}, download_root={download_root}, cpu_threads={cpu_threads})"
                )
                self.model = WhisperModel(
                    model_to_load,
                    device="cpu",
                    compute_type="int8",
                    cpu_threads=cpu_threads,
                    download_root=download_root,
                )
                self.loaded_model_repo = model_to_load
                self.active_model_name = target_repo
                logger.info("Unified speech-to-text model loaded successfully.")
            except Exception as e:
                logger.error(f"Failed to load speech-to-text model: {e}", exc_info=True)
                raise
        return self.model

    async def reload_model(self, model_identifier: str):
        """Hot-reloads the unified speech-to-text model across both live feed and walkie-talkie."""
        async with self._model_lock:
            self._model_loading = True
            try:
                repo_id = self.resolve_repo_id(model_identifier)
                logger.info(f"Reloading speech-to-text model to: {repo_id}")
                with self._inference_lock:
                    self.model = None
                    gc.collect()

                self.active_model_name = repo_id
                await asyncio.to_thread(self._get_model)
                logger.info(f"Successfully activated and loaded unified model: {repo_id}")
            finally:
                self._model_loading = False

    def get_models_status(self) -> dict[str, Any]:
        """Scans disk cache and returns current download, size, and active status for all models."""
        from huggingface_hub import scan_cache_dir

        download_root = os.getenv("TRANSCRIPTION_MODEL_PATH", str(MODELS_DIR))
        cached_info: dict[str, dict] = {}
        if os.path.exists(download_root):
            try:
                report = scan_cache_dir(download_root)
                for r in report.repos:
                    cached_info[r.repo_id] = {
                        "size_on_disk": r.size_on_disk_str,
                        "size_bytes": r.size_on_disk,
                    }
            except Exception as e:
                logger.debug(f"Failed to scan cache dir {download_root}: {e}")

        active_repo = self.loaded_model_repo or self.active_model_name or self._get_active_setting_from_db()
        active_repo = self.resolve_repo_id(active_repo)

        models_list = []
        known_repos = set()

        for m in AVAILABLE_MODELS:
            repo_id = m["repo_id"]
            known_repos.add(repo_id.lower())
            
            is_downloaded = repo_id in cached_info
            size_on_disk = cached_info[repo_id]["size_on_disk"] if is_downloaded else None
            size_bytes = cached_info[repo_id]["size_bytes"] if is_downloaded else None
            is_active = (active_repo.lower() == repo_id.lower())

            curr_status = self.download_status.get(m["id"], {"status": "completed" if is_downloaded else "idle"})

            models_list.append({
                "id": m["id"],
                "name": m["name"],
                "repo_id": repo_id,
                "category": m["category"],
                "description": m["description"],
                "size_estimate": m["size_estimate"],
                "recommended": m.get("recommended", False),
                "is_downloaded": is_downloaded,
                "size_on_disk": size_on_disk,
                "size_bytes": size_bytes,
                "is_active": is_active,
                "download_status": curr_status.get("status", "idle"),
                "download_error": curr_status.get("error"),
            })

        # Also list any custom HuggingFace repos downloaded into cache
        for repo_id, cinfo in cached_info.items():
            if repo_id.lower() not in known_repos:
                custom_id = f"custom-{repo_id.replace('/', '-')}"
                is_active = (active_repo.lower() == repo_id.lower())
                curr_status = self.download_status.get(custom_id, {"status": "completed"})
                models_list.append({
                    "id": custom_id,
                    "name": f"Custom: {repo_id}",
                    "repo_id": repo_id,
                    "category": "Custom Model",
                    "description": f"Custom Hugging Face model {repo_id} downloaded to server storage.",
                    "size_estimate": cinfo["size_on_disk"],
                    "recommended": False,
                    "is_downloaded": True,
                    "size_on_disk": cinfo["size_on_disk"],
                    "size_bytes": cinfo["size_bytes"],
                    "is_active": is_active,
                    "download_status": curr_status.get("status", "completed"),
                    "download_error": None,
                })

        active_name = active_repo
        for m in models_list:
            if m["is_active"]:
                active_name = m["name"]
                break

        return {
            "active_model": active_repo,
            "active_model_name": active_name,
            "is_loading": self._model_loading,
            "restricted_languages": list(ALLOWED_LANGUAGES),
            "restricted_language_names": ["English (en)", "Bahasa Melayu / Malaysia (ms)", "Mandarin Chinese (zh)"],
            "singleton_shared": True,
            "models": models_list,
        }

    async def download_model_async(self, model_id: str, custom_repo: str | None = None):
        """Asynchronously triggers model weight download from Hugging Face Hub to persistent storage."""
        repo_id = None
        if custom_repo and custom_repo.strip():
            repo_id = self.resolve_repo_id(custom_repo.strip())
        else:
            for m in AVAILABLE_MODELS:
                if m["id"].lower() == model_id.lower():
                    repo_id = m["repo_id"]
                    break

        if not repo_id:
            repo_id = self.resolve_repo_id(model_id)

        self.download_status[model_id] = {
            "status": "downloading",
            "progress": "Downloading model weights from Hugging Face...",
            "error": None
        }

        async def _download_worker():
            try:
                from huggingface_hub import snapshot_download
                download_root = os.getenv("TRANSCRIPTION_MODEL_PATH", str(MODELS_DIR))
                logger.info(f"Starting download for speech model: {repo_id} to {download_root}")

                def _do_snapshot():
                    snapshot_download(
                        repo_id=repo_id,
                        cache_dir=download_root,
                    )

                await asyncio.to_thread(_do_snapshot)
                self.download_status[model_id] = {
                    "status": "completed",
                    "progress": "Download complete",
                    "error": None
                }
                logger.info(f"Model download completed successfully: {repo_id}")
            except Exception as e:
                logger.error(f"Failed to download model {repo_id}: {e}", exc_info=True)
                self.download_status[model_id] = {
                    "status": "failed",
                    "progress": "Download failed",
                    "error": str(e)
                }

        asyncio.create_task(_download_worker())

    def delete_model_files(self, model_id: str) -> bool:
        """Deletes model files from disk to free up server storage."""
        from huggingface_hub import scan_cache_dir

        repo_id = None
        for m in AVAILABLE_MODELS:
            if m["id"].lower() == model_id.lower():
                repo_id = m["repo_id"]
                break

        if not repo_id:
            repo_id = self.resolve_repo_id(model_id)

        download_root = os.getenv("TRANSCRIPTION_MODEL_PATH", str(MODELS_DIR))
        deleted = False

        if os.path.exists(download_root):
            try:
                report = scan_cache_dir(download_root)
                for r in report.repos:
                    if r.repo_id.lower() == repo_id.lower():
                        revs = [rev.commit_hash for rev in r.revisions]
                        del_strategy = report.delete_revisions(*revs)
                        del_strategy.execute()
                        deleted = True
                        break
            except Exception as e:
                logger.debug(f"scan_cache_dir revision deletion exception: {e}")

            clean_repo_name = f"models--{repo_id.replace('/', '--')}"
            folder = os.path.join(download_root, clean_repo_name)
            if os.path.exists(folder):
                shutil.rmtree(folder, ignore_errors=True)
                deleted = True

        if model_id in self.download_status:
            del self.download_status[model_id]

        return deleted

    def transcribe_walkie_call(self, audio_data: np.ndarray) -> tuple[str, str]:
        """
        Transcribes recorded walkie-talkie call audio using the shared singleton model
        strictly restricted to English, Bahasa Melayu, and Mandarin.
        """
        model = self._get_model()
        with self._inference_lock:
            # 1. Constrain language detection to allowed languages
            try:
                _, _, all_language_probs = model.detect_language(audio=audio_data)
                allowed_probs = [item for item in all_language_probs if item[0] in ALLOWED_LANGUAGES]
                if allowed_probs:
                    chosen_lang = max(allowed_probs, key=lambda x: x[1])[0]
                else:
                    chosen_lang = "en"
            except Exception as lang_err:
                logger.debug(f"Walkie language detection fallback to 'en': {lang_err}")
                chosen_lang = "en"

            segments, info = model.transcribe(
                audio_data,
                task="transcribe",
                language=chosen_lang,
                initial_prompt=INITIAL_PROMPT,
                beam_size=1,
                temperature=0.0,
                condition_on_previous_text=False,
                without_timestamps=True,
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=250),
            )
            text = " ".join(s.text.strip() for s in segments).strip()
            return text, chosen_lang

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

    @staticmethod
    def _stitch_sentence_clauses(prev: str, next_chunk: str) -> str:
        """
        Stitches consecutive clauses of a sentence, deduplicating boundary overlap words if needed.
        Preserves natural flow between audio chunks.
        """
        if not prev:
            return next_chunk.strip()
        if not next_chunk:
            return prev.strip()
        p = prev.strip()
        n = next_chunk.strip()

        # Check for 1 to 3 word overlap at boundary
        prev_words = p.split()
        next_words = n.split()

        max_check = min(3, len(prev_words), len(next_words))
        for k in range(max_check, 0, -1):
            prev_tail = [w.lower().strip(".,!?;:-_\"'") for w in prev_words[-k:]]
            next_head = [w.lower().strip(".,!?;:-_\"'") for w in next_words[:k]]
            if prev_tail == next_head:
                return " ".join(prev_words + next_words[k:])

        return f"{p} {n}"

    def _transcribe_chunk_sync(self, audio_data: np.ndarray) -> tuple[list[dict], bool]:
        """Synchronously runs whisper inference on a float32 16kHz mono audio chunk with 3-language restriction."""
        model = self._get_model()
        results = []
        is_acoustics = detect_music_acoustics(audio_data)

        try:
            with self._inference_lock:
                # 1. Constrain language detection to English (en), Bahasa Melayu (ms), and Mandarin (zh)
                try:
                    _, _, all_language_probs = model.detect_language(audio=audio_data)
                    allowed_probs = [item for item in all_language_probs if item[0] in ALLOWED_LANGUAGES]
                    if allowed_probs:
                        chosen_lang = max(allowed_probs, key=lambda x: x[1])[0]
                    else:
                        chosen_lang = "en"
                except Exception as lang_err:
                    logger.debug(f"Video chunk language detection fallback to 'en': {lang_err}")
                    chosen_lang = "en"

                segments, info = model.transcribe(
                    audio_data,
                    task="transcribe",
                    language=chosen_lang,  # Strictly clamped to en, ms, or zh
                    initial_prompt=INITIAL_PROMPT,
                    beam_size=1,  # Fast greedy decoding for low-latency live captions
                    temperature=0.0,
                    condition_on_previous_text=False,  # Prevents repeating previous text or looping
                    without_timestamps=True,  # Significant speedup since timestamps are managed by the audio chunker
                    vad_filter=True,  # Silero VAD filters out laughter, breathing, and mic hum before decoding
                    vad_parameters=dict(min_silence_duration_ms=600),
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
                            "language": chosen_lang,
                            "is_music": is_seg_music or is_acoustics,
                        })
        except Exception as e:
            logger.error(f"Error during whisper inference: {e}")
        return results, is_acoustics

    async def _transcription_worker(self, event_id: str, stream_key: str):
        """
        Background worker using a decoupled producer-consumer queue:
        - Producer: Continuously reads 16kHz mono PCM from FFmpeg stdout with zero backpressure on MediaMTX.
        - Consumer: Accumulates speech utterances using voice activity energy detection and sentence stitching,
          capturing full sentences before emitting lines to avoid fragmenting speech and confusing script synchronization.
        """
        rtmp_url = f"{settings.MEDIAMTX_RTMP_URL}/live/{stream_key}"
        
        # Audio specs: 16kHz, 16-bit mono PCM = 32,000 bytes/sec
        SAMPLE_RATE = 16000
        BYTES_PER_SEC = SAMPLE_RATE * 2  # 32,000 bytes/sec
        MIN_UTTERANCE_BYTES = int(BYTES_PER_SEC * 1.2)  # At least 1.2s of speech before evaluating natural pause
        MAX_UTTERANCE_BYTES = int(BYTES_PER_SEC * 8.5)  # Up to 8.5s to capture whole sentences without mid-sentence chop
        PAUSE_SILENCE_BYTES = int(BYTES_PER_SEC * 0.85) # 0.85s of silence marks true end of sentence/phrase (not breathing pause)
        OVERLAP_BYTES = int(BYTES_PER_SEC * 0.6)        # 600ms overlap if forced to chunk at MAX_UTTERANCE_BYTES
        SILENCE_FLUSH_BYTES = int(BYTES_PER_SEC * 1.2)  # 1.2s of silence flushes any pending incomplete sentence
        ENERGY_THRESHOLD = 0.0055                       # RMS energy threshold distinguishing speech from mic noise
        TERMINAL_PUNCTUATION = (".", "!", "?", "。", "！", "？")

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

            # Sentence accumulation state across chunks
            pending_sentence = ""
            pending_start_sec = 0.0
            pending_language = "en"

            async def _emit_complete_subtitle(
                text: str,
                lang: str,
                start_s: float,
                end_s: float,
                is_music: bool,
                trig_reason: str
            ):
                clean_text = text.strip()
                if not clean_text:
                    return

                sub_rec_id = None
                now = datetime.now(timezone.utc)
                db: Session = SessionLocal()
                try:
                    import re
                    from pathlib import Path
                    from app.models.recording import Recording

                    rec_dirs = [Path("/storage/recordings/live") / stream_key, Path("storage/recordings/live") / stream_key]
                    for rd in rec_dirs:
                        if rd.exists():
                            files = sorted(rd.glob("*.mp4"), key=lambda f: f.stat().st_mtime, reverse=True)
                            if files:
                                latest = files[0]
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
                                    start_s = round(diff, 1)
                                    end_s = round(diff + max(1.0, end_s - start_s), 1)
                                    break

                    sub = Subtitle(
                        id=str(uuid.uuid4()),
                        event_id=event_id,
                        stream_key=stream_key,
                        recording_id=sub_rec_id,
                        text=clean_text,
                        language=lang,
                        start_seconds=start_s,
                        end_seconds=end_s,
                        confidence=0.9,
                        is_music=bool(is_music),
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

                payload = {
                    "type": "subtitle",
                    "id": sub_id,
                    "event_id": event_id,
                    "recording_id": sub_rec_id,
                    "text": clean_text,
                    "language": lang,
                    "start_seconds": start_s,
                    "end_seconds": end_s,
                    "is_music": is_music,
                    "created_at": now.isoformat()
                }
                await self.broadcast_subtitle(event_id, payload)
                music_indicator = " [MUSIC/SINGING]" if is_music else ""
                logger.info(f"[{event_id[:8]}] Subtitle ({start_s}s, {trig_reason}{music_indicator}): {clean_text}")

                # Auto-sync live speech with event's active script
                try:
                    await self._match_and_sync_script(event_id, clean_text, is_music=is_music)
                except Exception as sync_err:
                    logger.warning(f"Script sync check failed: {sync_err}")

            while True:
                block = await audio_queue.get()
                if block is None:
                    # Stream ended: flush any pending sentence before exiting
                    if pending_sentence:
                        final_text = pending_sentence.strip()
                        if not final_text.endswith(TERMINAL_PUNCTUATION):
                            final_text = final_text.rstrip(",;: -") + "."
                        await _emit_complete_subtitle(
                            text=final_text,
                            lang=pending_language,
                            start_s=pending_start_sec,
                            end_s=round(stream_elapsed, 1),
                            is_music=False,
                            trig_reason="stream_end"
                        )
                        pending_sentence = ""
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
                    # Natural pause (0.85s of silence) after spoken words: sentence/phrase boundary reached
                    should_transcribe = True
                    trigger_reason = "pause"
                elif has_speech and len(audio_buffer) >= MAX_UTTERANCE_BYTES:
                    # Long continuous speech reached max duration (8.5s)
                    should_transcribe = True
                    trigger_reason = "max_len"
                elif not has_speech and len(audio_buffer) >= int(BYTES_PER_SEC * 1.5):
                    # Pure silence / background noise: discard to conserve CPU and advance clock
                    dropped_sec = len(audio_buffer) / BYTES_PER_SEC
                    stream_elapsed += dropped_sec
                    audio_buffer.clear()
                    silence_bytes = 0

                    # If an incomplete sentence was waiting and speaker stopped speaking for >1.2s:
                    if pending_sentence:
                        final_text = pending_sentence.strip()
                        if not final_text.endswith(TERMINAL_PUNCTUATION):
                            final_text = final_text.rstrip(",;: -") + "."
                        await _emit_complete_subtitle(
                            text=final_text,
                            lang=pending_language,
                            start_s=pending_start_sec,
                            end_s=round(stream_elapsed, 1),
                            is_music=False,
                            trig_reason="silence_timeout"
                        )
                        pending_sentence = ""
                    continue

                if should_transcribe:
                    raw_audio = bytes(audio_buffer)
                    if trigger_reason == "max_len" and len(audio_buffer) > OVERLAP_BYTES:
                        # Retain trailing 600ms overlap in audio_buffer so boundary words are not cut in half
                        audio_buffer = bytearray(audio_buffer[-OVERLAP_BYTES:])
                        chunk_advance_sec = (len(raw_audio) - OVERLAP_BYTES) / BYTES_PER_SEC
                    else:
                        audio_buffer.clear()
                        chunk_advance_sec = len(raw_audio) / BYTES_PER_SEC

                    has_speech = False
                    silence_bytes = 0

                    duration_sec = len(raw_audio) / BYTES_PER_SEC
                    audio_np = np.frombuffer(raw_audio, dtype=np.int16).astype(np.float32) / 32768.0

                    # Run inference in background thread
                    results, is_acoustics = await asyncio.to_thread(self._transcribe_chunk_sync, audio_np)

                    start_sec = round(stream_elapsed, 1)
                    end_sec = round(stream_elapsed + duration_sec, 1)
                    stream_elapsed += chunk_advance_sec

                    combined_text = ""
                    is_chunk_music = False

                    if results:
                        combined_text = " ".join(r["text"] for r in results).strip()
                        is_chunk_music = any(r.get("is_music", False) for r in results) or is_music_text(combined_text) or is_acoustics
                    elif is_acoustics:
                        # Purely instrumental dance performance, backing track, or music without decoded dialogue
                        combined_text = "♪ [Live Music / Performance] ♪"
                        is_chunk_music = True

                    if is_chunk_music:
                        # Flush any pending sentence before emitting music
                        if pending_sentence:
                            final_text = pending_sentence.strip()
                            if not final_text.endswith(TERMINAL_PUNCTUATION):
                                final_text = final_text.rstrip(",;: -") + "."
                            await _emit_complete_subtitle(
                                text=final_text,
                                lang=pending_language,
                                start_s=pending_start_sec,
                                end_s=start_sec,
                                is_music=False,
                                trig_reason="flush_before_music"
                            )
                            pending_sentence = ""

                        # Emit music subtitle
                        await _emit_complete_subtitle(
                            text=combined_text,
                            lang="en",
                            start_s=start_sec,
                            end_s=end_sec,
                            is_music=True,
                            trig_reason=trigger_reason
                        )

                    elif combined_text:
                        chunk_lang = results[0].get("language", "en") if results else "en"
                        if pending_sentence:
                            stitched_text = self._stitch_sentence_clauses(pending_sentence, combined_text)
                        else:
                            stitched_text = combined_text
                            pending_start_sec = start_sec

                        pending_language = chunk_lang
                        has_terminal = stitched_text.rstrip().endswith(TERMINAL_PUNCTUATION)
                        word_count = len(stitched_text.split())

                        # A sentence is complete when:
                        # 1. It ends with terminal punctuation (. ! ? 。 ！ ？)
                        # 2. Or the chunk was triggered by a natural pause (speaker stopped speaking for >= 0.85s)
                        # 3. Or it has accumulated >= 25 words
                        is_complete = has_terminal or (trigger_reason == "pause") or (word_count >= 25)

                        if is_complete:
                            final_text = stitched_text.strip()
                            if not final_text.endswith(TERMINAL_PUNCTUATION) and not final_text.endswith((",", ";", ":", "-")):
                                final_text += "."
                            elif final_text.endswith((",", ";", ":", "-")):
                                final_text = final_text.rstrip(",;: -") + "."

                            await _emit_complete_subtitle(
                                text=final_text,
                                lang=pending_language,
                                start_s=pending_start_sec,
                                end_s=end_sec,
                                is_music=False,
                                trig_reason=trigger_reason
                            )
                            pending_sentence = ""
                        else:
                            # Sentence is incomplete and speaker is still speaking (cut by max_len 8.5s)
                            pending_sentence = stitched_text

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

                curr_block_id = event_active_blocks.get(event_id) or getattr(active_script, "active_block_id", None)
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

                # 1. Primary match with current whole sentence
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

                # 2. If primary match was below threshold, check with recent rolling spoken context
                history = self.event_spoken_history.get(event_id, [])
                recent_entries = [h for h in history if (now - h["timestamp"]) < 15.0]
                self.event_spoken_history[event_id] = recent_entries

                if not matched_block and not is_music and recent_entries:
                    prev_text = recent_entries[-1]["text"]
                    combined_spoken = f"{prev_text} {spoken_text}"
                    combined_block, combined_conf = match_spoken_text_to_script(
                        blocks=blocks,
                        spoken_text=combined_spoken,
                        current_block_index=curr_idx,
                        time_since_last_match=time_since,
                        threshold=0.62,
                        local_window_size=5,
                        global_search_delay_seconds=3.0,
                        is_music=is_music,
                        allow_jump=allow_jump
                    )
                    if combined_block and combined_conf > confidence:
                        matched_block = combined_block
                        confidence = combined_conf

                if not is_music:
                    self.event_spoken_history.setdefault(event_id, []).append({
                        "text": spoken_text,
                        "timestamp": now
                    })

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
