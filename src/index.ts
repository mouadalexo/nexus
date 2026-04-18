import { ChannelType, Client, GatewayIntentBits, Partials } from "discord.js";
import { env } from "./config.js";
import { registerSlashCommands, handleButtonInteraction, handleInteraction, handleModalSubmit, handlePrefixMessage, handleStringSelectInteraction } from "./commands.js";
import { applyRewards, processTextXp, processVoiceMinute, resetForJail, sendLevelAnnouncement } from "./leveling.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel, Partials.GuildMember, Partials.Message],
});

process.on("unhandledRejection", (reason) => console.error("[Nexus] Unhandled rejection:", reason));
process.on("uncaughtException", (err) => console.error("[Nexus] Uncaught exception:", err));

client.once("clientReady", async () => {
  console.log(`[Nexus] Online as ${client.user?.tag}`);
  console.log(`[Nexus] Serving ${client.guilds.cache.size} guild(s)`);
  await registerSlashCommands(client).then(() => console.log("[Nexus] Slash commands registered")).catch((err) => console.error("[Nexus] Command registration failed:", err));
  client.user?.setPresence({ activities: [{ name: "Night Stars levels" }], status: "online" });
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand() && !interaction.isButton() && !interaction.isModalSubmit() && !interaction.isStringSelectMenu()) return;
  const action = interaction.isModalSubmit() ? handleModalSubmit(interaction) : interaction.isButton() ? handleButtonInteraction(interaction) : interaction.isStringSelectMenu() ? handleStringSelectInteraction(interaction) : handleInteraction(interaction);
  await action.catch((err) => {
    console.error("[Nexus] Interaction error:", err);
    if (interaction.deferred || interaction.replied) interaction.editReply("Nexus hit an error while processing this command.").catch(() => null);
    else interaction.reply({ content: "Nexus hit an error while processing this command.", ephemeral: true }).catch(() => null);
  });
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  const config = (await import("./db.js")).getConfig(newMember.guild.id);
  if (!config.jailRoleId) return;
  const wasJailed = oldMember.roles.cache.has(config.jailRoleId);
  const isJailed = newMember.roles.cache.has(config.jailRoleId);
  if (!wasJailed && isJailed) {
    resetForJail(newMember);
  }
});

client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot) return;
  await handlePrefixMessage(message).catch((err) => console.error("[Nexus] Prefix command error:", err));
  const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return;
  const levelUp = await processTextXp(member, message.channel, message.channelId).catch((err) => {
    console.error("[Nexus] Text XP error:", err);
    return null;
  });
  if (levelUp) {
    await applyRewards(member, levelUp.newLevel);
    await sendLevelAnnouncement(member, levelUp.newLevel, message.channel);
  }
});

async function tickVoiceXp() {
  for (const guild of client.guilds.cache.values()) {
    for (const channel of guild.channels.cache.values()) {
      if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) continue;
      for (const member of channel.members.values()) {
        const levelUp = await processVoiceMinute(member, channel.id).catch((err) => {
          console.error("[Nexus] Voice XP error:", err);
          return null;
        });
        if (levelUp) {
          await applyRewards(member, levelUp.newLevel);
          await sendLevelAnnouncement(member, levelUp.newLevel, null);
        }
      }
    }
  }
}

setInterval(() => {
  tickVoiceXp().catch((err) => console.error("[Nexus] Voice tick error:", err));
}, 60_000);

async function shutdown(signal: string) {
  console.log(`[Nexus] Received ${signal}, shutting down`);
  client.destroy();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.log("[Nexus] Attempting Discord login...");
client.login(env.token).catch((err) => {
  console.error("[Nexus] Login failed:", err?.code, err?.message ?? err);
  process.exit(1);
});
