import { useState, useEffect, useRef, useCallback } from 'react';

interface UseAudioPassthroughOptions {
    inputDeviceId: string;    // CABLE Output device ID (source)
    outputDeviceId: string;   // User-selected output device ID (headphones/speakers)
    enabled: boolean;         // Whether passthrough should be active
}

interface UseAudioPassthroughReturn {
    isActive: boolean;
    error: string | null;
}

export function useAudioPassthrough({ inputDeviceId, outputDeviceId, enabled }: UseAudioPassthroughOptions): UseAudioPassthroughReturn {
    const [isActive, setIsActive] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const audioCtxRef = useRef<AudioContext | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const audioElementRef = useRef<HTMLAudioElement | null>(null);

    const cleanup = useCallback(() => {
        if (audioElementRef.current) {
            audioElementRef.current.pause();
            audioElementRef.current.srcObject = null;
            audioElementRef.current = null;
        }
        if (audioCtxRef.current) {
            audioCtxRef.current.close().catch(() => {});
            audioCtxRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        setIsActive(false);
    }, []);

    useEffect(() => {
        if (!enabled || !inputDeviceId || !outputDeviceId) {
            cleanup();
            return;
        }

        let cancelled = false;

        async function start() {
            cleanup();
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        deviceId: { exact: inputDeviceId },
                        echoCancellation: false,
                        autoGainControl: false,
                        noiseSuppression: false,
                    }
                });
                if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
                streamRef.current = stream;

                const audioCtx = new AudioContext();
                audioCtxRef.current = audioCtx;

                // Resume if suspended (Chrome autoplay policy)
                if (audioCtx.state === 'suspended') {
                    await audioCtx.resume();
                }

                const source = audioCtx.createMediaStreamSource(stream);
                const destination = audioCtx.createMediaStreamDestination();
                source.connect(destination);

                const audio = new Audio();
                audio.srcObject = destination.stream;

                // Route to selected output device
                if (typeof (audio as any).setSinkId === 'function') {
                    await (audio as any).setSinkId(outputDeviceId);
                }

                await audio.play();
                if (cancelled) { audio.pause(); return; }
                audioElementRef.current = audio;

                setIsActive(true);
                setError(null);
                console.log(`🔊 Audio passthrough active: ${inputDeviceId.slice(0, 8)}... → ${outputDeviceId.slice(0, 8)}...`);
            } catch (e: any) {
                if (!cancelled) {
                    console.error('Audio passthrough error:', e);
                    setError(e.message);
                    setIsActive(false);
                }
            }
        }

        start();

        return () => {
            cancelled = true;
            cleanup();
        };
    }, [enabled, inputDeviceId, outputDeviceId, cleanup]);

    return { isActive, error };
}
