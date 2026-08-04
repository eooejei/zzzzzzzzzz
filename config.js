// config.js
module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID,
  recruitChannelId: process.env.DISCORD_RECRUIT_CHANNEL_ID,
  mentionRoleIds: (process.env.DISCORD_MENTION_ROLE_IDS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean),
  prefix: "!"
};
