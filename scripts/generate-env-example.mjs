import { writeFileSync } from 'node:fs';
import { renderEnvExample } from './env-example.mjs';

writeFileSync(new URL('../.env.example', import.meta.url), renderEnvExample());
