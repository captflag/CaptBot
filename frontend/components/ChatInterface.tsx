'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Image as ImageIcon, Loader2, Terminal, User, Power, Paperclip } from 'lucide-react';
import clsx from 'clsx';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

export default function ChatInterface() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [hasMounted, setHasMounted] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setHasMounted(true);
    }, []);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setSelectedFile(e.target.files[0]);
        }
    };

    const handleSend = async () => {
        if (!input.trim() && !selectedFile) return;

        const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: input + (selectedFile ? ` [IMAGE_ATTACHED: ${selectedFile.name}]` : ''),
            timestamp: new Date(),
        };

        setMessages((prev) => [...prev, userMessage]);
        setInput('');
        const currentFile = selectedFile;
        setSelectedFile(null);
        setIsLoading(true);

        try {
            const formData = new FormData();
            formData.append('message', userMessage.content);
            formData.append('session_id', 'default');
            if (currentFile) {
                formData.append('file', currentFile);
            }

            let apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').trim();
            // Remove trailing slash if present
            if (apiUrl.endsWith('/')) {
                apiUrl = apiUrl.slice(0, -1);
            }

            console.log(`[DEBUG] Calling Backend: ${apiUrl}/chat`);
            const response = await fetch(`${apiUrl}/chat`, {
                method: 'POST',
                body: formData,
            });


            if (!response.ok) throw new Error('CONNECTION_FAILURE');

            const data = await response.json();

            const botMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: data.response,
                timestamp: new Date(),
            };

            setMessages((prev) => [...prev, botMessage]);
        } catch (error) {
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: 'CRITICAL_ERROR: UNABLE_TO_REACH_MAINFRAME. RETRY_LATER.',
                timestamp: new Date(),
            };
            setMessages((prev) => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    if (!hasMounted) return <div className="h-screen bg-black" />;

    return (
        <div className="flex flex-col h-screen bg-black text-[var(--terminal-green)] font-mono overflow-hidden relative">
            {/* Header */}
            <header className="z-10 px-6 py-4 flex items-center justify-between border-b-2 border-[var(--terminal-green-dim)] bg-black/90">
                <div className="flex items-center gap-4">
                    <div className="p-2 border border-[var(--terminal-green)] shadow-[var(--crt-glow)]">
                        <Terminal className="w-6 h-6" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold tracking-[0.2em] uppercase">
                            CaptBot.v1.0
                        </h1>
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 bg-[var(--terminal-green)] animate-pulse" />
                            <p className="text-[10px] uppercase opacity-70">System_Active // Port: 8000</p>
                        </div>
                    </div>
                </div>
                <div className="hidden md:flex items-center gap-6 opacity-60 text-xs">
                    <p>MEM: 640KB</p>
                    <p>SECURE: YES</p>
                    <Power className="w-4 h-4 cursor-pointer hover:text-white transition-colors" />
                </div>
            </header>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 scrollbar-none relative">
                <div className="max-w-5xl mx-auto">
                    {messages.length === 0 && (
                        <div className="opacity-40 text-sm italic py-10">
                            &gt; AWAITING COMMANDS...
                            <br />
                            &gt; SYSTEM READY.
                        </div>
                    )}
                    <AnimatePresence initial={false}>
                        {messages.map((message) => (
                            <motion.div
                                key={message.id}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="flex flex-col gap-2 mb-8"
                            >
                                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
                                    <span className={clsx(
                                        message.role === 'user' ? 'text-[var(--terminal-amber)]' : 'text-[var(--terminal-green)]'
                                    )}>
                                        {message.role === 'user' ? 'USER >> ' : 'AI >> '}
                                    </span>
                                    <span className="opacity-40">{message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                                </div>

                                <div className={clsx(
                                    'p-5 border border-[var(--terminal-green-dim)] bg-[var(--terminal-green-dim)]/5',
                                    message.role === 'user' ? 'border-l-4 border-l-[var(--terminal-amber)]' : 'border-l-4 border-l-[var(--terminal-green)]'
                                )}>
                                    <p className="whitespace-pre-wrap leading-relaxed text-[17px] drop-shadow-[0_0_5px_rgba(0,255,65,0.3)]">
                                        {message.content}
                                    </p>
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>

                    {isLoading && (
                        <div className="flex items-center gap-2 mt-4 animate-pulse">
                            <span className="text-sm font-bold uppercase">&gt; PROCESSING...</span>
                            <Loader2 className="w-4 h-4 animate-spin" />
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
            </div>

            {/* Input Area */}
            <div className="p-4 md:p-8 bg-black border-t-2 border-[var(--terminal-green-dim)]">
                <div className="max-w-5xl mx-auto">
                    <div className="flex items-center gap-4 mb-4">
                        <span className="text-[var(--terminal-green)] font-bold text-lg">INPUT &gt; </span>
                        <div className="flex-1 relative flex items-center border border-[var(--terminal-green)] bg-black/50 overflow-hidden focus-within:ring-2 focus-within:ring-[var(--terminal-green)] transition-all">
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileSelect}
                                accept="image/*"
                                className="hidden"
                            />

                            <textarea
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSend();
                                    }
                                }}
                                placeholder="TYPE_MESSAGE_HERE..."
                                className="flex-1 bg-transparent border-0 focus:ring-0 text-[var(--terminal-green)] placeholder-[var(--terminal-green-dim)] resize-none p-4 max-h-32 min-h-[56px] scrollbar-none text-[18px] uppercase font-mono"
                                rows={1}
                            />

                            <div className="flex px-2 gap-2">
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className={clsx(
                                        "p-2 hover:bg-[var(--terminal-green)] hover:text-black transition-all",
                                        selectedFile && "bg-[var(--terminal-green)] text-black"
                                    )}
                                    title="LINK_FILE"
                                >
                                    <Paperclip size={22} />
                                </button>
                                <button
                                    onClick={handleSend}
                                    disabled={!input.trim() && !selectedFile}
                                    className="p-2 hover:bg-[var(--terminal-green)] hover:text-black transition-all disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--terminal-green)]"
                                >
                                    <Send size={22} />
                                </button>
                            </div>
                            <div className="cursor-blink absolute bottom-4 left-[200px]" style={{ left: `${(input.length * 11) + 80}px`, display: input.length > 50 ? 'none' : 'inline-block' }}></div>
                        </div>
                    </div>

                    <div className="flex justify-between items-center text-[10px] uppercase opacity-50 px-2 mt-4">
                        <div className="flex gap-4">
                            <span>SESSION: DEFAULT</span>
                            {selectedFile && <span>ATTACHED: {selectedFile.name}</span>}
                        </div>
                        <p>PROCEED_WITH_CAUTION // AI_GENERATED_CONTENT</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
