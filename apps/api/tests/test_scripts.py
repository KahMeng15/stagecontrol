import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models.enums import EventRole, EventStatus
from app.models.event import Event
from app.models.membership import Membership
from app.models.user import User
from app.core.security import hash_password, create_access_token
from app.services.script_parser import parse_docx_bytes, parse_raw_text, match_spoken_text_to_script

# In-memory SQLite for testing
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(scope="function")
def test_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)

@pytest.fixture(scope="function")
def client(test_db):
    def override_get_db():
        try:
            yield test_db
        finally:
            pass
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()

@pytest.fixture
def auth_headers(test_db):
    user = User(
        id="sm-user-1",
        email="sm@example.com",
        username="stagemanager",
        hashed_password=hash_password("password123"),
        is_active=True,
        is_superadmin=True
    )
    test_db.add(user)
    test_db.commit()
    token = create_access_token(user.id, extra_claims={"sub": user.id, "email": user.email})
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture
def test_event(test_db):
    event_id = "evt-concert-2026"
    event = Event(
        id=event_id,
        name="Annual Concert 2026",
        slug="concert-2026",
        status=EventStatus.LIVE.value
    )
    test_db.add(event)
    test_db.commit()
    return event_id

def test_script_text_import_and_jump(client, auth_headers, test_event):
    raw_script = """Roles: Emcee: Caitlyn\tAUDIO: Fanfare\tWelcome everyone
Caitlyn\tSPOTLIGHT ON EMCEE\tGood morning ladies and gentlemen, welcome to the show
Hang Tuah\tWHITE LIGHTS\tDid you bring the supplies for the journey
"""
    # 1. Import text
    resp = client.post(
        f"/api/events/{test_event}/script/import-text",
        headers=auth_headers,
        json={"text": raw_script, "title": "Test Concert Script"}
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["title"] == "Test Concert Script"
    assert data["total_blocks"] >= 3
    assert len(data["sections"]) > 0

    first_block = data["sections"][0]["blocks"][1]
    assert first_block["speaker"] == "Caitlyn"
    assert "Good morning ladies" in first_block["dialogue"]

    # 2. Get script
    get_resp = client.get(f"/api/events/{test_event}/script", headers=auth_headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == data["id"]

    # 3. Jump to block
    jump_resp = client.post(
        f"/api/events/{test_event}/script/jump",
        headers=auth_headers,
        json={"block_id": first_block["id"]}
    )
    assert jump_resp.status_code == 200
    assert jump_resp.json()["active_block_id"] == first_block["id"]

    # 4. Delete script
    del_resp = client.delete(f"/api/events/{test_event}/script", headers=auth_headers)
    assert del_resp.status_code == 200

    # 5. Verify deleted
    get_after = client.get(f"/api/events/{test_event}/script", headers=auth_headers)
    assert get_after.status_code == 200
    assert get_after.json() is None

def test_docx_parsing_and_upload(client, auth_headers, test_event):
    import io, docx
    doc = docx.Document()
    table = doc.add_table(rows=4, cols=3)
    # Header row
    table.rows[0].cells[0].text = "SPEAKER"
    table.rows[0].cells[1].text = "TECHNICAL NOTES"
    table.rows[0].cells[2].text = "LINES"
    # Row 1
    table.rows[1].cells[0].text = "Host"
    table.rows[1].cells[1].text = "SPOTLIGHT ON HOST"
    table.rows[1].cells[2].text = "Ladies and gentlemen, are you ready for an extraordinary show that will knock your socks off?"
    # Row 2
    table.rows[2].cells[0].text = "LIGHTS"
    table.rows[2].cells[1].text = "WHITE LIGHTS OFF"
    table.rows[2].cells[2].text = ""
    # Row 3
    table.rows[3].cells[0].text = "Narrator"
    table.rows[3].cells[1].text = "AUDIO: Theme Music"
    table.rows[3].cells[2].text = "Our story begins in the royal palace."

    bio = io.BytesIO()
    doc.save(bio)
    docx_bytes = bio.getvalue()

    resp = client.post(
        f"/api/events/{test_event}/script/upload",
        headers=auth_headers,
        files={"file": ("test_script.docx", docx_bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["total_blocks"] >= 3

    all_blocks = []
    for s in data["sections"]:
        all_blocks.extend(s["blocks"])

    matched, conf = match_spoken_text_to_script(
        blocks=all_blocks,
        spoken_text="are you ready for a show that will knock your socks off",
        threshold=0.72
    )
    assert matched is not None
    assert "knock your socks off" in matched["dialogue"].lower()
    assert conf >= 0.75


def test_random_line_jump_matching():
    blocks = [
        {"id": "b1", "order_index": 0, "speaker": "Caitlyn", "dialogue": "An exceptionally good morning to Puan Dilot, our Head of Secondary, Ms. Ebbie, our Head of Primary, dear parents, family, and friends."},
        {"id": "b2", "order_index": 1, "speaker": "Caitlyn", "dialogue": "Ladies and gentlemen…boys and girls…are you ready for a show that will knock your socks off? If you are, please put your hands together for our Early Year and Primary 6 Graduates!"},
        {"id": "b3", "order_index": 2, "speaker": "Caitlyn", "dialogue": "Thank you, ladies and gentlemen. Please be seated. It is now my great honour and privilege to invite our Principal to deliver her Welcome Address."},
        {"id": "b4", "order_index": 20, "speaker": "Sultan", "dialogue": "Talking monkeys? Don't be silly! Hang Tuah, Hang Jebat, Tun Mamat, and Sang Setia are brave and strong. They will reach Gunung Ledang safely."},
        {"id": "b5", "order_index": 35, "speaker": "Tun Mamat", "dialogue": "[Groans] Are we there yet? My feet hurt, my back hurts, and I think a monkey just stole my banana!"},
        {"id": "b6", "order_index": 50, "speaker": "Puteri", "dialogue": "Is that so? If the Sultan truly wishes to marry me, he must first fulfill my seven conditions."},
    ]

    # Test random jump from line 0 to line 35 after 3s cooldown
    matched, conf = match_spoken_text_to_script(
        blocks=blocks,
        spoken_text="Are we there yet?",
        current_block_index=0,
        time_since_last_match=3.5,
        threshold=0.60
    )
    assert matched is not None
    assert matched["id"] == "b5"
    assert conf >= 0.90

    # Test that within 3s cooldown, distant line (> 5 lines away) is blocked from premature jumping
    blocked_match, _ = match_spoken_text_to_script(
        blocks=blocks,
        spoken_text="Are we there yet?",
        current_block_index=0,
        time_since_last_match=1.2,
        threshold=0.60
    )
    assert blocked_match is None

    # Test that local line (within ±5 lines) matches immediately even within cooldown (< 3s)
    local_match, local_conf = match_spoken_text_to_script(
        blocks=blocks,
        spoken_text="Please be seated, invite our principal",
        current_block_index=1,
        time_since_last_match=0.5,
        threshold=0.60
    )
    assert local_match is not None
    assert local_match["id"] == "b3"
    assert local_conf >= 0.70

    # Test random jump to line 20 after 3s
    matched, conf = match_spoken_text_to_script(
        blocks=blocks,
        spoken_text="Talking monkeys, don't be silly!",
        current_block_index=35,
        time_since_last_match=4.0,
        threshold=0.60
    )
    assert matched is not None
    assert matched["id"] == "b4"
    assert conf >= 0.90

    # Test random jump to line 50 with partial mistranscription after 3s
    matched, conf = match_spoken_text_to_script(
        blocks=blocks,
        spoken_text="He must fulfill my seven conditions.",
        current_block_index=20,
        time_since_last_match=3.2,
        threshold=0.60
    )
    assert matched is not None
    assert matched["id"] == "b6"
    assert conf >= 0.90


def test_music_recognition_and_anti_jump():
    from app.services.script_parser import is_music_text, is_music_or_performance_block

    # 1. Text-based music detection
    assert is_music_text("♪ La la la love you ♪") is True
    assert is_music_text("[Music] Instrumental interlude") is True
    assert is_music_text("[Singing] Chorus repeats") is True
    assert is_music_text("Regular dialogue spoken on stage") is False

    blocks = [
        {"id": "b1", "order_index": 0, "speaker": "Narrator", "dialogue": "Welcome everyone to the annual musical.", "cue": ""},
        {"id": "b2", "order_index": 1, "speaker": "Singer", "dialogue": "[Song begins: Journey to the West]", "cue": "AUDIO: TRACK 1"},
        {"id": "b3", "order_index": 2, "speaker": "Actor", "dialogue": "We must fulfill seven conditions to cross the sea.", "cue": ""},
        {"id": "b4", "order_index": 10, "speaker": "Villain", "dialogue": "Talking monkeys are across the mountain river.", "cue": ""},
    ]

    # Block b2 is a music/performance block
    assert is_music_or_performance_block(blocks[1]) is True
    assert is_music_or_performance_block(blocks[0]) is False

    # 2. When singing/music is playing, random words that sound like distant dialogue MUST NOT cause jumps
    singing_match, _ = match_spoken_text_to_script(
        blocks=blocks,
        spoken_text="♪ talking monkeys across the river ♪",
        current_block_index=1,
        time_since_last_match=5.0,  # Even well after cooldown
        is_music=True
    )
    # Must NOT jump to line 10!
    assert singing_match is None or singing_match["id"] == "b2"

    # 3. If currently at line 0, and music starts, advance to the immediate next song block (b2)
    song_advance, _ = match_spoken_text_to_script(
        blocks=blocks,
        spoken_text="♪ [Music / Singing Performance] ♪",
        current_block_index=0,
        is_music=True
    )
    assert song_advance is not None
    assert song_advance["id"] == "b2"

    # 4. Explicitly flagged is_performance=True block is recognized even with neutral text
    custom_perf_block = {"id": "b5", "order_index": 5, "speaker": "Actor", "dialogue": "Spoken line without keywords", "cue": "", "is_performance": True}
    assert is_music_or_performance_block(custom_perf_block) is True


def test_toggle_block_performance_endpoint(client, auth_headers, test_event):
    # Import a simple script first
    import_resp = client.post(
        f"/api/events/{test_event}/script/import-text",
        headers=auth_headers,
        json={"text": "Narrator\tOpening remarks\tWelcome to the show\nBand\tLive overture\tInstrumental performance"}
    )
    assert import_resp.status_code == 200
    data = import_resp.json()
    first_block = data["sections"][0]["blocks"][0]
    block_id = first_block["id"]
    initial_perf = first_block["is_performance"]

    # Toggle performance flag
    toggle_resp = client.post(
        f"/api/events/{test_event}/script/blocks/{block_id}/toggle-performance",
        headers=auth_headers
    )
    assert toggle_resp.status_code == 200
    toggled_block = toggle_resp.json()
    assert toggled_block["is_performance"] != initial_perf

    # Toggle back
    toggle_resp2 = client.post(
        f"/api/events/{test_event}/script/blocks/{block_id}/toggle-performance",
        headers=auth_headers
    )
    assert toggle_resp2.status_code == 200
    assert toggle_resp2.json()["is_performance"] == initial_perf


def test_auto_jump_setting_and_matching(client, auth_headers, test_event):
    blocks = [
        {"id": "b1", "order_index": 0, "speaker": "Caitlyn", "dialogue": "Welcome to our annual presentation"},
        {"id": "b2", "order_index": 2, "speaker": "Caitlyn", "dialogue": "Please give a round of applause for our speakers"},
        {"id": "b3", "order_index": 4, "speaker": "Dean", "dialogue": "Thank you Caitlyn for the kind words"},
        {"id": "b4", "order_index": 25, "speaker": "Actor", "dialogue": "The golden eagle has landed in the distant valley"},
        {"id": "b5", "order_index": 50, "speaker": "Narrator", "dialogue": "And so ends the second scene of our story"},
    ]

    # 1. When allow_jump=False:
    # A distant utterance (> 5 lines away, e.g. line 25 while currently at line 0) is BLOCKED
    blocked, conf = match_spoken_text_to_script(
        blocks=blocks,
        spoken_text="The golden eagle has landed in the distant valley",
        current_block_index=0,
        time_since_last_match=5.0,
        threshold=0.60,
        allow_jump=False
    )
    assert blocked is None

    # An utterance within ±5 lines (e.g. line 2 while currently at line 0) matches successfully
    local_matched, local_conf = match_spoken_text_to_script(
        blocks=blocks,
        spoken_text="Please give a round of applause for our speakers",
        current_block_index=0,
        time_since_last_match=0.5,
        threshold=0.60,
        allow_jump=False
    )
    assert local_matched is not None
    assert local_matched["id"] == "b2"

    # 2. When allow_jump=True:
    # Distant utterance after cooldown is allowed to jump
    jump_matched, jump_conf = match_spoken_text_to_script(
        blocks=blocks,
        spoken_text="The golden eagle has landed in the distant valley",
        current_block_index=0,
        time_since_last_match=5.0,
        threshold=0.60,
        allow_jump=True
    )
    assert jump_matched is not None
    assert jump_matched["id"] == "b4"

    # 3. Test API endpoint POST /auto-jump
    # Import script first
    client.post(
        f"/api/events/{test_event}/script/import-text",
        headers=auth_headers,
        json={"text": "Host\tOpening\tHello world\nHost\tClosing\tGoodbye world"}
    )

    # Initial get script: auto_jump defaults to False
    res1 = client.get(f"/api/events/{test_event}/script", headers=auth_headers)
    assert res1.status_code == 200
    assert res1.json()["auto_jump"] is False

    # Enable auto_jump
    enable_res = client.post(
        f"/api/events/{test_event}/script/auto-jump",
        headers=auth_headers,
        json={"enabled": True}
    )
    assert enable_res.status_code == 200
    assert enable_res.json()["auto_jump"] is True

    # Verify script get returns auto_jump=True
    res2 = client.get(f"/api/events/{test_event}/script", headers=auth_headers)
    assert res2.status_code == 200
    assert res2.json()["auto_jump"] is True

    # Disable auto_jump
    disable_res = client.post(
        f"/api/events/{test_event}/script/auto-jump",
        headers=auth_headers,
        json={"enabled": False}
    )
    assert disable_res.status_code == 200
    assert disable_res.json()["auto_jump"] is False
