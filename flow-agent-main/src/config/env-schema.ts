import { z } from 'zod';

export const StudioEnvSchema = z.object({
  PORT: z.coerce.number().int().min(1, 'PORT must be between 1 and 65535').max(65535).default(3000),
  LLM_PROVIDER: z.enum(['gemini', 'claude', 'openrouter', 'groq', 'openai', 'auto']).default('auto'),
  LLM_MODEL: z.string().default('gemini-2.0-flash'),
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),
  OPENROUTER_MODEL: z.string().default('nvidia/nemotron-3-ultra-550b-a55b:free'),
  LLM_BASE_URL: z.string().url('LLM_BASE_URL must be a valid URL').optional().or(z.literal('')),
  LLM_API_KEY: z.string().default(''),
  GROQ_API_KEY: z.string().default(''),
  OPENROUTER_API_KEY: z.string().default(''),
  GEMINI_API_KEY: z.string().default(''),
  FLOW_AGENT_API_URL: z.string().url('FLOW_AGENT_API_URL must be a valid URL').default('http://127.0.0.1:8001'),
  OUTPUT_FOLDER: z.string().default('./projects'),
  OUTPUT_RESOLUTION: z.string().default('1080p'),
  ASPECT_RATIO: z.enum(['landscape', 'portrait', 'square']).default('landscape'),
  PARALLEL_GENERATIONS: z.coerce.number().int().positive().default(1),
  RETRY_COUNT: z.coerce.number().int().nonnegative().default(3),
  TRANSITION_DURATION: z.coerce.number().nonnegative().default(0.5),
  DEFAULT_TRANSITION: z.enum(['none', 'fade', 'crossfade']).default('crossfade'),
  FFMPEG_ENCODER: z.enum(['libx264', 'libx265']).default('libx264'),
  AUDIO_NORMALIZATION: z.coerce.boolean().default(true),
  DRY_RUN: z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});

export type ValidatedStudioEnv = z.infer<typeof StudioEnvSchema>;

export function validateStudioEnv(env: Record<string, string | undefined> = process.env): ValidatedStudioEnv {
  const result = StudioEnvSchema.safeParse(env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`[ConfigurationError] Invalid Studio environment configuration:\n${formatted}`);
  }
  return result.data;
}
