import React, { useState } from 'react';
import { InterviewContext, AudioPresetId } from '../types';
import { PresetInfo } from '../hooks/useAudioDevices';

interface Props {
    context: InterviewContext;
    onContextChange: (ctx: InterviewContext) => void;
    presets: PresetInfo[];
    outputDevices?: MediaDeviceInfo[];
    inputDevices?: { device: MediaDeviceInfo; type: string; friendlyName: string }[];
    uiLang: 'en' | 'uk';
    t: any;
    listenThroughActive?: boolean;
    listenThroughError?: string | null;
}

const PRESET_META: Record<string, { icon: string; group: 'listen' | 'interview'; nameKey: string; descKey: string }> = {
    'headphones-youtube': { icon: '🎧', group: 'listen', nameKey: 'presetHeadphonesYoutube', descKey: 'presetHeadphonesYoutubeDesc' },
    'speakers':           { icon: '🔊', group: 'listen', nameKey: 'presetSpeakers', descKey: 'presetSpeakersDesc' },
    'monitor-speakers':   { icon: '🖥️', group: 'listen', nameKey: 'presetMonitor', descKey: 'presetMonitorDesc' },
    'headphones-interview': { icon: '🎙️', group: 'interview', nameKey: 'presetInterview', descKey: 'presetInterviewDesc' },
};

const SETUP_KEYS: Record<string, string> = {
    'headphones-youtube': 'presetSetupHeadphonesYoutube',
    'speakers': 'presetSetupSpeakers',
    'monitor-speakers': 'presetSetupMonitor',
    'headphones-interview': 'presetSetupInterview',
};

function findOutputDevice(outputs: MediaDeviceInfo[], ...patterns: string[]): string | null {
    for (const p of patterns) {
        const found = outputs.find(d => d.label.toLowerCase().includes(p));
        if (found) return found.label;
    }
    return null;
}

function buildDynamicGuide(
    presetId: string,
    outputs: MediaDeviceInfo[],
    inputs: { device: MediaDeviceInfo; type: string; friendlyName: string }[],
    isUk: boolean
): string[] {
    const speakersLabel = findOutputDevice(outputs, 'speakers') || (isUk ? 'Speakers (колонки)' : 'Speakers');
    const headphonesLabel = findOutputDevice(outputs, 'headphones') || (isUk ? 'Headphones (навушники)' : 'Headphones');
    const monitorLabel = findOutputDevice(outputs, 'phl', 'hdmi', 'monitor') || (isUk ? 'Монітор (HDMI)' : 'Monitor (HDMI)');
    const cableInputLabel = findOutputDevice(outputs, 'cable input') || 'CABLE Input (VB-Audio Virtual Cable)';
    const cableOutputDev = inputs.find(d => d.type === 'vb-cable');
    const cableOutputLabel = cableOutputDev?.friendlyName || 'CABLE Output (VB-Audio Virtual Cable)';
    const webcamMic = inputs.find(d => d.type === 'webcam-mic');
    const defaultMicLabel = webcamMic?.friendlyName || inputs.find(d => d.type === 'realtek-mic')?.friendlyName || (isUk ? 'Мікрофон за замовч.' : 'Default Microphone');

    if (isUk) {
        switch (presetId) {
            case 'headphones-youtube': return [
                `① Звук Windows → Вивід → обрати «${cableInputLabel}»`,
                `② Звук → Запис → «${cableOutputLabel}» → Властивості → Прослуховування → ✅ «Прослуховувати» → обрати «${headphonesLabel}»`,
                `③ Додаток автоматично обирає «${cableOutputLabel}» як вхід`,
                `✦ Результат: Звук YouTube йде в додаток І в навушники одночасно`,
            ];
            case 'speakers': return [
                `① Звук Windows → Вивід → обрати «${speakersLabel}»`,
                `② Мікрофон «${defaultMicLabel}» має бути поруч з колонками`,
                `③ Додаток використовує «${defaultMicLabel}» для захоплення звуку`,
                `⚠ Збільшіть гучність колонок якщо розпізнавання слабке`,
            ];
            case 'monitor-speakers': return [
                `① Звук Windows → Вивід → обрати «${monitorLabel}»`,
                `② Мікрофон «${defaultMicLabel}» має бути поруч з монітором`,
                `③ Додаток використовує «${defaultMicLabel}» для захоплення звуку`,
                `⚠ Динаміки монітора зазвичай тихі — сядьте ближче`,
            ];
            case 'headphones-interview': return [
                `① В Teams/Zoom → Динамік → обрати «${cableInputLabel}»`,
                `② В Teams/Zoom → Мікрофон → залишити «${defaultMicLabel}»`,
                `③ Звук → Запис → «${cableOutputLabel}» → Властивості → Прослуховування → ✅ «Прослуховувати» → обрати «${headphonesLabel}»`,
                `④ Додаток автоматично обирає «${cableOutputLabel}» як вхід`,
                `✦ Результат: Голос інтерв'юера → додаток + навушники. Вони чують «${defaultMicLabel}»`,
            ];
        }
    } else {
        switch (presetId) {
            case 'headphones-youtube': return [
                `① Windows Sound → Output → select «${cableInputLabel}»`,
                `② Sound → Recording → «${cableOutputLabel}» → Properties → Listen → ✅ «Listen to this device» → select «${headphonesLabel}»`,
                `③ App auto-selects «${cableOutputLabel}» as input`,
                `✦ Result: YouTube sound goes to the app AND your headphones`,
            ];
            case 'speakers': return [
                `① Windows Sound → Output → select «${speakersLabel}»`,
                `② Place «${defaultMicLabel}» close to the speakers`,
                `③ App uses «${defaultMicLabel}» to pick up speaker audio`,
                `⚠ Increase speaker volume if recognition is poor`,
            ];
            case 'monitor-speakers': return [
                `① Windows Sound → Output → select «${monitorLabel}»`,
                `② Place «${defaultMicLabel}» close to the monitor speakers`,
                `③ App uses «${defaultMicLabel}» to pick up monitor audio`,
                `⚠ Monitor speakers are usually quiet — sit closer`,
            ];
            case 'headphones-interview': return [
                `① In Teams/Zoom → Speaker → select «${cableInputLabel}»`,
                `② In Teams/Zoom → Microphone → keep «${defaultMicLabel}»`,
                `③ Sound → Recording → «${cableOutputLabel}» → Properties → Listen → ✅ «Listen to this device» → select «${headphonesLabel}»`,
                `④ App auto-selects «${cableOutputLabel}» as input`,
                `✦ Result: Interviewer voice → app + headphones. They hear «${defaultMicLabel}»`,
            ];
        }
    }
    return [];
}

const VBCABLE_PRESETS = ['headphones-youtube', 'headphones-interview'];

const AudioPresetSelector: React.FC<Props> = ({ context, onContextChange, presets, outputDevices = [], inputDevices = [], uiLang, t, listenThroughActive = false, listenThroughError = null }) => {
    const [expandedWarning, setExpandedWarning] = useState<string | null>(null);
    const [expandedSetup, setExpandedSetup] = useState<string | null>(null);

    const listenPresets = presets.filter(p => PRESET_META[p.id]?.group === 'listen');
    const interviewPresets = presets.filter(p => PRESET_META[p.id]?.group === 'interview');

    const selectPreset = (preset: PresetInfo) => {
        if (!preset.available) {
            setExpandedWarning(expandedWarning === preset.id ? null : preset.id);
            return;
        }
        onContextChange({
            ...context,
            audioDeviceId: preset.matchedDeviceId,
            activeAudioPreset: preset.id as AudioPresetId,
            listenThroughDeviceId: preset.listenThroughDeviceId,
        });
        setExpandedWarning(null);
    };

    const isActive = (presetId: string) => context.activeAudioPreset === presetId;

    const getWarningText = (preset: PresetInfo): string => {
        if (preset.warning === 'vb-cable-required') return t.presetVBCableRequired;
        if (preset.warning === 'vb-cable-needed') return t.presetVBCableNeeded;
        return '';
    };

    const renderPresetButton = (preset: PresetInfo) => {
        const meta = PRESET_META[preset.id];
        if (!meta) return null;
        const active = isActive(preset.id);
        const available = preset.available;

        return (
            <div key={preset.id} className="flex flex-col">
                <button
                    onClick={() => selectPreset(preset)}
                    className={`relative flex items-start gap-3 p-3 rounded-lg border transition-all duration-200 text-left w-full
                        ${active
                            ? 'border-emerald-500 bg-emerald-500/10 shadow-[0_0_12px_rgba(16,185,129,0.2)]'
                            : available
                                ? 'border-gray-700 bg-gray-900/50 hover:border-gray-500 hover:bg-gray-800/50'
                                : 'border-gray-800 bg-gray-900/30 opacity-60 cursor-pointer hover:opacity-80'
                        }`}
                >
                    <span className="text-xl mt-0.5">{meta.icon}</span>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold ${active ? 'text-emerald-400' : available ? 'text-gray-200' : 'text-gray-500'}`}>
                                {t[meta.nameKey]}
                            </span>
                            {active && (
                                <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/20 px-1.5 py-0.5 rounded">
                                    {t.presetActive}
                                </span>
                            )}
                        </div>
                        <p className={`text-[10px] mt-0.5 ${active ? 'text-emerald-300/70' : 'text-gray-500'}`}>
                            {t[meta.descKey]}
                        </p>
                        {available && preset.matchedDeviceLabel && !active && (
                            <p className="text-[9px] text-cyan-400/60 mt-1 truncate">
                                {t.presetDetected}: {preset.matchedDeviceLabel}
                            </p>
                        )}
                        {!available && (
                            <p className="text-[9px] text-amber-400/80 mt-1">
                                ⚠️ {t.presetNotAvailable}
                            </p>
                        )}
                    </div>
                </button>
                {/* Expanded warning/instructions */}
                {expandedWarning === preset.id && !available && (
                    <div className="mt-1 px-3 py-2 bg-amber-900/20 border border-amber-700/30 rounded-lg text-[10px] text-amber-300/90 leading-relaxed">
                        {getWarningText(preset)}
                    </div>
                )}
                {/* Listen Through dropdown - for VB-Cable presets */}
                {active && VBCABLE_PRESETS.includes(preset.id) && (
                    <div className="mt-2 px-3 py-2.5 bg-indigo-950/40 border-2 border-indigo-500/50 rounded-lg shadow-[0_0_8px_rgba(99,102,241,0.2)]">
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="text-[9px] font-bold uppercase tracking-wider text-cyan-400/70">
                                {t.listenThrough}
                            </label>
                            {listenThroughActive && (
                                <span className="text-[8px] font-bold text-emerald-400 bg-emerald-500/20 px-1.5 py-0.5 rounded uppercase">
                                    {t.listenThroughActive}
                                </span>
                            )}
                        </div>
                        <p className="text-[9px] text-gray-500 mb-1.5">{t.listenThroughDesc}</p>
                        <select
                            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:border-cyan-500 outline-none"
                            value={context.listenThroughDeviceId || ''}
                            onChange={(e) => onContextChange({ ...context, listenThroughDeviceId: e.target.value })}
                        >
                            <option value="" className="bg-gray-900">{t.listenThroughNone}</option>
                            {outputDevices
                                .filter(d => !d.label.toLowerCase().includes('cable input'))
                                .map(d => (
                                    <option key={d.deviceId} value={d.deviceId} className="bg-gray-900">
                                        {d.label.length > 45 ? d.label.slice(0, 45) + '...' : d.label}
                                    </option>
                                ))
                            }
                        </select>
                        {listenThroughError && (
                            <p className="text-[9px] text-red-400 mt-1">{t.listenThroughError}: {listenThroughError}</p>
                        )}
                    </div>
                )}
                {/* Setup guide toggle */}
                {available && (
                    <button
                        onClick={(e) => { e.stopPropagation(); setExpandedSetup(expandedSetup === preset.id ? null : preset.id); }}
                        className="mt-1 text-[9px] text-gray-500 hover:text-cyan-400 transition-colors text-left px-3"
                    >
                        {expandedSetup === preset.id ? `▾ ${t.presetHideSetup}` : `▸ ${t.presetShowSetup}`}
                    </button>
                )}
                {/* Expanded setup guide */}
                {expandedSetup === preset.id && available && (() => {
                    const steps = outputDevices.length > 0
                        ? buildDynamicGuide(preset.id, outputDevices, inputDevices, uiLang === 'uk')
                        : (t[SETUP_KEYS[preset.id]] as string[] || []);
                    return (
                        <div className="mt-1 px-3 py-2.5 bg-cyan-950/30 border border-cyan-800/30 rounded-lg space-y-1.5">
                            {steps.map((step: string, i: number) => (
                                <div key={i} className={`text-[10px] leading-relaxed ${step.startsWith('✦') ? 'text-emerald-400 font-medium mt-1' : step.startsWith('⚠') ? 'text-amber-400/90' : 'text-gray-300/90'}`}>
                                    {step}
                                </div>
                            ))}
                        </div>
                    );
                })()}
            </div>
        );
    };

    return (
        <div className="space-y-4">
            {/* Group 1: Listen & Translate */}
            <div>
                <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-cyan-400/70 mb-2">
                    {t.presetGroupListen}
                </div>
                <div className="space-y-2">
                    {listenPresets.map(renderPresetButton)}
                </div>
            </div>

            {/* Group 2: Interview Mode */}
            <div>
                <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-orange-400/70 mb-2">
                    {t.presetGroupInterview}
                </div>
                <div className="space-y-2">
                    {interviewPresets.map(renderPresetButton)}
                </div>
            </div>
        </div>
    );
};

export default AudioPresetSelector;
