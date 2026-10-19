import json
import logging
import os
import struct
import subprocess
from pathlib import Path
from typing import Optional

logger = logging.getLogger("stagecontrol.video_processor")


def is_fragmented_mp4(file_path: Path) -> bool:
    """
    Checks if an MP4 file contains fragmented movie boxes ('moof') in its header.
    Fragmented MP4s (fMP4) written by streaming servers lack a global sample duration
    and index table in 'moov'. This causes browser HTML5 <video> tags to report 'Infinity'
    or NaN duration, stall when scrubbing, and fail over HTTP 206 range requests.
    """
    if not file_path.exists() or file_path.stat().st_size < 128:
        return False
    try:
        with open(file_path, "rb") as f:
            for _ in range(12):
                header = f.read(8)
                if len(header) < 8:
                    break
                size, tag = struct.unpack(">I4s", header)
                if tag == b"moof":
                    return True
                if size == 0:
                    break
                if size == 1:
                    size = struct.unpack(">Q", f.read(8))[0]
                    f.seek(size - 16, 1)
                else:
                    f.seek(size - 8, 1)
    except Exception as e:
        logger.debug(f"Error checking MP4 atom headers for {file_path}: {e}")
        return False
    return False


def probe_video_metadata(file_path: Path) -> dict:
    """
    Executes ffprobe to extract exact duration (seconds as float), bit rate,
    resolution, and audio/video stream parameters.
    """
    if not file_path.exists() or file_path.stat().st_size < 1024:
        return {}

    try:
        cmd = [
            "ffprobe",
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            str(file_path),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        if res.returncode != 0:
            logger.warning(f"ffprobe failed for {file_path.name}: {res.stderr}")
            return {}

        data = json.loads(res.stdout)
        fmt = data.get("format", {})
        streams = data.get("streams", [])

        duration = 0.0
        try:
            duration = float(fmt.get("duration", 0.0))
        except (ValueError, TypeError):
            duration = 0.0

        # Fallback to video stream duration if format duration missing
        video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
        if duration <= 0.0 and video_stream:
            try:
                duration = float(video_stream.get("duration", 0.0))
            except (ValueError, TypeError):
                duration = 0.0

        size = int(fmt.get("size", file_path.stat().st_size))
        bit_rate = 0
        try:
            bit_rate = int(fmt.get("bit_rate", 0))
        except (ValueError, TypeError):
            bit_rate = 0

        width = int(video_stream.get("width", 0)) if video_stream else 0
        height = int(video_stream.get("height", 0)) if video_stream else 0
        codec = video_stream.get("codec_name", "") if video_stream else ""

        return {
            "duration": duration,
            "size": size,
            "bit_rate": bit_rate,
            "width": width,
            "height": height,
            "codec": codec,
        }
    except Exception as e:
        logger.warning(f"Exception probing video metadata for {file_path.name}: {e}")
        return {}


def remux_to_faststart_mp4(file_path: Path) -> tuple[bool, float, int]:
    """
    Remuxes an fMP4 (fragmented MP4) into a standardized, seekable MP4 with the 'moov' atom
    relocated to the very beginning of the file (+faststart) without re-encoding video frames.
    This enables instant browser playback, exact duration reporting, and smooth timeline seeking.
    Returns: (success: bool, exact_duration_seconds: float, file_size_bytes: int).
    """
    if not file_path.exists() or file_path.stat().st_size < 1024:
        return False, 0.0, 0

    tmp_path = file_path.with_name(f"{file_path.stem}.faststart_tmp.mp4")
    try:
        cmd = [
            "ffmpeg",
            "-y",
            "-i", str(file_path),
            "-c", "copy",
            "-movflags", "+faststart",
            "-f", "mp4",
            str(tmp_path),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        if res.returncode == 0 and tmp_path.exists() and tmp_path.stat().st_size > 1024:
            os.replace(tmp_path, file_path)
            meta = probe_video_metadata(file_path)
            duration = meta.get("duration", 0.0)
            size = file_path.stat().st_size
            logger.info(
                f"Successfully remuxed {file_path.name} to faststart MP4 "
                f"(duration: {duration:.2f}s, size: {size} bytes)"
            )
            return True, duration, size
        else:
            logger.error(f"FFmpeg remux failed for {file_path.name}: {res.stderr}")
            if tmp_path.exists():
                tmp_path.unlink()
            return False, 0.0, 0
    except Exception as e:
        logger.error(f"Exception during faststart remux of {file_path.name}: {e}")
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass
        return False, 0.0, 0


def generate_compressed_proxy(master_file: Path) -> tuple[bool, Optional[Path], int]:
    """
    Compresses raw master MP4 into a 720p ~800kbps faststart web proxy.
    Typically reduces file size by 80-88% with high visual fidelity.
    Returns: (success: bool, proxy_path: Optional[Path], proxy_size_bytes: int).
    """
    if not master_file.exists() or master_file.stat().st_size < 1024:
        return False, None, 0

    proxy_path = master_file.with_name(f"{master_file.stem}_720p.mp4")
    tmp_path = master_file.with_name(f"{master_file.stem}_720p.tmp.mp4")

    # If proxy already exists and is non-empty, return it immediately
    if proxy_path.exists() and proxy_path.stat().st_size > 1024:
        return True, proxy_path, proxy_path.stat().st_size

    try:
        cmd = [
            "ffmpeg", "-y",
            "-i", str(master_file),
            "-vf", "scale=-2:720",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "26",
            "-maxrate", "950k",
            "-bufsize", "1900k",
            "-c:a", "aac",
            "-b:a", "96k",
            "-movflags", "+faststart",
            str(tmp_path)
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if res.returncode == 0 and tmp_path.exists() and tmp_path.stat().st_size > 1024:
            os.replace(tmp_path, proxy_path)
            size = proxy_path.stat().st_size
            pct = (size / max(1, master_file.stat().st_size)) * 100
            logger.info(
                f"Generated 720p web proxy for {master_file.name}: {size} bytes ({pct:.1f}% of master)"
            )
            return True, proxy_path, size
        else:
            logger.error(f"FFmpeg proxy compression failed for {master_file.name}: {res.stderr}")
            if tmp_path.exists():
                tmp_path.unlink()
            return False, None, 0
    except Exception as e:
        logger.error(f"Exception compressing proxy for {master_file.name}: {e}")
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass
        return False, None, 0
