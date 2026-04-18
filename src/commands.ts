import { AttachmentBuilder, ChatInputCommandInteraction, Client, EmbedBuilder, GuildMember, Message, PermissionsBitField, REST, Routes, SlashCommandBuilder } from "discord.js";
import { env } from "./config.js";
import { getConfig, updateConfig, ensureUser, getLeaderboard, getRewards, setReward, removeReward, toggleList, getManagerRoles, type LeaderboardType } from "./db.js";
import { rankCard, levelCard, topCard } from "./cards.js";
import { addManualXp, canManageLevels, setLevel } from "./leveling.js";

const brand = 0x7c2cff;

export async function registerSlashCommands(client: Client) {
  if (!client.user) return;
  const commands = [
    new SlashCommandBuilder().setName("rank").setDescription("Show your Nexus rank card").addUserOption((o) => o.setName("user").setDescription("User to view").setRequired(false)),
    new SlashCommandBuilder().setName("level").setDescription("Show detailed Nexus level stats").addUserOption((o) => o.setName("user").setDescription("User to view").setRequired(false)),
    new SlashCommandBuilder().setName("top").setDescription("Show Nexus leaderboards").addStringOption((o) => o.setName("type").setDescription("Leaderboard type").setRequired(false).addChoices({ name: "Overall", value: "overall" }, { name: "Text XP", value: "text" }, { name: "Voice", value: "voice" }, { name: "Messages", value: "messages" })).addIntegerOption((o) => o.setName("page").setDescription("Page number").setMinValue(1).setRequired(false)),
    new SlashCommandBuilder().setName("nexus").setDescription("Configure Nexus leveling").setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
      .addSubcommand((s) => s.setName("view").setDescription("View current settings"))
      .addSubcommand((s) => s.setName("prefix").setDescription("Set prefix rank command").addStringOption((o) => o.setName("value").setDescription("Example: R").setRequired(true).setMaxLength(8)))
      .addSubcommand((s) => s.setName("levelup-channel").setDescription("Set level-up message channel").addChannelOption((o) => o.setName("channel").setDescription("Target channel").setRequired(true)))
      .addSubcommand((s) => s.setName("levelup-message").setDescription("Set level-up message text").addStringOption((o) => o.setName("message").setDescription("Use {user} {username} {level} {rank} {totalXp}").setRequired(true).setMaxLength(500)))
      .addSubcommand((s) => s.setName("xp-rates").setDescription("Set XP rates").addIntegerOption((o) => o.setName("text-min").setDescription("Minimum text XP").setMinValue(1).setMaxValue(500).setRequired(true)).addIntegerOption((o) => o.setName("text-max").setDescription("Maximum text XP").setMinValue(1).setMaxValue(500).setRequired(true)).addIntegerOption((o) => o.setName("cooldown").setDescription("Text cooldown seconds").setMinValue(5).setMaxValue(3600).setRequired(true)).addIntegerOption((o) => o.setName("voice-per-minute").setDescription("Voice XP per minute, default 30 = 1.5x text average").setMinValue(1).setMaxValue(1000).setRequired(true)))
      .addSubcommand((s) => s.setName("ignored-channel").setDescription("Enable/disable XP ignore for a channel").addChannelOption((o) => o.setName("channel").setDescription("Channel").setRequired(true)).addStringOption((o) => o.setName("kind").setDescription("XP kind").setRequired(true).addChoices({ name: "All", value: "all" }, { name: "Text", value: "text" }, { name: "Voice", value: "voice" })).addBooleanOption((o) => o.setName("enabled").setDescription("true ignores XP there, false allows XP").setRequired(true)))
      .addSubcommand((s) => s.setName("ignored-role").setDescription("Enable/disable XP ignore for a role").addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true)).addBooleanOption((o) => o.setName("enabled").setDescription("true ignores users with this role").setRequired(true)))
      .addSubcommand((s) => s.setName("manager-role").setDescription("Allow a role to edit XP/ranks").addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true)).addBooleanOption((o) => o.setName("enabled").setDescription("true allows level management").setRequired(true)))
      .addSubcommand((s) => s.setName("stack-rewards").setDescription("Keep lower level reward roles when higher rewards are reached").addBooleanOption((o) => o.setName("enabled").setDescription("true keeps all rewards, false keeps highest tier only").setRequired(true)))
      .addSubcommand((s) => s.setName("muted-voice").setDescription("Control muted/deafened voice XP").addBooleanOption((o) => o.setName("ignored").setDescription("true means muted/deafened users do not earn voice XP").setRequired(true))),
    new SlashCommandBuilder().setName("reward").setDescription("Configure level role rewards").setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
      .addSubcommand((s) => s.setName("add").setDescription("Add role reward at level").addIntegerOption((o) => o.setName("level").setDescription("Level").setMinValue(1).setMaxValue(500).setRequired(true)).addRoleOption((o) => o.setName("role").setDescription("Role reward").setRequired(true)))
      .addSubcommand((s) => s.setName("remove").setDescription("Remove rewards at level").addIntegerOption((o) => o.setName("level").setDescription("Level").setMinValue(1).setMaxValue(500).setRequired(true)).addRoleOption((o) => o.setName("role").setDescription("Optional exact role").setRequired(false)))
      .addSubcommand((s) => s.setName("list").setDescription("List role rewards")),
    new SlashCommandBuilder().setName("xp").setDescription("Edit Nexus XP/ranks").setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
      .addSubcommand((s) => s.setName("add").setDescription("Add or remove text XP").addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)).addIntegerOption((o) => o.setName("amount").setDescription("Use negative to remove").setMinValue(-1000000).setMaxValue(1000000).setRequired(true)))
      .addSubcommand((s) => s.setName("set-level").setDescription("Set a member level").addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)).addIntegerOption((o) => o.setName("level").setDescription("Target level").setMinValue(0).setMaxValue(500).setRequired(true))),
  ].map((c) => c.toJSON());
  const rest = new REST().setToken(env.token);
  if (env.guildId) await rest.put(Routes.applicationGuildCommands(client.user.id, env.guildId), { body: commands });
  else await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
}

async function resolveMember(interaction: ChatInputCommandInteraction) {
  const user = interaction.options.getUser("user") ?? interaction.user;
  return interaction.guild!.members.fetch(user.id).catch(() => null);
}

function noStatsEmbed() {
  return new EmbedBuilder().setColor(brand).setDescription("No Nexus stats yet. Send messages or join voice to start earning XP.");
}

async function replyRank(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const member = await resolveMember(interaction);
  if (!member) return interaction.editReply("I could not find that member.");
  const stats = ensureUser(interaction.guild!.id, member.id, member.user.username, member.displayAvatarURL({ extension: "png", size: 128 }));
  const file = await rankCard(member, stats);
  await interaction.editReply({ files: [file] });
}

async function replyLevel(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const member = await resolveMember(interaction);
  if (!member) return interaction.editReply("I could not find that member.");
  const stats = ensureUser(interaction.guild!.id, member.id, member.user.username, member.displayAvatarURL({ extension: "png", size: 128 }));
  const file = await levelCard(member, stats);
  await interaction.editReply({ files: [file] });
}

async function replyTop(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply();
  const type = (interaction.options.getString("type") ?? "overall") as LeaderboardType;
  const page = interaction.options.getInteger("page") ?? 1;
  const users = getLeaderboard(interaction.guild!.id, type, 10, (page - 1) * 10);
  const file = await topCard(interaction.guild!, type, page, users);
  await interaction.editReply({ files: [file] });
}

function requireManager(member: GuildMember) {
  return canManageLevels(member);
}

async function handleNexus(interaction: ChatInputCommandInteraction) {
  if (!requireManager(interaction.member as GuildMember)) return interaction.reply({ content: "You do not have permission to configure Nexus.", ephemeral: true });
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild!.id;
  if (sub === "view") {
    const config = getConfig(guildId);
    const rewards = getRewards(guildId);
    const managers = getManagerRoles(guildId);
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(brand).setTitle("Nexus Settings").addFields(
      { name: "Prefix", value: `\`${config.prefix}\``, inline: true },
      { name: "Level-up Channel", value: config.levelupChannelId ? `<#${config.levelupChannelId}>` : "Same channel/fallback", inline: true },
      { name: "XP", value: `Text ${config.textMinXp}-${config.textMaxXp} / ${config.textCooldownSeconds}s\nVoice ${config.voiceXpPerMinute}/min`, inline: true },
      { name: "Reward Mode", value: config.stackRewards ? "Stack rewards" : "Highest reward only", inline: true },
      { name: "Manager Roles", value: managers.length ? managers.map((r) => `<@&${r}>`).join(" ") : "Admins only", inline: false },
      { name: "Rewards", value: rewards.length ? rewards.map((r) => `Level ${r.level} → <@&${r.roleId}>`).join("\n").slice(0, 1000) : "No rewards set", inline: false },
      { name: "Level-up Message", value: config.levelupMessage, inline: false },
    )], ephemeral: true });
  }
  if (sub === "prefix") updateConfig(guildId, { prefix: interaction.options.getString("value", true) });
  if (sub === "levelup-channel") updateConfig(guildId, { levelupChannelId: interaction.options.getChannel("channel", true).id });
  if (sub === "levelup-message") updateConfig(guildId, { levelupMessage: interaction.options.getString("message", true) });
  if (sub === "xp-rates") updateConfig(guildId, { textMinXp: interaction.options.getInteger("text-min", true), textMaxXp: interaction.options.getInteger("text-max", true), textCooldownSeconds: interaction.options.getInteger("cooldown", true), voiceXpPerMinute: interaction.options.getInteger("voice-per-minute", true) });
  if (sub === "ignored-channel") toggleList("ignored_channels", guildId, interaction.options.getChannel("channel", true).id, interaction.options.getBoolean("enabled", true), interaction.options.getString("kind", true));
  if (sub === "ignored-role") toggleList("ignored_roles", guildId, interaction.options.getRole("role", true).id, interaction.options.getBoolean("enabled", true));
  if (sub === "manager-role") toggleList("manager_roles", guildId, interaction.options.getRole("role", true).id, interaction.options.getBoolean("enabled", true));
  if (sub === "stack-rewards") updateConfig(guildId, { stackRewards: interaction.options.getBoolean("enabled", true) ? 1 : 0 });
  if (sub === "muted-voice") updateConfig(guildId, { ignoreMutedVoice: interaction.options.getBoolean("ignored", true) ? 1 : 0 });
  return interaction.reply({ content: "Nexus settings updated.", ephemeral: true });
}

async function handleReward(interaction: ChatInputCommandInteraction) {
  if (!requireManager(interaction.member as GuildMember)) return interaction.reply({ content: "You do not have permission to configure rewards.", ephemeral: true });
  const sub = interaction.options.getSubcommand();
  if (sub === "add") {
    setReward(interaction.guild!.id, interaction.options.getInteger("level", true), interaction.options.getRole("role", true).id);
    return interaction.reply({ content: "Reward added.", ephemeral: true });
  }
  if (sub === "remove") {
    removeReward(interaction.guild!.id, interaction.options.getInteger("level", true), interaction.options.getRole("role")?.id);
    return interaction.reply({ content: "Reward removed.", ephemeral: true });
  }
  const rewards = getRewards(interaction.guild!.id);
  return interaction.reply({ embeds: [new EmbedBuilder().setColor(brand).setTitle("Nexus Role Rewards").setDescription(rewards.length ? rewards.map((r) => `Level ${r.level} → <@&${r.roleId}>`).join("\n") : "No rewards set.")], ephemeral: true });
}

async function handleXp(interaction: ChatInputCommandInteraction) {
  if (!requireManager(interaction.member as GuildMember)) return interaction.reply({ content: "You do not have permission to edit XP.", ephemeral: true });
  const sub = interaction.options.getSubcommand();
  const member = await interaction.guild!.members.fetch(interaction.options.getUser("user", true).id).catch(() => null);
  if (!member) return interaction.reply({ content: "Member not found.", ephemeral: true });
  if (sub === "add") {
    const level = addManualXp(member, interaction.options.getInteger("amount", true));
    return interaction.reply({ content: `${member} is now level ${level}.`, ephemeral: true });
  }
  setLevel(member, interaction.options.getInteger("level", true));
  return interaction.reply({ content: `${member} level was updated.`, ephemeral: true });
}

export async function handleInteraction(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) return;
  if (interaction.commandName === "rank") return replyRank(interaction);
  if (interaction.commandName === "level") return replyLevel(interaction);
  if (interaction.commandName === "top") return replyTop(interaction);
  if (interaction.commandName === "nexus") return handleNexus(interaction);
  if (interaction.commandName === "reward") return handleReward(interaction);
  if (interaction.commandName === "xp") return handleXp(interaction);
}

async function memberFromArg(message: Message, arg: string | undefined) {
  if (!message.guild) return null;
  if (message.mentions.members?.first()) return message.mentions.members.first()!;
  if (arg && /^\d{15,25}$/.test(arg)) return message.guild.members.fetch(arg).catch(() => null);
  return message.member;
}

export async function handlePrefixMessage(message: Message) {
  if (!message.guild || message.author.bot) return;
  const config = getConfig(message.guild.id);
  const trimmed = message.content.trim();
  const prefix = config.prefix;
  if (trimmed !== prefix && !trimmed.startsWith(`${prefix} `)) return;
  const args = trimmed === prefix ? [] : trimmed.slice(prefix.length).trim().split(/\s+/g);
  const command = args[0]?.toLowerCase();
  if (!command || message.mentions.users.size || /^\d{15,25}$/.test(command)) {
    const member = await memberFromArg(message, args[0]);
    if (!member) return;
    const stats = ensureUser(message.guild.id, member.id, member.user.username, member.displayAvatarURL({ extension: "png", size: 128 }));
    const file = await rankCard(member, stats);
    await message.reply({ files: [file] });
    return;
  }
  if (command === "level") {
    const member = await memberFromArg(message, args[1]);
    if (!member) return;
    const stats = ensureUser(message.guild.id, member.id, member.user.username, member.displayAvatarURL({ extension: "png", size: 128 }));
    const file = await levelCard(member, stats);
    await message.reply({ files: [file] });
    return;
  }
  if (command === "top") {
    const type = (["overall", "text", "voice", "messages"].includes(args[1]) ? args[1] : "overall") as LeaderboardType;
    const page = Math.max(1, Number(args[2] ?? 1) || 1);
    const users = getLeaderboard(message.guild.id, type, 10, (page - 1) * 10);
    const file = await topCard(message.guild, type, page, users);
    await message.reply({ files: [file] });
  }
}
