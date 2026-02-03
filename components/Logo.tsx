
import React from 'react';
import { motion } from 'framer-motion';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  showText?: boolean;
}

const Logo: React.FC<LogoProps> = ({ size = 'md', className = '', showText = true }) => {
  const sizeClasses = {
    sm: "w-6 h-6",
    md: "w-10 h-10",
    lg: "w-24 h-24"
  };

  const isSmall = size === 'sm';

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className={`relative flex items-center justify-center ${sizeClasses[size]}`}>
        
        {/* Deep Field Glow (Atmosphere) */}
        <div className="absolute inset-[-20%] bg-violet-600/30 rounded-full blur-xl animate-pulse" />

        {/* Layer 1: Data Ring (SVG Dashes) - Rotates slowly, hidden on small sizes */}
        {!isSmall && (
            <motion.svg 
                viewBox="0 0 100 100" 
                className="absolute inset-[-15%] w-[130%] h-[130%] opacity-30 text-purple-600 pointer-events-none"
                animate={{ rotate: 360 }}
                transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
            >
                <circle cx="50" cy="50" r="49" fill="none" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 4" />
                <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="0.2" className="opacity-50" />
            </motion.svg>
        )}

        {/* Layer 2: Primary Orbital (Cyber Ring) */}
        <motion.div 
          className="absolute inset-0 rounded-full border-[2px] border-transparent border-t-purple-500 border-l-indigo-400/80 shadow-[0_0_10px_rgba(139,92,246,0.3)]"
          animate={{ rotate: 360 }}
          transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
        />

        {/* Layer 3: Secondary Contra-Rotating Ring (Accent) */}
        <motion.div 
          className="absolute inset-[12%] rounded-full border-[1.5px] border-transparent border-b-cyan-400/80 border-r-purple-400/40"
          animate={{ rotate: -360 }}
          transition={{ duration: 5, repeat: Infinity, ease: "linear" }}
        />

        {/* Layer 4: The Core (Singularity) */}
        <motion.div 
          className="absolute inset-[28%] rounded-full bg-gradient-to-br from-indigo-600 via-purple-700 to-violet-900 shadow-inner overflow-hidden flex items-center justify-center"
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
        >
            {/* Inner Grid/Texture */}
            <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.8)_0%,_transparent_50%)]" />
            
            {/* Plasma/Scanning Effect */}
            <motion.div 
                className="absolute inset-[-100%] bg-gradient-to-tr from-transparent via-white/30 to-transparent skew-y-12"
                animate={{ top: ['150%', '-150%'] }}
                transition={{ duration: 3, repeat: Infinity, repeatDelay: 0.5, ease: "easeInOut" }}
            />
        </motion.div>

        {/* Layer 5: The Center Point (Lens) */}
        <div className="absolute w-[18%] h-[18%] bg-white rounded-full shadow-[0_0_15px_rgba(255,255,255,1)] z-10" />

      </div>
      
      {showText && size !== 'lg' && (
        <div className="flex flex-col justify-center">
            <span className="font-bold text-gray-900 tracking-tight text-[15px] leading-tight">CaptBot</span>
            {!isSmall && <span className="text-[9px] text-purple-500 tracking-[0.2em] font-semibold uppercase leading-none opacity-80 mt-0.5">Quantum</span>}
        </div>
      )}
    </div>
  );
};

export default Logo;
