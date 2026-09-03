import { LlmAgentService } from '../agents/llm-agent';
import { CharacterMemoryService, CharacterProfile } from '../agents/character-memory';
import { SceneSplitterService, StoryboardData, StoryboardScene } from './scene-splitter';
import { logger } from '../utils/logger';

export class StoryboardGeneratorService {
  private llmAgent: LlmAgentService;
  private characterMemory: CharacterMemoryService;

  constructor(llmAgent: LlmAgentService, characterMemory: CharacterMemoryService) {
    this.llmAgent = llmAgent;
    this.characterMemory = characterMemory;
  }

  public async generateStoryboard(
    userPromptOrScript: string,
    targetDurationSeconds: number = 60,
    stylePreference?: string,
    projectId?: string
  ): Promise<StoryboardData> {
    const sceneCount = SceneSplitterService.calculateTargetSceneCount(targetDurationSeconds);
    const durationSec = sceneCount * 10;

    logger.info(
      `Generating storyboard for duration ${durationSec}s (${sceneCount} scenes of 10s each)...`,
      projectId
    );

    if (this.llmAgent.hasValidApiKey()) {
      try {
        const systemPrompt = `You are an elite Hollywood director, cinematographer, and AI film architect.
Your task is to take a prompt or script and expand it into a complete, structured film storyboard JSON.

Target total duration: ${durationSec} seconds.
Required exact scene count: ${sceneCount} scenes.
Each scene MUST be exactly 10 seconds.

Return JSON in this EXACT structure:
{
  "title": "Short title of the film",
  "style": "Overall visual & artistic style",
  "duration": ${durationSec},
  "sceneDuration": 10,
  "characters": [
    {
      "name": "Character Name",
      "identity": "Brief identity summary",
      "age": "Age range",
      "face": "Detailed facial features",
      "hairstyle": "Exact hair color, cut, style",
      "clothing": "Exact outfit details",
      "accessories": "Glasses, armor, jewelry",
      "bodyProportions": "Height, build"
    }
  ],
  "scenes": [
    {
      "scene": 1,
      "duration": 10,
      "camera": "Cinematic camera movement",
      "environment": "Environment details, background, weather",
      "character": "Character present and position",
      "action": "Specific key action during 10 seconds",
      "dialogue": "Character dialogue if any",
      "audio": "Sound effects and ambient sound",
      "transition": "fade"
    }
  ]
}

STRICT RULE: The "scenes" array MUST contain EXACTLY ${sceneCount} items.`;

        const userMessage = `Movie Request / Script:
"${userPromptOrScript}"

${stylePreference ? `Preferred Style: ${stylePreference}` : ''}

Generate the structured film storyboard JSON now.`;

        const rawResult = await this.llmAgent.generateJson<StoryboardData>(userMessage, systemPrompt);
        const normalized = SceneSplitterService.normalizeScenes(rawResult, durationSec);

        // Register character profiles into memory
        this.characterMemory.clear();
        if (normalized.characters && normalized.characters.length > 0) {
          for (const c of normalized.characters) {
            const profile: CharacterProfile = {
              id: c.name.toLowerCase().replace(/\s+/g, '-'),
              name: c.name,
              identity: c.identity || 'Protagonist',
              age: c.age || '30s',
              face: c.face || 'Defined facial features',
              hairstyle: c.hairstyle || 'Dark hair',
              clothing: c.clothing || 'Cinematic costume',
              accessories: c.accessories || 'None',
              bodyProportions: c.bodyProportions || 'Average build',
            };
            this.characterMemory.registerCharacter(profile);
            logger.info(`Registered persistent character memory for: [${c.name}]`, projectId);
          }
        }

        logger.success(`Successfully generated storyboard "${normalized.title}" via LLM with ${normalized.scenes.length} scenes.`, projectId);
        return normalized;
      } catch (err: any) {
        logger.warn(
          `LLM Storyboard Generation notice (${err.message}). Switching to autonomous built-in cinematic storyboard builder...`,
          projectId
        );
      }
    } else {
      logger.info(
        `No LLM API Key provided. Using autonomous built-in cinematic storyboard builder for prompt...`,
        projectId
      );
    }

    // Fallback: Autonomous Storyboard Builder
    return this.buildFallbackStoryboard(userPromptOrScript, sceneCount, stylePreference, projectId);
  }

  private buildFallbackStoryboard(
    userPromptOrScript: string,
    sceneCount: number,
    stylePreference?: string,
    projectId?: string
  ): StoryboardData {
    const style = stylePreference || 'Cinematic 8K Photorealistic, IMAX 70mm, volumetric lighting';
    const mainCharacter: CharacterProfile = {
      id: 'protagonist',
      name: 'Protagonist',
      identity: 'Hero character',
      age: '30s',
      face: 'Distinct sharp features, clear expressive eyes',
      hairstyle: 'Modern styled dark hair',
      clothing: 'Detailed cinematic attire with rich textures',
      accessories: 'Signature emblem and wrist watch',
      bodyProportions: 'Athletic proportioned build',
    };

    this.characterMemory.clear();
    this.characterMemory.registerCharacter(mainCharacter);

    const title = userPromptOrScript.split('\n')[0].substring(0, 40) || 'AI Movie Project';
    const scenes: StoryboardScene[] = [];

    const cameraMovements = [
      'Establishing wide angle shot with dramatic low perspective',
      'Slow tracking push-in shot focusing on central character motion',
      'Dynamic medium tracking pan with shallow depth of field',
      'Cinematic over-the-shoulder orbital camera arc',
      'High-angle wide atmospheric camera movement',
      'Close-up dramatic tilt revealing environmental details',
    ];

    for (let i = 1; i <= sceneCount; i++) {
      const cam = cameraMovements[(i - 1) % cameraMovements.length];
      scenes.push({
        scene: i,
        duration: 10,
        camera: cam,
        environment: `High-detail scene environment, atmospheric depth, ${style}`,
        character: mainCharacter.name,
        action: `Scene ${i} sequence: ${userPromptOrScript.substring(0, 100)} (Part ${i}/${sceneCount})`,
        dialogue: i === 1 ? 'Let us begin.' : '',
        audio: 'Cinematic soundtrack score with rich ambient sound effects',
        transition: 'fade',
      });
    }

    const storyboard: StoryboardData = {
      title,
      style,
      duration: sceneCount * 10,
      sceneDuration: 10,
      characters: [mainCharacter],
      scenes,
    };

    logger.success(`Autonomous storyboard created with ${sceneCount} scenes (10s each).`, projectId);
    return storyboard;
  }
}
