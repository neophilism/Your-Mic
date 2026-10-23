import vinext from 'vinext';
import {defineConfig} from 'vite';
import {cloudflare} from '@cloudflare/vite-plugin';

// Independent hosting. The default vite.config.ts remains the Sites workflow.
export default defineConfig({
  plugins: [
    vinext(),
    cloudflare({
      configPath: './wrangler.cloudflare.jsonc',
      viteEnvironment: {name: 'rsc', childEnvironments: ['ssr']},
      inspectorPort: false,
    }),
  ],
});
