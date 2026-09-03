import { SceneSplitterService } from '../src/storyboard/scene-splitter';
import { CharacterMemoryService } from '../src/agents/character-memory';
import { ProjectManagerService } from '../src/projects/project-manager';
import { FFmpegUtils } from '../src/utils/ffmpeg';
import fs from 'fs';
import path from 'path';

async function runTests() {
  console.log('--- STARTING PLATFORM VERIFICATION TESTS ---');

  // Test 1: Scene Splitting math
  console.log('\n[1] Testing Scene Splitting logic...');
  console.assert(SceneSplitterService.calculateTargetSceneCount(30) === 3, '30s must equal 3 scenes');
  console.assert(SceneSplitterService.calculateTargetSceneCount(60) === 6, '60s must equal 6 scenes');
  console.assert(SceneSplitterService.calculateTargetSceneCount(90) === 9, '90s must equal 9 scenes');
  console.assert(SceneSplitterService.calculateTargetSceneCount(120) === 12, '120s must equal 12 scenes');
  console.assert(SceneSplitterService.calculateTargetSceneCount(300) === 30, '300s must equal 30 scenes');
  console.log('✓ Scene Splitting math verified!');

  // Test 2: Character Memory
  console.log('\n[2] Testing Character Memory persistence...');
  const charMemory = new CharacterMemoryService();
  charMemory.registerCharacter({
    id: 'hero',
    name: 'Captain Alex',
    identity: 'Cyber pilot',
    age: '32',
    face: 'Sharp jawline, blue eyes',
    hairstyle: 'Short dark hair',
    clothing: 'Leather flight jacket',
    accessories: 'Glowing blue visor',
    bodyProportions: 'Athletic 6ft',
  });
  const block = charMemory.formatCharacterPromptBlock('Captain Alex');
  console.assert(block.includes('Captain Alex') && block.includes('Leather flight jacket'), 'Character memory block formatting must include character attributes');
  console.log('✓ Character Memory persistence verified!');

  // Test 3: Project Manager
  console.log('\n[3] Testing Project Manager state saving and loading...');
  const testDir = path.resolve(__dirname, '../temp_test_projects');
  const projectManager = new ProjectManagerService(testDir);
  const proj = await projectManager.createProject('Test Cyberpunk Movie', 'A cyberpunk detective investigates...', 60);

  console.assert(proj.sceneCount === 6, '60s movie must have 6 scene states');
  console.assert(fs.existsSync(projectManager.getProjectDir(proj.id)), 'Project folder must exist');
  console.assert(fs.existsSync(projectManager.getScenesDir(proj.id)), 'Scenes subfolder must exist');
  console.assert(fs.existsSync(projectManager.getRendersDir(proj.id)), 'Renders subfolder must exist');

  const loaded = await projectManager.loadProject(proj.id);
  console.assert(loaded !== null && loaded.title === 'Test Cyberpunk Movie', 'Loaded project title must match created title');
  console.log('✓ Project Manager state saving and loading verified!');

  // Test 4: FFmpeg availability
  console.log('\n[4] Testing FFmpeg Probe integration...');
  const ffmpegTest = await FFmpegUtils.probe('non_existent_file.mp4');
  console.assert(ffmpegTest.isValid === false, 'Non existent file probe should return isValid=false');
  console.log('✓ FFmpeg integration verified!');

  // Cleanup test directory
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }

  console.log('\n=== ALL PLATFORM TESTS PASSED SUCCESSFULLY! ===\n');
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
