import os
import re
from pathlib import Path
from typing import Generator
from fastapi import HTTPException, Request, status
from fastapi.responses import StreamingResponse

CHUNK_SIZE = 1024 * 1024  # 1 MB chunk size for video streaming

def parse_range_header(range_header: str, file_size: int) -> tuple[int, int]:
    """
    Parses an HTTP Range header like 'bytes=0-1048575' or 'bytes=1048576-'
    and returns (start, end).
    """
    if not range_header:
        return 0, file_size - 1

    match = re.search(r"bytes=(\d+)-(\d*)", range_header)
    if not match:
        return 0, file_size - 1

    start_str, end_str = match.groups()
    start = int(start_str) if start_str else 0
    end = int(end_str) if end_str else file_size - 1

    if start >= file_size or end >= file_size or start > end:
        raise HTTPException(
            status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
            detail=f"Requested range {start}-{end} outside file size {file_size}"
        )

    return start, end

def range_file_stream(file_path: Path, start: int, end: int, chunk_size: int = CHUNK_SIZE) -> Generator[bytes, None, None]:
    """
    Yields chunks of bytes from file_path within the range [start, end].
    """
    with open(file_path, "rb") as f:
        f.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            bytes_to_read = min(remaining, chunk_size)
            chunk = f.read(bytes_to_read)
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk

def create_range_video_response(file_path: Path, request: Request, content_type: str = "video/mp4") -> StreamingResponse:
    """
    Creates a FastAPI StreamingResponse supporting HTTP 206 Partial Content
    for timeline scrubbing, pause/resume, and seekable playback.
    """
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Video recording file not found on disk"
        )

    file_size = os.path.getsize(file_path)
    range_header = request.headers.get("range")

    if not range_header:
        # Full file response
        return StreamingResponse(
            range_file_stream(file_path, 0, file_size - 1),
            status_code=status.HTTP_200_OK,
            headers={
                "Content-Type": content_type,
                "Content-Length": str(file_size),
                "Accept-Ranges": "bytes",
                "Content-Disposition": "inline",
                "Cache-Control": "public, max-age=86400",
            }
        )

    start, end = parse_range_header(range_header, file_size)
    content_length = end - start + 1

    headers = {
        "Content-Type": content_type,
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Content-Length": str(content_length),
        "Accept-Ranges": "bytes",
        "Content-Disposition": "inline",
        "Cache-Control": "public, max-age=86400",
    }

    return StreamingResponse(
        range_file_stream(file_path, start, end),
        status_code=status.HTTP_206_PARTIAL_CONTENT,
        headers=headers
    )
