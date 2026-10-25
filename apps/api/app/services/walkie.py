import asyncio
import logging
import time
import uuid
import wave
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
import numpy as np
from fastapi import WebSocket
from sqlalchemy.orm import Session

from app.config import settings, WALKIE_DIR
from app.database import SessionLocal
from app.models.walkie import WalkieCall
from app.services.transcription import transcription_service

logger = logging.getLogger("stagecontrol.walkie")

SAMPLE_RATE = 16000  # 16kHz Mono 16-bit PCM (Standard Whisper input & voice comms)
BYTES_PER_SAMPLE = 2  # 16-bit = 2 bytes
BYTES_PER_SECOND = SAMPLE_RATE * BYTES_PER_SAMPLE  # 32,000 bytes/sec

class WalkieService:
    def __init__(self):
        # event_id -> dict of websocket -> user_info dict {user_id, caller_name, caller_role}
        self.rooms: dict[str, dict[WebSocket, dict[str, Any]]] = {}
        # event_id -> active speaker dict
        self.active_speakers: dict[str, dict[str, Any]] = {}
        # transmission_id -> {event_id, user_id, caller_name, caller_role, buffer: bytearray, start_time: float}
        self.transmissions: dict[str, dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    async def register_connection(self, event_id: str, websocket: WebSocket, user_info: dict[str, Any]):
        """Registers a crew connection to an event's walkie-talkie room."""
        async with self._lock:
            if event_id not in self.rooms:
                self.rooms[event_id] = {}
            self.rooms[event_id][websocket] = user_info

        await self.broadcast_presence(event_id)

    async def unregister_connection(self, event_id: str, websocket: WebSocket):
        """Unregisters a crew connection and clears active speaker lock if needed."""
        removed_user_info = None
        async with self._lock:
            if event_id in self.rooms and websocket in self.rooms[event_id]:
                removed_user_info = self.rooms[event_id].pop(websocket)
                if not self.rooms[event_id]:
                    del self.rooms[event_id]

            # If this user was actively transmitting, terminate their transmission
            active = self.active_speakers.get(event_id)
            if active and removed_user_info and active.get("user_id") == removed_user_info.get("user_id"):
                tid = active.get("transmission_id")
                del self.active_speakers[event_id]
                if tid:
                    asyncio.create_task(self.finalize_transmission(event_id, tid))

        await self.broadcast_presence(event_id)

    def get_connected_users(self, event_id: str) -> list[dict[str, Any]]:
        """Returns unique connected users currently in this walkie room."""
        if event_id not in self.rooms:
            return []
        seen = set()
        users = []
        for info in self.rooms[event_id].values():
            uid = info.get("user_id")
            if uid and uid not in seen:
                seen.add(uid)
                users.append({
                    "user_id": uid,
                    "caller_name": info.get("caller_name", "Crew Member"),
                    "caller_role": info.get("caller_role", "crew")
                })
        return users

    async def broadcast_presence(self, event_id: str):
        """Broadcasts updated online presence to everyone in the room."""
        users = self.get_connected_users(event_id)
        payload = {
            "type": "presence_update",
            "connected_users": users,
            "active_speaker": self.active_speakers.get(event_id)
        }
        await self.broadcast_json(event_id, payload)

    async def broadcast_json(self, event_id: str, payload: dict[str, Any], exclude: Optional[WebSocket] = None):
        """Sends JSON payload to all connected sockets in event room."""
        if event_id not in self.rooms:
            return
        dead = []
        for ws in list(self.rooms[event_id].keys()):
            if exclude and ws == exclude:
                continue
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for d in dead:
            if event_id in self.rooms:
                self.rooms[event_id].pop(d, None)

    async def broadcast_bytes(self, event_id: str, data: bytes, exclude: Optional[WebSocket] = None):
        """Broadcasts raw binary audio packets directly to all other listeners."""
        if event_id not in self.rooms:
            return
        dead = []
        for ws in list(self.rooms[event_id].keys()):
            if exclude and ws == exclude:
                continue
            try:
                await ws.send_bytes(data)
            except Exception:
                dead.append(ws)
        for d in dead:
            if event_id in self.rooms:
                self.rooms[event_id].pop(d, None)

    async def handle_start_transmission(
        self, event_id: str, websocket: WebSocket, transmission_id: str, user_info: dict[str, Any]
    ) -> bool:
        """Handles PTT button press: validates channel availability and locks transmission."""
        async with self._lock:
            current_speaker = self.active_speakers.get(event_id)
            if current_speaker:
                # Channel is already transmitting
                # If same user re-sending start, ignore
                if current_speaker.get("user_id") == user_info.get("user_id"):
                    return True
                # Reject transmission (channel busy)
                try:
                    await websocket.send_json({
                        "type": "channel_busy",
                        "active_speaker": current_speaker
                    })
                except Exception:
                    pass
                return False

            now = time.time()
            speaker_info = {
                "user_id": user_info.get("user_id"),
                "caller_name": user_info.get("caller_name", "Crew Member"),
                "caller_role": user_info.get("caller_role", "crew"),
                "transmission_id": transmission_id,
                "started_at": now
            }
            self.active_speakers[event_id] = speaker_info
            self.transmissions[transmission_id] = {
                "event_id": event_id,
                "user_id": user_info.get("user_id"),
                "caller_name": user_info.get("caller_name", "Crew Member"),
                "caller_role": user_info.get("caller_role", "crew"),
                "buffer": bytearray(),
                "start_time": now
            }

        # Broadcast live speaker banner to everyone immediately
        logger.info(f"[{event_id[:8]}] Walkie Talkie transmission STARTED by {speaker_info['caller_name']} ({transmission_id[:8]})")
        await self.broadcast_json(event_id, {
            "type": "incoming_transmission_start",
            "transmission_id": transmission_id,
            "speaker": speaker_info
        })
        return True

    async def handle_audio_chunk(self, event_id: str, websocket: WebSocket, data: bytes):
        """
        Receives binary PCM chunk from sender and broadcasts instantly to all listeners,
        accumulating the full call into in-memory buffer.
        """
        if len(data) <= 36:
            return
        
        try:
            tid = data[:36].decode("ascii")
        except Exception:
            return

        tx = self.transmissions.get(tid)
        if tx and tx.get("event_id") == event_id:
            pcm_bytes = data[36:]
            tx["buffer"].extend(pcm_bytes)

        # Broadcast raw audio chunk to every other listener in real time
        await self.broadcast_bytes(event_id, data, exclude=websocket)

    async def handle_end_transmission(self, event_id: str, transmission_id: str):
        """Handles PTT button release: unlocks channel and processes the call record & transcription."""
        async with self._lock:
            active = self.active_speakers.get(event_id)
            if active and active.get("transmission_id") == transmission_id:
                del self.active_speakers[event_id]

        logger.info(f"[{event_id[:8]}] Walkie Talkie transmission ENDED ({transmission_id[:8]})")
        # Notify clients that transmission ended
        await self.broadcast_json(event_id, {
            "type": "incoming_transmission_end",
            "transmission_id": transmission_id
        })

        # Finalize and transcribe in background
        asyncio.create_task(self.finalize_transmission(event_id, transmission_id))

    async def finalize_transmission(self, event_id: str, transmission_id: str):
        """
        Writes accumulated PCM bytes to a playable .wav file, creates database record,
        and runs Whisper transcription.
        """
        tx = self.transmissions.pop(transmission_id, None)
        if not tx:
            return

        raw_pcm = bytes(tx["buffer"])
        duration_sec = round(len(raw_pcm) / BYTES_PER_SECOND, 2)

        # Discard ultra-short accidental clicks (< 0.3s)
        if duration_sec < 0.3 or len(raw_pcm) < 4000:
            logger.info(f"Discarding short walkie blip ({duration_sec}s)")
            return

        # Write WAV file
        event_walkie_dir = WALKIE_DIR / event_id
        event_walkie_dir.mkdir(parents=True, exist_ok=True)
        wav_path = event_walkie_dir / f"{transmission_id}.wav"

        try:
            with wave.open(str(wav_path), "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(BYTES_PER_SAMPLE)
                wf.setframerate(SAMPLE_RATE)
                wf.writeframes(raw_pcm)
        except Exception as e:
            logger.error(f"Failed to write walkie wav file: {e}", exc_info=True)
            return

        file_size = wav_path.stat().st_size
        rel_audio_path = f"walkie_talkie/{event_id}/{transmission_id}.wav"
        audio_url = f"/api/events/{event_id}/walkie-talkie/calls/{transmission_id}/audio"

        db: Session = SessionLocal()
        try:
            call = WalkieCall(
                id=transmission_id,
                event_id=event_id,
                caller_id=tx.get("user_id"),
                caller_name=tx.get("caller_name", "Crew Member"),
                caller_role=tx.get("caller_role", "crew"),
                audio_path=rel_audio_path,
                duration_seconds=duration_sec,
                file_size_bytes=file_size,
                transcription=None,
                language="en",
                status="transcribing",
                created_at=datetime.now(timezone.utc)
            )
            db.add(call)
            db.commit()
            db.refresh(call)

            # Broadcast new call to history lists
            created_at_dt = call.created_at if (call.created_at and call.created_at.tzinfo) else (call.created_at.replace(tzinfo=timezone.utc) if call.created_at else datetime.now(timezone.utc))
            call_dict = {
                "id": call.id,
                "event_id": call.event_id,
                "caller_id": call.caller_id,
                "caller_name": call.caller_name,
                "caller_role": call.caller_role,
                "audio_url": audio_url,
                "duration_seconds": call.duration_seconds,
                "file_size_bytes": call.file_size_bytes,
                "transcription": None,
                "language": call.language,
                "status": call.status,
                "created_at": created_at_dt.isoformat()
            }
            await self.broadcast_json(event_id, {
                "type": "new_call_recorded",
                "call": call_dict
            })
        except Exception as err:
            logger.error(f"Failed to save walkie call to DB: {err}", exc_info=True)
            db.rollback()
            return
        finally:
            db.close()

        # Run speech-to-text transcription asynchronously
        asyncio.create_task(self._transcribe_call(event_id, transmission_id, raw_pcm, audio_url))

    async def _transcribe_call(self, event_id: str, call_id: str, raw_pcm: bytes, audio_url: str):
        """Transcribes recorded call audio using the shared unified faster-whisper model (restricted to English, Malay, and Mandarin)."""
        try:
            audio_np = np.frombuffer(raw_pcm, dtype=np.int16).astype(np.float32) / 32768.0

            transcript_text, detected_lang = await asyncio.to_thread(
                transcription_service.transcribe_walkie_call, audio_np
            )
            if not transcript_text:
                transcript_text = "(No dialogue detected)"

            db: Session = SessionLocal()
            try:
                call = db.query(WalkieCall).filter(WalkieCall.id == call_id).first()
                if call:
                    call.transcription = transcript_text
                    call.language = detected_lang
                    call.status = "completed"
                    db.commit()
                    db.refresh(call)

                    created_at_dt = call.created_at if (call.created_at and call.created_at.tzinfo) else (call.created_at.replace(tzinfo=timezone.utc) if call.created_at else datetime.now(timezone.utc))
                    call_dict = {
                        "id": call.id,
                        "event_id": call.event_id,
                        "caller_id": call.caller_id,
                        "caller_name": call.caller_name,
                        "caller_role": call.caller_role,
                        "audio_url": audio_url,
                        "duration_seconds": call.duration_seconds,
                        "file_size_bytes": call.file_size_bytes,
                        "transcription": call.transcription,
                        "language": call.language,
                        "status": call.status,
                        "created_at": created_at_dt.isoformat()
                    }
                    logger.info(f"[{event_id[:8]}] Walkie Call {call_id[:8]} transcribed: \"{transcript_text}\"")
                    await self.broadcast_json(event_id, {
                        "type": "call_transcription_ready",
                        "call": call_dict
                    })
            finally:
                db.close()
        except Exception as e:
            logger.error(f"Error transcribing walkie call {call_id}: {e}", exc_info=True)
            db: Session = SessionLocal()
            try:
                call = db.query(WalkieCall).filter(WalkieCall.id == call_id).first()
                if call:
                    call.transcription = "(Transcription unavailable)"
                    call.status = "completed"
                    db.commit()
            except Exception:
                pass
            finally:
                db.close()

# Global singleton walkie service
walkie_service = WalkieService()
