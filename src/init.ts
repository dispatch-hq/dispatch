import { createFactory } from 'discord-hono';
import type { AppEnv } from './types';

export const factory = createFactory<AppEnv>();