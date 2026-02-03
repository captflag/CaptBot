import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Menu,
  Send,
  Paperclip,
  Globe,
  Mic,
  Grid,
  Sparkles,
  Link as LinkIcon,
  Download,
  ChevronDown,
  BrainCircuit,
  Lightbulb,
  CheckCircle,
  BarChart,
  MoreHorizontal,
  FileText,
  Square
} from 'lucide-react';
import { Role, Message, Modality, ModelID, FileData } from './types';
import { gemini } from './services/geminiService';
import { neuralCache } from './services/cacheService';
import { GuardrailService } from './services/guardrailService';
import { rag } from './services/ragService';
import ChatMessage from './components/ChatMessage';
import Sidebar from './components/Sidebar';
import Logo from './components/Logo';

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<FileData[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [deepResearch, setDeepResearch] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [savedPrompts, setSavedPrompts] = useState<string[]>([]);
  const [isListening, setIsListening] = useState(false);

  // Font State
  const [fontFamily, setFontFamily] = useState('Inter');

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    rag.init();

    const savedHistory = localStorage.getItem('captbot_history');
    if (savedHistory) setHistory(JSON.parse(savedHistory));

    const savedFont = localStorage.getItem('captbot_font');
    if (savedFont) setFontFamily(savedFont);

    const savedPromptsLocal = localStorage.getItem('captbot_prompts');
    if (savedPromptsLocal) setSavedPrompts(JSON.parse(savedPromptsLocal));
  }, []);

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isProcessing]);

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
    if (!isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const handleMicClick = () => {
    if (!('webkitSpeechRecognition' in window)) {
      alert("Speech recognition not supported in this browser.");
      return;
    }

    if (isListening) {
      setIsListening(false);
      // Stop logic handled by recognition.stop() usually, 
      // but we just toggle state here for UI, real impl needs instance ref
      return;
    }

    setIsListening(true);
    const recognition = new (window as any).webkitSpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript;
      setInput(prev => (prev ? prev + ' ' + text : text));
      setIsListening(false);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsProcessing(false);
    }
  };

  const startNewChat = () => {
    setMessages([]);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
  };

  const handleSelectChat = (id: string) => {
    console.log("Loading chat:", id);
    if (window.innerWidth < 1024) {
      setIsSidebarOpen(false);
    }
  };

  const handleRenameChat = (id: string, newTitle: string) => {
    const updated = history.map(h => h.id === id ? { ...h, title: newTitle } : h);
    setHistory(updated);
    localStorage.setItem('captbot_history', JSON.stringify(updated));
  };

  const handleSaveToLibrary = (text: string) => {
    if (savedPrompts.includes(text)) return;
    const updated = [...savedPrompts, text];
    setSavedPrompts(updated);
    localStorage.setItem('captbot_prompts', JSON.stringify(updated));
  };

  const handleFontChange = (newFont: string) => {
    setFontFamily(newFont);
    localStorage.setItem('captbot_font', newFont);
  };

  const handlePinMessage = (id: string) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, isPinned: !m.isPinned } : m));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      const data = base64.split(',')[1];
      setAttachments(prev => [...prev, {
        fileName: file.name,
        mimeType: file.type,
        data: data
      }]);
    };
    reader.readAsDataURL(file);
  };

  const handleExportToDocs = () => {
    if (messages.length === 0) return;
    const transcript = messages.map(m => {
      const role = m.role === Role.USER ? 'USER' : 'CAPTBOT';
      const cleanContent = m.content.replace(/\*/g, '');
      return `[${role}]:\n${cleanContent}\n`;
    }).join('\n---\n\n');

    navigator.clipboard.writeText(transcript).then(() => {
      window.open('https://docs.new', '_blank');
    });
  };

  const handleSubmit = async (e?: React.FormEvent, overridePrompt?: string) => {
    e?.preventDefault();
    const promptText = overridePrompt || input;

    if ((!promptText.trim() && attachments.length === 0) || isProcessing) return;

    const validation = GuardrailService.validate(promptText);
    if (!validation.isValid) return;

    if (messages.length === 0) {
      const title = promptText.length > 30 ? promptText.substring(0, 30) + '...' : promptText;
      const newHistoryItem = {
        id: crypto.randomUUID(),
        title: title,
        timestamp: Date.now()
      };
      const updatedHistory = [newHistoryItem, ...history];
      setHistory(updatedHistory);
      localStorage.setItem('captbot_history', JSON.stringify(updatedHistory));
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: Role.USER,
      content: promptText,
      timestamp: Date.now(),
      attachments: [...attachments]
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setAttachments([]);
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setIsProcessing(true);

    const nexusId = crypto.randomUUID();
    const nexusMsgPlaceholder: Message = {
      id: nexusId,
      role: Role.NEXUS,
      content: '',
      timestamp: Date.now(),
      thinkingBudget: deepResearch ? 1024 : 0 // Pass budget to UI
    };

    setMessages(prev => [...prev, nexusMsgPlaceholder]);

    // Create AbortController
    abortControllerRef.current = new AbortController();
    let fullContent = '';

    try {
      // Collect Pinned Context
      const pinnedContext = messages
        .filter(m => m.isPinned)
        .map(m => `[PINNED CONTEXT FROM ${m.role === Role.USER ? 'USER' : 'AI'}]: ${m.content}`)
        .join('\n\n');

      const chatHistory = messages.map(m => ({
        role: m.role === Role.USER ? 'user' as const : 'model' as const,
        parts: [{ text: m.content }]
      }));

      if (pinnedContext) {
        // Prepend pinned context to the last user message virtually for the API call
        chatHistory[chatHistory.length - 1].parts[0].text = `${pinnedContext}\n\n${chatHistory[chatHistory.length - 1].parts[0].text}`;
      }

      const budget = deepResearch ? 1024 : 0;
      const model = deepResearch ? 'gemini-3-pro-preview' : 'gemini-3-flash-preview';

      const stream = gemini.sendMessageStream(
        userMsg.content,
        chatHistory,
        'STRATEGIC',
        model,
        budget,
        userMsg.attachments,
        webSearch,
        abortControllerRef.current.signal
      );

      for await (const chunk of stream) {
        fullContent += (chunk as any).text || '';

        let uiComponents = undefined;
        if ((chunk as any).imageUrl) {
          uiComponents = [{
            type: 'IMAGE_PROJECTION',
            content: 'Strategic Visualization',
            url: (chunk as any).imageUrl
          }];
        }

        let grounded = (chunk as any).groundedChunks;
        let sources = (chunk as any).candidates?.[0]?.groundingMetadata?.groundingChunks?.map((c: any) => ({
          title: c.web?.title || c.maps?.title || 'Source',
          uri: c.web?.uri || c.maps?.uri || '#'
        })).filter((s: any) => s.uri !== '#');

        setMessages(prev => prev.map(m =>
          m.id === nexusId ? {
            ...m,
            content: fullContent,
            groundedChunks: grounded,
            sources: sources,
            uiComponents: uiComponents || m.uiComponents
          } : m
        ));
      }
    } catch (err: any) {
      if (err.message !== "Aborted by user") {
        console.error(err);
        setMessages(prev => prev.map(m =>
          m.id === nexusId ? { ...m, content: "Error: System Malfunction.", isSystemError: true } : m
        ));
      } else {
        setMessages(prev => prev.map(m =>
          m.id === nexusId ? { ...m, content: fullContent + " [GENERATION ABORTED]", isSystemError: true } : m
        ));
      }
    } finally {
      setIsProcessing(false);
      abortControllerRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      className={`flex h-screen bg-[#F9FAFB] dark:bg-[#050505] text-gray-900 dark:text-gray-100 overflow-hidden transition-colors duration-300`}
      style={{ fontFamily: `"${fontFamily}", sans-serif` }}
    >

      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onNewChat={startNewChat}
        onSelectChat={handleSelectChat}
        history={history}
        onRenameChat={handleRenameChat}
        status={isProcessing ? 'BUSY' : 'IDLE'}
        currentFont={fontFamily}
        onFontChange={handleFontChange}
        isDarkMode={isDarkMode}
        toggleTheme={toggleTheme}
        savedPrompts={savedPrompts}
      />

      <main
        className={`flex-grow flex flex-col relative h-full transition-all duration-300 w-full ${isSidebarOpen ? 'lg:ml-[280px]' : ''
          }`}
      >
        {/* Header */}
        <header className="h-16 flex-shrink-0 flex items-center justify-between px-6 border-b border-gray-100 dark:border-gray-800 bg-white/80 dark:bg-[#0A0A0A]/80 backdrop-blur-md z-20">
          <div className="flex items-center gap-4">
            <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 -ml-2 hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg text-gray-500 dark:text-gray-400">
              <Menu size={20} />
            </button>
            <button className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 px-3 py-1.5 rounded-lg transition-colors">
              <Logo size="sm" showText={false} />
              <span>CaptBot</span>
              <ChevronDown size={14} className="text-gray-400" />
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg transition-all hidden sm:block">
              <MoreHorizontal size={20} />
            </button>
            <button
              onClick={handleExportToDocs}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
              title="Copy chat and open Google Docs"
            >
              <FileText size={14} />
              <span className="hidden sm:inline">Export to Docs</span>
            </button>
          </div>
        </header>

        {/* Scrollable Content */}
        <div ref={scrollRef} className="flex-grow overflow-y-auto px-4 custom-scrollbar bg-transparent">
          <div className="max-w-3xl mx-auto py-12">

            <AnimatePresence mode="popLayout">
              {messages.length === 0 ? (
                /* Empty State / Welcome */
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col items-center justify-center min-h-[60vh] space-y-8"
                >
                  <div className="relative w-32 h-32 flex items-center justify-center">
                    <div className="absolute inset-0 bg-purple-500 blur-[80px] opacity-20 rounded-full animate-pulse" />
                    <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-violet-200 to-purple-100 dark:from-violet-900 dark:to-purple-900 flex items-center justify-center shadow-inner">
                      <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-white to-purple-50 dark:from-black dark:to-purple-950 flex items-center justify-center shadow-sm">
                        <Logo size="lg" />
                      </div>
                    </div>
                  </div>

                  <div className="text-center space-y-2">
                    <h2 className="text-3xl font-semibold text-purple-600 dark:text-purple-400 tracking-tight">Hello, Divyansh</h2>
                    <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">How can I assist you today?</h1>
                  </div>

                  {/* Suggestion Cards moved here to avoid overlap */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 w-full max-w-2xl pt-4">
                    {[
                      { icon: BarChart, title: "Synthesize Data", subtitle: "Turn meeting notes into 5 key bullet points." },
                      { icon: Lightbulb, title: "Creative Brainstorm", subtitle: "Generate 3 taglines for a sustainable brand." },
                      { icon: CheckCircle, title: "Check Facts", subtitle: "Compare key differences between GDPR and CCPA." }
                    ].map((card, idx) => (
                      <button key={idx} onClick={() => handleSubmit(undefined, card.title + " " + card.subtitle)} className="text-left p-4 bg-white dark:bg-white/5 border border-gray-200 dark:border-gray-800 rounded-xl hover:border-purple-300 dark:hover:border-purple-700 hover:shadow-md transition-all group">
                        <card.icon size={18} className="text-gray-400 group-hover:text-purple-600 dark:group-hover:text-purple-400 mb-2 transition-colors" />
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">{card.title}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{card.subtitle}</div>
                      </button>
                    ))}
                  </div>
                </motion.div>
              ) : (
                /* Chat Messages */
                <div className="pb-32">
                  {messages.map((msg) => (
                    <ChatMessage
                      key={msg.id}
                      message={msg}
                      onPin={handlePinMessage}
                      onSaveToLibrary={handleSaveToLibrary}
                    />
                  ))}
                  {isProcessing && messages[messages.length - 1]?.role === Role.USER && (
                    <div className="flex gap-4">
                      <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center">
                        <Logo size="sm" showText={false} className="scale-75 animate-pulse" />
                      </div>
                      <div className="flex items-center gap-1.5 mt-2 h-4">
                        {[0, 1, 2].map((i) => (
                          <motion.div
                            key={i}
                            className="w-1.5 h-1.5 bg-gray-400 rounded-full"
                            animate={{
                              scale: [1, 1.2, 1],
                              opacity: [0.4, 1, 0.4]
                            }}
                            transition={{
                              duration: 1,
                              repeat: Infinity,
                              delay: i * 0.2,
                              ease: "easeInOut"
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </AnimatePresence>

          </div>
        </div>

        {/* Input Area (Fixed Bottom) */}
        <div className={`absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#F9FAFB] via-[#F9FAFB] to-transparent dark:from-[#050505] dark:via-[#050505] z-30 transition-all duration-300`}>
          <div className="max-w-3xl mx-auto space-y-4">

            {/* Suggestion Cards removed from here and moved to welcome section */}

            {/* Input Card */}
            <div className="relative bg-white dark:bg-[#0F0F0F] rounded-2xl border border-gray-200 dark:border-gray-800 shadow-xl shadow-gray-200/50 dark:shadow-black/50 p-3 transition-shadow focus-within:shadow-2xl focus-within:border-purple-200 dark:focus-within:border-purple-900">
              {/* Attachments Preview */}
              {attachments.length > 0 && (
                <div className="flex gap-2 px-2 pb-2 overflow-x-auto">
                  {attachments.map((file, i) => (
                    <div key={i} className="flex items-center gap-2 bg-gray-100 dark:bg-white/10 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200">
                      <span className="max-w-[100px] truncate">{file.fileName}</span>
                      <button onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))} className="hover:text-red-500"><div className="w-3 h-3">×</div></button>
                    </div>
                  ))}
                </div>
              )}

              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${e.target.scrollHeight}px`;
                }}
                onKeyDown={handleKeyDown}
                placeholder="Ask me anything..."
                className="w-full max-h-60 bg-transparent border-none focus:ring-0 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 text-base resize-none py-3 px-2 custom-scrollbar"
                rows={1}
              />

              <div className="flex items-center justify-between pt-2 px-1">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setDeepResearch(!deepResearch)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${deepResearch ? 'bg-purple-100 text-purple-700 border border-purple-200 dark:bg-purple-900/50 dark:text-purple-300 dark:border-purple-800' : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100 dark:bg-white/5 dark:text-gray-400 dark:border-gray-700 dark:hover:bg-white/10'}`}
                  >
                    <BrainCircuit size={14} />
                    <span>Deeper Research</span>
                  </button>

                  <button
                    onClick={() => setWebSearch(!webSearch)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${webSearch ? 'bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-900/50 dark:text-blue-300 dark:border-blue-800' : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100 dark:bg-white/5 dark:text-gray-400 dark:border-gray-700 dark:hover:bg-white/10'}`}
                  >
                    <Globe size={14} />
                    <span>Web Search</span>
                  </button>

                  <button onClick={() => fileInputRef.current?.click()} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg transition-colors" title="Attach image">
                    <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/*" />
                    <Paperclip size={18} />
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={handleMicClick}
                    className={`p-2 rounded-full transition-all ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-purple-100 text-purple-600 dark:bg-purple-900/50 dark:text-purple-400 hover:bg-purple-200'}`}
                  >
                    <Mic size={18} />
                  </button>

                  {isProcessing ? (
                    <button onClick={handleStop} className="p-2 bg-gray-900 dark:bg-white text-white dark:text-black rounded-xl hover:opacity-80 transition-all shadow-md group">
                      <Square size={16} fill="currentColor" />
                    </button>
                  ) : (
                    input.trim() || attachments.length > 0 ? (
                      <button onClick={() => handleSubmit()} className="p-2 bg-gray-900 dark:bg-white text-white dark:text-black rounded-xl hover:bg-black dark:hover:bg-gray-200 transition-all shadow-md">
                        <Send size={16} />
                      </button>
                    ) : null
                  )}
                </div>
              </div>
            </div>

            {/* Bottom Note */}
            <div className="flex items-center justify-between px-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-purple-600 dark:text-purple-400">
                <Sparkles size={12} />
                <span>Saved prompts</span>
              </div>
              <button className="flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 px-3 py-1.5 rounded-lg hover:bg-white dark:hover:bg-white/5 border border-transparent hover:border-gray-200 dark:hover:border-gray-800 transition-all">
                <Paperclip size={12} />
                <span>Attach file</span>
              </button>
            </div>

          </div>
        </div>

      </main>
    </div>
  );
};

export default App;