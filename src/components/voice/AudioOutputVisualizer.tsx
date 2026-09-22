import React, { useEffect, useRef, useState } from 'react';
import { Play, Square, Volume2, VolumeX, Disc, Radio, Sliders, Activity, Repeat } from 'lucide-react';

interface AudioOutputVisualizerProps {
  isPlaying: boolean;
  isBuffering: boolean;
  onPlay: () => void;
  onStop: () => void;
  title?: string;
  subtitle?: string;
  volume: number;
  onVolumeChange: (vol: number) => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  pitch: number;
  onPitchChange: (pitch: number) => void;
  statusText?: string;
}

export const AudioOutputVisualizer: React.FC<AudioOutputVisualizerProps> = ({
  isPlaying,
  isBuffering,
  onPlay,
  onStop,
  title = 'Gemini Vocal Deck 01',
  subtitle = 'Estúdio de Saída de Áudio',
  volume,
  onVolumeChange,
  speed,
  onSpeedChange,
  pitch,
  onPitchChange,
  statusText = 'READY',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rotation, setRotation] = useState(0);

  // Animate spinning jog wheel vinyl when playing
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setRotation((r) => (r + 4) % 360);
    }, 30);
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Animated visualizer canvas bars
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const bars = 32;
      const barWidth = canvas.width / bars;

      for (let i = 0; i < bars; i++) {
        let height = 4;
        if (isPlaying) {
          height = Math.sin(Date.now() * 0.01 + i * 0.3) * 18 + Math.random() * 12 + 10;
        } else if (isBuffering) {
          height = Math.sin(Date.now() * 0.005 + i * 0.5) * 8 + 6;
        }

        const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
        gradient.addColorStop(0, '#10b981'); // Emerald
        gradient.addColorStop(0.6, '#3b82f6'); // Blue
        gradient.addColorStop(1, '#ec4899'); // Pink/Purple

        ctx.fillStyle = gradient;
        ctx.fillRect(i * barWidth, canvas.height - height, barWidth - 2, height);
      }

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, isBuffering]);

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 text-zinc-100 shadow-2xl relative overflow-hidden font-mono">
      {/* Top Deck Status Bar */}
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800 text-xs">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded-md bg-emerald-500/20 text-emerald-400">
            <Radio className="w-3.5 h-3.5 animate-pulse" />
          </div>
          <div>
            <div className="font-bold text-zinc-100 truncate">{title}</div>
            <div className="text-[10px] text-zinc-500">{subtitle}</div>
          </div>
        </div>

        {/* LED Status Display */}
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase border ${
              isBuffering
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-400 animate-pulse'
                : isPlaying
                ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                : 'bg-zinc-800 border-zinc-700 text-zinc-400'
            }`}
          >
            {isBuffering ? 'CARREGANDO' : isPlaying ? 'EM EXECUÇÃO' : statusText}
          </span>
        </div>
      </div>

      {/* Main CDJ Control Deck Body */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 my-4 items-center">
        {/* Left Vinyl Jog Wheel */}
        <div className="md:col-span-4 flex flex-col items-center justify-center p-2">
          <div
            className="relative w-28 h-28 rounded-full bg-gradient-to-tr from-zinc-900 via-zinc-800 to-zinc-950 border-4 border-zinc-700 flex items-center justify-center shadow-inner cursor-pointer transition transform active:scale-95"
            style={{ transform: `rotate(${rotation}deg)` }}
            onClick={isPlaying ? onStop : onPlay}
          >
            {/* Vinyl Grooves */}
            <div className="absolute inset-2 rounded-full border border-zinc-700/50"></div>
            <div className="absolute inset-4 rounded-full border border-zinc-700/40"></div>
            <div className="absolute inset-6 rounded-full border border-zinc-700/30"></div>

            {/* Center Label */}
            <div className="w-10 h-10 rounded-full bg-emerald-500 border-2 border-zinc-900 flex items-center justify-center text-zinc-950 font-black text-[10px] shadow-md">
              <Disc className={`w-5 h-5 ${isPlaying ? 'animate-spin' : ''}`} />
            </div>
          </div>
          <span className="text-[10px] text-zinc-500 mt-2 font-mono">PITCH & JOG WHEEL</span>
        </div>

        {/* Center Visualizer & Play Controls */}
        <div className="md:col-span-8 flex flex-col gap-3">
          {/* Visualizer Canvas */}
          <div className="bg-zinc-900/80 rounded-xl border border-zinc-800 p-2.5 flex flex-col gap-1">
            <div className="flex justify-between items-center text-[10px] text-zinc-400">
              <span className="flex items-center gap-1 text-emerald-400">
                <Activity className="w-3 h-3" /> VU METER SINAL
              </span>
              <span>24-bit / 48kHz Gemini DSP</span>
            </div>
            <canvas ref={canvasRef} width={280} height={36} className="w-full h-9 rounded" />
          </div>

          {/* Large Action Buttons (PLAY, CUE, STOP) */}
          <div className="flex items-center gap-3">
            <button
              onClick={isPlaying ? onStop : onPlay}
              disabled={isBuffering}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-bold text-xs transition shadow-lg cursor-pointer ${
                isPlaying
                  ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/30'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950 shadow-emerald-900/30'
              }`}
            >
              {isPlaying ? (
                <>
                  <Square className="w-4 h-4 fill-current" /> PARAR ÁUDIO
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" /> OUVIR / PREVIEW
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Deck Knobs / Faders */}
      <div className="grid grid-cols-3 gap-3 pt-3 border-t border-zinc-800 text-xs">
        {/* Speed Fader */}
        <div className="space-y-1 bg-zinc-900/50 p-2 rounded-xl border border-zinc-800/80">
          <div className="flex justify-between text-[10px] text-zinc-400">
            <span>VELOCIDADE</span>
            <span className="font-bold text-emerald-400">{speed.toFixed(2)}x</span>
          </div>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.05"
            value={speed}
            onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
            className="w-full accent-emerald-500 bg-zinc-800 h-1.5 rounded cursor-pointer"
          />
        </div>

        {/* Pitch Fader */}
        <div className="space-y-1 bg-zinc-900/50 p-2 rounded-xl border border-zinc-800/80">
          <div className="flex justify-between text-[10px] text-zinc-400">
            <span>PITCH (AFINAÇÃO)</span>
            <span className="font-bold text-blue-400">
              {pitch > 0 ? `+${pitch}` : pitch} semit
            </span>
          </div>
          <input
            type="range"
            min="-12"
            max="12"
            step="1"
            value={pitch}
            onChange={(e) => onPitchChange(parseInt(e.target.value))}
            className="w-full accent-blue-500 bg-zinc-800 h-1.5 rounded cursor-pointer"
          />
        </div>

        {/* Volume Control */}
        <div className="space-y-1 bg-zinc-900/50 p-2 rounded-xl border border-zinc-800/80">
          <div className="flex justify-between text-[10px] text-zinc-400">
            <span>VOLUME MASTER</span>
            <span className="font-bold text-pink-400">{volume}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={volume}
            onChange={(e) => onVolumeChange(parseInt(e.target.value))}
            className="w-full accent-pink-500 bg-zinc-800 h-1.5 rounded cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
};
