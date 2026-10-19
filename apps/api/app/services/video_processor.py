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


def repair_corrupted_mvhd(file_path: Path) -> bool:
    """
    Detects and repairs corrupted 'mvhd' (Movie Header Box) atom lengths in MP4 files.

    In certain streaming or interrupted remux scenarios, MediaMTX or FFmpeg writes the
    total mdat size (e.g. 1-2 GB) into the 4-byte mvhd box size field instead of the
    standard ISO BMFF length (108 bytes for version 0, 120 bytes for version 1).
    Because mvhd claims to exceed the entire moov container, browser demuxers (Chrome/Safari)
    and ffprobe fail with 'Output file does not contain any stream' or NotSupportedError.

    This function inspects the mvhd atom and repairs the 4-byte box size in-place.
    Returns True if a repair was made, False otherwise.
    """
    if not file_path.exists() or file_path.stat().st_size < 128:
        return False

    repaired = False
    try:
        file_size = file_path.stat().st_size
        with open(file_path, "r+b") as f:
            # 1. Sequential top-level atom walking
            curr = 0
            while curr < file_size:
                f.seek(curr)
                hdr = f.read(8)
                if len(hdr) < 8:
                    break
                box_size, box_tag = struct.unpack(">I4s", hdr)
                if box_size == 1:
                    ext_hdr = f.read(8)
                    if len(ext_hdr) < 8:
                        break
                    box_size = struct.unpack(">Q", ext_hdr)[0]
                    hdr_len = 16
                elif box_size == 0:
                    box_size = file_size - curr
                    hdr_len = 8
                else:
                    hdr_len = 8

                if box_tag == b"moov":
                    # Check first subbox of moov
                    f.seek(curr + hdr_len)
                    sub_hdr = f.read(8)
                    if len(sub_hdr) == 8:
                        sub_size, sub_tag = struct.unpack(">I4s", sub_hdr)
                        if sub_tag == b"mvhd":
                            ver_byte = f.read(1)
                            version = ver_byte[0] if ver_byte else 0
                            expected_size = 120 if version == 1 else 108
                            if sub_size != expected_size:
                                f.seek(curr + hdr_len)
                                f.write(struct.pack(">I", expected_size))
                                f.flush()
                                logger.info(
                                    f"Repaired corrupted mvhd size in {file_path.name}: "
                                    f"was {sub_size} (0x{sub_size:08x}), patched to {expected_size}"
                                )
                                repaired = True
                                break

                    # If not first subbox, search within moov payload
                    moov_payload_size = min(box_size - hdr_len, 16 * 1024 * 1024)
                    f.seek(curr + hdr_len)
                    moov_data = f.read(moov_payload_size)
                    idx = moov_data.find(b"mvhd")
                    if idx >= 4:
                        sub_size = struct.unpack(">I", moov_data[idx - 4 : idx])[0]
                        ver = moov_data[idx + 4] if len(moov_data) > idx + 4 else 0
                        expected_size = 120 if ver == 1 else 108
                        if sub_size != expected_size:
                            f.seek(curr + hdr_len + idx - 4)
                            f.write(struct.pack(">I", expected_size))
                            f.flush()
                            logger.info(
                                f"Repaired corrupted mvhd size in moov payload of {file_path.name}: "
                                f"was {sub_size} (0x{sub_size:08x}), patched to {expected_size}"
                            )
                            repaired = True
                    break

                if box_size < hdr_len or curr + box_size > file_size:
                    break
                curr += box_size

            # 2. Candidate chunk and full file scan with version byte validation
            if not repaired:
                offset = 0
                block_size = 16 * 1024 * 1024
                while offset < file_size:
                    f.seek(offset)
                    # 16-byte overlap prevents missing "mvhd" split across block boundaries
                    block = f.read(block_size + 16)
                    if not block:
                        break
                    pos = 0
                    while True:
                        pos = block.find(b"mvhd", pos)
                        if pos == -1:
                            break
                        if pos >= 4:
                            sub_size = struct.unpack(">I", block[pos - 4 : pos])[0]
                            ver = block[pos + 4] if len(block) > pos + 4 else 255
                            if ver in (0, 1):
                                expected_size = 120 if ver == 1 else 108
                                if sub_size != expected_size and (sub_size > 500 or sub_size < 100):
                                    f.seek(offset + pos - 4)
                                    f.write(struct.pack(">I", expected_size))
                                    f.flush()
                                    logger.info(
                                        f"Repaired corrupted mvhd size via scan in {file_path.name}: "
                                        f"was {sub_size} (0x{sub_size:08x}), patched to {expected_size}"
                                    )
                                    repaired = True
                                    break
                        pos += 4
                    if repaired:
                        break
                    offset += block_size
    except Exception as e:
        logger.warning(f"Error checking/repairing mvhd for {file_path.name}: {e}")
        return False

    return repaired


def repair_all_recordings_in_storage() -> int:
    """
    Scans the recordings storage directory and checks/repairs all MP4 files
    for corrupted mvhd headers. Returns count of repaired files.
    """
    from app.core.config import settings
    rec_dir = Path(settings.RECORDINGS_DIR).resolve()
    if not rec_dir.exists():
        return 0

    repaired_count = 0
    for mp4_file in rec_dir.rglob("*.mp4"):
        if ".tmp" in mp4_file.name or ".part" in mp4_file.name:
            continue
        try:
            if repair_corrupted_mvhd(mp4_file):
                repaired_count += 1
        except Exception as e:
            logger.warning(f"Error during storage scan for {mp4_file.name}: {e}")

    if repaired_count > 0:
        logger.info(f"Storage startup scan completed: auto-repaired {repaired_count} take(s)")
    return repaired_count


def probe_video_metadata(file_path: Path, retry_repair: bool = True) -> dict:
    """
    Executes ffprobe to extract exact duration (seconds as float), bit rate,
    resolution, and audio/video stream parameters.
    Automatically detects and repairs corrupted mvhd headers if ffprobe fails.
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
            if retry_repair and repair_corrupted_mvhd(file_path):
                return probe_video_metadata(file_path, retry_repair=False)
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

        # If ffprobe returned zero duration or no streams, attempt mvhd repair and re-probe
        if (duration <= 0.0 or not streams) and retry_repair:
            if repair_corrupted_mvhd(file_path):
                return probe_video_metadata(file_path, retry_repair=False)

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

    repair_corrupted_mvhd(file_path)
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

    repair_corrupted_mvhd(master_file)
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
