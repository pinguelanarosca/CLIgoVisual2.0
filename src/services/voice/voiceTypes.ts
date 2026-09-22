export interface VoiceOption {
  id: string;
  name: string;
  gender: 'Feminino' | 'Masculino' | 'Neutro';
  baseGeminiVoice: 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';
  description: string;
  recommendedStyles: string[];
  nativeLanguage: string;
  accent: string;
}

export type VoiceStyle =
  | 'Conversacional'
  | 'Formal'
  | 'Dramático'
  | 'Neutro'
  | 'Épico'
  | 'Entusiasmado'
  | 'Calmo'
  | 'Sensacionalista'
  | 'Educativo'
  | 'Íntimo/ASMR'
  | 'Urgente/Notícias';

export type VoiceEmotion =
  | 'Alegre'
  | 'Triste'
  | 'Bravo/Autoritário'
  | 'Misterioso'
  | 'Amigável'
  | 'Sério'
  | 'Empático'
  | 'Confiante'
  | 'Curioso'
  | 'Irônico/Sarcástico'
  | 'Neutro';

export type VoiceTone =
  | 'Grave'
  | 'Médio'
  | 'Agudo'
  | 'Acolhedor'
  | 'Impositivo'
  | 'Provocativo'
  | 'Corporativo'
  | 'Suave';

export type VoiceRhythm =
  | 'Pausado/Lento'
  | 'Fluído/Natural'
  | 'Acelerado/Dinâmico'
  | 'Poético'
  | 'Rítmico'
  | 'Telejornalístico';

export type VoiceExpressiveness = 'Sutil' | 'Moderado' | 'Intenso' | 'Exagerado';

export type VoiceAccent =
  | 'Neutro/Sudoeste (BR)'
  | 'Nordestino (BR)'
  | 'Sulista (BR)'
  | 'Carioca (BR)'
  | 'Português (PT)'
  | 'Americano (US)'
  | 'Britânico (UK)'
  | 'Espanhol (ES)';

export type VoicePauseStyle = 'Mínimas' | 'Naturais' | 'Pontuadas' | 'Dramáticas/Extensas';

export interface VoiceDirectorConfig {
  voiceId: string; // From the 30 voices
  baseGeminiVoice: 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';
  model: string; // 'gemini-3.5-flash-lite', 'gemini-3.1-flash-tts', etc.
  language: string; // 'pt-BR', 'en-US', etc.
  style: VoiceStyle;
  emotion: VoiceEmotion;
  tone: VoiceTone;
  rhythm: VoiceRhythm;
  expressiveness: VoiceExpressiveness;
  accent: VoiceAccent;
  pauseStyle: VoicePauseStyle;
  pitch: number; // -12 to +12 (semitones / compiled into prompt)
  volume: number; // 0 to 100
  speed: number; // 0.5 to 2.0 (speed parameter)
  presetName?: string;
  customInstructions?: string;
  multiSpeakerConfig?: {
    enabled: boolean;
    speakerABName?: string;
    secondaryVoiceId?: string;
  };
}

export interface VoiceAgent {
  id: string;
  name: string;
  description: string;
  type: 'narrator' | 'transcriber' | 'hybrid';
  config: VoiceDirectorConfig;
  directorPrompt: string; // Compiled instructions sent to Gemini TTS
  sttInstructions?: string;
  isSystemDefaultTts?: boolean;
  isSystemDefaultStt?: boolean;
  createdAt: number;
  updatedAt: number;
  tagsPreferences?: string[];
}

export interface DirectorPreset {
  id: string;
  name: string;
  category: 'Cinematográfico' | 'Mídia & Notícias' | 'Conversacional' | 'Especializado' | 'Entretenimento';
  description: string;
  iconName: string;
  config: Partial<VoiceDirectorConfig>;
}

export interface AudioPlaybackState {
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackRate: number;
  currentAgentId?: string;
  error?: string | null;
}

export interface ABComparisonState {
  enabled: boolean;
  activeDeck: 'A' | 'B';
  agentA: VoiceAgent | null;
  agentB: VoiceAgent | null;
  audioAUrl: string | null;
  audioBUrl: string | null;
}
