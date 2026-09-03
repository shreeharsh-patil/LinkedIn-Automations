export interface StoryboardScene {
  scene: number;
  duration: number; // Always 10
  camera: string;
  environment: string;
  character: string;
  action: string;
  dialogue?: string;
  audio?: string;
  transition?: string;
}

export interface StoryboardData {
  title: string;
  style: string;
  duration: number; // Total duration in seconds (e.g. 30, 60, 90, 120, 300)
  sceneDuration: number; // Always 10
  characters?: Array<{
    name: string;
    identity: string;
    age: string;
    face: string;
    hairstyle: string;
    clothing: string;
    accessories: string;
    bodyProportions: string;
  }>;
  scenes: StoryboardScene[];
}

export class SceneSplitterService {
  public static SCENE_DURATION = 10;

  /**
   * Validates and normalizes storyboard scenes to ensure every scene is exactly 10 seconds,
   * matching total target duration.
   */
  public static calculateTargetSceneCount(totalDurationSeconds: number): number {
    const validDuration = Math.max(10, Math.ceil(totalDurationSeconds / 10) * 10);
    return validDuration / this.SCENE_DURATION;
  }

  public static normalizeScenes(storyboard: StoryboardData, targetTotalDuration?: number): StoryboardData {
    const totalDuration = targetTotalDuration || storyboard.duration || 60;
    const requiredSceneCount = this.calculateTargetSceneCount(totalDuration);

    const scenes: StoryboardScene[] = [];
    const rawScenes = storyboard.scenes || [];

    for (let i = 0; i < requiredSceneCount; i++) {
      const sceneNum = i + 1;
      const existing = rawScenes[i];

      if (existing) {
        scenes.push({
          scene: sceneNum,
          duration: this.SCENE_DURATION,
          camera: existing.camera || 'Cinematic medium shot with subtle movement',
          environment: existing.environment || storyboard.style || 'High detail cinematic environment',
          character: existing.character || 'Main character',
          action: existing.action || 'Performing action in scene',
          dialogue: existing.dialogue || '',
          audio: existing.audio || 'Ambient sound effects',
          transition: existing.transition || 'fade',
        });
      } else {
        // Synthesize continuation scene if LLM provided fewer scenes than required
        const lastScene = scenes[scenes.length - 1];
        scenes.push({
          scene: sceneNum,
          duration: this.SCENE_DURATION,
          camera: lastScene ? `Tracking shot continuing scene ${sceneNum - 1}` : 'Cinematic wide shot',
          environment: lastScene ? lastScene.environment : storyboard.style,
          character: lastScene ? lastScene.character : 'Main character',
          action: lastScene ? `Continuing motion from scene ${sceneNum - 1}` : 'Action sequence',
          dialogue: '',
          audio: lastScene ? lastScene.audio : 'Cinematic atmosphere',
          transition: 'fade',
        });
      }
    }

    return {
      title: storyboard.title || 'Untitled Movie',
      style: storyboard.style || 'Cinematic 8K Photorealistic',
      duration: requiredSceneCount * this.SCENE_DURATION,
      sceneDuration: this.SCENE_DURATION,
      characters: storyboard.characters || [],
      scenes,
    };
  }
}
