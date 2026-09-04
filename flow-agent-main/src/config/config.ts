import path from 'path';
import dotenv from 'dotenv';
import { validateStudioEnv } from './env-schema';

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
  dryRun: boolean;
}

function resolveDefaultConfig(): AppConfig {
  const validated = validateStudioEnv(process.env);
  const resolvedOutputFolder = path.isAbsolute(validated.OUTPUT_FOLDER)
    ? validated.OUTPUT_FOLDER
    : path.resolve(process.cwd(), validated.OUTPUT_FOLDER);

  return {
    llmProvider: validated.LLM_PROVIDER,
    llmApiKey:
      validated.LLM_API_KEY ||
      validated.GROQ_API_KEY ||
      validated.OPENROUTER_API_KEY ||
      validated.GEMINI_API_KEY ||
      '',
    groqApiKey: validated.GROQ_API_KEY,
    openrouterApiKey: validated.OPENROUTER_API_KEY,
    geminiApiKey: validated.GEMINI_API_KEY,
    llmModel: validated.LLM_MODEL,
    groqModel: validated.GROQ_MODEL,
    openrouterModel: validated.OPENROUTER_MODEL,
    llmBaseUrl: validated.LLM_BASE_URL || undefined,
    flowAgentApiUrl: validated.FLOW_AGENT_API_URL,
    outputFolder: resolvedOutputFolder,
    outputResolution: validated.OUTPUT_RESOLUTION,
    aspectRatio: validated.ASPECT_RATIO,
    parallelGenerations: validated.PARALLEL_GENERATIONS,
    retryCount: validated.RETRY_COUNT,
    transitionDuration: validated.TRANSITION_DURATION,
    defaultTransition: validated.DEFAULT_TRANSITION,
    ffmpegEncoder: validated.FFMPEG_ENCODER,
    audioNormalization: validated.AUDIO_NORMALIZATION,
    port: validated.PORT,
    dryRun: validated.DRY_RUN,
  };
}

export const defaultConfig: AppConfig = resolveDefaultConfig();

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
