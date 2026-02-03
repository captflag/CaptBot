
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Logo from './Logo';

interface BootSequenceProps {
  onComplete: () => void;
}

const BootSequence: React.FC<BootSequenceProps> = ({ onComplete }) => {
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => setPhase(1), 800);
          setTimeout(onComplete, 2800);
          return 100;
        }
        return prev + 1.2;
      });
    }, 16);
    return () => clearInterval(interval);
  }, [onComplete]);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, filter: 'blur(40px)', transition: { duration: 1.2 } }}
      className="fixed inset-0 bg-[#D7E8BA] flex flex-col items-center justify-center z-50 overflow-hidden font-sans"
    >
      <div className="absolute inset-0 opacity-[0.05] pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]" />
      
      <div className="relative flex flex-col items-center">
        <AnimatePresence mode="wait">
          {phase === 0 ? (
            <motion.div 
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col items-center"
            >
              <Logo size="lg" className="mb-24" />
              
              <div className="w-96 h-[1px] bg-[#355E3B]/10 relative overflow-hidden rounded-full mb-6">
                <motion.div 
                  className="absolute top-0 left-0 h-full bg-[#355E3B]"
                  style={{ width: '100%', transform: `translateX(${progress - 100}%)` }}
                />
              </div>

              <div className="flex items-center gap-6 text-[9px] text-[#355E3B]/40 tracking-[0.6em] uppercase font-black">
                <span className="w-16 text-right tabular-nums">{Math.round(progress)}%</span>
                <span className="w-px h-3 bg-[#355E3B]/10"></span>
                <span>Synthesizing Link</span>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="complete"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center"
            >
              <div className="p-12 bg-[#D7E8BA] rounded-[3rem] shadow-premium border border-[#355E3B]/10 flex flex-col items-center">
                <Logo size="lg" className="mb-8" />
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: "100%" }}
                  className="h-px bg-gradient-to-r from-transparent via-[#355E3B]/20 to-transparent mb-8"
                />
                <p className="text-[10px] text-[#355E3B] tracking-[0.8em] uppercase font-black animate-pulse">
                  Core Access Authorized
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      
      {/* Background Ambience */}
      <motion.div 
        animate={{ scale: [1, 1.1, 1], opacity: [0.03, 0.08, 0.03] }}
        transition={{ duration: 10, repeat: Infinity }}
        className="absolute w-[1200px] h-[1200px] border border-[#355E3B]/5 rounded-full pointer-events-none"
      />
    </motion.div>
  );
};

export default BootSequence;
