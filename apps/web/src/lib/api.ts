// API Client for StageControl

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';

export interface User {
  id: string;
  username: string;
  email: string;
  full_name: string | null;
  is_active: boolean;
  is_superadmin: boolean;
  created_at: string;
}

export type EventRole = 'admin' | 'stage_manager' | 'crew' | 'presenter' | 'viewer';
export type EventStatus = 'draft' | 'live' | 'completed' | 'archived';

export interface Membership {
  id: string;
  user_id: string;
  event_id: string;
  role: EventRole;
  callsign: string | null;
  created_at: string;
  user?: User;
}

export interface EventItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: EventStatus;
  created_by_id: string | null;
  created_at: string;
  updated_at: string;
  user_role?: EventRole;
  stream_key?: string | null;
  public_pin?: string | null;
  public_pin_enabled?: boolean;
}

export interface EventDetail extends EventItem {
  memberships: Membership[];
}

export interface PublicEventInfo {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: EventStatus;
  public_pin_enabled: boolean;
}

export interface GuestAuthResponse {
  access_token: string;
  token_type: string;
  event: EventItem;
  display_name: string;
}

export interface SystemSettings {
  id: string;
  primary_domain: string | null;
  alternative_domain: string | null;
  updated_at: string;
}

export interface StreamStatus {
  is_live: boolean;
  ready: boolean;
  readers_count: number;
  bytes_received: number;
  tracks: string[];
  rtmp_url: string;
  webrtc_url: string;
  webrtc_whep_url: string;
  hls_url: string;
  hls_playlist_url: string;
  stream_key?: string | null;
}

export interface Recording {
  id: string;
  event_id: string;
  title: string;
  filename: string;
  duration_seconds: number;
  file_size_bytes: number;
  status: string;
  created_at: string;
  stream_url: string;
  download_url: string;
}

export interface VideoMarker {
  id: string;
  event_id: string;
  recording_id?: string | null;
  title: string;
  description?: string | null;
  timestamp_seconds?: number | null;
  color: string;
  created_by_id?: string | null;
  creator_callsign?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubtitleItem {
  id: string;
  event_id: string;
  stream_key?: string | null;
  text: string;
  language: string;
  start_seconds?: number | null;
  end_seconds?: number | null;
  confidence?: number | null;
  created_at: string;
}

export interface SubtitleStatus {
  is_active: boolean;
  event_id: string;
  model_name: string;
  subtitles_count: number;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface ScriptBlock {
  id: string;
  section_id: string;
  order_index: number;
  speaker: string | null;
  cue: string | null;
  dialogue: string | null;
  notes: string | null;
}

export interface ScriptSection {
  id: string;
  script_id: string;
  title: string;
  order_index: number;
  blocks: ScriptBlock[];
}

export interface ScriptItem {
  id: string;
  event_id: string;
  title: string;
  version: number;
  is_active: number;
  created_at: string;
  updated_at: string;
  sections: ScriptSection[];
  total_blocks: number;
  active_block_id?: string | null;
}

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('stagecontrol_token');
}

export function setStoredToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) {
    localStorage.setItem('stagecontrol_token', token);
  } else {
    localStorage.removeItem('stagecontrol_token');
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 204) {
    return {} as T;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const errorMsg = data?.detail || `API Request failed with status ${response.status}`;
    throw new ApiError(errorMsg, response.status);
  }

  return data as T;
}

export const api = {
  // Auth
  register: (payload: { username: string; email: string; password: string; full_name?: string }) =>
    request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (payload: { username_or_email: string; password: string }) =>
    request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getMe: () => request<User>('/auth/me'),

  logout: () => {
    setStoredToken(null);
  },

  // Events
  listEvents: () => request<EventItem[]>('/events'),

  createEvent: (payload: { name: string; slug?: string; description?: string }) =>
    request<EventItem>('/events', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getEvent: (eventIdOrSlug: string) => request<EventDetail>(`/events/${eventIdOrSlug}`),

  updateEvent: (eventId: string, payload: { name?: string; description?: string; status?: EventStatus }) =>
    request<EventItem>(`/events/${eventId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteEvent: (eventId: string) =>
    request<void>(`/events/${eventId}`, {
      method: 'DELETE',
    }),

  regenerateStreamKey: (eventId: string) =>
    request<EventItem>(`/events/${eventId}/regenerate-stream-key`, {
      method: 'POST',
    }),

  // Public 6-Digit PIN
  generatePublicPin: (eventId: string) =>
    request<EventItem>(`/events/${eventId}/public-pin`, {
      method: 'POST',
    }),

  revokePublicPin: (eventId: string) =>
    request<EventItem>(`/events/${eventId}/public-pin`, {
      method: 'DELETE',
    }),

  getPublicEventInfo: (pin: string) =>
    request<PublicEventInfo>(`/events/public/info/${pin}`),

  joinWithPublicPin: (pin: string, displayName?: string) =>
    request<GuestAuthResponse>('/events/public/join', {
      method: 'POST',
      body: JSON.stringify({ pin, display_name: displayName }),
    }),

  // Members
  listMembers: (eventId: string) => request<Membership[]>(`/events/${eventId}/members`),

  addMember: (eventId: string, payload: { username_or_email: string; role: EventRole; callsign?: string }) =>
    request<Membership>(`/events/${eventId}/members`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateMember: (eventId: string, membershipId: string, payload: { role?: EventRole; callsign?: string }) =>
    request<Membership>(`/events/${eventId}/members/${membershipId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  removeMember: (eventId: string, membershipId: string) =>
    request<void>(`/events/${eventId}/members/${membershipId}`, {
      method: 'DELETE',
    }),

  // System Settings (Superadmin)
  getSettings: () => request<SystemSettings>('/settings'),

  updateSettings: (payload: { primary_domain?: string | null; alternative_domain?: string | null }) =>
    request<SystemSettings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  // Live Streaming & Recordings (Milestone 2)
  getStreamStatus: (eventId: string) =>
    request<StreamStatus>(`/events/${eventId}/stream-status`),

  listRecordings: (eventId: string) =>
    request<Recording[]>(`/events/${eventId}/recordings`),

  renameRecording: (eventId: string, recordingId: string, title: string) =>
    request<Recording>(`/events/${eventId}/recordings/${recordingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),

  deleteRecording: (eventId: string, recordingId: string) =>
    request<void>(`/events/${eventId}/recordings/${recordingId}`, {
      method: 'DELETE',
    }),

  // Video Timeline Chapters & Markers
  listMarkers: (eventId: string, recordingId?: string) =>
    request<VideoMarker[]>(`/events/${eventId}/markers${recordingId ? `?recording_id=${recordingId}` : ''}`),

  createMarker: (
    eventId: string,
    payload: {
      title: string;
      description?: string;
      timestamp_seconds?: number | null;
      recording_id?: string | null;
      color?: string;
    }
  ) =>
    request<VideoMarker>(`/events/${eventId}/markers`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateMarker: (
    eventId: string,
    markerId: string,
    payload: {
      title?: string;
      description?: string;
      timestamp_seconds?: number | null;
      color?: string;
    }
  ) =>
    request<VideoMarker>(`/events/${eventId}/markers/${markerId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteMarker: (eventId: string, markerId: string) =>
    request<void>(`/events/${eventId}/markers/${markerId}`, {
      method: 'DELETE',
    }),

  // Real-time Live Transcription & Subtitles
  listSubtitles: (eventId: string, search?: string, limit: number = 100, recordingId?: string) =>
    request<SubtitleItem[]>(
      `/events/${eventId}/subtitles?limit=${limit}${search ? `&search=${encodeURIComponent(search)}` : ''}${recordingId ? `&recording_id=${recordingId}` : ''}`
    ),

  getSubtitleStatus: (eventId: string) =>
    request<SubtitleStatus>(`/events/${eventId}/subtitles/status`),

  toggleTranscription: (eventId: string) =>
    request<{ is_active: boolean; message: string }>(`/events/${eventId}/subtitles/toggle`, {
      method: 'POST',
    }),

  clearSubtitles: (eventId: string) =>
    request<void>(`/events/${eventId}/subtitles`, {
      method: 'DELETE',
    }),

  // Script & Cue Synchronization
  getScript: (eventId: string) =>
    request<ScriptItem | null>(`/events/${eventId}/script`),

  uploadScriptFile: async (eventId: string, file: File, title?: string): Promise<ScriptItem> => {
    const token = getStoredToken();
    const formData = new FormData();
    formData.append('file', file);
    if (title) formData.append('title', title);

    const res = await fetch(`${API_BASE}/events/${eventId}/script/upload`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to upload script file' }));
      throw new Error(err.detail || 'Failed to upload script file');
    }
    return res.json();
  },

  importScriptText: (eventId: string, text: string, title?: string) =>
    request<ScriptItem>(`/events/${eventId}/script/import-text`, {
      method: 'POST',
      body: JSON.stringify({ text, title }),
    }),

  jumpScriptBlock: (eventId: string, blockId: string) =>
    request<{ status: string; active_block_id: string }>(`/events/${eventId}/script/jump`, {
      method: 'POST',
      body: JSON.stringify({ block_id: blockId }),
    }),

  deleteScript: (eventId: string) =>
    request<{ status: string; message: string }>(`/events/${eventId}/script`, {
      method: 'DELETE',
    }),

  // Token helper for media streaming & download
  getToken: getStoredToken,
};

export function getWebSocketUrl(path: string): string {
  if (typeof window === 'undefined') return '';
  const token = api.getToken() || '';
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const queryPrefix = cleanPath.includes('?') ? '&' : '?';
  const tokenQuery = token ? `${queryPrefix}token=${encodeURIComponent(token)}` : '';

  if (process.env.NEXT_PUBLIC_API_URL) {
    try {
      const u = new URL(process.env.NEXT_PUBLIC_API_URL);
      const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${wsProto}//${u.host}${cleanPath}${tokenQuery}`;
    } catch {}
  }

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname;
  const port = window.location.port === '3000' ? '8000' : window.location.port;
  return `${wsProtocol}//${host}${port ? `:${port}` : ''}${cleanPath}${tokenQuery}`;
}


