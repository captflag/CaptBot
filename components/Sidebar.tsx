
import React, { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Plus, 
  Search, 
  Compass, 
  Library, 
  FolderOpen, 
  History, 
  MoreHorizontal,
  FileText,
  Loader2,
  Trash2,
  SidebarClose,
  Sparkles,
  BookOpen,
  Cpu,
  ArrowRight,
  Upload,
  Settings,
  Moon,
  Sun,
  Edit2,
  Save,
  Bookmark
} from 'lucide-react';
import { RagDocument } from '../types';
import Logo from './Logo';
import { rag } from '../services/ragService';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ChatHistoryItem {
  id: string;
  title: string;
  timestamp: number;
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  history: ChatHistoryItem[];
  onRenameChat: (id: string, newTitle: string) => void;
  status: 'IDLE' | 'BUSY';
  currentFont: string;
  onFontChange: (font: string) => void;
  isDarkMode: boolean;
  toggleTheme: () => void;
  savedPrompts: string[];
}

const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  onNewChat,
  onSelectChat,
  history,
  onRenameChat,
  currentFont,
  onFontChange,
  isDarkMode,
  toggleTheme,
  savedPrompts
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isIndexing, setIsIndexing] = useState(false);
  const [docs, setDocs] = useState<RagDocument[]>(rag.getDocuments());
  const [activeTab, setActiveTab] = useState<'EXPLORE' | 'LIBRARY' | 'FILES' | 'HISTORY' | 'SETTINGS'>('HISTORY');
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsIndexing(true);
    try {
      const text = await file.text();
      await rag.indexDocument(file.name, text);
      setDocs([...rag.getDocuments()]);
      setActiveTab('FILES');
    } catch (err) {
      console.error("Indexing failed:", err);
    } finally {
      setIsIndexing(false);
    }
  };

  const handleDeleteDoc = (id: string) => {
    rag.removeDocument(id);
    setDocs([...rag.getDocuments()]);
  };

  const startEditing = (id: string, title: string) => {
    setEditingChatId(id);
    setEditTitle(title);
  };

  const saveEditing = (id: string) => {
    onRenameChat(id, editTitle);
    setEditingChatId(null);
  };

  const groupHistory = (items: ChatHistoryItem[]) => {
    const today = new Date().setHours(0,0,0,0);
    const yesterday = new Date(today - 86400000).setHours(0,0,0,0);
    const lastWeek = new Date(today - 604800000).setHours(0,0,0,0);

    const groups = {
      today: [] as ChatHistoryItem[],
      yesterday: [] as ChatHistoryItem[],
      lastWeek: [] as ChatHistoryItem[],
      older: [] as ChatHistoryItem[]
    };

    items.forEach(item => {
      if (item.timestamp >= today) groups.today.push(item);
      else if (item.timestamp >= yesterday) groups.yesterday.push(item);
      else if (item.timestamp >= lastWeek) groups.lastWeek.push(item);
      else groups.older.push(item);
    });

    return groups;
  };

  const groups = groupHistory(history);

  const MenuItem = ({ icon: Icon, label, id }: { icon: any, label: string, id: string }) => (
    <button 
      onClick={() => setActiveTab(id as any)}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all relative group",
        activeTab === id 
          ? "bg-purple-50/50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300" 
          : "text-gray-500 hover:bg-gray-50/80 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200"
      )}
    >
      <Icon size={18} className={cn("transition-colors", activeTab === id ? "text-purple-600 dark:text-purple-400" : "text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300")} />
      <span>{label}</span>
      {activeTab === id && (
        <motion.div 
            layoutId="activeTabIndicator"
            className="absolute left-0 w-1 h-5 bg-purple-600 rounded-r-full shadow-[0_0_8px_rgba(147,51,234,0.5)]"
        />
      )}
    </button>
  );

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-gray-900/10 backdrop-blur-sm z-40 lg:hidden transition-all duration-500"
          />
        )}
      </AnimatePresence>

      <motion.aside 
        initial={false}
        animate={{ x: isOpen ? 0 : '-100%' }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className={cn(
          "fixed top-0 left-0 bottom-0 w-[280px] z-50 flex flex-col font-sans",
          // Glassmorphism implementation
          "bg-white/80 backdrop-blur-2xl backdrop-saturate-150",
          "dark:bg-[#0A0A0A]/80 dark:border-gray-800",
          "border-r border-gray-200/50",
          "shadow-[8px_0_30px_-10px_rgba(0,0,0,0.05)] lg:shadow-none"
        )}
      >
        {/* Header */}
        <div className="p-5 flex items-center justify-between">
          <Logo size="md" />
          <button onClick={onClose} className="lg:hidden text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <SidebarClose size={20} />
          </button>
        </div>

        {/* New Chat & Search */}
        <div className="px-4 pb-2 space-y-3">
          <button 
            onClick={() => { onNewChat(); onClose(); }}
            className="w-full flex items-center justify-center gap-2 bg-[#111827] hover:bg-black hover:shadow-lg text-white py-2.5 rounded-lg text-sm font-medium shadow-md transition-all active:scale-[0.98] dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            <Plus size={18} />
            <span>New chat</span>
          </button>

          <div className="relative group">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-purple-500 transition-colors" />
            <input 
              type="text" 
              placeholder="Search" 
              className="w-full bg-white/50 border border-gray-200/60 rounded-lg py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-purple-100 focus:border-purple-200 focus:bg-white transition-all shadow-sm dark:bg-white/5 dark:border-gray-800 dark:text-gray-100 dark:focus:ring-purple-900"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 border border-gray-200/60 rounded px-1 bg-white/50 dark:bg-white/10 dark:border-gray-700">⌘K</span>
          </div>
        </div>

        {/* Navigation */}
        <div className="px-2 py-4 space-y-1">
          <MenuItem icon={Compass} label="Explore" id="EXPLORE" />
          <MenuItem icon={Library} label="Library" id="LIBRARY" />
          <MenuItem icon={FolderOpen} label="Files" id="FILES" />
          <MenuItem icon={History} label="History" id="HISTORY" />
          <MenuItem icon={Settings} label="Settings" id="SETTINGS" />
        </div>

        {/* Content Area */}
        <div className="flex-grow overflow-y-auto custom-scrollbar px-4 py-2">
            
            {/* --- FILES TAB --- */}
            {activeTab === 'FILES' && (
                <motion.div 
                    initial={{ opacity: 0, x: -10 }} 
                    animate={{ opacity: 1, x: 0 }} 
                    className="space-y-4"
                >
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Knowledge Base</span>
                        <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".txt,.md,.json,.csv" />
                        <button 
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isIndexing}
                            className="p-1.5 text-purple-600 hover:bg-purple-50 rounded-md transition-colors dark:text-purple-400 dark:hover:bg-purple-900/30"
                            title="Upload text document"
                        >
                            {isIndexing ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                        </button>
                    </div>
                    
                    <div className="space-y-2">
                        {docs.length === 0 && (
                            <div className="text-center py-8 px-4 text-xs text-gray-400 border-2 border-dashed border-gray-100 rounded-xl bg-gray-50/30 dark:bg-white/5 dark:border-gray-800">
                                <Upload size={24} className="mx-auto mb-2 opacity-50" />
                                <p>No files indexed.</p>
                                <p className="opacity-70 mt-1">Upload .txt or .md</p>
                            </div>
                        )}
                        {docs.map(doc => (
                            <div key={doc.id} className="group flex items-center gap-3 p-3 rounded-xl border border-gray-100 bg-white/60 hover:bg-white hover:border-purple-200 hover:shadow-sm transition-all backdrop-blur-sm dark:bg-white/5 dark:border-gray-800 dark:hover:bg-white/10 dark:hover:border-purple-900">
                                <div className="p-2 bg-purple-50 text-purple-600 rounded-lg shrink-0 dark:bg-purple-900/30 dark:text-purple-300">
                                    <FileText size={16} />
                                </div>
                                <div className="min-w-0 flex-grow">
                                    <div className="text-xs font-medium text-gray-900 truncate dark:text-gray-200" title={doc.name}>{doc.name}</div>
                                    <div className="text-[10px] text-gray-400">{doc.chunkCount} vectors</div>
                                </div>
                                <button 
                                    onClick={() => handleDeleteDoc(doc.id)}
                                    className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-md opacity-0 group-hover:opacity-100 transition-all dark:hover:bg-red-900/30"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                </motion.div>
            )}

            {/* --- HISTORY TAB --- */}
            {activeTab === 'HISTORY' && (
                 <motion.div 
                    initial={{ opacity: 0, x: -10 }} 
                    animate={{ opacity: 1, x: 0 }} 
                    className="space-y-6"
                 >
                    {[
                        { label: 'Today', items: groups.today },
                        { label: 'Yesterday', items: groups.yesterday },
                        { label: '7 days', items: groups.lastWeek },
                        { label: 'Older', items: groups.older }
                    ].map(group => group.items.length > 0 && (
                        <div key={group.label} className="space-y-2">
                            <h3 className="text-xs font-medium text-gray-400 px-2">{group.label}</h3>
                            <div className="space-y-0.5">
                                {group.items.map(item => (
                                <div 
                                    key={item.id} 
                                    className="group flex items-center gap-1 w-full rounded-md hover:bg-white/60 dark:hover:bg-white/5 transition-all"
                                >
                                    {editingChatId === item.id ? (
                                        <div className="flex-grow flex items-center gap-1 px-2 py-1">
                                            <input 
                                                autoFocus
                                                value={editTitle}
                                                onChange={(e) => setEditTitle(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && saveEditing(item.id)}
                                                onBlur={() => saveEditing(item.id)}
                                                className="w-full text-sm bg-white border border-purple-200 rounded px-1 text-gray-900 focus:outline-none dark:bg-black dark:border-purple-800 dark:text-white"
                                            />
                                            <button onClick={() => saveEditing(item.id)} className="text-purple-600"><Save size={14} /></button>
                                        </div>
                                    ) : (
                                        <>
                                            <button 
                                                onClick={() => { onSelectChat(item.id); onClose(); }}
                                                onDoubleClick={() => startEditing(item.id, item.title)}
                                                className="flex-grow text-left px-2 py-2 text-sm text-gray-600 dark:text-gray-300 truncate"
                                            >
                                                {item.title}
                                            </button>
                                            <button 
                                                onClick={() => startEditing(item.id, item.title)}
                                                className="p-1.5 text-gray-400 opacity-0 group-hover:opacity-100 hover:text-purple-600 transition-all"
                                            >
                                                <Edit2 size={12} />
                                            </button>
                                        </>
                                    )}
                                </div>
                                ))}
                            </div>
                        </div>
                    ))}
                    {history.length === 0 && (
                        <div className="text-center py-10 text-xs text-gray-400">
                            No recent history.
                        </div>
                    )}
                 </motion.div>
            )}

            {/* --- EXPLORE TAB --- */}
            {activeTab === 'EXPLORE' && (
                <motion.div 
                    initial={{ opacity: 0, x: -10 }} 
                    animate={{ opacity: 1, x: 0 }} 
                    className="space-y-4"
                >
                     <div className="p-3 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl text-white shadow-lg shadow-purple-500/20">
                        <div className="flex items-center gap-2 mb-2">
                            <Sparkles size={16} className="text-purple-200" />
                            <span className="text-xs font-bold uppercase tracking-wide opacity-90">Pro Features</span>
                        </div>
                        <p className="text-xs opacity-90 leading-relaxed">
                            Unlock Deep Research and Agentic workflows with the specialized toolkits below.
                        </p>
                     </div>

                     <div className="space-y-2">
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Capabilities</span>
                        {[
                            { icon: Cpu, label: "Code Analysis", desc: "Refactor & Debug" },
                            { icon: BookOpen, label: "Strategic Report", desc: "Long-form writing" },
                            { icon: Search, label: "Deep Research", desc: "Web synthesis" },
                        ].map((tool, i) => (
                            <button key={i} className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-100 bg-white/60 hover:bg-white hover:border-purple-200 hover:shadow-sm transition-all text-left group backdrop-blur-sm dark:bg-white/5 dark:border-gray-800 dark:hover:bg-white/10 dark:hover:border-purple-900">
                                <div className="p-2 bg-gray-50 group-hover:bg-purple-50 text-gray-600 group-hover:text-purple-600 rounded-lg transition-colors dark:bg-white/10 dark:text-gray-300 dark:group-hover:bg-purple-900/30 dark:group-hover:text-purple-300">
                                    <tool.icon size={16} />
                                </div>
                                <div>
                                    <div className="text-xs font-bold text-gray-900 dark:text-gray-200">{tool.label}</div>
                                    <div className="text-[10px] text-gray-500 dark:text-gray-400">{tool.desc}</div>
                                </div>
                            </button>
                        ))}
                     </div>
                </motion.div>
            )}

            {/* --- LIBRARY TAB --- */}
            {activeTab === 'LIBRARY' && (
                <motion.div 
                    initial={{ opacity: 0, x: -10 }} 
                    animate={{ opacity: 1, x: 0 }} 
                    className="space-y-4"
                >
                    <div className="space-y-2">
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Saved Prompts</span>
                        {savedPrompts.map((prompt, i) => (
                             <button key={i} className="w-full text-left p-3 rounded-xl border border-gray-100 bg-white/60 hover:bg-white hover:border-purple-200 hover:shadow-sm transition-all backdrop-blur-sm group dark:bg-white/5 dark:border-gray-800 dark:hover:bg-white/10 dark:hover:border-purple-900">
                                <div className="text-xs font-medium text-gray-800 dark:text-gray-200 line-clamp-3">{prompt}</div>
                             </button>
                        ))}
                        {savedPrompts.length === 0 && (
                            <div className="text-center py-8 text-xs text-gray-400 border border-dashed border-gray-200 rounded-xl dark:border-gray-800">
                                <Bookmark size={20} className="mx-auto mb-2 opacity-50" />
                                <p>No saved prompts.</p>
                                <p className="opacity-70 mt-1">Bookmark from chat.</p>
                            </div>
                        )}
                    </div>
                </motion.div>
            )}

            {/* --- SETTINGS TAB --- */}
            {activeTab === 'SETTINGS' && (
                <motion.div 
                    initial={{ opacity: 0, x: -10 }} 
                    animate={{ opacity: 1, x: 0 }} 
                    className="space-y-6"
                >
                    <div className="space-y-4">
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Appearance</span>
                        
                        <div className="space-y-2">
                           <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Interface Theme</label>
                           <button 
                             onClick={toggleTheme}
                             className="w-full flex items-center justify-between p-3 rounded-xl border border-gray-200 bg-white/60 hover:bg-white dark:bg-white/5 dark:border-gray-700 dark:hover:bg-white/10 transition-all"
                           >
                             <div className="flex items-center gap-2 text-sm text-gray-900 dark:text-gray-100">
                                {isDarkMode ? <Moon size={16} /> : <Sun size={16} />}
                                <span>{isDarkMode ? "Void Mode (Dark)" : "Day Mode (Light)"}</span>
                             </div>
                             <div className={`w-8 h-4 rounded-full p-0.5 transition-colors ${isDarkMode ? 'bg-purple-600' : 'bg-gray-300'}`}>
                                <div className={`w-3 h-3 bg-white rounded-full shadow-sm transition-transform ${isDarkMode ? 'translate-x-4' : 'translate-x-0'}`} />
                             </div>
                           </button>
                        </div>

                        <div className="space-y-2">
                           <label className="text-xs font-medium text-gray-700 dark:text-gray-300">Interface Font</label>
                           <div className="relative">
                               <select 
                                  value={currentFont} 
                                  onChange={(e) => onFontChange(e.target.value)}
                                  className="w-full appearance-none bg-white/50 border border-gray-200 text-gray-700 text-sm rounded-lg p-2.5 focus:ring-2 focus:ring-purple-200 focus:border-purple-500 outline-none transition-all shadow-sm dark:bg-white/10 dark:border-gray-700 dark:text-gray-200"
                               >
                                  <option value="Inter">Inter (Default)</option>
                                  <option value="Martian Grotesk">Martian Grotesk</option>
                                  <option value="Redaction">Redaction</option>
                               </select>
                           </div>
                           <p className="text-[10px] text-gray-400">Select the typeface for the entire application interface.</p>
                        </div>
                    </div>
                </motion.div>
            )}

        </div>

        {/* Footer User Profile */}
        <div className="p-4 border-t border-gray-200/50 dark:border-gray-800">
           <button className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-gray-50/80 transition-colors group dark:hover:bg-white/5">
              <div className="flex items-center gap-3">
                 <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shadow-md">
                    DS
                 </div>
                 <div className="text-left">
                    <div className="text-xs font-semibold text-gray-900 dark:text-gray-200">Divyansh</div>
                    <div className="text-[10px] text-gray-500 dark:text-gray-400">Pro Plan</div>
                 </div>
              </div>
              <MoreHorizontal size={16} className="text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300" />
           </button>
        </div>
      </motion.aside>
    </>
  );
};

export default Sidebar;
