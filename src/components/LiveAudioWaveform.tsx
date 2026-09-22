import React, { useEffect, useRef } from 'react';

interface LiveAudioWaveformProps {
  stream: MediaStream | null;
  isRecording: boolean;
}

export const LiveAudioWaveform: React.FC<LiveAudioWaveformProps> = ({ stream, isRecording }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const historyRef = useRef<number[]>([]);
  const phaseRef = useRef<number>(0);
  const volumeSmoothedRef = useRef<number>(0);

  useEffect(() => {
    if (!isRecording || !stream) {
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
      audioContextRef.current = null;
      analyserRef.current = null;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
    } catch (err) {
      console.warn('AudioContext visualization initialization note:', err);
    }

    return () => {
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
      audioContextRef.current = null;
      analyserRef.current = null;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isRecording, stream]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isRecording) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Initialize wave history points across width
    const pointCount = 140;
    if (historyRef.current.length !== pointCount) {
      historyRef.current = new Array(pointCount).fill(0.08);
    }

    const dataArray = new Uint8Array(128);

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      // Measure current mic audio volume
      let currentVolume = 0.05;
      if (analyserRef.current) {
        analyserRef.current.getByteFrequencyData(dataArray);
        let sum = 0;
        // Focus on vocal frequencies (bins 2 to 40)
        for (let i = 2; i < 45; i++) {
          sum += dataArray[i];
        }
        const avg = sum / 43;
        currentVolume = Math.min(1.0, (avg / 255) * 2.8);
      }

      // Smooth volume transitions
      volumeSmoothedRef.current += (currentVolume - volumeSmoothedRef.current) * 0.35;
      const vol = Math.max(0.06, volumeSmoothedRef.current);

      // Push new audio sample onto the right end (flows right to left)
      phaseRef.current += 0.15;
      const dynamicSample = vol + Math.sin(phaseRef.current * 1.5) * (vol * 0.35);

      historyRef.current.shift();
      historyRef.current.push(dynamicSample);

      const centerY = height / 2;
      const points = historyRef.current;
      const step = width / (pointCount - 1);

      // 1. Create Left-to-Right alpha fading mask gradient (fades to 0 at left edge)
      const gradientPrimary = ctx.createLinearGradient(0, 0, width, 0);
      gradientPrimary.addColorStop(0, 'rgba(56, 189, 248, 0)');      // Transparent at left end
      gradientPrimary.addColorStop(0.18, 'rgba(56, 189, 248, 0.25)');
      gradientPrimary.addColorStop(0.5, 'rgba(129, 140, 248, 0.75)');  // Indigo/violet
      gradientPrimary.addColorStop(1, 'rgba(192, 132, 252, 1)');      // Solid purple/cyan at right end

      const gradientSecondary = ctx.createLinearGradient(0, 0, width, 0);
      gradientSecondary.addColorStop(0, 'rgba(168, 85, 247, 0)');
      gradientSecondary.addColorStop(0.2, 'rgba(168, 85, 247, 0.2)');
      gradientSecondary.addColorStop(0.7, 'rgba(59, 130, 246, 0.6)');
      gradientSecondary.addColorStop(1, 'rgba(56, 189, 248, 0.85)');

      // Background soft glowing aura
      const maxAmp = Math.max(8, (height / 2.2) * vol);

      // Draw secondary harmonic wave
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const x = i * step;
        const progress = i / (points.length - 1); // 0 at left, 1 at right
        const pointVol = points[i];
        const harmonic = Math.sin(phaseRef.current + i * 0.22) * (pointVol * (height * 0.35)) * progress;
        const y = centerY + harmonic;

        if (i === 0) ctx.moveTo(x, y);
        else {
          const prevX = (i - 1) * step;
          const prevVol = points[i - 1];
          const prevHarmonic = Math.sin(phaseRef.current + (i - 1) * 0.22) * (prevVol * (height * 0.35)) * ((i - 1) / (points.length - 1));
          const prevY = centerY + prevHarmonic;
          const xc = (prevX + x) / 2;
          const yc = (prevY + y) / 2;
          ctx.quadraticCurveTo(prevX, prevY, xc, yc);
        }
      }
      ctx.strokeStyle = gradientSecondary;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Draw primary voice-responsive audio wave
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const x = i * step;
        const progress = i / (points.length - 1); // 0 at left, 1 at right
        const pointVol = points[i];
        // Amplitude grows towards the right and modulates with vocal frequency
        const amp = (pointVol * (height * 0.42)) * Math.pow(progress, 0.8);
        const wave = Math.sin(phaseRef.current * 1.8 + i * 0.28) * amp;
        const y = centerY + wave;

        if (i === 0) ctx.moveTo(x, y);
        else {
          const prevX = (i - 1) * step;
          const prevProgress = (i - 1) / (points.length - 1);
          const prevVol = points[i - 1];
          const prevAmp = (prevVol * (height * 0.42)) * Math.pow(prevProgress, 0.8);
          const prevWave = Math.sin(phaseRef.current * 1.8 + (i - 1) * 0.28) * prevAmp;
          const prevY = centerY + prevWave;
          const xc = (prevX + x) / 2;
          const yc = (prevY + y) / 2;
          ctx.quadraticCurveTo(prevX, prevY, xc, yc);
        }
      }
      ctx.strokeStyle = gradientPrimary;
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(129, 140, 248, 0.7)';
      ctx.shadowBlur = 8;
      ctx.stroke();

      // Small glowing origin pulse at the right edge
      const rightX = width - 4;
      ctx.beginPath();
      ctx.arc(rightX, centerY, Math.max(2, 4 * vol), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.shadowColor = 'rgba(56, 189, 248, 1)';
      ctx.shadowBlur = 10;
      ctx.fill();

      ctx.restore();
      animationFrameRef.current = requestAnimationFrame(render);
    };

    animationFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isRecording]);

  return (
    <div className="flex-1 h-8 flex items-center justify-center relative overflow-hidden px-1">
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
      />
    </div>
  );
};
