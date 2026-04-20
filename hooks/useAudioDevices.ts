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
    matchedDeviceId: string;       // Input device (CABLE Output)
    matchedDeviceLabel: string;
    listenThroughDeviceId: string;  // Output device (Speakers/Headphones/Monitor)
    listenThroughLabel: string;
    warning?: string;
}

const DEVICE_PATTERNS: { type: DeviceType; patterns: string[]; friendlyName: string }[] = [
    { type: 'stereo-mix', patterns: ['stereo mix', 'stereo-mix', 'what u hear', 'wave out', 'loopback'], friendlyName: '🔁 Stereo Mix (системний звук)' },
    { type: 'vb-cable', patterns: ['cable output', 'vb-audio', 'vb-cable'], friendlyName: '🔌 VB-Cable (віртуальний кабель)' },
    { type: 'voicemeeter', patterns: ['voicemeeter'], friendlyName: '🎛️ VoiceMeeter (мікшер)' },
    { type: 'headset-mic', patterns: ['headset', 'airpods', 'jabra', 'plantronics', 'logitech headset', 'hands-free', 'handsfree'], friendlyName: '🎧 Гарнітура' },
    { type: 'usb-mic', patterns: ['blue yeti', 'at2020', 'fifine', 'samson', 'rode', 'usb microphone', 'usb audio', 'usb pnp'], friendlyName: '🎙️ USB мікрофон' },
    { type: 'webcam-mic', patterns: ['webcam', 'camera', 'c920', 'c922', 'c930', 'facecam', 'brio'], friendlyName: '📷 Мікрофон ��ебкамери' },
    { type: 'realtek-mic', patterns: ['realtek', 'high definition audio', 'internal mic', 'built-in', 'integrated', 'microphone array'], friendlyName: '💻 Вбудований мікрофон' },
];

// Friendly names for output devices
function friendlyOutputName(label: string): string {
    const l = label.toLowerCase();
    if (l.includes('cable input') || l.includes('vb-audio')) return '🔌 VB-Cable (вхід)';
    if (l.includes('headphone')) return '🎧 Навушники';
    if (l.includes('speaker')) return '🔊 Колонки';
    if (l.includes('hdmi') || l.includes('monitor') || l.includes('phl') || l.includes('displayport')) return '🖥️ Монітор';
    if (l.includes('realtek') || l.includes('high definition')) return '🔊 Вбудовані динаміки';
    if (l.includes('bluetooth') || l.includes('bt ')) return '📶 Bluetooth';
    if (l.includes('airpods')) return '🎧 AirPods';
    if (l.includes('voicemeeter')) return '🎛️ VoiceMeeter';
    return label;
}

function classifyDevice(device: MediaDeviceInfo): ClassifiedDevice {
    const label = device.label.toLowerCase();
    for (const { type, patterns, friendlyName } of DEVICE_PATTERNS) {
        if (patterns.some(p => label.includes(p))) {
            // Add specific brand/model if detectable
            let name = friendlyName;
            if (type === 'usb-mic') {
                if (label.includes('blue yeti')) name = '🎙️ Blue Yeti';
                else if (label.includes('at2020')) name = '🎙️ AT2020 USB';
                else if (label.includes('fifine')) name = '🎙️ Fifine USB';
                else if (label.includes('rode')) name = '🎙️ Rode USB';
                else if (label.includes('samson')) name = '🎙️ Samson USB';
            } else if (type === 'headset-mic') {
                if (label.includes('airpods')) name = '🎧 AirPods';
                else if (label.includes('jabra')) name = '🎧 Jabra';
                else if (label.includes('plantronics') || label.includes('poly')) name = '🎧 Poly/Plantronics';
                else if (label.includes('logitech')) name = '🎧 Logitech гарнітура';
            } else if (type === 'webcam-mic') {
                if (label.includes('c920')) name = '📷 Logitech C920';
                else if (label.includes('c922')) name = '📷 Logitech C922';
                else if (label.includes('brio')) name = '📷 Logitech Brio';
            }
            return { device, type, friendlyName: name };
        }
    }
    // Fallback: try to make a readable name from the raw label
    const rawLabel = device.label || `Мікрофон ${device.deviceId.slice(0, 6)}`;
    return { device, type: 'unknown', friendlyName: `🎤 ${rawLabel}` };
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
    const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
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
            const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
            setRawDevices(audioInputs);
            setOutputDevices(audioOutputs);
            setClassifiedDevices(audioInputs.map(classifyDevice));
            console.log(`🔌 [AudioDevices] ${audioInputs.length} inputs, ${audioOutputs.length} outputs. VB-Cable: ${audioInputs.some(d => d.label.toLowerCase().includes('cable')) ? 'YES' : 'NO'}`);
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

    // Find output device by pattern, return with friendly label
    const findOutput = useCallback((...patterns: string[]): { id: string; label: string } | null => {
        for (const p of patterns) {
            const found = outputDevices.find(d => d.label.toLowerCase().includes(p));
            if (found) return { id: found.deviceId, label: friendlyOutputName(found.label) };
        }
        return null;
    }, [outputDevices]);

    // Rank microphones by quality: USB > headset > webcam > realtek > unknown
    const getBestMic = useCallback((): ClassifiedDevice | undefined => {
        const priority: DeviceType[] = ['usb-mic', 'headset-mic', 'webcam-mic', 'realtek-mic', 'unknown'];
        return findDeviceByType(classifiedDevices, ...priority);
    }, [classifiedDevices]);

    const getPresets = useCallback((): PresetInfo[] => {
        const vbCable = findDeviceByType(classifiedDevices, 'vb-cable', 'stereo-mix', 'voicemeeter');
        const speakers = findOutput('speakers');
        const headphones = findOutput('headphones');
        const monitor = findOutput('phl', 'hdmi', 'monitor');
        const noVBCable = { available: false, matchedDeviceId: '', matchedDeviceLabel: '', listenThroughDeviceId: '', listenThroughLabel: '', warning: 'vb-cable-needed' as const };

        // === UNIVERSAL PRESETS (always available) ===

        // 🎤 Best Available: auto-detect best mic
        const bestMic = getBestMic();
        const bestAvailablePreset: PresetInfo = {
            id: 'best-available',
            available: classifiedDevices.length > 0,
            matchedDeviceId: bestMic?.device.deviceId || '',
            matchedDeviceLabel: bestMic?.friendlyName || 'System default',
            listenThroughDeviceId: '',
            listenThroughLabel: '',
        };

        // 🔇 Default Mic: system default (no device selection)
        const defaultMicPreset: PresetInfo = {
            id: 'default-mic',
            available: true,
            matchedDeviceId: '',
            matchedDeviceLabel: 'System default',
            listenThroughDeviceId: '',
            listenThroughLabel: '',
        };

        // === VB-CABLE PRESETS (require virtual audio driver) ===

        // 🔊 Speakers via VB-Cable: input=CABLE, output=Speakers
        const speakersPreset: PresetInfo = vbCable && speakers
            ? { id: 'speakers', available: true, matchedDeviceId: vbCable.device.deviceId, matchedDeviceLabel: vbCable.friendlyName, listenThroughDeviceId: speakers.id, listenThroughLabel: speakers.label }
            : { id: 'speakers', ...noVBCable };

        // 🎧 Headphones via VB-Cable: input=CABLE, output=Headphones
        const headphonesPreset: PresetInfo = vbCable && headphones
            ? { id: 'headphones-youtube', available: true, matchedDeviceId: vbCable.device.deviceId, matchedDeviceLabel: vbCable.friendlyName, listenThroughDeviceId: headphones.id, listenThroughLabel: headphones.label }
            : { id: 'headphones-youtube', ...noVBCable };

        // 🖥️ Monitor via VB-Cable: input=CABLE, output=Monitor
        const monitorPreset: PresetInfo = vbCable && monitor
            ? { id: 'monitor-speakers', available: true, matchedDeviceId: vbCable.device.deviceId, matchedDeviceLabel: vbCable.friendlyName, listenThroughDeviceId: monitor.id, listenThroughLabel: monitor.label }
            : { id: 'monitor-speakers', ...noVBCable };

        // 🎙️ Interview via VB-Cable: input=CABLE, output=Headphones (default for calls)
        const interviewPreset: PresetInfo = vbCable && headphones
            ? { id: 'headphones-interview', available: true, matchedDeviceId: vbCable.device.deviceId, matchedDeviceLabel: vbCable.friendlyName, listenThroughDeviceId: headphones.id, listenThroughLabel: headphones.label }
            : vbCable && speakers
                ? { id: 'headphones-interview', available: true, matchedDeviceId: vbCable.device.deviceId, matchedDeviceLabel: vbCable.friendlyName, listenThroughDeviceId: speakers.id, listenThroughLabel: speakers.label }
                : { id: 'headphones-interview', ...noVBCable, warning: 'vb-cable-required' };

        return [bestAvailablePreset, defaultMicPreset, speakersPreset, headphonesPreset, monitorPreset, interviewPreset];
    }, [classifiedDevices, outputDevices, findOutput, getBestMic]);

    return {
        rawDevices,
        outputDevices,
        classifiedDevices,
        isLoading,
        refreshDevices: enumerate,
        getPresets,
        hasVBCable,
        hasStereoMix,
        hasVoiceMeeter,
    };
}
