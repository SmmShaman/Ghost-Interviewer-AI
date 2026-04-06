import { useState, useEffect, useCallback } from 'react';
import { AudioPresetId } from '../types';

export type DeviceType = 'stereo-mix' | 'vb-cable' | 'voicemeeter' | 'realtek-mic' | 'usb-mic' | 'headset-mic' | 'webcam-mic' | 'unknown';

export interface ClassifiedDevice {
    device: MediaDeviceInfo;
    type: DeviceType;
    friendlyName: string;
}

export interface PresetInfo {
    id: AudioPresetId;
    available: boolean;
    matchedDeviceId: string;
    matchedDeviceLabel: string;
    warning?: string;
}

const DEVICE_PATTERNS: { type: DeviceType; patterns: string[] }[] = [
    { type: 'stereo-mix', patterns: ['stereo mix', 'stereo-mix', 'what u hear', 'wave out', 'loopback'] },
    { type: 'vb-cable', patterns: ['cable output', 'vb-audio', 'vb-cable'] },
    { type: 'voicemeeter', patterns: ['voicemeeter'] },
    { type: 'headset-mic', patterns: ['headset', 'airpods', 'jabra', 'plantronics', 'logitech headset'] },
    { type: 'usb-mic', patterns: ['usb', 'blue yeti', 'at2020', 'fifine', 'samson', 'rode'] },
    { type: 'webcam-mic', patterns: ['webcam', 'camera', 'c920', 'c922', 'facecam'] },
    { type: 'realtek-mic', patterns: ['realtek', 'high definition audio', 'internal mic', 'built-in'] },
];

function classifyDevice(device: MediaDeviceInfo): ClassifiedDevice {
    const label = device.label.toLowerCase();
    for (const { type, patterns } of DEVICE_PATTERNS) {
        if (patterns.some(p => label.includes(p))) {
            return { device, type, friendlyName: device.label };
        }
    }
    return { device, type: 'unknown', friendlyName: device.label || `Microphone ${device.deviceId.slice(0, 8)}` };
}

function findDeviceByType(devices: ClassifiedDevice[], ...types: DeviceType[]): ClassifiedDevice | undefined {
    for (const type of types) {
        const found = devices.find(d => d.type === type);
        if (found) return found;
    }
    return undefined;
}

export function useAudioDevices() {
    const [rawDevices, setRawDevices] = useState<MediaDeviceInfo[]>([]);
    const [classifiedDevices, setClassifiedDevices] = useState<ClassifiedDevice[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const enumerate = useCallback(async () => {
        setIsLoading(true);
        try {
            // Request permission first to get device labels
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(t => t.stop());
            } catch { /* proceed without labels */ }

            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(d => d.kind === 'audioinput');
            setRawDevices(audioInputs);
            setClassifiedDevices(audioInputs.map(classifyDevice));
        } catch (e) {
            console.error('Failed to enumerate audio devices', e);
        }
        setIsLoading(false);
    }, []);

    useEffect(() => {
        enumerate();
        const handler = () => enumerate();
        navigator.mediaDevices?.addEventListener('devicechange', handler);
        return () => navigator.mediaDevices?.removeEventListener('devicechange', handler);
    }, [enumerate]);

    const hasVBCable = classifiedDevices.some(d => d.type === 'vb-cable');
    const hasStereoMix = classifiedDevices.some(d => d.type === 'stereo-mix');
    const hasVoiceMeeter = classifiedDevices.some(d => d.type === 'voicemeeter');
    const hasAnyMic = classifiedDevices.length > 0;

    const getPresets = useCallback((): PresetInfo[] => {
        // Headphones + YouTube: need Stereo Mix or VB-Cable to capture system audio
        const systemCapture = findDeviceByType(classifiedDevices, 'vb-cable', 'stereo-mix', 'voicemeeter');
        const headphonesYoutube: PresetInfo = systemCapture
            ? { id: 'headphones-youtube', available: true, matchedDeviceId: systemCapture.device.deviceId, matchedDeviceLabel: systemCapture.friendlyName }
            : { id: 'headphones-youtube', available: false, matchedDeviceId: '', matchedDeviceLabel: '', warning: 'vb-cable-needed' };

        // Speakers: just use default mic, it picks up speaker sound
        const speakers: PresetInfo = {
            id: 'speakers', available: hasAnyMic, matchedDeviceId: '', matchedDeviceLabel: 'Default Microphone'
        };

        // Monitor speakers: same as speakers
        const monitorSpeakers: PresetInfo = {
            id: 'monitor-speakers', available: hasAnyMic, matchedDeviceId: '', matchedDeviceLabel: 'Default Microphone'
        };

        // Interview mode: needs VB-Cable to route Teams/Zoom audio
        const vbCable = findDeviceByType(classifiedDevices, 'vb-cable');
        const headphonesInterview: PresetInfo = vbCable
            ? { id: 'headphones-interview', available: true, matchedDeviceId: vbCable.device.deviceId, matchedDeviceLabel: vbCable.friendlyName }
            : { id: 'headphones-interview', available: false, matchedDeviceId: '', matchedDeviceLabel: '', warning: 'vb-cable-required' };

        return [headphonesYoutube, speakers, monitorSpeakers, headphonesInterview];
    }, [classifiedDevices, hasAnyMic]);

    return {
        rawDevices,
        classifiedDevices,
        isLoading,
        refreshDevices: enumerate,
        getPresets,
        hasVBCable,
        hasStereoMix,
        hasVoiceMeeter,
    };
}
