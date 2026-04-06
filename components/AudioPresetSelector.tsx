import React, { useState } from 'react';
import { InterviewContext, AudioPresetId } from '../types';
import { PresetInfo } from '../hooks/useAudioDevices';

interface Props {
    context: InterviewContext;
    onContextChange: (ctx: InterviewContext) => void;
    presets: PresetInfo[];
    uiLang: 'en' | 'uk';
    t: any;
}

const PRESET_META: Record<string, { icon: string; group: 'listen' | 'interview'; nameKey: string; descKey: string }> = {
    'headphones-youtube': { icon: '🎧', group: 'listen', nameKey: 'presetHeadphonesYoutube', descKey: 'presetHeadphonesYoutubeDesc' },
    'speakers':           { icon: '🔊', group: 'listen', nameKey: 'presetSpeakers', descKey: 'presetSpeakersDesc' },
    'monitor-speakers':   { icon: '🖥️', group: 'listen', nameKey: 'presetMonitor', descKey: 'presetMonitorDesc' },
    'headphones-interview': { icon: '🎙️', group: 'interview', nameKey: 'presetInterview', descKey: 'presetInterviewDesc' },
};

const AudioPresetSelector: React.FC<Props> = ({ context, onContextChange, presets, uiLang, t }) => {
    const [expandedWarning, setExpandedWarning] = useState<string | null>(null);

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
