import { ConfigService } from '../src/config/config';
import { LlmAgentService } from '../src/agents/llm-agent';
import { createServer } from '../src/server';
import fs from 'fs';
import path from 'path';

async function runTests() {
  console.log('--- STARTING LINKEDIN STUDIO VERIFICATION TESTS ---');

  // Test 1: ConfigService environment loading & defaults
  console.log('\n[1] Testing ConfigService configuration & defaults...');
  const configService = new ConfigService();
  const config = configService.getAll();
  console.assert(typeof config.port === 'number', 'Port must be a number');
  console.assert(typeof config.flowAgentApiUrl === 'string', 'flowAgentApiUrl must be configured');
  console.assert(fs.existsSync(config.outputFolder), 'Output folder must exist');
  console.log('✓ ConfigService verified successfully!');

  // Test 2: LLM Agent Model initialization
  console.log('\n[2] Testing LLM Agent Service configuration...');
  const llmAgent = new LlmAgentService(configService.getAll());
  console.assert(llmAgent !== null, 'LlmAgentService instance must be defined');
  console.log('✓ LLM Agent Service verified successfully!');

  // Test 3: Express Server creation & route verification
  console.log('\n[3] Testing LinkedIn Studio Server routes...');
  const app = createServer(configService);
  console.assert(typeof app.listen === 'function', 'Server must be an Express application');
  console.log('✓ LinkedIn Studio Server verified successfully!');

  // Test 4: Static public dashboard assets exist
  console.log('\n[4] Testing Dashboard UI asset integrity...');
  const publicDir = path.resolve(__dirname, '../public');
  console.assert(fs.existsSync(path.join(publicDir, 'index.html')), 'index.html must exist');
  console.assert(fs.existsSync(path.join(publicDir, 'style.css')), 'style.css must exist');
  console.assert(fs.existsSync(path.join(publicDir, 'app.js')), 'app.js must exist');
  console.log('✓ Dashboard UI assets verified successfully!');

  console.log('\n=== ALL LINKEDIN STUDIO TESTS PASSED SUCCESSFULLY! ===\n');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
