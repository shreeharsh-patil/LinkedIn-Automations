import axios from 'axios';
import { AppConfig } from '../config/config';
import { logger } from '../utils/logger';

export class LlmAgentService {
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  public hasValidApiKey(): boolean {
    const { llmApiKey, groqApiKey, openrouterApiKey, geminiApiKey } = this.config;
    return !!(
      (llmApiKey && llmApiKey.trim().length > 0) ||
      (groqApiKey && groqApiKey.trim().length > 0) ||
      (openrouterApiKey && openrouterApiKey.trim().length > 0) ||
      (geminiApiKey && geminiApiKey.trim().length > 0)
    );
  }

  public async generateText(prompt: string, systemPrompt?: string): Promise<string> {
    const { groqApiKey, openrouterApiKey, geminiApiKey, llmApiKey, llmProvider } = this.config;

    const attempts: Array<{ provider: string; fn: () => Promise<string> }> = [];

    const geminiKey = geminiApiKey || (llmProvider === 'gemini' || llmProvider === 'auto' ? llmApiKey : '');
    if (geminiKey && geminiKey.trim().length > 0 && !geminiKey.startsWith('gsk_') && !geminiKey.startsWith('sk-or-')) {
      attempts.push({
        provider: 'gemini',
        fn: () => this.callGemini(prompt, systemPrompt, geminiKey.trim(), this.config.llmModel),
      });
    }

    const groqKey = groqApiKey || (llmProvider === 'groq' || (llmProvider === 'auto' && llmApiKey.startsWith('gsk_')) ? llmApiKey : '');
    if (groqKey && groqKey.trim().length > 0) {
      attempts.push({
        provider: 'groq',
        fn: () => this.callGroq(prompt, systemPrompt, groqKey.trim()),
      });
    }

    const openrouterKey = openrouterApiKey || (llmProvider === 'openrouter' || (llmProvider === 'auto' && llmApiKey.startsWith('sk-or-')) ? llmApiKey : '');
    if (openrouterKey && openrouterKey.trim().length > 0) {
      attempts.push({
        provider: 'openrouter',
        fn: () => this.callOpenRouter(prompt, systemPrompt, openrouterKey.trim()),
      });
    }

    if (llmProvider === 'openai' && llmApiKey) {
      attempts.push({
        provider: 'openai',
        fn: () =>
          this.callOpenAICompatible(
            this.config.llmBaseUrl || 'https://api.openai.com/v1/chat/completions',
            prompt,
            systemPrompt,
            llmApiKey,
            this.config.llmModel || 'gpt-4o'
          ),
      });
    }

    if (attempts.length === 0) {
      throw new Error(
        'No valid LLM API Key found (Groq, OpenRouter, Gemini, or OpenAI). Please provide an API key.'
      );
    }

    let lastError: Error | null = null;
    for (let i = 0; i < attempts.length; i++) {
      try {
        return await attempts[i].fn();
      } catch (err: any) {
        lastError = err;
        logger.warn(`LLM provider '${attempts[i].provider}' attempt ${i + 1}/${attempts.length} failed (${err.message}). Trying next provider in failover chain...`);
      }
    }

    throw lastError || new Error('All LLM providers in failover chain failed');
  }

  public async generateJson<T = any>(prompt: string, systemPrompt?: string): Promise<T> {
    const jsonSystemPrompt = `${systemPrompt || ''}\n\nCRITICAL INSTRUCTION: You MUST reply ONLY with valid JSON matching the requested structure. Ensure all string values escape internal double quotes (e.g. use 5'8in. or 5'8\\" instead of unescaped quotes). Do NOT include markdown code blocks, explanation, or conversational commentary. Output MUST start with { and end with }.`;
    const responseText = await this.generateText(prompt, jsonSystemPrompt);

    let cleaned = responseText.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const jsonMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
    }

    try {
      return JSON.parse(cleaned) as T;
    } catch (initialErr: any) {
      try {
        const repaired = this.repairAndParseJson<T>(cleaned);
        logger.info('Successfully repaired dirty LLM JSON response.');
        return repaired;
      } catch (repairErr: any) {
        logger.error(`Failed to parse LLM JSON response: ${initialErr.message}. Response was:\n${responseText}`);
        throw new Error(`LLM generated invalid JSON: ${initialErr.message}`);
      }
    }
  }

  private repairAndParseJson<T>(str: string): T {
    // Attempt 1: Remove trailing commas
    let cleaned = str.replace(/,\s*([\}\]])/g, '$1');
    try {
      return JSON.parse(cleaned) as T;
    } catch {}

    // Attempt 2: Fix unescaped measurement quotes like 5'8" -> 5'8in.
    cleaned = cleaned.replace(/(\d+)'(\d+)"/g, '$1\'$2in.');
    try {
      return JSON.parse(cleaned) as T;
    } catch {}

    // Attempt 3: Line-by-line repair of unescaped double quotes inside JSON string property values
    const lines = str.split('\n');
    const repairedLines = lines.map((line) => {
      const match = line.match(/^(\s*"[^"]+"\s*:\s*")([\s\S]*)("(?:\s*,)?\s*)$/);
      if (match) {
        const prefix = match[1];
        const content = match[2];
        const suffix = match[3];
        const fixedContent = content.replace(/(?<!\\)"/g, '\\"');
        return `${prefix}${fixedContent}${suffix}`;
      }
      return line;
    });

    return JSON.parse(repairedLines.join('\n')) as T;
  }

  private async callGroq(prompt: string, systemPrompt: string | undefined, apiKey: string): Promise<string> {
    logger.debug(`Calling Groq API (free high-speed models)...`);
    const models = Array.from(
      new Set([
        this.config.groqModel || 'llama-3.3-70b-versatile',
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant',
      ])
    );

    let lastError: Error | null = null;
    for (const model of models) {
      try {
        const text = await this.callOpenAICompatible(
          'https://api.groq.com/openai/v1/chat/completions',
          prompt,
          systemPrompt,
          apiKey,
          model
        );
        logger.success(`Groq API response received successfully (${model})`);
        return text;
      } catch (err: any) {
        lastError = err;
      }
    }
    throw lastError || new Error('Groq API calls failed');
  }

  private async callOpenRouter(prompt: string, systemPrompt: string | undefined, apiKey: string): Promise<string> {
    logger.debug(`Calling OpenRouter API...`);
    const freeModels = [
      this.config.openrouterModel || 'nvidia/nemotron-3-ultra-550b-a55b:free',
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'nvidia/llama-3.1-nemotron-70b-instruct:free',
      'meta-llama/llama-3.3-70b-instruct',
      'meta-llama/llama-3.1-8b-instruct',
      'mistralai/mistral-7b-instruct',
    ];

    let lastError: Error | null = null;
    for (const model of freeModels) {
      try {
        const text = await this.callOpenAICompatible(
          'https://openrouter.ai/api/v1/chat/completions',
          prompt,
          systemPrompt,
          apiKey,
          model
        );
        logger.success(`OpenRouter API response received successfully (${model})`);
        return text;
      } catch (err: any) {
        lastError = err;
      }
    }
    throw lastError || new Error('OpenRouter API calls failed');
  }

  public async generateVisionCaption(
    imageBase64: string,
    mimeType: string = 'image/png',
    prompt?: string,
    systemPrompt?: string
  ): Promise<string> {
    const { geminiApiKey, llmApiKey, llmProvider } = this.config;
    const cleanBase64 = imageBase64.includes('base64,') ? imageBase64.split('base64,')[1] : imageBase64;
    const geminiKey = geminiApiKey || (llmProvider === 'gemini' || llmProvider === 'auto' ? llmApiKey : '');

    const finalSystemPrompt =
      systemPrompt ||
      `You are a principal software engineer, system architect, and technical author.
Analyze the provided technical image (diagram, benchmark, code, flowchart, or schema).
Write an educational, high-density, informative LinkedIn post that breaks down what this image shows.
STRICT RULES:
1. Write like an engineer documenting a real system or technical breakthrough.
2. Tone: Objective, analytical, educational. No emojis.
3. Completely avoid marketing fluff, fake hype, or engagement bait ("Agree?", "Thoughts?", "Let that sink in", "99% get this wrong").
4. Explain key components, data flow, trade-offs, and architectural significance visible in the image.
5. Length: 150-250 words.
6. Add 2-3 relevant tech hashtags at the end.`;

    const userPrompt =
      prompt ||
      `Analyze this image in detail. Extract all technical facts, architectural nodes, benchmark figures, and mechanisms, and write a structured, high-density engineering breakdown post.`;

    if (geminiKey && geminiKey.trim().length > 0 && !geminiKey.startsWith('gsk_') && !geminiKey.startsWith('sk-or-')) {
      const modelsToTry = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
      for (const endpointModel of modelsToTry) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${endpointModel}:generateContent?key=${geminiKey.trim()}`;
          const contents = [
            {
              role: 'user',
              parts: [
                { text: `${finalSystemPrompt}\n\n${userPrompt}` },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: cleanBase64,
                  },
                },
              ],
            },
          ];

          const res = await axios.post(
            url,
            { contents },
            { headers: { 'Content-Type': 'application/json' }, timeout: 45000 }
          );
          const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text && text.trim()) {
            logger.success(`Gemini Vision API response received successfully (${endpointModel})`);
            return text.trim();
          }
        } catch (err: any) {
          logger.warn(`Gemini Vision model ${endpointModel} failed: ${err.message}`);
        }
      }
    }

    // Try OpenAI compatible / OpenRouter vision if configured
    if (this.config.llmApiKey || this.config.openrouterApiKey) {
      const key = (this.config.openrouterApiKey || this.config.llmApiKey || '').trim();
      const isOR = !!this.config.openrouterApiKey || key.startsWith('sk-or-');
      const endpoint = isOR
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : this.config.llmBaseUrl || 'https://api.openai.com/v1/chat/completions';

      const visionModels = isOR
        ? [
            'dots-studio/dots-3-note-preview:free',
            'google/gemini-2.0-flash-exp:free',
            'meta-llama/llama-3.2-11b-vision-instruct:free',
            'google/gemini-2.0-flash-001',
            'google/gemini-flash-1.5',
          ]
        : [this.config.llmModel || 'gpt-4o'];

      for (const model of visionModels) {
        try {
          const res = await axios.post(
            endpoint,
            {
              model,
              messages: [
                { role: 'system', content: finalSystemPrompt },
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: userPrompt },
                    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${cleanBase64}` } },
                  ],
                },
              ],
            },
            {
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
              timeout: 45000,
            }
          );
          const text = res.data?.choices?.[0]?.message?.content;
          if (text && text.trim()) {
            logger.success(`Vision API response received successfully (${model})`);
            return text.trim();
          }
        } catch (err: any) {
          logger.warn(`Vision model ${model} failed: ${err.message}`);
        }
      }
    }

    throw new Error(
      'Gemini Vision API requires a valid GEMINI_API_KEY (or Gemini/OpenAI vision key). Please configure it in settings or .env.'
    );
  }

  private async callGemini(prompt: string, systemPrompt: string | undefined, apiKey: string, model: string): Promise<string> {
    logger.debug(`Calling Gemini API...`);
    const isGeminiModel = model && model.toLowerCase().includes('gemini');
    const primaryModel = isGeminiModel ? model : 'gemini-2.0-flash';
    const modelsToTry = [primaryModel, 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
    const uniqueModels = Array.from(new Set(modelsToTry));

    let lastError: Error | null = null;

    for (const endpointModel of uniqueModels) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${endpointModel}:generateContent?key=${apiKey}`;

      const contents: any[] = [];
      if (systemPrompt) {
        contents.push({ role: 'user', parts: [{ text: systemPrompt }] });
        contents.push({ role: 'model', parts: [{ text: 'Understood. I will follow your system instructions strictly.' }] });
      }
      contents.push({ role: 'user', parts: [{ text: prompt }] });

      try {
        const res = await axios.post(url, { contents }, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 });
        const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          throw new Error('Empty response from Gemini API');
        }
        logger.success(`Gemini API response received successfully (${endpointModel})`);
        return text;
      } catch (err: any) {
        const msg = err.response?.data?.error?.message || err.message;
        lastError = new Error(`Gemini API error (${endpointModel}): ${msg}`);
      }
    }

    throw lastError || new Error('Gemini API call failed for all model candidates');
  }

  private async callOpenAICompatible(url: string, prompt: string, systemPrompt: string | undefined, apiKey: string, model: string): Promise<string> {
    const messages: any[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    try {
      const res = await axios.post(
        url,
        {
          model,
          messages,
          temperature: 0.7,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: 30000,
        }
      );
      const text = res.data?.choices?.[0]?.message?.content;
      if (!text) {
        throw new Error('Empty response from LLM API');
      }
      return text;
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || err.message;
      throw new Error(`LLM API error (${model}): ${msg}`);
    }
  }
}
