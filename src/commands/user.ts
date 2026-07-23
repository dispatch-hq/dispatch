import { Command, SubCommand, Option } from 'discord-hono'
import { APIChatInputApplicationCommandInteraction, APIUser } from 'discord-api-types/v10'
import { factory } from '../init'

const IS_COMPONENTS_V2 = 32768

export const command_user = factory.command(
  new Command('user', 'User utility commands').options(
    new SubCommand('info', 'Fetch user profile & account details').options(
      new Option('user', 'The user to inspect', 'User').required()
    )
  ),
  (c) => {
    if (c.sub.command === 'info') {
      const userId = c.var.user
      const interaction = c.interaction as APIChatInputApplicationCommandInteraction

      // Extract resolved user object safely
      const user: APIUser = interaction.data.resolved?.users?.[userId] ?? {
        id: userId,
        username: 'Unknown User',
        global_name: null,
        discriminator: '0000',
        avatar: null
      }

      // Generate Avatar CDN URL
      const avatarUrl = user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=512`
        : 'https://cdn.discordapp.com/embed/avatars/0.png'

      // Calculate account creation timestamp from Discord Snowflake
      const creationUnix = Math.floor(Number((BigInt(user.id) >> 22n) + 1420070400000n) / 1000)

      return c.res({
        flags: IS_COMPONENTS_V2,
        components: [
          {
            type: 17, // Container (App Card)
            accent_color: 0x5865F2,
            components: [
              {
                type: 9, // Section (Header + Avatar Thumbnail)
                components: [
                  {
                    type: 10, // Text Display
                    content: `## ${user.global_name || user.username}\n\`@${user.username}\`${user.bot ? ' `[BOT]`' : ''}`
                  }
                ],
                accessory: {
                  type: 11, // Thumbnail Component
                  media: {
                    url: avatarUrl
                  }
                }
              },
              {
                type: 14, // Separator
                divider: true,
                spacing: 1
              },
              {
                type: 10, // Text Display (Formatted Account Info)
                content: [
                  `**🆔 User ID:** \`${user.id}\``,
                  `**📅 Created:** <t:${creationUnix}:R> (<t:${creationUnix}:d>)`,
                  `**🤖 Account Type:** ${user.bot ? 'System Bot' : 'Discord User'}`
                ].join('\n')
              },
              {
                type: 14, // Separator
                divider: true
              },
              {
                type: 1, // Action Row
                components: [
                  {
                    type: 2, // Link Button
                    style: 5,
                    label: 'Open Full Avatar',
                    url: avatarUrl
                  }
                ]
              }
            ]
          }
        ]
      })
    }

    return c.res('Unknown subcommand')
  }
)