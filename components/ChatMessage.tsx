
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, ThumbsUp, ThumbsDown, RefreshCw, Terminal, Check, ExternalLink, BrainCircuit, Maximize2, X, Pin, PinOff, Bookmark, BarChart as ChartIcon } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Message, Role, UIComponent } from '../types';
import Logo from './Logo';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from 'recharts';

interface ChatMessageProps {
  message: Message;
  onPin?: (id: string) => void;
  onSaveToLibrary?: (text: string) => void;
}

const CopyButton = ({ text }: { text: string }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <button onClick={handleCopy} className="text-gray-400 hover:text-white transition-colors flex items-center gap-1.5">
            {copied ? <><Check size={14} /><span className="text-[10px]">COPIED</span></> : <><Copy size={14} /><span className="text-[10px]">COPY</span></>}
        </button>
    );
};

// Holographic Data Parser
const detectChartData = (text: string): any[] | null => {
    try {
        // Look for JSON arrays in code blocks or plain text that look like data
        const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[1]);
            if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
                // Heuristic: check if objects have number values
                const hasNumbers = Object.values(parsed[0]).some(v => typeof v === 'number');
                if (hasNumbers) return parsed;
            }
        }
    } catch (e) {
        // Ignore parsing errors
    }
    return null;
};

// Sub-component for realistic typing effect with Markdown support
const TypingText: React.FC<{ text: string, isNew: boolean, onComplete?: () => void }> = ({ text, isNew, onComplete }) => {
  const [displayedText, setDisplayedText] = useState(isNew ? '' : text);
  
  useEffect(() => {
    if (!isNew) {
        setDisplayedText(text);
        return;
    }

    if (text.length - displayedText.length > 50) {
        setDisplayedText(text);
        return;
    }

    let i = displayedText.length;
    const interval = setInterval(() => {
      if (i < text.length) {
        const increment = text.length > 500 ? 5 : 1;
        setDisplayedText(text.slice(0, i + increment));
        i += increment;
      } else {
        clearInterval(interval);
        if (onComplete) onComplete();
      }
    }, 10); 

    return () => clearInterval(interval);
  }, [text, isNew, displayedText.length, onComplete]);

  return (
    <div className="prose prose-sm prose-gray dark:prose-invert max-w-none leading-relaxed break-words [&>pre]:!bg-transparent [&>pre]:!p-0 [&>pre]:!m-0">
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]}
        components={{
            code({node, inline, className, children, ...props}: any) {
                const match = /language-(\w+)/.exec(className || '');
                const language = match ? match[1] : '';
                const codeText = String(children).replace(/\n$/, '');

                if (!inline && match) {
                    return (
                        <div className="my-6 rounded-lg overflow-hidden border border-gray-700 bg-[#0d0d0d] shadow-2xl not-prose group">
                            <div className="flex items-center justify-between px-4 py-2 bg-[#1a1a1a] border-b border-gray-800">
                                <div className="flex items-center gap-2">
                                    <Terminal size={12} className="text-purple-400" />
                                    <span className="text-xs text-gray-400 uppercase font-mono tracking-wider">{language || 'CODE'}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {/* Mock Execution Button */}
                                    <button className="text-gray-500 hover:text-green-400 transition-colors" title="Run in Sandbox">
                                        <div className="text-[10px] font-mono border border-gray-700 px-1.5 py-0.5 rounded hover:border-green-800">RUN</div>
                                    </button>
                                    <div className="w-px h-3 bg-gray-700 mx-1"></div>
                                    <CopyButton text={codeText} />
                                </div>
                            </div>
                            <div className="p-4 overflow-x-auto custom-scrollbar">
                                <pre className="text-sm font-mono text-gray-300 leading-relaxed bg-transparent p-0 m-0 font-[Consolas,Monaco,'Courier New',monospace]">
                                    <code className={className} {...props}>
                                        {children}
                                    </code>
                                </pre>
                            </div>
                        </div>
                    );
                }
                return (
                    <code className="bg-gray-100 dark:bg-white/10 text-purple-700 dark:text-purple-300 rounded px-1.5 py-0.5 text-[0.9em] font-mono border border-gray-200 dark:border-gray-700" {...props}>
                        {children}
                    </code>
                );
            },
            // Style other markdown elements
            a: ({node, ...props}) => <a {...props} className="text-purple-600 dark:text-purple-400 hover:underline" target="_blank" rel="noopener noreferrer" />,
            ul: ({node, ...props}) => <ul {...props} className="list-disc pl-4 space-y-1" />,
            ol: ({node, ...props}) => <ol {...props} className="list-decimal pl-4 space-y-1" />,
            li: ({node, ...props}) => <li {...props} className="pl-1" />,
            h1: ({node, ...props}) => <h1 {...props} className="text-xl font-bold text-gray-900 dark:text-white mt-6 mb-3" />,
            h2: ({node, ...props}) => <h2 {...props} className="text-lg font-bold text-gray-900 dark:text-white mt-5 mb-2" />,
            h3: ({node, ...props}) => <h3 {...props} className="text-md font-bold text-gray-800 dark:text-gray-200 mt-4 mb-2" />,
            blockquote: ({node, ...props}) => <blockquote {...props} className="border-l-4 border-purple-500/50 pl-4 italic text-gray-500 dark:text-gray-400 my-4 bg-gray-50 dark:bg-white/5 py-2 rounded-r-lg" />,
            table: ({node, ...props}) => <div className="overflow-x-auto my-4 rounded-lg border border-gray-200 dark:border-gray-800"><table {...props} className="w-full text-sm text-left" /></div>,
            th: ({node, ...props}) => <th {...props} className="px-4 py-2 bg-gray-50 dark:bg-white/5 font-semibold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700" />,
            td: ({node, ...props}) => <td {...props} className="px-4 py-2 border-b border-gray-100 dark:border-gray-800" />,
        }}
      >
        {displayedText}
      </ReactMarkdown>
    </div>
  );
};

const Lightbox = ({ src, onClose }: { src: string, onClose: () => void }) => (
    <motion.div 
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4"
        onClick={onClose}
    >
        <button onClick={onClose} className="absolute top-4 right-4 text-white/50 hover:text-white p-2">
            <X size={32} />
        </button>
        <motion.img 
            initial={{ scale: 0.9 }} animate={{ scale: 1 }} 
            src={src} 
            alt="Artifact" 
            className="max-w-full max-h-screen object-contain rounded-lg shadow-2xl shadow-purple-500/20" 
            onClick={(e) => e.stopPropagation()}
        />
    </motion.div>
);

const ChatMessage: React.FC<ChatMessageProps> = ({ message, onPin, onSaveToLibrary }) => {
  const isUser = message.role === Role.USER;
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [showThinking, setShowThinking] = useState(false);

  // Cognitive Trace: Simulate thinking time for deep reasoning
  useEffect(() => {
      if (message.thinkingBudget && message.thinkingBudget > 0 && !message.content) {
          setShowThinking(true);
      }
  }, [message.thinkingBudget, message.content]);

  const parseContent = (raw: string) => {
    let mainContent = raw.replace(/\[UI:.*?\]/g, '').trim();
    let uiComponents: UIComponent[] = message.uiComponents || [];
    
    // Auto-detect charts
    const chartData = detectChartData(mainContent);
    if (chartData && !uiComponents.find(u => u.type === 'CHART_SUGGESTION')) {
        uiComponents.push({ type: 'CHART_SUGGESTION', content: 'Auto-detected Data', chartData });
    }

    return { mainContent, uiComponents };
  };

  const { mainContent, uiComponents } = parseContent(message.content);
  const shouldRenderText = mainContent.length > 0;

  return (
    <>
    <AnimatePresence>
        {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </AnimatePresence>

    <motion.div 
      initial={{ opacity: 0, y: 10 }} 
      animate={{ opacity: 1, y: 0 }} 
      className={`flex gap-4 mb-8 ${isUser ? 'flex-row-reverse' : ''}`}
    >
      {/* Avatar */}
      <div className="shrink-0 flex flex-col items-center gap-2">
        {isUser ? (
          <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-300 text-xs font-bold shadow-sm">
            YOU
          </div>
        ) : (
          <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center shadow-sm">
            <Logo size="sm" showText={false} className="scale-75" />
          </div>
        )}
        
        {/* Context Pinning Button */}
        <button 
            onClick={() => onPin && onPin(message.id)}
            className={`opacity-0 group-hover:opacity-100 transition-opacity ${message.isPinned ? 'opacity-100 text-purple-500' : 'text-gray-300 hover:text-gray-500'}`}
            title={message.isPinned ? "Unpin from context" : "Pin to context"}
        >
            {message.isPinned ? <PinOff size={12} /> : <Pin size={12} />}
        </button>
      </div>

      <div className={`flex flex-col max-w-3xl ${isUser ? 'items-end' : 'items-start'} w-full group`}>
        {/* Name & Time */}
        <div className={`flex items-center gap-2 mb-1 ${isUser ? 'flex-row-reverse' : ''}`}>
           <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide dark:text-gray-400">{isUser ? 'Divyansh' : 'CaptBot'}</span>
           {message.thinkingBudget && message.thinkingBudget > 0 && (
               <span className="text-[10px] text-purple-500 border border-purple-200 dark:border-purple-800 rounded px-1">DEEP REASONING</span>
           )}
        </div>

        {/* Cognitive Trace (Thinking Accordion) */}
        {!isUser && message.thinkingBudget && message.thinkingBudget > 0 && (
            <div className="mb-2 w-full max-w-md">
                <button 
                    onClick={() => setShowThinking(!showThinking)}
                    className="flex items-center gap-2 text-xs font-medium text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 px-3 py-1.5 rounded-lg w-full hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors text-left"
                >
                    <BrainCircuit size={14} className={showThinking ? "animate-pulse" : ""} />
                    <span>Thinking Process ({message.thinkingBudget} tokens)</span>
                    <span className="ml-auto opacity-50">{showThinking ? "Hide" : "Show"}</span>
                </button>
                <AnimatePresence>
                    {showThinking && (
                        <motion.div 
                            initial={{ height: 0, opacity: 0 }} 
                            animate={{ height: 'auto', opacity: 1 }} 
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                        >
                            <div className="p-3 bg-white dark:bg-gray-900 border border-purple-100 dark:border-gray-800 rounded-b-lg text-xs text-gray-500 font-mono leading-relaxed shadow-inner">
                                <p>Analyzing intent... [OK]</p>
                                <p>Retrieving context... [{(message.groundedChunks?.length || 0)} chunks]</p>
                                <p>Synthesizing response vectors...</p>
                                <p className="text-purple-500">Optimizing for strategic clarity.</p>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        )}

        {/* Message Bubble/Content */}
        <motion.div 
           className={`relative group/bubble ${isUser ? 'bg-white dark:bg-white/5 border border-gray-200 dark:border-gray-800 px-5 py-4 rounded-2xl rounded-tr-sm text-gray-800 dark:text-gray-200 shadow-sm' : 'text-gray-800 dark:text-gray-200 w-full'}`}
        >
           {isUser ? (
             <div className="prose prose-sm prose-gray dark:prose-invert max-w-none leading-relaxed">
                {mainContent}
                {/* Save to Library Button */}
                <button 
                   onClick={() => onSaveToLibrary && onSaveToLibrary(mainContent)}
                   className="absolute top-2 right-2 p-1.5 text-gray-300 hover:text-purple-500 opacity-0 group-hover/bubble:opacity-100 transition-all" 
                   title="Save to Prompt Library"
                >
                    <Bookmark size={14} />
                </button>
             </div>
           ) : (
             shouldRenderText && <TypingText text={mainContent} isNew={!message.isFromCache && !message.isSystemError} />
           )}

           {/* Attachments for User */}
           {isUser && message.attachments && message.attachments.length > 0 && (
             <div className="mt-3 flex flex-wrap gap-2">
               {message.attachments.map((file, idx) => (
                 <div key={idx} className="bg-gray-50 dark:bg-white/10 rounded-lg p-2 text-xs border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 flex items-center gap-2">
                    <span className="font-medium">{file.fileName || 'Attachment'}</span>
                 </div>
               ))}
             </div>
           )}

            {/* AI Action Bar */}
            {!isUser && !message.isSystemError && (
              <div className="flex items-center gap-2 mt-4 opacity-0 group-hover:opacity-100 transition-opacity">
                <button className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 rounded-md transition-colors"><Copy size={14} /></button>
                <button className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 rounded-md transition-colors"><ThumbsUp size={14} /></button>
                <button className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 rounded-md transition-colors"><ThumbsDown size={14} /></button>
                <button className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 rounded-md transition-colors"><RefreshCw size={14} /></button>
              </div>
            )}
        </motion.div>

        {/* Sources / Grounding */}
        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {message.sources.map((source, i) => (
              <a key={i} href={source.uri} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-white/5 border border-gray-200 dark:border-gray-700 rounded-full text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 hover:border-purple-200 transition-all shadow-sm">
                <ExternalLink size={10} />
                <span className="max-w-[150px] truncate">{source.title}</span>
              </a>
            ))}
          </div>
        )}

        {/* UI Components (Images, Charts) */}
        {!isUser && uiComponents.length > 0 && (
          <div className="mt-4 w-full space-y-4">
             {uiComponents.map((ui, idx) => (
               <div key={idx} className="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800 shadow-sm bg-white dark:bg-[#0A0A0A]">
                 {/* Image Projection */}
                 {ui.type === 'IMAGE_PROJECTION' && ui.url && (
                   <div className="relative group/img cursor-zoom-in" onClick={() => setLightboxSrc(ui.url!)}>
                      <img src={ui.url} alt="Generated" className="w-full h-auto" />
                      <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover/img:opacity-100">
                          <span className="bg-black/70 text-white text-xs px-2 py-1 rounded flex items-center gap-1 backdrop-blur-md">
                              <Maximize2 size={12} /> Expand Artifact
                          </span>
                      </div>
                   </div>
                 )}

                 {/* Holographic Data (Charts) */}
                 {ui.type === 'CHART_SUGGESTION' && ui.chartData && (
                     <div className="p-4">
                         <div className="flex items-center gap-2 mb-4">
                             <ChartIcon size={16} className="text-purple-500" />
                             <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Holographic Projection</span>
                         </div>
                         <div className="h-64 w-full">
                             <ResponsiveContainer width="100%" height="100%">
                                 <BarChart data={ui.chartData}>
                                     <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#374151" opacity={0.2} />
                                     <XAxis dataKey={Object.keys(ui.chartData[0])[0]} stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} />
                                     <YAxis stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} />
                                     <Tooltip 
                                        contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: '#F3F4F6' }}
                                        itemStyle={{ color: '#E5E7EB' }}
                                     />
                                     <Bar dataKey={Object.keys(ui.chartData[0])[1]} fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                                 </BarChart>
                             </ResponsiveContainer>
                         </div>
                     </div>
                 )}
               </div>
             ))}
          </div>
        )}
      </div>
    </motion.div>
    </>
  );
};

export default ChatMessage;
