const resolveApiBase = (): string => {
  if (typeof window !== 'undefined') {
    const envUrl = process.env.NEXT_PUBLIC_API_URL;
    if (envUrl && envUrl.startsWith('http') && !envUrl.includes('localhost')) {
      return envUrl;
    }
    if ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && window.location.port === '3000') {
      return envUrl || 'http://localhost:8000/api';
    }
    return '/api';
  }
  return process.env.INTERNAL_API_URL ? `${process.env.INTERNAL_API_URL}/api` : (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api');
};

export const API_BASE = resolveApiBase();

export interface User {
  id: string;
  email: string;
  username?: string;
  full_name: string | null;
  is_active: boolean;
  is_superadmin: boolean;
  approval_status?: 'approved' | 'pending' | 'rejected';
  last_login_at?: string | null;
  last_login_ip?: string | null;
  last_login_device?: string | null;
  last_login_browser?: string | null;
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
  registration_mode: 'open' | 'approval' | 'closed';
  updated_at: string;
}

export interface LoginLog {
  id: string;
  user_id: string;
  ip_address: string | null;
  device: string | null;
  browser: string | null;
  user_agent: string | null;
  status: string;
  created_at: string;
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
  webrtc_whip_url?: string;
  hls_url: string;
  hls_playlist_url: string;
  hls_low_url?: string;
  hls_low_playlist_url?: string;
  webrtc_low_url?: string;
  webrtc_low_whep_url?: string;
  stream_key?: string | null;
  ready_time?: string | null;
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
  master_stream_url?: string;
  download_url: string;
  proxy_filename?: string | null;
  proxy_size_bytes?: number | null;
  is_optimized?: boolean;
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
  is_music?: boolean | null;
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
  requires_approval?: boolean;
  message?: string;
}

export interface ScriptBlock {
  id: string;
  section_id: string;
  order_index: number;
  speaker: string | null;
  cue: string | null;
  dialogue: string | null;
  notes: string | null;
  is_performance?: boolean;
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
  auto_jump?: boolean;
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
  getRegistrationMode: () =>
    request<{ registration_mode: 'open' | 'approval' | 'closed' }>('/auth/registration-mode'),

  register: (payload: { email: string; password: string; full_name: string; username?: string }) =>
    request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (payload: { email: string; password: string }) =>
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

  updateSettings: (payload: {
    primary_domain?: string | null;
    alternative_domain?: string | null;
    registration_mode?: 'open' | 'approval' | 'closed';
  }) =>
    request<SystemSettings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  // Admin User Management (Superadmin)
  listAdminUsers: (params?: { query?: string; status_filter?: string; role_filter?: string }) => {
    const q = new URLSearchParams();
    if (params?.query) q.set('query', params.query);
    if (params?.status_filter && params.status_filter !== 'all') q.set('status_filter', params.status_filter);
    if (params?.role_filter && params.role_filter !== 'all') q.set('role_filter', params.role_filter);
    const qs = q.toString();
    return request<User[]>(`/admin/users${qs ? `?${qs}` : ''}`);
  },

  createAdminUser: (payload: { email: string; full_name: string; password: string; is_superadmin?: boolean }) =>
    request<User>('/admin/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateAdminUser: (userId: string, payload: { email?: string; full_name?: string; is_superadmin?: boolean; password?: string }) =>
    request<User>(`/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  updateAdminUserStatus: (userId: string, payload: { is_active?: boolean; approval_status?: 'approved' | 'pending' | 'rejected' }) =>
    request<User>(`/admin/users/${userId}/status`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteAdminUser: (userId: string) =>
    request<{ message: string }>(`/admin/users/${userId}`, {
      method: 'DELETE',
    }),

  getUserLoginLogs: (userId: string) =>
    request<LoginLog[]>(`/admin/users/${userId}/logs`),

  // Live Streaming & Recordings (Milestone 2)
  getStreamStatus: (eventId: string) =>
    request<StreamStatus>(`/events/${eventId}/stream-status`),

  postWhipOffer: async (eventId: string, sdp: string): Promise<{ sdp: string; location?: string }> => {
    const token = getStoredToken();
    const headers: HeadersInit = {
      'Content-Type': 'application/sdp',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    const response = await fetch(`${API_BASE}/events/${eventId}/whip`, {
      method: 'POST',
      headers,
      body: sdp,
    });
    if (!response.ok) {
      const err = await response.text().catch(() => '');
      throw new Error(err || `WHIP failed with status ${response.status}`);
    }
    const location = response.headers.get('Location') || undefined;
    const answerSdp = await response.text();
    return { sdp: answerSdp, location };
  },

  deleteWhipSession: async (eventId: string, sessionId: string): Promise<void> => {
    const token = getStoredToken();
    const headers: HeadersInit = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    await fetch(`${API_BASE}/events/${eventId}/whip/${sessionId}`, {
      method: 'DELETE',
      headers,
    }).catch(() => {});
  },

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

  optimizeRecording: (eventId: string, recordingId: string) =>
    request<Recording>(`/events/${eventId}/recordings/${recordingId}/optimize`, {
      method: 'POST',
    }),

  postProcessRecordings: (eventId: string) =>
    request<{ status: string; message: string }>(`/events/${eventId}/recordings/post-process`, {
      method: 'POST',
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

  toggleScriptAutoJump: (eventId: string, enabled: boolean) =>
    request<{ status: string; auto_jump: boolean }>(`/events/${eventId}/script/auto-jump`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),

  toggleBlockPerformance: (eventId: string, blockId: string) =>
    request<ScriptBlock>(`/events/${eventId}/script/blocks/${blockId}/toggle-performance`, {
      method: 'POST',
    }),

  updateScriptBlock: (eventId: string, blockId: string, data: Partial<ScriptBlock>) =>
    request<ScriptBlock>(`/events/${eventId}/script/blocks/${blockId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteScript: (eventId: string) =>
    request<{ status: string; message: string }>(`/events/${eventId}/script`, {
      method: 'DELETE',
    }),

  // Walkie-Talkie Comms (Milestone 4)
  getWalkieStatus: (eventId: string) =>
    request<WalkieStatus>(`/events/${eventId}/walkie-talkie/status`),

  getWalkieCalls: (eventId: string, search?: string) =>
    request<WalkieCall[]>(`/events/${eventId}/walkie-talkie/calls${search ? `?search=${encodeURIComponent(search)}` : ''}`),

  deleteWalkieCall: (eventId: string, callId: string) =>
    request<{ message: string }>(`/events/${eventId}/walkie-talkie/calls/${callId}`, {
      method: 'DELETE',
    }),

  clearAllWalkieCalls: (eventId: string) =>
    request<{ message: string }>(`/events/${eventId}/walkie-talkie/calls`, {
      method: 'DELETE',
    }),

  // Token helper for media streaming & download
  getToken: getStoredToken,
};

export interface WalkieCall {
  id: string;
  event_id: string;
  caller_id: string | null;
  caller_name: string;
  caller_role: string;
  audio_url: string;
  duration_seconds: number;
  file_size_bytes: number;
  transcription: string | null;
  language: string;
  status: string;
  created_at: string;
}

export interface WalkiePresenceUser {
  user_id: string;
  caller_name: string;
  caller_role: string;
}

export interface WalkieActiveSpeaker {
  user_id: string;
  caller_name: string;
  caller_role: string;
  transmission_id: string;
  started_at: number;
}

export interface WalkieStatus {
  event_id: string;
  voice_room: string;
  connected_users: WalkiePresenceUser[];
  active_speaker: WalkieActiveSpeaker | null;
  total_calls: number;
}

export function getWebSocketUrl(path: string): string {
  if (typeof window === 'undefined') return '';
  const token = api.getToken() || '';
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const queryPrefix = cleanPath.includes('?') ? '&' : '?';
  const tokenQuery = token ? `${queryPrefix}token=${encodeURIComponent(token)}` : '';

  const envWs = process.env.NEXT_PUBLIC_WS_URL;
  if (envWs && (envWs.startsWith('ws://') || envWs.startsWith('wss://'))) {
    try {
      const u = new URL(envWs);
      return `${u.protocol}//${u.host}${cleanPath}${tokenQuery}`;
    } catch {}
  }

  const envUrl = process.env.NEXT_PUBLIC_API_URL;
  if (envUrl && envUrl.startsWith('http') && !envUrl.includes('localhost')) {
    try {
      const u = new URL(envUrl);
      const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${wsProto}//${u.host}${cleanPath}${tokenQuery}`;
    } catch {}
  }

  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname;

  if (window.location.port === '3000') {
    return `${wsProtocol}//${host}:8000${cleanPath}${tokenQuery}`;
  }

  if (window.location.port === '1550') {
    return `${wsProtocol}//${host}:1551${cleanPath}${tokenQuery}`;
  }

  const port = window.location.port ? `:${window.location.port}` : '';
  return `${wsProtocol}//${host}${port}${cleanPath}${tokenQuery}`;
}

export function getAudioMediaUrl(urlPath: string): string {
  if (!urlPath) return '';
  const token = api.getToken() || '';
  const tokenQuery = token ? `token=${encodeURIComponent(token)}` : '';

  let fullUrl = urlPath;
  if (!urlPath.startsWith('http://') && !urlPath.startsWith('https://')) {
    const cleanPath = urlPath.startsWith('/api') ? urlPath.replace(/^\/api/, '') : urlPath;
    fullUrl = `${API_BASE}${cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`}`;
  }

  if (tokenQuery && !fullUrl.includes('token=')) {
    const sep = fullUrl.includes('?') ? '&' : '?';
    fullUrl = `${fullUrl}${sep}${tokenQuery}`;
  }
  return fullUrl;
}


