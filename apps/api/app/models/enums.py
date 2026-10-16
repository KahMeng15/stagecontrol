import enum

class EventRole(str, enum.Enum):
    ADMIN = "admin"
    STAGE_MANAGER = "stage_manager"
    CREW = "crew"
    PRESENTER = "presenter"
    VIEWER = "viewer"

class EventStatus(str, enum.Enum):
    DRAFT = "draft"
    LIVE = "live"
    COMPLETED = "completed"
    ARCHIVED = "archived"

# Hierarchy ranking for permission checks
ROLE_HIERARCHY: dict[EventRole, int] = {
    EventRole.VIEWER: 1,
    EventRole.PRESENTER: 2,
    EventRole.CREW: 3,
    EventRole.STAGE_MANAGER: 4,
    EventRole.ADMIN: 5,
}

def has_sufficient_role(current_role: str | EventRole, required_role: str | EventRole) -> bool:
    try:
        curr_enum = EventRole(current_role)
        req_enum = EventRole(required_role)
        return ROLE_HIERARCHY[curr_enum] >= ROLE_HIERARCHY[req_enum]
    except ValueError:
        return False
