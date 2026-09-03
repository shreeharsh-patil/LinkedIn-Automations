import { StoryboardScene, StoryboardData } from '../storyboard/scene-splitter';
import { CharacterMemoryService } from '../agents/character-memory';
import { LlmAgentService } from '../agents/llm-agent';
import { logger } from '../utils/logger';

export interface OptimizedPromptResult {
  sceneNumber: number;
  flowPrompt: string;
  negativePrompt: string;
  inheritedContext: string;
  cameraMovement: string;
  lighting: string;
}

export class PromptGeneratorService {
  private llmAgent: LlmAgentService;
  private characterMemory: CharacterMemoryService;

  constructor(llmAgent: LlmAgentService, characterMemory: CharacterMemoryService) {
    this.llmAgent = llmAgent;
    this.characterMemory = characterMemory;
  }

  public async generateScenePrompt(
    scene: StoryboardScene,
    storyboard: StoryboardData,
    previousSceneResult?: OptimizedPromptResult,
    projectId?: string
  ): Promise<OptimizedPromptResult> {
    logger.info(`Generating optimized Google Flow prompt for Scene ${scene.scene}...`, projectId);

    const characterBlock = this.characterMemory.formatCharacterPromptBlock(scene.character);
    const prevContext = previousSceneResult
      ? `Previous Scene (${previousSceneResult.sceneNumber}) visual baseline: "${previousSceneResult.flowPrompt}"`
      : 'First scene in the film.';

    const systemPrompt = `You are a world-class prompt engineer specializing in Google Flow AI video generation.
Google Flow works best with rich, vivid, multi-sensory cinematic prompts that describe camera, environment, character consistency, lighting, action, motion, dialogue, and mood.

Your goal is to output an optimized Google Flow video prompt for Scene ${scene.scene} (10 seconds duration).

Ensure the prompt explicitly incorporates:
1. Character consistency (reusing exact facial features, hair, clothing, accessories, age, body proportions)
2. Environment & architectural context
3. Camera movement & lens framing (e.g. 35mm lens, dynamic panning, slow push-in)
4. Cinematic composition (e.g. rule of thirds, low angle, atmospheric depth)
5. Dynamic animation & fluid action (10-second motion pace)
6. Lighting & atmosphere (e.g. volumetric neon rim lighting, golden hour rays, dramatic shadows)
7. Character outfit, hairstyle, facial expressions
8. Action & dialogue performance cues
9. Audio environment description (ambient sound, soundtrack vibe)

Inherit visual continuity from previous scenes.

Return JSON in this format:
{
  "flowPrompt": "The complete, highly detailed Google Flow video prompt (150-300 words).",
  "negativePrompt": "blurry, low quality, deformed faces, sudden jumps, flickering, extra limbs, static image, text, watermark",
  "cameraMovement": "Camera spec string",
  "lighting": "Lighting spec string"
}`;

    const userPrompt = `Film Title: ${storyboard.title}
Overall Visual Style: ${storyboard.style}
Current Scene (${scene.scene}/${storyboard.scenes.length}):
- Character: ${scene.character}
- Camera: ${scene.camera}
- Environment: ${scene.environment}
- Action: ${scene.action}
- Dialogue: ${scene.dialogue || 'None'}
- Audio: ${scene.audio || 'Ambient sound'}

Character Memory:
${characterBlock}

Inherited Continuity:
${prevContext}

Generate the optimized Google Flow prompt JSON now.`;

    try {
      const res = await this.llmAgent.generateJson<{
        flowPrompt: string;
        negativePrompt: string;
        cameraMovement: string;
        lighting: string;
      }>(userPrompt, systemPrompt);

      const rawPrompt = res.flowPrompt || this.buildFallbackPrompt(scene, storyboard, characterBlock);
      const cleanFlowPrompt = this.sanitizeAndTruncate(rawPrompt, 600);

      const result: OptimizedPromptResult = {
        sceneNumber: scene.scene,
        flowPrompt: cleanFlowPrompt,
        negativePrompt: this.sanitizeAndTruncate(res.negativePrompt || 'blurry, low quality, distorted, watermark', 200),
        inheritedContext: prevContext,
        cameraMovement: this.sanitizeAndTruncate(res.cameraMovement || scene.camera, 100),
        lighting: this.sanitizeAndTruncate(res.lighting || 'Cinematic lighting', 100),
      };

      logger.success(`Optimized prompt generated for Scene ${scene.scene}.`, projectId);
      return result;
    } catch (err: any) {
      logger.warn(`LLM prompt optimization failed (${err.message}). Using structured fallback prompt.`, projectId);
      const fallbackPrompt = this.sanitizeAndTruncate(this.buildFallbackPrompt(scene, storyboard, characterBlock), 600);
      return {
        sceneNumber: scene.scene,
        flowPrompt: fallbackPrompt,
        negativePrompt: 'blurry, low quality, deformed, static, text, watermark',
        inheritedContext: prevContext,
        cameraMovement: scene.camera,
        lighting: 'Cinematic lighting',
      };
    }
  }

  private sanitizeAndTruncate(str: string, maxChars: number): string {
    let cleaned = (str || '').replace(/"/g, "'").replace(/\s+/g, ' ').trim();
    if (cleaned.length <= maxChars) return cleaned;
    const truncated = cleaned.substring(0, maxChars);
    const lastPeriod = truncated.lastIndexOf('.');
    if (lastPeriod > 150) {
      return truncated.substring(0, lastPeriod + 1);
    }
    const lastSpace = truncated.lastIndexOf(' ');
    return (lastSpace > 100 ? truncated.substring(0, lastSpace) : truncated) + '...';
  }

  private buildFallbackPrompt(
    scene: StoryboardScene,
    storyboard: StoryboardData,
    characterBlock: string
  ): string {
    return `${storyboard.style}. Scene ${scene.scene}: ${scene.action}. Set in ${scene.environment}. ${characterBlock}. Camera: ${scene.camera}. Lighting: Cinematic atmospheric lighting, 8k resolution, photorealistic fluid 10-second animation. Audio: ${scene.audio || 'ambient noise'}.`;
  }
}
