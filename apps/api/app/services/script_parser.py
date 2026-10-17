import io
import re
from typing import Any, Dict, List, Optional, Tuple
import docx

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


def is_music_or_performance_block(blk: Any) -> bool:
    """Checks if a script block represents a musical performance, song, dance, video, or audio interlude."""
    if isinstance(blk, dict) and blk.get("is_performance") is not None:
        if blk.get("is_performance"):
            return True
    elif hasattr(blk, "is_performance") and getattr(blk, "is_performance", False):
        return True

    cue = (getattr(blk, "cue", None) or "") if not isinstance(blk, dict) else (blk.get("cue") or "")
    diag = (getattr(blk, "dialogue", None) or "") if not isinstance(blk, dict) else (blk.get("dialogue") or "")
    speaker = (getattr(blk, "speaker", None) or "") if not isinstance(blk, dict) else (blk.get("speaker") or "")

    cue_speaker = f"{cue} {speaker}".lower()
    cue_pattern = r'\b(audio|music|song|songs|track|tracks|soundtrack|soundtracks|playback|singing|sing|band|choir|anthem|dance|dancing|performance|dikir|silat|walk-in|video|montage|instrumental)\b'
    if re.search(cue_pattern, cue_speaker, re.I):
        return True

    diag_pattern = r'\b(dance|dancing|song|songs|singing|anthem|dikir|silat|walk-in|soundtrack)\b'
    if diag and re.search(diag_pattern, diag.lower(), re.I):
        if speaker and len(diag) > 40:
            return False
        return True

    return False

def parse_docx_bytes(file_bytes: bytes, default_title: str = "Imported Script") -> Dict[str, Any]:
    """
    Parses a Word (.docx) document into structured sections and blocks.
    Specifically designed for stage scripts with tables where:
      Column 0: Speaker
      Column 1: Technical notes (Audio / Lights / Backstage cues)
      Column 2: Lines / Dialogue / Stage directions
    Also handles merged header rows, scene title banners, and plain text scripts.
    """
    doc = docx.Document(io.BytesIO(file_bytes))
    
    sections: List[Dict[str, Any]] = []
    current_section: Dict[str, Any] = {
        "title": "Act 1: Opening & Formalities",
        "order_index": 0,
        "blocks": []
    }
    sections.append(current_section)
    
    total_block_index = 0

    if doc.tables:
        # Use first substantial table
        tbl = doc.tables[0]
        for row_idx, row in enumerate(tbl.rows):
            raw_cells = [c.text.strip() for c in row.cells]
            
            # Clean newlines and spaces
            cells = [re.sub(r'\s+', ' ', c).strip() for c in raw_cells]
            
            c0 = cells[0] if len(cells) > 0 else ""
            c1 = cells[1] if len(cells) > 1 else ""
            c2 = cells[2] if len(cells) > 2 else ""

            # Check for empty row
            if not c0 and not c1 and not c2:
                continue

            # Check if merged banner row (all cells identical)
            if c0 and (c0 == c1 == c2 or (len(cells) == 1)):
                if "Roles:" in c0 or "Cast:" in c0:
                    current_section["blocks"].append({
                        "order_index": total_block_index,
                        "speaker": "PROD / ROLES",
                        "cue": "CAST & CREW ASSIGNMENTS",
                        "dialogue": c0,
                        "notes": "Script cast and roles header"
                    })
                    total_block_index += 1
                elif any(kw in c0.lower() for kw in ["scene", "act", "prologue", "finale", "---", "==="]):
                    clean_title = re.sub(r'^[-=\s]+|[-=\s]+$', '', c0).strip()
                    if clean_title:
                        current_section = {
                            "title": clean_title,
                            "order_index": len(sections),
                            "blocks": []
                        }
                        sections.append(current_section)
                else:
                    # Generic banner
                    current_section["blocks"].append({
                        "order_index": total_block_index,
                        "speaker": "STAGE DIRECTION",
                        "cue": "",
                        "dialogue": c0,
                        "notes": ""
                    })
                    total_block_index += 1
                continue

            # Check if header row like NARRATOR / AUDIO/BS
            if (c0.upper() in ["NARRATOR", "SPEAKER", "CHARACTER", "ROLE"] and 
                c1.upper() in ["AUDIO/BS", "TECHNICAL NOTES", "CUE", "LIGHTS", "AUDIO"]):
                continue

            # Check if this row represents a scene transition (e.g. col 1 has 'SCENE 2', col 2 has 'The Journey')
            combined = f"{c0} {c1} {c2}"
            if re.match(r'^(?:SCENE\s+\d+|ACT\s+\d+|PROLOGUE|FINALE)', c1.strip(), re.I) and len(c1.strip()) < 30:
                scene_name = f"{c1.strip()}: {c2.strip()}" if c2.strip() else c1.strip()
                current_section = {
                    "title": scene_name,
                    "order_index": len(sections),
                    "blocks": []
                }
                sections.append(current_section)
                continue

            if ("---" in c2 or "===" in c2) and any(kw in c2.lower() for kw in ["scene", "act"]):
                clean_title = re.sub(r'^[-=\s]+|[-=\s]+$', '', c2).strip()
                current_section = {
                    "title": clean_title,
                    "order_index": len(sections),
                    "blocks": []
                }
                sections.append(current_section)
                continue

            speaker = c0
            cue = c1
            dialogue = c2

            is_perf = is_music_or_performance_block({"speaker": speaker, "cue": cue, "dialogue": dialogue})
            current_section["blocks"].append({
                "order_index": total_block_index,
                "speaker": speaker if speaker else None,
                "cue": cue if cue else None,
                "dialogue": dialogue if dialogue else None,
                "notes": None,
                "is_performance": is_perf
            })
            total_block_index += 1
    else:
        # Fallback for plain text Word documents without tables
        for p in doc.paragraphs:
            text = p.text.strip()
            if not text:
                continue
            
            # Check for scene heading
            if re.match(r'^(?:#+\s*|(?:SCENE|ACT)\s+\d+|---)', text, re.I):
                clean_title = re.sub(r'^#+\s*|^[-=\s]+|[-=\s]+$', '', text).strip()
                current_section = {
                    "title": clean_title or f"Scene {len(sections) + 1}",
                    "order_index": len(sections),
                    "blocks": []
                }
                sections.append(current_section)
                continue

            parsed = _parse_single_line(text, total_block_index)
            current_section["blocks"].append(parsed)
            total_block_index += 1

    # Filter out empty sections
    sections = [s for s in sections if s["blocks"] or len(sections) == 1]
    # Re-index sections
    for i, s in enumerate(sections):
        s["order_index"] = i

    return {
        "title": default_title,
        "sections": sections,
        "total_blocks": total_block_index
    }


def parse_raw_text(text: str, default_title: str = "Imported Script") -> Dict[str, Any]:
    """
    Parses pasted raw text into structured script sections and blocks.
    Supports:
      1. Tab-delimited (TSV) or CSV table copies: Speaker \t Technical Notes \t Dialogue Lines
      2. Dialogue scripts: Speaker: Dialogue [Cue: Technical notes]
      3. Plain line-by-line dialogue.
    """
    lines = [line.strip() for line in text.splitlines()]
    lines = [l for l in lines if l]

    sections: List[Dict[str, Any]] = []
    current_section: Dict[str, Any] = {
        "title": "Act 1: Script",
        "order_index": 0,
        "blocks": []
    }
    sections.append(current_section)

    total_block_index = 0

    # Detect if primarily tab-separated
    tab_count = sum(1 for l in lines[:20] if '\t' in l)
    is_tsv = tab_count >= max(2, len(lines[:20]) // 3)

    for line in lines:
        # Scene / Act headers
        if re.match(r'^(?:#+\s*|(?:SCENE|ACT)\s+\d+|[-=]{3,})', line, re.I):
            clean_title = re.sub(r'^#+\s*|^[-=\s]+|[-=\s]+$', '', line).strip()
            if clean_title:
                current_section = {
                    "title": clean_title,
                    "order_index": len(sections),
                    "blocks": []
                }
                sections.append(current_section)
                continue

        if is_tsv and '\t' in line:
            parts = [p.strip() for p in line.split('\t')]
            spk = parts[0] if len(parts) > 0 else ""
            cue = parts[1] if len(parts) > 1 else ""
            diag = parts[2] if len(parts) > 2 else ""
            
            # If 2 columns, check if 2nd is dialogue or cue
            if len(parts) == 2:
                spk = parts[0]
                diag = parts[1]
                cue = ""

            is_perf = is_music_or_performance_block({"speaker": spk, "cue": cue, "dialogue": diag})
            current_section["blocks"].append({
                "order_index": total_block_index,
                "speaker": spk or None,
                "cue": cue or None,
                "dialogue": diag or None,
                "notes": None,
                "is_performance": is_perf
            })
            total_block_index += 1
        else:
            parsed = _parse_single_line(line, total_block_index)
            current_section["blocks"].append(parsed)
            total_block_index += 1

    sections = [s for s in sections if s["blocks"] or len(sections) == 1]
    for i, s in enumerate(sections):
        s["order_index"] = i

    return {
        "title": default_title,
        "sections": sections,
        "total_blocks": total_block_index
    }


def _parse_single_line(line: str, order_index: int) -> Dict[str, Any]:
    """Extracts speaker, cue, dialogue from a single line like 'Host: Welcome everyone [LIGHTS UP]'."""
    cue = None
    speaker = None
    dialogue = line

    # Extract bracketed cue like [LIGHTS UP] or (SOUND: fanfare)
    cue_match = re.search(r'\[(.*?)\]|\((?:cue|notes?|sound|lights?):\s*(.*?)\)', dialogue, re.I)
    if cue_match:
        cue = (cue_match.group(1) or cue_match.group(2)).strip()
        dialogue = re.sub(r'\[(.*?)\]|\((?:cue|notes?|sound|lights?):\s*(.*?)\)', '', dialogue).strip()

    # Extract speaker prefix like "Speaker Name: Dialogue"
    spk_match = re.match(r'^([A-Z0-9\s\.\-_’\']{2,30}?):\s*(.*)$', dialogue, re.I)
    if spk_match and not dialogue.lower().startswith('http'):
        speaker = spk_match.group(1).strip()
        dialogue = spk_match.group(2).strip()

    is_perf = is_music_or_performance_block({"speaker": speaker, "cue": cue, "dialogue": dialogue})
    return {
        "order_index": order_index,
        "speaker": speaker,
        "cue": cue,
        "dialogue": dialogue,
        "notes": None,
        "is_performance": is_perf
    }


def normalize_script_text(text: str, strip_actions: bool = False) -> str:
    """Normalizes text for fuzzy matching by collapsing contractions, removing punctuation, and trimming."""
    if not text:
        return ""
    cleaned = text
    if strip_actions:
        # Strip stage directions and actor actions in brackets: [Groans], (pause), {applause}
        cleaned = re.sub(r'\[.*?\]|\(.*?\)|{.*?}', ' ', cleaned)
    # Remove apostrophes without space so "don't" -> "dont", "it's" -> "its"
    cleaned = re.sub(r"['’`]", "", cleaned.lower())
    # Replace other punctuation with space
    cleaned = re.sub(r"[^\w\s]", " ", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def calculate_script_similarity(spoken: str, dialogue: str) -> float:
    """
    Computes fuzzy similarity score between spoken speech and scripted dialogue.
    Handles partial phrases, slight mistranscriptions, and rewordings (~70-80% match).
    Strips bracketed actions like [Groans] or (pause) from dialogue to match purely spoken words.
    Guards against short-line false positives (e.g. 'No...' matching 'honor').
    """
    from difflib import SequenceMatcher

    norm_spk = normalize_script_text(spoken, strip_actions=False)
    # Strip actions from dialogue because actors do not speak bracketed stage directions
    norm_diag = normalize_script_text(dialogue, strip_actions=True)
    if not norm_diag:
        # Fallback if entire block is purely a stage direction
        norm_diag = normalize_script_text(dialogue, strip_actions=False)

    if not norm_spk or not norm_diag:
        return 0.0

    spk_words = [w for w in norm_spk.split() if len(w) > 1]
    diag_words = [w for w in norm_diag.split() if len(w) > 1]
    if not spk_words or not diag_words:
        return 0.0

    spk_len = len(spk_words)
    diag_len = len(diag_words)

    # Whole-phrase match with word boundaries
    pattern = r'(?:\b|^)' + re.escape(norm_spk) + r'(?:\b|$)'
    if spk_len >= 3 and re.search(pattern, norm_diag):
        return 0.95

    # If dialogue is completely inside spoken (and not trivial)
    if diag_len >= 3 and re.search(r'(?:\b|^)' + re.escape(norm_diag) + r'(?:\b|$)', norm_spk):
        return 0.90

    # Short line guard: prevent a multi-word sentence from matching "No..." or "I wish!"
    if diag_len <= 2 and spk_len > 3:
        return 0.0

    # Word-level fuzzy containment
    # For each spoken word, check if it matches a word in dialogue
    matched_spk_words = 0.0
    for sw in spk_words:
        best_w = 0.0
        for dw in diag_words:
            if sw == dw:
                best_w = 1.0
                break
            elif len(sw) >= 4 and len(dw) >= 4:
                # Tolerates small typos / phonetic variations like 'hangebat' -> 'jebat'
                sim = SequenceMatcher(None, sw, dw).ratio()
                if sim >= 0.75:
                    best_w = max(best_w, sim)
        if best_w >= 0.75:
            matched_spk_words += best_w

    containment = matched_spk_words / spk_len

    # Sliding window for long dialogue paragraphs
    best_window = 0.0
    if diag_len > spk_len + 2:
        for i in range(diag_len - spk_len + 1):
            window = ' '.join(diag_words[i:i + spk_len + 2])
            ratio = SequenceMatcher(None, norm_spk, window).ratio()
            if ratio > best_window:
                best_window = ratio
    else:
        best_window = SequenceMatcher(None, norm_spk, norm_diag).ratio()

    return max(containment * 0.80 + (best_window * 0.20), best_window)


class ScriptMatchResult(tuple):
    def __new__(cls, block, confidence, is_local=True):
        return super().__new__(cls, (block, confidence))

    def __init__(self, block, confidence, is_local=True):
        self.block = block
        self.confidence = confidence
        self.is_local = is_local


def match_spoken_text_to_script(
    blocks: List[Any],
    spoken_text: str,
    current_block_index: Optional[int] = None,
    time_since_last_match: float = 999.0,
    threshold: float = 0.65,
    local_window_size: int = 5,
    global_search_delay_seconds: float = 3.0,
    is_music: bool = False
) -> ScriptMatchResult:
    """
    Finds the best matching script block for an incoming spoken utterance with anti-jump cooldown
    and song/performance recognition.
    """
    has_music = is_music or is_music_text(spoken_text)

    # 1. Local Search (±5 lines around current position)
    if current_block_index is not None:
        # Check if current line or immediate next lines (0 <= diff <= 8) is a musical performance / song / dance
        if has_music:
            for blk in blocks:
                order_idx = getattr(blk, "order_index", 0) if not isinstance(blk, dict) else blk.get("order_index", 0)
                diff = order_idx - current_block_index
                if 0 <= diff <= 8 and is_music_or_performance_block(blk):
                    return ScriptMatchResult(blk, 0.95, is_local=True)
            # If current block is already a performance block, keep it locked during music
            curr_blk = next((b for b in blocks if (getattr(b, "order_index", 0) if not isinstance(b, dict) else b.get("order_index", 0)) == current_block_index), None)
            if curr_blk and is_music_or_performance_block(curr_blk):
                return ScriptMatchResult(curr_blk, 0.95, is_local=True)
            return ScriptMatchResult(None, 0.0, True)

        words = [w for w in normalize_script_text(spoken_text).split() if len(w) > 1]
        if len(words) < 2:
            return ScriptMatchResult(None, 0.0, True)

        best_local_block = None
        best_local_score = 0.0

        for blk in blocks:
            order_idx = getattr(blk, "order_index", 0) if not isinstance(blk, dict) else blk.get("order_index", 0)
            diff = order_idx - current_block_index
            if abs(diff) > local_window_size:
                continue

            diag = getattr(blk, "dialogue", None) if not isinstance(blk, dict) else blk.get("dialogue")
            cue = getattr(blk, "cue", None) if not isinstance(blk, dict) else blk.get("cue")
            target_text = f"{diag or ''} {cue or ''}".strip()
            if not target_text or len(target_text) < 3:
                continue

            raw_score = calculate_script_similarity(spoken_text, target_text)
            if raw_score <= 0.25:
                continue

            score = raw_score
            # Forward locality bias: natural reading progression
            if 0 <= diff <= 2:
                score += 0.06
            elif 3 <= diff <= local_window_size:
                score += 0.03
            elif -2 <= diff < 0:
                score += 0.02

            if score > best_local_score:
                best_local_score = score
                best_local_block = blk

        if best_local_score >= threshold and best_local_block is not None:
            return ScriptMatchResult(best_local_block, min(1.0, best_local_score), is_local=True)

        # If within 3 seconds of last match, do NOT allow global jumping yet
        if time_since_last_match < global_search_delay_seconds:
            return ScriptMatchResult(None, 0.0, False)
    else:
        words = [w for w in normalize_script_text(spoken_text).split() if len(w) > 1]
        if len(words) < 2 and not has_music:
            return ScriptMatchResult(None, 0.0, True)

    # If music is detected but current_block_index was None, check if words match any performance block or return first performance
    if has_music:
        # Check if spoken words match any performance block title or cue
        for blk in blocks:
            if is_music_or_performance_block(blk):
                cue = (getattr(blk, "cue", None) or "") if not isinstance(blk, dict) else (blk.get("cue") or "")
                diag = (getattr(blk, "dialogue", None) or "") if not isinstance(blk, dict) else (blk.get("dialogue") or "")
                target = f"{cue} {diag}".lower()
                spoken_words = [w for w in normalize_script_text(spoken_text).split() if len(w) > 3]
                if any(w in target for w in spoken_words):
                    return ScriptMatchResult(blk, 0.95, is_local=False)

        for blk in blocks:
            if is_music_or_performance_block(blk):
                return ScriptMatchResult(blk, 0.90, is_local=False)
        return ScriptMatchResult(None, 0.0, False)

    # 2. Global Search
    best_global_block = None
    best_global_score = 0.0
    distant_threshold = max(threshold, 0.70)

    for blk in blocks:
        diag = getattr(blk, "dialogue", None) if not isinstance(blk, dict) else blk.get("dialogue")
        cue = getattr(blk, "cue", None) if not isinstance(blk, dict) else blk.get("cue")
        target_text = f"{diag or ''} {cue or ''}".strip()
        if not target_text or len(target_text) < 3:
            continue

        raw_score = calculate_script_similarity(spoken_text, target_text)
        if raw_score > best_global_score:
            best_global_score = raw_score
            best_global_block = blk

    if best_global_score >= distant_threshold and best_global_block is not None:
        is_local = False
        if current_block_index is not None:
            order_idx = getattr(best_global_block, "order_index", 0) if not isinstance(best_global_block, dict) else best_global_block.get("order_index", 0)
            is_local = abs(order_idx - current_block_index) <= local_window_size
        return ScriptMatchResult(best_global_block, min(1.0, best_global_score), is_local=is_local)

    return ScriptMatchResult(None, 0.0, False)


