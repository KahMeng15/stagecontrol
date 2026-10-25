import pytest
from app.services.transcription import transcription_service
from app.services.script_parser import match_spoken_text_to_script, calculate_script_similarity

def test_stitch_sentence_clauses():
    # 1. Simple concatenation with space
    res = transcription_service._stitch_sentence_clauses("Good morning ladies and gentlemen,", "welcome to our show.")
    assert res == "Good morning ladies and gentlemen, welcome to our show."

    # 2. Boundary word overlap deduplication (e.g. 1 word overlap caused by audio chunk overlap)
    res2 = transcription_service._stitch_sentence_clauses("welcome to our annual", "annual concert tonight.")
    assert res2 == "welcome to our annual concert tonight."

    # 3. Two words overlap deduplication
    res3 = transcription_service._stitch_sentence_clauses("we are ready for the", "for the grand finale.")
    assert res3 == "we are ready for the grand finale."

    # 4. Empty edge cases
    assert transcription_service._stitch_sentence_clauses("", "Hello world") == "Hello world"
    assert transcription_service._stitch_sentence_clauses("Hello world", "") == "Hello world"

def test_whole_sentence_vs_fragment_disambiguation():
    """
    Demonstrates that capturing a whole sentence avoids line-jumping confusion
    caused by ambiguous shared fragments like 'Good morning ladies and gentlemen'.
    """
    blocks = [
        {"id": "line-1", "order_index": 0, "speaker": "Caitlyn", "dialogue": "Good morning ladies and gentlemen, welcome to our 2026 annual gala concert."},
        {"id": "line-2", "order_index": 1, "speaker": "Caitlyn", "dialogue": "Please give a warm round of applause for our distinguished guests and teachers."},
        {"id": "line-15", "order_index": 14, "speaker": "Principal", "dialogue": "Good morning ladies and gentlemen, it is my honour to address you all today."},
    ]

    # When whole sentence is captured:
    whole_sentence = "Good morning ladies and gentlemen, welcome to our 2026 annual gala concert."
    matched_whole, conf_whole = match_spoken_text_to_script(
        blocks=blocks,
        spoken_text=whole_sentence,
        current_block_index=0,
        threshold=0.60
    )
    assert matched_whole is not None
    assert matched_whole["id"] == "line-1"
    assert conf_whole >= 0.90

    # Line 1 gets an overwhelming match, far higher than Line 15:
    sim_line1 = calculate_script_similarity(whole_sentence, blocks[0]["dialogue"])
    sim_line15 = calculate_script_similarity(whole_sentence, blocks[2]["dialogue"])
    assert sim_line1 >= 0.90
    assert sim_line1 - sim_line15 >= 0.25

def test_multi_clause_compound_sentence():
    """
    Tests that a complex theatrical sentence with multiple clauses matches
    with high precision when captured in full.
    """
    blocks = [
        {
            "id": "tuah-1",
            "order_index": 10,
            "speaker": "Hang Tuah",
            "dialogue": "My Sultan, we have traveled across turbulent seas and dense jungles to bring you the fabled treasure of Gunung Ledang."
        }
    ]

    spoken = "My Sultan, we have traveled across turbulent seas and dense jungles to bring you the fabled treasure of Gunung Ledang."
    matched, conf = match_spoken_text_to_script(
        blocks=blocks,
        spoken_text=spoken,
        current_block_index=10,
        threshold=0.65
    )
    assert matched is not None
    assert matched["id"] == "tuah-1"
    assert conf >= 0.95
