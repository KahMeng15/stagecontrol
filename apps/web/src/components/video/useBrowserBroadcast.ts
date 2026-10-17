'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';

export type QualityPreset = '1080p' | '720p' | '480p';

export interface QualityConfig {
  label: string;
  width: number;
  height: number;
  frameRate: number;
  maxBitrate: number;
}

export const QUALITY_PRESETS: Record<QualityPreset, QualityConfig> = {
  '1080p': {
    label: '1080p Full HD (3.5 Mbps)',
    width: 1920,
    height: 1080,
    frameRate: 30,
    maxBitrate: 3500000,
  },
  '720p': {
    label: '720p Balanced (1.5 Mbps)',
    width: 1280,
    height: 720,
    frameRate: 30,
    maxBitrate: 1500000,
  },
  '480p': {
    label: '480p Data Saver (700 kbps)',
    width: 854,
    height: 480,
    frameRate: 30,
    maxBitrate: 700000,
  },
};

export type BroadcastStatus = 'idle' | 'requesting_permissions' | 'ready' | 'connecting' | 'live' | 'error';

interface UseBrowserBroadcastOptions {
  eventId: string;
  streamKey?: string | null;
  onLiveChange?: (isLive: boolean) => void;
}

export function useBrowserBroadcast({ eventId, streamKey, onLiveChange }: UseBrowserBroadcastOptions) {
  const [status, setStatus] = useState<BroadcastStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // Device lists
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState<string>('');
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState<string>('');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  // Controls & Settings
  const [qualityPreset, setQualityPreset] = useState<QualityPreset>('720p');
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);
  const [isVideoMuted, setIsVideoMuted] = useState<boolean>(false);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
  const [isTorchSupported, setIsTorchSupported] = useState<boolean>(false);

  // Real-time audio VU meter & Stream stats
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [streamDuration, setStreamDuration] = useState<number>(0);

  // References
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const whipSessionUrlRef = useRef<string | null>(null);
  const durationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Enumerate all connected audio/video devices
  const updateDeviceList = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const vDevs = devices.filter((d) => d.kind === 'videoinput');
      const aDevs = devices.filter((d) => d.kind === 'audioinput');

      setVideoDevices(vDevs);
      setAudioDevices(aDevs);

      // Auto-select first devices if not selected
      setSelectedVideoDeviceId((curr) => {
        if (curr && vDevs.some((d) => d.deviceId === curr)) return curr;
        return vDevs[0]?.deviceId || '';
      });

      setSelectedAudioDeviceId((curr) => {
        if (curr && aDevs.some((d) => d.deviceId === curr)) return curr;
        return aDevs[0]?.deviceId || '';
      });
    } catch (e: any) {
      console.warn('Failed to enumerate media devices:', e);
    }
  }, []);

  // Listen for device changes (e.g. plugging in webcam or bluetooth mic)
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return;
    const handleDeviceChange = () => {
      updateDeviceList();
    };
    navigator.mediaDevices.addEventListener?.('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener?.('devicechange', handleDeviceChange);
    };
  }, [updateDeviceList]);

  // Audio VU meter setup
  const setupAudioAnalyzer = useCallback((stream: MediaStream) => {
    try {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }

      const audioTrack = stream.getAudioTracks()[0];
      if (!audioTrack) {
        setAudioLevel(0);
        return;
      }

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);
      analyserRef.current = analyser;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const renderMeter = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const normalized = Math.min(100, Math.round((average / 128) * 100));
        setAudioLevel(normalized);

        animFrameRef.current = requestAnimationFrame(renderMeter);
      };

      renderMeter();
    } catch {
      setAudioLevel(0);
    }
  }, []);

  // Check torch capability
  const inspectTorchCapability = useCallback((stream: MediaStream) => {
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) {
      setIsTorchSupported(false);
      return;
    }
    try {
      const capabilities = (videoTrack.getCapabilities && videoTrack.getCapabilities()) || {};
      setIsTorchSupported(Boolean((capabilities as any).torch));
    } catch {
      setIsTorchSupported(false);
    }
  }, []);

  // Initialize or re-acquire media stream based on current device / quality settings
  const initPreview = useCallback(
    async (overrideVideoId?: string, overrideAudioId?: string, overrideFacing?: 'environment' | 'user') => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setError('Media devices not supported in this browser. Please use a modern browser over HTTPS or localhost.');
        setStatus('error');
        return null;
      }

      const preset = QUALITY_PRESETS[qualityPreset];
      const videoId = overrideVideoId !== undefined ? overrideVideoId : selectedVideoDeviceId;
      const audioId = overrideAudioId !== undefined ? overrideAudioId : selectedAudioDeviceId;
      const targetFacing = overrideFacing !== undefined ? overrideFacing : facingMode;

      const videoConstraints: MediaTrackConstraints = {
        width: { ideal: preset.width },
        height: { ideal: preset.height },
        frameRate: { ideal: preset.frameRate },
      };

      if (videoId) {
        videoConstraints.deviceId = { exact: videoId };
      } else {
        videoConstraints.facingMode = { ideal: targetFacing };
      }

      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };
      if (audioId) {
        audioConstraints.deviceId = { exact: audioId };
      }

      try {
        setStatus((s) => (s === 'live' ? s : 'requesting_permissions'));
        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: audioConstraints,
        });

        // Stop previous tracks if not live
        if (mediaStreamRef.current && status !== 'live') {
          mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        }

        mediaStreamRef.current = stream;
        inspectTorchCapability(stream);
        setupAudioAnalyzer(stream);
        await updateDeviceList();

        setStatus((s) => (s === 'live' ? s : 'ready'));
        setError(null);
        return stream;
      } catch (err: any) {
        console.error('Failed to get camera/mic stream:', err);
        let msg = 'Failed to access camera or microphone.';
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          msg = 'Permission denied. Please grant camera and microphone access in browser settings.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          msg = 'No camera or microphone found on this device.';
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          msg = 'Camera or microphone is already in use by another application.';
        }
        setError(msg);
        setStatus('error');
        return null;
      }
    },
    [qualityPreset, selectedVideoDeviceId, selectedAudioDeviceId, facingMode, inspectTorchCapability, setupAudioAnalyzer, updateDeviceList, status]
  );

  // Switch camera device (seamless track replacement if already streaming)
  const selectVideoDevice = useCallback(
    async (deviceId: string) => {
      setSelectedVideoDeviceId(deviceId);

      if (status === 'live' && pcRef.current) {
        const preset = QUALITY_PRESETS[qualityPreset];
        try {
          const newStream = await navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: { exact: deviceId },
              width: { ideal: preset.width },
              height: { ideal: preset.height },
              frameRate: { ideal: preset.frameRate },
            },
          });
          const newTrack = newStream.getVideoTracks()[0];
          const oldTrack = mediaStreamRef.current?.getVideoTracks()[0];

          if (oldTrack && mediaStreamRef.current) {
            mediaStreamRef.current.removeTrack(oldTrack);
            oldTrack.stop();
          }
          if (newTrack && mediaStreamRef.current) {
            mediaStreamRef.current.addTrack(newTrack);
          }

          const senders = pcRef.current.getSenders();
          const videoSender = senders.find((s) => s.track?.kind === 'video');
          if (videoSender && newTrack) {
            await videoSender.replaceTrack(newTrack);
          }
          inspectTorchCapability(mediaStreamRef.current!);
        } catch (e: any) {
          setError(`Could not switch camera: ${e.message}`);
        }
      } else {
        await initPreview(deviceId, undefined, undefined);
      }
    },
    [status, qualityPreset, initPreview, inspectTorchCapability]
  );

  // Switch microphone device
  const selectAudioDevice = useCallback(
    async (deviceId: string) => {
      setSelectedAudioDeviceId(deviceId);

      if (status === 'live' && pcRef.current) {
        try {
          const newStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId: { exact: deviceId },
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
          const newTrack = newStream.getAudioTracks()[0];
          const oldTrack = mediaStreamRef.current?.getAudioTracks()[0];

          if (oldTrack && mediaStreamRef.current) {
            mediaStreamRef.current.removeTrack(oldTrack);
            oldTrack.stop();
          }
          if (newTrack && mediaStreamRef.current) {
            mediaStreamRef.current.addTrack(newTrack);
          }

          const senders = pcRef.current.getSenders();
          const audioSender = senders.find((s) => s.track?.kind === 'audio');
          if (audioSender && newTrack) {
            await audioSender.replaceTrack(newTrack);
          }
          if (mediaStreamRef.current) {
            setupAudioAnalyzer(mediaStreamRef.current);
          }
        } catch (e: any) {
          setError(`Could not switch microphone: ${e.message}`);
        }
      } else {
        await initPreview(undefined, deviceId, undefined);
      }
    },
    [status, initPreview, setupAudioAnalyzer]
  );

  // Flip camera (between environment and user, useful for mobile)
  const flipCamera = useCallback(async () => {
    const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextFacing);

    // If multiple video devices are known, pick the other one or let facingMode decide
    if (videoDevices.length > 1) {
      const currentIndex = videoDevices.findIndex((d) => d.deviceId === selectedVideoDeviceId);
      const nextIndex = (currentIndex + 1) % videoDevices.length;
      const nextDevId = videoDevices[nextIndex].deviceId;
      await selectVideoDevice(nextDevId);
    } else {
      await initPreview(undefined, undefined, nextFacing);
    }
  }, [facingMode, videoDevices, selectedVideoDeviceId, selectVideoDevice, initPreview]);

  // Toggle Torch / Flashlight
  const toggleTorch = useCallback(async () => {
    if (!mediaStreamRef.current) return;
    const track = mediaStreamRef.current.getVideoTracks()[0];
    if (!track) return;

    try {
      const nextState = !isTorchOn;
      await track.applyConstraints({
        advanced: [{ torch: nextState } as any],
      });
      setIsTorchOn(nextState);
    } catch (e) {
      console.warn('Torch toggle failed:', e);
    }
  }, [isTorchOn]);

  // Audio mute toggle
  const toggleAudioMute = useCallback(() => {
    if (!mediaStreamRef.current) return;
    const track = mediaStreamRef.current.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setIsAudioMuted(!track.enabled);
    }
  }, []);

  // Video pause/mute toggle
  const toggleVideoMute = useCallback(() => {
    if (!mediaStreamRef.current) return;
    const track = mediaStreamRef.current.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setIsVideoMuted(!track.enabled);
    }
  }, []);

  // Screen WakeLock management to keep phone screen awake during show
  const acquireWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator && (navigator as any).wakeLock) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      }
    } catch {}
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
    }
  }, []);

  // Stop broadcasting
  const stopBroadcast = useCallback(async () => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    releaseWakeLock();

    // Terminate WHIP session on server
    if (whipSessionUrlRef.current) {
      const sessionUrl = whipSessionUrlRef.current;
      whipSessionUrlRef.current = null;
      try {
        if (sessionUrl.startsWith('/api/events/')) {
          const parts = sessionUrl.split('/');
          const sid = parts[parts.length - 1];
          await api.deleteWhipSession(eventId, sid);
        } else {
          await fetch(sessionUrl, { method: 'DELETE' }).catch(() => {});
        }
      } catch {}
    }

    // Close WebRTC peer connection
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    setStatus('ready');
    setStreamDuration(0);
    onLiveChange?.(false);
  }, [eventId, onLiveChange, releaseWakeLock]);

  // Start broadcasting via WHIP
  const startBroadcast = useCallback(async () => {
    setError(null);
    setStatus('connecting');

    // Make sure media stream exists
    let stream = mediaStreamRef.current;
    if (!stream || stream.getTracks().every((t) => t.readyState === 'ended')) {
      stream = await initPreview();
      if (!stream) {
        setStatus('error');
        return;
      }
    }

    try {
      // 1. Create RTCPeerConnection
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
        bundlePolicy: 'max-bundle',
      });
      pcRef.current = pc;

      // 2. Add local audio and video tracks
      const preset = QUALITY_PRESETS[qualityPreset];
      stream.getTracks().forEach((track) => {
        const sender = pc.addTrack(track, stream!);
        // Set maximum bitrate constraint on video sender
        if (track.kind === 'video' && sender.setParameters) {
          try {
            const params = sender.getParameters();
            if (!params.encodings || params.encodings.length === 0) {
              params.encodings = [{}];
            }
            params.encodings[0].maxBitrate = preset.maxBitrate;
            sender.setParameters(params).catch(() => {});
          } catch {}
        }
      });

      // 3. Monitor connection state
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          setStatus('live');
          onLiveChange?.(true);
        } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          if (status === 'live') {
            setError('Stream connection dropped. Please reconnect.');
            stopBroadcast();
          }
        }
      };

      // 4. Create offer and wait for ICE gathering
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for ICE candidates to gather into SDP offer
      if (pc.iceGatheringState !== 'complete') {
        await new Promise<void>((resolve) => {
          const checkState = () => {
            if (pc.iceGatheringState === 'complete') {
              pc.removeEventListener('icegatheringstatechange', checkState);
              resolve();
            }
          };
          pc.addEventListener('icegatheringstatechange', checkState);
          setTimeout(resolve, 1500); // 1.5s max gather time
        });
      }

      const offerSdp = pc.localDescription?.sdp || offer.sdp;
      if (!offerSdp) {
        throw new Error('Failed to generate WebRTC SDP offer');
      }

      // 5. Ingest via WHIP (try backend proxy first, fallback to direct port 8889 if needed)
      let answerSdp = '';
      let sessionLocation: string | undefined = undefined;

      try {
        const whipRes = await api.postWhipOffer(eventId, offerSdp);
        answerSdp = whipRes.sdp;
        sessionLocation = whipRes.location;
      } catch (proxyErr: any) {
        // Fallback: Direct WHIP to MediaMTX port 8889 if stream key is available
        if (streamKey && typeof window !== 'undefined') {
          const directWhipUrl = `http://${window.location.hostname}:8889/live/${streamKey}/whip`;
          const directResp = await fetch(directWhipUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/sdp' },
            body: offerSdp,
          });
          if (!directResp.ok) {
            throw new Error(`MediaMTX WHIP returned error ${directResp.status}`);
          }
          answerSdp = await directResp.text();
          const loc = directResp.headers.get('Location');
          sessionLocation = loc ? `http://${window.location.hostname}:8889${loc}` : undefined;
        } else {
          throw proxyErr;
        }
      }

      whipSessionUrlRef.current = sessionLocation || null;

      // 6. Set remote description with answer SDP
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: answerSdp }));

      // 7. Acquire Screen WakeLock
      acquireWakeLock();

      // 8. Start duration counter
      setStreamDuration(0);
      durationTimerRef.current = setInterval(() => {
        setStreamDuration((d) => d + 1);
      }, 1000);

      setStatus('live');
      onLiveChange?.(true);
    } catch (err: any) {
      console.error('WHIP Broadcast error:', err);
      setError(err.message || 'Failed to establish live broadcast connection');
      setStatus('error');
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
    }
  }, [eventId, streamKey, qualityPreset, initPreview, onLiveChange, acquireWakeLock, stopBroadcast, status]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
      if (whipSessionUrlRef.current) {
        const url = whipSessionUrlRef.current;
        if (url.startsWith('/api/events/')) {
          const parts = url.split('/');
          const sid = parts[parts.length - 1];
          api.deleteWhipSession(eventId, sid).catch(() => {});
        } else {
          fetch(url, { method: 'DELETE' }).catch(() => {});
        }
      }
      if (pcRef.current) pcRef.current.close();
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      releaseWakeLock();
    };
  }, [eventId, releaseWakeLock]);

  return {
    status,
    isLive: status === 'live',
    error,
    mediaStream: mediaStreamRef.current,
    videoDevices,
    audioDevices,
    selectedVideoDeviceId,
    selectedAudioDeviceId,
    facingMode,
    qualityPreset,
    isAudioMuted,
    isVideoMuted,
    isTorchOn,
    isTorchSupported,
    audioLevel,
    streamDuration,
    initPreview,
    startBroadcast,
    stopBroadcast,
    selectVideoDevice,
    selectAudioDevice,
    flipCamera,
    toggleTorch,
    toggleAudioMute,
    toggleVideoMute,
    setQualityPreset,
  };
}
