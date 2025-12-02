'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Image as ImageIcon, Loader2, Bot, User, Sparkles, Paperclip } from 'lucide-react';
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
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

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
            content: input + (selectedFile ? ` [Image: ${selectedFile.name}]` : ''),
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

            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
            const response = await fetch(`${apiUrl}/chat`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) throw new Error('Failed to send message');

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
                content: 'Error connecting to server. Please try again.',
                timestamp: new Date(),
            };
            setMessages((prev) => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden relative selection:bg-indigo-500/30">
            {/* Background Effects */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-indigo-600/10 rounded-full blur-[120px] animate-pulse-slow" />
                <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-pink-600/10 rounded-full blur-[120px] animate-pulse-slow" />
            </div>

            {/* Header */}
            <header className="glass-dark z-10 px-6 py-4 flex items-center justify-between border-b border-white/5">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-lg shadow-indigo-500/20">
                        <Bot className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent tracking-tight">
                            CaptBot
                        </h1>
                        <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            <p className="text-xs text-slate-400 font-medium">Online</p>
                        </div>
                    </div>
                </div>
            </header>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 z-0 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent">
                <AnimatePresence initial={false}>
                    {messages.map((message) => (
                        <motion.div
                            key={message.id}
                            initial={{ opacity: 0, y: 20, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            transition={{ duration: 0.3, ease: "easeOut" }}
                            className={clsx(
                                'flex w-full',
                                message.role === 'user' ? 'justify-end' : 'justify-start'
                            )}
                        >
                            <div
                                className={clsx(
                                    'flex max-w-[85%] md:max-w-[70%] gap-3',
                                    message.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                                )}
                            >
                                {/* Avatar */}
                                <div className={clsx(
                                    'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-lg',
                                    message.role === 'user'
                                        ? 'bg-gradient-to-br from-indigo-500 to-blue-600'
                                        : 'bg-gradient-to-br from-pink-500 to-rose-600'
                                )}>
                                    {message.role === 'user' ? <User size={14} className="text-white" /> : <Sparkles size={14} className="text-white" />}
                                </div>

                                {/* Message Bubble */}
                                <div
                                    className={clsx(
                                        'p-4 rounded-2xl shadow-md backdrop-blur-sm transition-all',
                                        message.role === 'user'
                                            ? 'bg-indigo-600 text-white rounded-tr-sm'
                                            : 'bg-slate-800/80 border border-white/5 text-slate-200 rounded-tl-sm hover:bg-slate-800/90'
                                    )}
                                >
                                    <p className="whitespace-pre-wrap leading-relaxed text-[15px]">{message.content}</p>
                                    <span className={clsx(
                                        "text-[10px] mt-2 block font-medium",
                                        message.role === 'user' ? 'text-indigo-200/70' : 'text-slate-500'
                                    )}>
                                        {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>

                {isLoading && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center gap-3 ml-1"
                    >
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center shadow-lg">
                            <Bot size={14} className="text-white" />
                        </div>
                        <div className="bg-slate-800/50 px-4 py-3 rounded-2xl rounded-tl-sm border border-white/5 flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                            <span className="text-sm text-slate-400 font-medium">CaptBot is thinking...</span>
                        </div>
                    </motion.div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 md:p-6 z-10 bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent">
                <div className="max-w-4xl mx-auto relative group">
                    {/* Glow Effect */}
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-pink-500 rounded-2xl opacity-20 group-hover:opacity-40 transition duration-500 blur"></div>

                    <div className="relative glass-dark rounded-2xl p-2 flex items-end gap-2 bg-slate-900/90">
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileSelect}
                            accept="image/*"
                            className="hidden"
                        />

                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className={clsx(
                                "p-3 rounded-xl transition-all duration-200 hover:scale-105 active:scale-95",
                                selectedFile
                                    ? "bg-pink-500/20 text-pink-400 ring-1 ring-pink-500/50"
                                    : "hover:bg-slate-800 text-slate-400 hover:text-indigo-400"
                            )}
                            title="Upload Image"
                        >
                            <Paperclip size={20} />
                        </button>

                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                }
                            }}
                            placeholder="Message CaptBot..."
                            className="flex-1 bg-transparent border-0 focus:ring-0 text-slate-200 placeholder-slate-500 resize-none py-3 max-h-32 min-h-[44px] scrollbar-none text-[15px]"
                            rows={1}
                        />

                        <button
                            onClick={handleSend}
                            disabled={!input.trim() && !selectedFile}
                            className={clsx(
                                "p-3 rounded-xl transition-all duration-200 hover:scale-105 active:scale-95",
                                (input.trim() || selectedFile)
                                    ? "bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow-lg shadow-indigo-500/25"
                                    : "bg-slate-800 text-slate-600 cursor-not-allowed"
                            )}
                        >
                            <Send size={20} />
                        </button>
                    </div>
                </div>

                {selectedFile && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="max-w-4xl mx-auto mt-3 px-1"
                    >
                        <div className="inline-flex items-center gap-2 bg-slate-800/80 border border-white/10 px-3 py-1.5 rounded-full text-xs text-slate-300">
                            <ImageIcon size={12} className="text-pink-400" />
                            <span className="truncate max-w-[200px]">{selectedFile.name}</span>
                            <button
                                onClick={() => setSelectedFile(null)}
                                className="ml-1 hover:text-white transition-colors"
                            >
                                ✕
                            </button>
                        </div>
                    </motion.div>
                )}

                <p className="text-center text-[10px] text-slate-600 mt-3">
                    CaptBot can make mistakes. Check important info.
                </p>
            </div>
        </div>
    );
}
