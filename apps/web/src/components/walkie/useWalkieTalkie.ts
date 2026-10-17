'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { api, getWebSocketUrl, WalkieCall, WalkiePresenceUser, WalkieActiveSpeaker } from '@/lib/api';

interface UseWalkieTalkieProps {
  eventId: string;
  enabled?: boolean;
}

// Generate subtle radio chirp tones with Web Audio API
function playRadioChirp(ctx: AudioContext, type: 'start' | 'end') {
  try {
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'start') {
      // Crisp 2-tone Motorola PTT mic engage beep (850Hz -> 1150Hz)
      osc.type = 'sine';
      osc.frequency.setValueAtTime(850, now);
      osc.frequency.setValueAtTime(1150, now + 0.035);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    } else {
      // Classic radio squelch release / roger beep
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, now);
      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      osc.start(now);
      osc.stop(now + 0.06);
    }
  } catch {
    // Ignore audio autoplay restrictions
  }
}

export function useWalkieTalkie({ eventId, enabled = true }: UseWalkieTalkieProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [voiceRoom, setVoiceRoom] = useState<string>('');
  const [connectedUsers, setConnectedUsers] = useState<WalkiePresenceUser[]>([]);
  const [activeSpeaker, setActiveSpeaker] = useState<WalkieActiveSpeaker | null>(null);
  const [incomingSpeaker, setIncomingSpeaker] = useState<WalkieActiveSpeaker | null>(null);
  
  // Audio state
  const [isTransmitting, setIsTransmitting] = useState(false);
  const [isHandsFree, setIsHandsFree] = useState(false);
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [incomingAudioLevel, setIncomingAudioLevel] = useState<number>(0);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState<number>(1.0);
  const [channelBusyMessage, setChannelBusyMessage] = useState<string | null>(null);
  
  // Call archive state
  const [calls, setCalls] = useState<WalkieCall[]>([]);
  const [isLoadingCalls, setIsLoadingCalls] = useState(false);

  // References
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playbackGainRef = useRef<GainNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const currentTransmissionIdRef = useRef<string | null>(null);
  const nextScheduledTimeRef = useRef<number>(0);
  const isTransmittingRef = useRef<boolean>(false);
  isTransmittingRef.current = isTransmitting;

  // Initialize playback AudioContext & GainNode
  const getAudioContext = useCallback((): AudioContext => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx({ sampleRate: 16000 });
      const gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);
      audioCtxRef.current = ctx;
      playbackGainRef.current = gain;
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, [volume]);

  // Update volume and mute on gain node
  useEffect(() => {
    if (playbackGainRef.current && audioCtxRef.current) {
      playbackGainRef.current.gain.setValueAtTime(
        isMuted ? 0 : volume,
        audioCtxRef.current.currentTime
      );
    }
  }, [volume, isMuted]);

  // Fetch past recorded calls
  const fetchCalls = useCallback(async (searchQuery?: string) => {
    if (!eventId) return;
    setIsLoadingCalls(true);
    try {
      const data = await api.getWalkieCalls(eventId, searchQuery);
      setCalls(data);
    } catch {
      // Ignore initial unauthenticated fetch
    } finally {
      setIsLoadingCalls(false);
    }
  }, [eventId]);

  useEffect(() => {
    if (enabled) {
      fetchCalls();
    }
  }, [enabled, fetchCalls]);

  // Start Transmission (PTT press)
  const startTransmission = useCallback(async () => {
    if (isTransmittingRef.current) return;
    if (activeSpeaker && activeSpeaker.user_id !== wsRef.current?.url) {
      setChannelBusyMessage(`Channel Busy: ${activeSpeaker.caller_name} is talking`);
      setTimeout(() => setChannelBusyMessage(null), 3000);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      mediaStreamRef.current = stream;
      const audioCtx = getAudioContext();
      playRadioChirp(audioCtx, 'start');

      const source = audioCtx.createMediaStreamSource(stream);
      // ScriptProcessor with buffer size 2048 (~128ms slices at 16kHz)
      const scriptNode = audioCtx.createScriptProcessor(2048, 1, 1);
      scriptNodeRef.current = scriptNode;

      const tid = crypto.randomUUID();
      currentTransmissionIdRef.current = tid;

      // Notify server of transmission start
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'start_transmission',
          transmission_id: tid,
        }));
      }

      setIsTransmitting(true);

      scriptNode.onaudioprocess = (event) => {
        if (!isTransmittingRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          return;
        }

        const inputData = event.inputBuffer.getChannelData(0);
        let sumSquares = 0;
        const pcm16 = new Int16Array(inputData.length);

        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          sumSquares += s * s;
        }

        // Live RMS audio level (0.0 to 1.0)
        const rms = Math.sqrt(sumSquares / inputData.length);
        setAudioLevel(Math.min(1.0, rms * 4.5));

        // Format packet: 36 bytes ASCII UUID header + Int16 PCM samples
        const headerBytes = new TextEncoder().encode(tid);
        const packet = new Uint8Array(headerBytes.length + pcm16.buffer.byteLength);
        packet.set(headerBytes, 0);
        packet.set(new Uint8Array(pcm16.buffer), headerBytes.length);

        wsRef.current.send(packet.buffer);
      };

      source.connect(scriptNode);
      scriptNode.connect(audioCtx.destination);
    } catch (err) {
      console.error('Failed to access microphone for walkie-talkie:', err);
      setIsTransmitting(false);
    }
  }, [activeSpeaker, getAudioContext]);

  // Stop Transmission (PTT release)
  const stopTransmission = useCallback(() => {
    if (!isTransmittingRef.current) return;

    const tid = currentTransmissionIdRef.current;
    setIsTransmitting(false);
    setAudioLevel(0);

    if (tid && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'end_transmission',
        transmission_id: tid,
      }));
    }

    if (scriptNodeRef.current) {
      scriptNodeRef.current.disconnect();
      scriptNodeRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioCtxRef.current) {
      playRadioChirp(audioCtxRef.current, 'end');
    }

    currentTransmissionIdRef.current = null;
  }, []);

  // Toggle Hands-Free
  const toggleTransmission = useCallback(() => {
    if (isTransmitting) {
      setIsHandsFree(false);
      stopTransmission();
    } else {
      setIsHandsFree(true);
      startTransmission();
    }
  }, [isTransmitting, startTransmission, stopTransmission]);

  // Connect WebSocket
  useEffect(() => {
    if (!enabled || !eventId) return;

    let isSubscribed = true;
    let ws: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;
    let pingInterval: NodeJS.Timeout | null = null;

    const connect = () => {
      const url = getWebSocketUrl(`/api/events/${eventId}/walkie-talkie/ws`);
      if (!url) return;

      ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isSubscribed) return;
        setIsConnected(true);
        pingInterval = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send('ping');
          }
        }, 15000);
      };

      ws.onmessage = (event) => {
        if (!isSubscribed) return;

        // Binary frame = live raw PCM voice chunk from another speaker!
        if (event.data instanceof ArrayBuffer) {
          const buf = event.data;
          if (buf.byteLength <= 36) return;

          try {
            const pcmBytes = buf.slice(36);
            const pcm16 = new Int16Array(pcmBytes);
            const float32 = new Float32Array(pcm16.length);
            let sumSq = 0;

            for (let i = 0; i < pcm16.length; i++) {
              const val = pcm16[i] / 32768.0;
              float32[i] = val;
              sumSq += val * val;
            }

            const rms = Math.sqrt(sumSq / pcm16.length);
            setIncomingAudioLevel(Math.min(1.0, rms * 4.5));

            // Schedule audio playback seamlessly
            const ctx = getAudioContext();
            const audioBuffer = ctx.createBuffer(1, float32.length, 16000);
            audioBuffer.copyToChannel(float32, 0);

            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;

            if (playbackGainRef.current) {
              source.connect(playbackGainRef.current);
            } else {
              source.connect(ctx.destination);
            }

            const startTime = Math.max(ctx.currentTime, nextScheduledTimeRef.current);
            source.start(startTime);
            nextScheduledTimeRef.current = startTime + audioBuffer.duration;
          } catch (playbackErr) {
            console.debug('Error decoding walkie pcm audio chunk:', playbackErr);
          }
          return;
        }

        // Text / JSON control messages
        if (typeof event.data === 'string') {
          if (event.data === 'pong') return;

          try {
            const msg = JSON.parse(event.data);
            switch (msg.type) {
              case 'connected':
                setVoiceRoom(msg.voice_room || '');
                setConnectedUsers(msg.connected_users || []);
                setActiveSpeaker(msg.active_speaker || null);
                break;

              case 'presence_update':
                setConnectedUsers(msg.connected_users || []);
                setActiveSpeaker(msg.active_speaker || null);
                break;

              case 'incoming_transmission_start': {
                const speaker = msg.speaker;
                setActiveSpeaker(speaker);
                setIncomingSpeaker(speaker);
                const ctx = getAudioContext();
                playRadioChirp(ctx, 'start');
                nextScheduledTimeRef.current = ctx.currentTime;
                break;
              }

              case 'incoming_transmission_end': {
                setActiveSpeaker(null);
                setIncomingSpeaker(null);
                setIncomingAudioLevel(0);
                const ctx = getAudioContext();
                playRadioChirp(ctx, 'end');
                break;
              }

              case 'channel_busy':
                setChannelBusyMessage(`Channel Busy: ${msg.active_speaker?.caller_name || 'Someone'} is talking`);
                setTimeout(() => setChannelBusyMessage(null), 3000);
                break;

              case 'new_call_recorded':
                if (msg.call) {
                  setCalls((prev) => [msg.call, ...prev.filter((c) => c.id !== msg.call.id)]);
                }
                break;

              case 'call_transcription_ready':
                if (msg.call) {
                  setCalls((prev) =>
                    prev.map((c) => (c.id === msg.call.id ? { ...c, ...msg.call } : c))
                  );
                }
                break;
            }
          } catch {
            // Ignore parse errors
          }
        }
      };

      ws.onclose = () => {
        if (!isSubscribed) return;
        setIsConnected(false);
        setActiveSpeaker(null);
        setIncomingSpeaker(null);
        if (pingInterval) clearInterval(pingInterval);
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      isSubscribed = false;
      if (pingInterval) clearInterval(pingInterval);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        ws.close();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [enabled, eventId, getAudioContext]);

  // Keyboard shortcut: Hold Spacebar to Talk (when not typing in an input)
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !isHandsFree) {
        const target = e.target as HTMLElement;
        const isInputField =
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable;

        if (!isInputField && !isTransmittingRef.current) {
          e.preventDefault();
          startTransmission();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isHandsFree && isTransmittingRef.current) {
        const target = e.target as HTMLElement;
        const isInputField =
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable;

        if (!isInputField) {
          e.preventDefault();
          stopTransmission();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [enabled, isHandsFree, startTransmission, stopTransmission]);

  const deleteCall = async (callId: string) => {
    await api.deleteWalkieCall(eventId, callId);
    setCalls((prev) => prev.filter((c) => c.id !== callId));
  };

  const clearCalls = async () => {
    await api.clearAllWalkieCalls(eventId);
    setCalls([]);
  };

  return {
    isConnected,
    voiceRoom,
    connectedUsers,
    activeSpeaker,
    incomingSpeaker,
    isTransmitting,
    isHandsFree,
    audioLevel,
    incomingAudioLevel,
    isMuted,
    setIsMuted,
    volume,
    setVolume,
    channelBusyMessage,
    calls,
    isLoadingCalls,
    startTransmission,
    stopTransmission,
    toggleTransmission,
    fetchCalls,
    deleteCall,
    clearCalls,
  };
}
