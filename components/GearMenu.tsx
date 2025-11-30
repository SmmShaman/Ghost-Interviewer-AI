

import React, { useState, useRef, useEffect } from 'react';
import { InterviewContext, ViewMode } from '../types';
import { translations } from '../translations';
import { SettingsIcon } from './Icons';

interface GearMenuProps {
  context: InterviewContext;
  onContextChange: (ctx: InterviewContext) => void;
  uiLang: 'en' | 'uk';
  onOpenFullSettings: () => void;
}

interface MenuItem {
  id: string;
  icon: string;
  label: string;
  color: string;
  subItems?: SubMenuItem[];
}

interface SubMenuItem {
  id: string;
  label: string;
  value: string;
  isActive?: boolean;
}

const GearMenu: React.FC<GearMenuProps> = ({ context, onContextChange, uiLang, onOpenFullSettings }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const t = translations[uiLang];

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setExpandedItem(null);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleChange = (field: keyof InterviewContext, value: any) => {
    onContextChange({ ...context, [field]: value });
  };

  const toggleGear = () => {
    if (isOpen) {
      setExpandedItem(null);
    }
    setIsOpen(!isOpen);
  };

  const toggleSubMenu = (itemId: string) => {
    setExpandedItem(expandedItem === itemId ? null : itemId);
  };

  // Menu items configuration
  const menuItems: MenuItem[] = [
    {
      id: 'mode',
      icon: '🎯',
      label: t.settings.modeCards?.selectMode || 'Mode',
      color: 'emerald',
      subItems: [
        { id: 'FULL', label: 'FULL', value: 'FULL', isActive: context.viewMode === 'FULL' },
        { id: 'FOCUS', label: 'FOCUS', value: 'FOCUS', isActive: context.viewMode === 'FOCUS' },
        { id: 'SIMPLE', label: 'SIMPLE', value: 'SIMPLE', isActive: context.viewMode === 'SIMPLE' },
      ]
    },
    {
      id: 'language',
      icon: '🌐',
      label: t.settings.accordion?.languageSettings || 'Language',
      color: 'blue',
      subItems: [
        { id: 'no', label: '🇳🇴 Norwegian', value: 'Norwegian', isActive: context.targetLanguage === 'Norwegian' },
        { id: 'en', label: '🇬🇧 English', value: 'English', isActive: context.targetLanguage === 'English' },
        { id: 'de', label: '🇩🇪 German', value: 'German', isActive: context.targetLanguage === 'German' },
        { id: 'fr', label: '🇫🇷 French', value: 'French', isActive: context.targetLanguage === 'French' },
      ]
    },
    {
      id: 'ai',
      icon: '🤖',
      label: 'AI Model',
      color: 'purple',
      subItems: [
        { id: 'azure', label: 'Azure GPT-4', value: 'azure', isActive: context.llmProvider === 'azure' },
        { id: 'groq', label: 'Groq Llama 3', value: 'groq', isActive: context.llmProvider === 'groq' },
      ]
    },
    {
      id: 'audio',
      icon: '🎧',
      label: t.settings.accordion?.audioSetup || 'Audio',
      color: 'orange',
      subItems: [
        { id: 'stereo_on', label: 'Stereo ON', value: 'true', isActive: context.stereoMode === true },
        { id: 'stereo_off', label: 'Stereo OFF', value: 'false', isActive: context.stereoMode === false },
      ]
    },
    {
      id: 'settings',
      icon: '⚙️',
      label: t.settings.accordion?.advancedPrompts || 'Full Settings',
      color: 'gray',
    },
  ];

  const handleSubItemClick = (menuId: string, subItem: SubMenuItem) => {
    switch (menuId) {
      case 'mode':
        handleChange('viewMode', subItem.value as ViewMode);
        break;
      case 'language':
        handleChange('targetLanguage', subItem.value);
        break;
      case 'ai':
        handleChange('llmProvider', subItem.value as 'azure' | 'groq');
        break;
      case 'audio':
        handleChange('stereoMode', subItem.value === 'true');
        break;
    }
    // Close submenu after selection
    setExpandedItem(null);
  };

  const handleMenuItemClick = (item: MenuItem) => {
    if (item.id === 'settings') {
      setIsOpen(false);
      setExpandedItem(null);
      onOpenFullSettings();
    } else if (item.subItems) {
      toggleSubMenu(item.id);
    }
  };

  const getColorClasses = (color: string, isActive: boolean = false) => {
    const colors: Record<string, { bg: string; border: string; text: string; hover: string; activeBg: string }> = {
      emerald: { bg: 'bg-emerald-900/30', border: 'border-emerald-500', text: 'text-emerald-400', hover: 'hover:bg-emerald-800/50', activeBg: 'bg-emerald-500' },
      blue: { bg: 'bg-blue-900/30', border: 'border-blue-500', text: 'text-blue-400', hover: 'hover:bg-blue-800/50', activeBg: 'bg-blue-500' },
      purple: { bg: 'bg-purple-900/30', border: 'border-purple-500', text: 'text-purple-400', hover: 'hover:bg-purple-800/50', activeBg: 'bg-purple-500' },
      orange: { bg: 'bg-orange-900/30', border: 'border-orange-500', text: 'text-orange-400', hover: 'hover:bg-orange-800/50', activeBg: 'bg-orange-500' },
      amber: { bg: 'bg-amber-900/30', border: 'border-amber-500', text: 'text-amber-400', hover: 'hover:bg-amber-800/50', activeBg: 'bg-amber-500' },
      gray: { bg: 'bg-gray-800/50', border: 'border-gray-600', text: 'text-gray-400', hover: 'hover:bg-gray-700/50', activeBg: 'bg-gray-500' },
    };
    return colors[color] || colors.gray;
  };

  return (
    <div ref={menuRef} className="relative flex items-center">
      {/* Gear Button */}
      <button
        onClick={toggleGear}
        className={`
          relative z-50 p-2.5 rounded-full transition-all duration-500 ease-out
          ${isOpen
            ? 'bg-gradient-to-br from-emerald-500 to-cyan-500 text-white shadow-lg shadow-emerald-500/30 rotate-180'
            : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 border border-gray-700'
          }
        `}
        title="Settings"
      >
        <SettingsIcon className={`w-5 h-5 transition-transform duration-500 ${isOpen ? 'rotate-90' : ''}`} />
      </button>

      {/* Menu Items Container - Horizontal Slide Out */}
      <div className={`
        absolute left-14 flex items-center gap-2 transition-all duration-500 ease-out
        ${isOpen
          ? 'opacity-100 translate-x-0'
          : 'opacity-0 -translate-x-8 pointer-events-none'
        }
      `}>
        {menuItems.map((item, index) => {
          const colors = getColorClasses(item.color);
          const isExpanded = expandedItem === item.id;
          const delay = index * 50;

          return (
            <div
              key={item.id}
              className="relative"
              style={{
                transitionDelay: isOpen ? `${delay}ms` : `${(menuItems.length - index - 1) * 30}ms`,
              }}
            >
              {/* Menu Item Button */}
              <button
                onClick={() => handleMenuItemClick(item)}
                className={`
                  flex items-center gap-2 px-3 py-2 rounded-lg border transition-all duration-300
                  ${isExpanded
                    ? `${colors.bg} ${colors.border} shadow-lg`
                    : `bg-gray-800/90 border-gray-700 ${colors.hover}`
                  }
                  transform ${isOpen ? 'translate-x-0 opacity-100' : '-translate-x-4 opacity-0'}
                  hover:scale-105 active:scale-95
                `}
                style={{
                  transitionDelay: isOpen ? `${delay}ms` : `${(menuItems.length - index - 1) * 30}ms`,
                }}
              >
                <span className="text-base">{item.icon}</span>
                <span className={`text-[10px] font-bold uppercase tracking-wider ${isExpanded ? colors.text : 'text-gray-300'}`}>
                  {item.label}
                </span>
                {item.subItems && (
                  <span className={`text-[10px] transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''} ${colors.text}`}>
                    ▼
                  </span>
                )}
              </button>

              {/* Sub-Items Dropdown - Vertical Slide Down */}
              {item.subItems && (
                <div className={`
                  absolute top-full left-0 mt-2 min-w-[140px] z-50
                  bg-gray-900/95 backdrop-blur-md border border-gray-700 rounded-lg shadow-2xl
                  overflow-hidden transition-all duration-300 ease-out origin-top
                  ${isExpanded
                    ? 'opacity-100 scale-y-100 translate-y-0'
                    : 'opacity-0 scale-y-0 -translate-y-2 pointer-events-none'
                  }
                `}>
                  {item.subItems.map((subItem, subIndex) => {
                    const subColors = getColorClasses(
                      item.id === 'mode'
                        ? (subItem.value === 'FULL' ? 'emerald' : subItem.value === 'FOCUS' ? 'blue' : 'amber')
                        : item.color
                    );

                    return (
                      <button
                        key={subItem.id}
                        onClick={() => handleSubItemClick(item.id, subItem)}
                        className={`
                          w-full flex items-center gap-2 px-3 py-2 text-left transition-all duration-200
                          ${subItem.isActive
                            ? `${subColors.bg} ${subColors.text}`
                            : 'text-gray-300 hover:bg-gray-800/80 hover:text-white'
                          }
                          border-b border-gray-800/50 last:border-b-0
                        `}
                        style={{
                          transitionDelay: isExpanded ? `${subIndex * 50}ms` : '0ms',
                          transform: isExpanded ? 'translateY(0)' : 'translateY(-10px)',
                          opacity: isExpanded ? 1 : 0,
                        }}
                      >
                        {subItem.isActive && (
                          <span className={`w-1.5 h-1.5 rounded-full ${subColors.activeBg}`}></span>
                        )}
                        <span className="text-xs font-medium">{subItem.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Backdrop for mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm md:hidden"
          onClick={() => {
            setIsOpen(false);
            setExpandedItem(null);
          }}
        />
      )}
    </div>
  );
};

export default GearMenu;
