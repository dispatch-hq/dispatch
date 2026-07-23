// src/commands/profile.ts
import { Command } from 'discord-hono'
import { factory } from '../init'

const IS_COMPONENTS_V2 = 32768

export const command_profile = factory.command(
  new Command('profile', 'Displays user stats using Components V2 UI'),
  (c) => {
    return c.res({
      flags: IS_COMPONENTS_V2,
      components: [
        {
          type: 17, // Container
          accent_color: 0x5865F2,
          components: [
            {
              type: 10, // Text Display
              content: '# ⚡ Dispatch Bot Profile\nModern app interface running on Cloudflare Edge.'
            },
            {
              type: 14, // Separator
              divider: true,
              spacing: 1
            },
            {
              type: 10, // Text Display directly in the Container!
              content: '**Status:** Operational 🔥\n**Runtime:** Cloudflare Workers\n**Tier:** Free Scale'
            },
            {
              type: 14, // Separator
              divider: true
            },
            {
              type: 1, // Action Row
              components: [
                {
                  type: 2, // Button
                  style: 5,
                  label: 'Documentation',
                  url: 'https://discord-hono.luis.fun'
                }
              ]
            }
          ]
        }
      ]
    })
  }
)