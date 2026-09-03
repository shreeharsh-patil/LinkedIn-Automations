import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export type LLMProvider = 'gemini' | 'claude' | 'openrouter' | 'groq' | 'openai' | 'auto';
export type AspectRatio = 'landscape' | 'portrait' | 'square';
export type FFmpegEncoder = 'libx264' | 'libx265';
export type TransitionType = 'none' | 'fade' | 'crossfade';

export interface AppConfig {
  llmProvider: LLMProvider;
  llmApiKey: string;
  groqApiKey: string;
  openrouterApiKey: string;
  geminiApiKey: string;
  llmModel: string;
  groqModel: string;
  openrouterModel: string;
  llmBaseUrl?: string;
  flowAgentApiUrl: string;
  outputFolder: string;
  outputResolution: string;
  aspectRatio: AspectRatio;
  parallelGenerations: number;
  retryCount: number;
  transitionDuration: number;
  defaultTransition: TransitionType;
  ffmpegEncoder: FFmpegEncoder;
  audioNormalization: boolean;
  port: number;
}

export const defaultConfig: AppConfig = {
  llmProvider: (process.env.LLM_PROVIDER as LLMProvider) || 'auto',
  llmApiKey: process.env.LLM_API_KEY || process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || '',
  groqApiKey: process.env.GROQ_API_KEY || '',
  openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  llmModel: process.env.LLM_MODEL || 'llama-3.3-70b-versatile',
  groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  openrouterModel: process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b:free',
  llmBaseUrl: process.env.LLM_BASE_URL,
  flowAgentApiUrl: process.env.FLOW_AGENT_API_URL || 'http://127.0.0.1:8001',
  outputFolder: process.env.OUTPUT_FOLDER || path.resolve(process.cwd(), 'projects'),
  outputResolution: process.env.OUTPUT_RESOLUTION || '1080p',
  aspectRatio: (process.env.ASPECT_RATIO as AspectRatio) || 'landscape',
  parallelGenerations: parseInt(process.env.PARALLEL_GENERATIONS || '1', 10),
  retryCount: parseInt(process.env.RETRY_COUNT || '3', 10),
  transitionDuration: parseFloat(process.env.TRANSITION_DURATION || '0.5'),
  defaultTransition: (process.env.DEFAULT_TRANSITION as TransitionType) || 'crossfade',
  ffmpegEncoder: (process.env.FFMPEG_ENCODER as FFmpegEncoder) || 'libx264',
  audioNormalization: process.env.AUDIO_NORMALIZATION !== 'false',
  port: parseInt(process.env.PORT || '3000', 10),
};

export class ConfigService {
  private config: AppConfig;

  constructor(customConfig?: Partial<AppConfig>) {
    this.config = { ...defaultConfig, ...customConfig };
  }

  public get<K extends keyof AppConfig>(key: K): AppConfig[K] {
    return this.config[key];
  }

  public getAll(): AppConfig {
    return { ...this.config };
  }

  public update(customConfig: Partial<AppConfig>): AppConfig {
    this.config = { ...this.config, ...customConfig };
    return this.getAll();
  }
}
