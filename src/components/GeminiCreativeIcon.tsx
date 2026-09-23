import React, { useId } from 'react';

export type GeminiActionState =
  | 'pensando'
  | 'lendo'
  | 'executando'
  | 'editando'
  | 'consultando'
  | 'aguardando'
  | 'concluido'
  | 'erro'
  | 'cancelado'
  | 'usuario';

export interface GeminiCreativeIconProps {
  state?: GeminiActionState;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  paused?: boolean;
  className?: string;
  tooltipText?: string;
}

export const GEMINI_STAR_PATH =
  'M 49.61 0 C 55.67 16.49 62.71 19.65 69.77 30.23 C 80.08 37.02 83.08 43.91 99.22 49.61 C 82.85 55.44 79.57 62.21 68.99 68.99 C 62.48 79.57 55.86 82.85 50.39 99.22 C 44.56 82.85 37.79 79.57 31.01 68.99 C 20.16 62.48 16.72 55.86 0 50.39 C 16.72 44.56 20.16 37.79 31.01 31.01 C 37.52 20.16 44.14 16.72 49.61 0 Z';

const SIZE_CONFIGS = {
  xs: { px: 14, strokeW: 1.6, dotScale: 1.3 },
  sm: { px: 18, strokeW: 1.4, dotScale: 1.2 },
  md: { px: 24, strokeW: 1.1, dotScale: 1.0 },
  lg: { px: 40, strokeW: 0.9, dotScale: 1.0 },
  xl: { px: 56, strokeW: 0.85, dotScale: 1.0 },
};

export const GeminiCreativeIcon: React.FC<GeminiCreativeIconProps> = ({
  state = 'pensando',
  size = 'sm',
  paused = false,
  className = '',
  tooltipText,
}) => {
  const rawId = useId().replace(/[:]/g, '');
  const prefix = `gemini-${rawId}-${state}`;

  const { px, strokeW, dotScale } = SIZE_CONFIGS[size] || SIZE_CONFIGS.sm;
  const playStateStyle = paused ? { animationPlayState: 'paused' as const } : {};

  // Default tooltips when not explicitly provided
  const defaultTooltips: Record<GeminiActionState, string> = {
    pensando: 'Pensando e processando instrução...',
    lendo: 'Lendo e analisando código/arquivos...',
    executando: 'Executando tarefas e comandos...',
    editando: 'Modificando e escrevendo arquivos...',
    consultando: 'Consultando a web em tempo real...',
    aguardando: 'Aguardando comandos...',
    concluido: 'Resposta concluída com sucesso',
    erro: 'Ocorreu um erro na execução',
    cancelado: 'Execução pausada/cancelada pelo usuário',
    usuario: 'Comando do usuário',
  };

  const tip = tooltipText || defaultTooltips[state];

  // Specific scale and motion animation class
  const getMotionClass = () => {
    switch (state) {
      case 'pensando':
      case 'usuario':
        return 'animate-gemini-thinkScale';
      case 'lendo':
        return 'animate-gemini-tilt';
      case 'executando':
        return 'animate-gemini-execScale';
      case 'aguardando':
        return 'animate-gemini-breatheA';
      case 'erro':
        return 'animate-gemini-shake';
      case 'cancelado':
        return 'animate-gemini-cancel';
      case 'concluido':
        return 'animate-gemini-concluScale';
      default:
        return '';
    }
  };

  // Ambient glow background color based on action
  const getAmbientGlow = () => {
    switch (state) {
      case 'executando':
        return 'radial-gradient(55% 55% at 50% 50%, rgba(224,64,251,0.28) 0%, rgba(124,58,237,0.15) 50%, transparent 75%)';
      case 'consultando':
        return 'radial-gradient(55% 55% at 50% 50%, rgba(6,182,212,0.25) 0%, rgba(16,185,129,0.15) 55%, transparent 75%)';
      case 'editando':
        return 'radial-gradient(55% 55% at 50% 50%, rgba(244,114,182,0.25) 0%, rgba(139,92,246,0.15) 55%, transparent 75%)';
      case 'lendo':
        return 'radial-gradient(55% 55% at 50% 50%, rgba(34,211,238,0.25) 0%, rgba(99,102,241,0.15) 55%, transparent 75%)';
      case 'erro':
        return 'radial-gradient(55% 55% at 50% 50%, rgba(239,68,68,0.35) 0%, rgba(249,115,22,0.15) 55%, transparent 75%)';
      case 'cancelado':
        return 'radial-gradient(55% 55% at 50% 50%, rgba(245,158,11,0.25) 0%, rgba(100,116,139,0.15) 55%, transparent 75%)';
      case 'aguardando':
        return 'radial-gradient(55% 55% at 50% 50%, rgba(192,132,252,0.22) 0%, rgba(251,191,36,0.15) 55%, transparent 75%)';
      case 'concluido':
        return 'radial-gradient(55% 55% at 50% 50%, rgba(16,185,129,0.28) 0%, rgba(34,211,238,0.15) 55%, transparent 75%)';
      case 'usuario':
        return 'radial-gradient(55% 55% at 50% 50%, rgba(56,189,248,0.25) 0%, rgba(99,102,241,0.15) 55%, transparent 75%)';
      default:
        return 'radial-gradient(60% 60% at 50% 50%, rgba(74,124,255,0.22) 0%, rgba(139,92,246,0.12) 55%, transparent 75%)';
    }
  };

  return (
    <div
      className={`inline-flex items-center justify-center relative overflow-visible shrink-0 select-none ${className}`}
      style={{ width: px, height: px }}
      title={tip}
    >
      {/* Ambient Glow behind the 5-layer star */}
      <div
        className="absolute pointer-events-none rounded-full"
        style={{
          inset: -px * 0.28,
          background: getAmbientGlow(),
          filter: `blur(${Math.max(2, px * 0.16)}px)`,
          ...playStateStyle,
        }}
      />

      {/* Main 4-pointed Star with 5 Aesthetic Layers & Pure SVG Animations */}
      <div
        className={`w-full h-full relative overflow-visible will-change-transform ${getMotionClass()}`}
        style={playStateStyle}
      >
        <svg
          viewBox="0 0 100 100"
          width={px}
          height={px}
          className="overflow-visible block"
          style={{ display: 'block' }}
        >
          <defs>
            {/* Layer 1 Filter: Shadow */}
            <filter id={`${prefix}-shadow`} x="-40%" y="-40%" width="180%" height="180%">
              <feOffset dx="1.5" dy="2.2" in="SourceAlpha" result="off" />
              <feGaussianBlur in="off" stdDeviation="3.2" result="blur" />
              <feColorMatrix
                type="matrix"
                values="0 0 0 0 0   0 0 0 0 0   0 0 0 0 0  0 0 0 0.5 0"
              />
            </filter>

            {/* Layer 2 Gradient: Cavity backing for 3D metallic/glass bezel */}
            <radialGradient id={`${prefix}-cavity`} cx="50%" cy="35%" r="75%">
              <stop offset="0%" stopColor="#1e1e24" />
              <stop offset="60%" stopColor="#121216" />
              <stop offset="100%" stopColor="#08080a" />
            </radialGradient>

            {/* Clip path for internal sweeps like shimmer or edit scan */}
            <clipPath id={`${prefix}-clip`}>
              <path d={GEMINI_STAR_PATH} />
            </clipPath>

            {/* Shimmer sweep gradient */}
            <linearGradient id={`${prefix}-shimmer`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="white" stopOpacity="0" />
              <stop offset="45%" stopColor="white" stopOpacity="0" />
              <stop offset="50%" stopColor="white" stopOpacity="0.85" />
              <stop offset="55%" stopColor="white" stopOpacity="0" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </linearGradient>

            {/* Main Layer Gradients mapped directly to each Action State */}
            {state === 'pensando' && (
              <linearGradient id={`${prefix}-main`} x1="0%" y1="15%" x2="100%" y2="85%">
                <stop offset="0%" stopColor="#4A7CFF" />
                <stop offset="25%" stopColor="#5E6FFF" />
                <stop offset="55%" stopColor="#7A65FF" />
                <stop offset="80%" stopColor="#865BFA" />
                <stop offset="100%" stopColor="#8B5CF6" />
                {!paused && (
                  <animateTransform
                    attributeName="gradientTransform"
                    type="rotate"
                    from="0 50 50"
                    to="360 50 50"
                    dur="4.8s"
                    repeatCount="indefinite"
                  />
                )}
              </linearGradient>
            )}

            {state === 'lendo' && (
              <linearGradient id={`${prefix}-main`} x1="10%" y1="0%" x2="90%" y2="100%">
                <stop offset="0%" stopColor="#06B6D4" />
                <stop offset="28%" stopColor="#22D3EE" />
                <stop offset="58%" stopColor="#3B82F6" />
                <stop offset="82%" stopColor="#4F46E5" />
                <stop offset="100%" stopColor="#6366F1" />
                {!paused && (
                  <animateTransform
                    attributeName="gradientTransform"
                    type="rotate"
                    from="-10 50 50"
                    to="20 50 50"
                    dur="6s"
                    repeatCount="indefinite"
                  />
                )}
              </linearGradient>
            )}

            {state === 'executando' && (
              <linearGradient id={`${prefix}-main`} x1="15%" y1="0%" x2="85%" y2="100%">
                <stop offset="0%" stopColor="#7C3AED" />
                <stop offset="22%" stopColor="#9C4AEA" />
                <stop offset="48%" stopColor="#BE4CEA" />
                <stop offset="76%" stopColor="#D145F5" />
                <stop offset="100%" stopColor="#E040FB" />
                {!paused && (
                  <animateTransform
                    attributeName="gradientTransform"
                    type="rotate"
                    from="0 50 50"
                    to="360 50 50"
                    dur="2.2s"
                    repeatCount="indefinite"
                  />
                )}
              </linearGradient>
            )}

            {state === 'editando' && (
              <linearGradient id={`${prefix}-main`} x1="50%" y1="0%" x2="50%" y2="100%">
                <stop offset="0%" stopColor="#8B5CF6" />
                <stop offset="30%" stopColor="#A76CE0" />
                <stop offset="60%" stopColor="#C06FC6" />
                <stop offset="85%" stopColor="#DD72B0" />
                <stop offset="100%" stopColor="#F472B6" />
                {!paused && (
                  <animate
                    attributeName="y1"
                    values="0%;-15%;0%"
                    dur="2.4s"
                    repeatCount="indefinite"
                  />
                )}
              </linearGradient>
            )}

            {state === 'consultando' && (
              <linearGradient id={`${prefix}-main`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#2563EB" />
                <stop offset="32%" stopColor="#0EA5E9" />
                <stop offset="58%" stopColor="#06B6D4" />
                <stop offset="80%" stopColor="#0BBF8A" />
                <stop offset="100%" stopColor="#10B981" />
                {!paused && (
                  <animateTransform
                    attributeName="gradientTransform"
                    type="rotate"
                    from="0 50 50"
                    to="360 50 50"
                    dur="7s"
                    repeatCount="indefinite"
                  />
                )}
              </linearGradient>
            )}

            {/* AGUARDANDO REFEITA: Tons de aurora celestial/dourada suave, viva e respirante */}
            {state === 'aguardando' && (
              <linearGradient id={`${prefix}-main`} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#818CF8" />
                <stop offset="35%" stopColor="#A78BFA" />
                <stop offset="70%" stopColor="#F472B6" />
                <stop offset="100%" stopColor="#FBBF24" />
                {!paused && (
                  <animateTransform
                    attributeName="gradientTransform"
                    type="rotate"
                    from="0 50 50"
                    to="360 50 50"
                    dur="9s"
                    repeatCount="indefinite"
                  />
                )}
              </linearGradient>
            )}

            {state === 'concluido' && (
              <linearGradient id={`${prefix}-main`} x1="0%" y1="20%" x2="100%" y2="80%">
                <stop offset="0%" stopColor="#10B981" />
                <stop offset="50%" stopColor="#14C8A0" />
                <stop offset="100%" stopColor="#22D3EE" />
              </linearGradient>
            )}

            {state === 'erro' && (
              <linearGradient id={`${prefix}-main`} x1="15%" y1="15%" x2="85%" y2="85%">
                <stop offset="0%" stopColor="#EF4444" />
                <stop offset="55%" stopColor="#F65A3A" />
                <stop offset="100%" stopColor="#F97316" />
              </linearGradient>
            )}

            {/* CANCELADO REFEITA: Pôr do sol âmbar para ardósia nobre com anel de dissipação */}
            {state === 'cancelado' && (
              <linearGradient id={`${prefix}-main`} x1="20%" y1="10%" x2="80%" y2="90%">
                <stop offset="0%" stopColor="#F59E0B" />
                <stop offset="45%" stopColor="#D97706" />
                <stop offset="100%" stopColor="#64748B" />
              </linearGradient>
            )}

            {/* USUARIO: Ciano & Índigo Criativo, representando a autoria humana */}
            {state === 'usuario' && (
              <linearGradient id={`${prefix}-main`} x1="0%" y1="10%" x2="100%" y2="90%">
                <stop offset="0%" stopColor="#38BDF8" />
                <stop offset="45%" stopColor="#6366F1" />
                <stop offset="100%" stopColor="#A855F7" />
                {!paused && (
                  <animateTransform
                    attributeName="gradientTransform"
                    type="rotate"
                    from="0 50 50"
                    to="360 50 50"
                    dur="6s"
                    repeatCount="indefinite"
                  />
                )}
              </linearGradient>
            )}
          </defs>

          {/* LAYER 1: Shadow Layer */}
          <path
            d={GEMINI_STAR_PATH}
            fill="black"
            transform="translate(1.5 2.2)"
            filter={`url(#${prefix}-shadow)`}
            opacity="0.5"
          />

          {/* LAYER 2: Cavity Layer (Metallic/Glass background depth) */}
          <path
            d={GEMINI_STAR_PATH}
            fill={`url(#${prefix}-cavity)`}
            opacity="0.88"
          />

          {/* LAYER 3: Main Dynamic Color Gradient Layer */}
          <path
            d={GEMINI_STAR_PATH}
            fill={`url(#${prefix}-main)`}
            opacity={state === 'cancelado' ? 0.85 : 0.98}
          />

          {/* LAYER 4: Bevel Layer & Precision Rims */}
          <path
            d={GEMINI_STAR_PATH}
            fill="none"
            stroke="white"
            strokeWidth={strokeW}
            strokeLinejoin="round"
            opacity="0.38"
            style={{ mixBlendMode: 'soft-light' }}
          />
          <path
            d={GEMINI_STAR_PATH}
            fill="none"
            stroke="white"
            strokeWidth={strokeW * 0.45}
            opacity="0.14"
            transform="translate(0.4 -0.4)"
          />

          {/* LAYER 5: Top-left Specular Glass Highlight */}
          <ellipse
            cx="36"
            cy="30"
            rx="11"
            ry="7.5"
            fill="white"
            opacity={state === 'cancelado' ? 0.12 : 0.22}
            style={{ filter: 'blur(1.6px)' }}
            transform="rotate(-12 36 30)"
          />

          {/* === ACTION-SPECIFIC OVERLAYS === */}

          {/* LENDO: Shimmer Light Sweep */}
          {state === 'lendo' && (
            <g clipPath={`url(#${prefix}-clip)`}>
              <g style={paused ? {} : { animation: 'gemini-shimmerMove 1.8s ease-in-out infinite' }}>
                <rect
                  x="-20"
                  y="0"
                  width="38"
                  height="100"
                  fill={`url(#${prefix}-shimmer)`}
                  opacity="0.95"
                  transform="skewX(-12)"
                />
              </g>
            </g>
          )}

          {/* EDITANDO: Scanline flow + Perimeter Border Draw */}
          {state === 'editando' && (
            <>
              <g clipPath={`url(#${prefix}-clip)`} opacity="0.35">
                <rect
                  x="0"
                  y="-100"
                  width="100"
                  height="36"
                  fill="white"
                  opacity="0.25"
                  style={{ animation: paused ? 'none' : 'gemini-editFlow 2.4s linear infinite' }}
                />
              </g>
              <path
                d={GEMINI_STAR_PATH}
                fill="none"
                stroke="white"
                strokeWidth={strokeW * 1.1}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="320"
                strokeDashoffset="320"
                opacity="0.9"
                style={{
                  animation: paused ? 'none' : 'gemini-drawBorder 2.4s cubic-bezier(0.4,0,0.2,1) infinite',
                }}
              />
            </>
          )}

          {/* EXECUTANDO (FAVORITA): 3 Partículas Orbitais Internas + Anel de Energia Magenta */}
          {state === 'executando' && (
            <>
              <g>
                {[0, 1, 2].map((idx) => {
                  const radius = [14, 19, 24][idx];
                  const dur = [1.0, 1.22, 1.44][idx];
                  const rSize = [2.6 * dotScale, 2.0 * dotScale, 1.6 * dotScale][idx];
                  const op = [0.95, 0.75, 0.55][idx];
                  return (
                    <g
                      key={idx}
                      style={{
                        transformOrigin: '50px 50px',
                        animation: paused ? 'none' : `gemini-orbitInternal ${dur}s linear infinite`,
                      }}
                    >
                      <g style={{ transform: `translate(${radius}px, 0px)` }}>
                        <circle
                          cx="50"
                          cy="50"
                          r={rSize}
                          fill="white"
                          opacity={op}
                          style={{ filter: 'blur(0.2px)' }}
                        />
                        <circle
                          cx="50"
                          cy="50"
                          r={rSize * 1.8}
                          fill="#E040FB"
                          opacity="0.35"
                          style={{ filter: 'blur(1.2px)' }}
                        />
                      </g>
                    </g>
                  );
                })}
              </g>
              <circle
                cx="50"
                cy="50"
                r="34"
                fill="none"
                stroke="#E040FB"
                strokeWidth={strokeW * 0.7}
                opacity="0.25"
                style={{
                  animation: paused ? 'none' : 'gemini-pulseGlow 1.1s ease-in-out infinite',
                  transformOrigin: '50px 50px',
                }}
              />
            </>
          )}

          {/* CONSULTANDO WEB (FAVORITA): 3 Anéis Expansivos Concêntricos + 3 Satélites Orbitais */}
          {state === 'consultando' && (
            <>
              {/* 3 Rings */}
              {[0, 1, 2].map((idx) => {
                const ringColor = idx === 2 ? '#10B981' : idx === 1 ? '#06B6D4' : '#2563EB';
                const dur = [2.0, 2.5, 3.0][idx];
                const delay = `${idx * 0.35}s`;
                return (
                  <path
                    key={`ring-${idx}`}
                    d={GEMINI_STAR_PATH}
                    fill="none"
                    stroke={ringColor}
                    strokeWidth={strokeW * 0.75}
                    opacity={0.6 - idx * 0.12}
                    style={{
                      transformOrigin: '50px 50px',
                      animation: paused
                        ? 'none'
                        : `gemini-ringPulse ${dur}s cubic-bezier(0.4,0,0.2,1) infinite`,
                      animationDelay: delay,
                    }}
                  />
                );
              })}

              {/* 3 External Orbital Satellite Dots */}
              {[0, 1, 2].map((idx) => {
                const dotColor = ['#2563EB', '#06B6D4', '#10B981'][idx];
                const dur = [2.0, 2.7, 3.4][idx];
                const orbitR = [56, 60, 64][idx];
                const dotR = [2.4 * dotScale, 2.0 * dotScale, 1.6 * dotScale][idx];
                return (
                  <g
                    key={`dot-${idx}`}
                    style={{
                      transformOrigin: '50px 50px',
                      animation: paused ? 'none' : `gemini-orbitExternal ${dur}s linear infinite`,
                    }}
                  >
                    <g style={{ transform: `translate(0px, -${orbitR}px)` }}>
                      <circle cx="50" cy="50" r={dotR} fill={dotColor} opacity="0.95" />
                      <circle
                        cx="50"
                        cy="50"
                        r={dotR * 1.8}
                        fill={dotColor}
                        opacity="0.3"
                        style={{ filter: 'blur(1px)' }}
                      />
                    </g>
                  </g>
                );
              })}
            </>
          )}

          {/* CONCLUÍDO: Flash branco alegre + 2 anéis expansivos */}
          {state === 'concluido' && (
            <>
              {[0, 1].map((idx) => (
                <path
                  key={idx}
                  d={GEMINI_STAR_PATH}
                  fill="none"
                  stroke="#22D3EE"
                  strokeWidth={idx === 0 ? strokeW : strokeW * 0.6}
                  opacity="0.6"
                  style={{
                    transformOrigin: '50px 50px',
                    animation: paused
                      ? 'none'
                      : `gemini-ringExpansive ${idx === 0 ? 1.1 : 1.6}s cubic-bezier(0.2,0,0.8,1) infinite`,
                    animationDelay: `${idx * 0.22}s`,
                  }}
                />
              ))}
              <path
                d={GEMINI_STAR_PATH}
                fill="white"
                opacity="0"
                style={{ animation: paused ? 'none' : 'gemini-flash 2.4s ease-out infinite' }}
              />
            </>
          )}

          {/* ERRO: Shake orgânico + Contorno vermelho pulsante */}
          {state === 'erro' && (
            <path
              d={GEMINI_STAR_PATH}
              fill="none"
              stroke="#EF4444"
              strokeWidth={strokeW * 1.4}
              opacity="0.45"
              style={{
                filter: 'blur(2.5px)',
                animation: paused ? 'none' : 'gemini-glowPulseRed 0.9s ease-in-out infinite',
                transformOrigin: '50px 50px',
              }}
            />
          )}

          {/* AGUARDANDO REFEITA: Pulso de luz suave aurora */}
          {state === 'aguardando' && (
            <circle
              cx="50"
              cy="50"
              r="28"
              fill="#FBBF24"
              opacity="0.12"
              style={{
                filter: 'blur(10px)',
                animation: paused ? 'none' : 'gemini-warmGlow 3.6s ease-in-out infinite',
              }}
            />
          )}

          {/* CANCELADO REFEITA: Anel sutil de dissipação âmbar */}
          {state === 'cancelado' && (
            <circle
              cx="50"
              cy="50"
              r="30"
              fill="none"
              stroke="#F59E0B"
              strokeWidth={strokeW * 0.8}
              opacity="0.3"
              style={{
                filter: 'blur(1.5px)',
                transformOrigin: '50px 50px',
              }}
            />
          )}
        </svg>
      </div>
    </div>
  );
};
