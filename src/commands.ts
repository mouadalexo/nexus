import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChannelSelectMenuBuilder, ChannelSelectMenuInteraction, ChannelType, ChatInputCommandInteraction, Client, EmbedBuilder, GuildMember, Message, ModalBuilder, ModalSubmitInteraction, PermissionsBitField, REST, Routes, SlashCommandBuilder, StringSelectMenuBuilder, StringSelectMenuInteraction, TextInputBuilder, TextInputStyle } from "discord.js";
import { env } from "./config.js";
import { countUsers, getConfig, updateConfig, ensureUser, getLeaderboard, getRewards, setReward, removeReward, toggleList, getManagerRoles, setEventVoiceChannel, getEventVoiceChannels, getRewardGiverRoles, hasRewardGiverRole, getTodayRewardGrant, recordRewardGrant, getIgnoredChannels, getIgnoredRoles, getChannelLeaderboard, countChannels, isCommandBlockedChannel, getBlockedCommandChannels, setCommandBlockedChannel, getAllowedCommandChannels, getAllowedCommandCategories, setAllowedCommandChannels, setAllowedCommandCategories, clearAllowedCommandRestrictions, isCommandAllowedHere, type LeaderboardType } from "./db.js";
import { rankCard, levelCard, topCard, statsCard, type StatsView } from "./cards.js";
import { addRewardXp, applyRewards, canManageLevels, setLevel } from "./leveling.js";

const brand = 0x6f55ff;
const leaderboardTypes = ["overall", "text", "voice", "messages"];
const statsViews = ["overview", "message_members", "voice_members", "message_channels", "voice_channels"] as const;
const setupDeleteMs = 5 * 60_000;
const rankDeleteMs = 30_000;
const menuDeleteMs = 60_000;

function deleteReplyLater(interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction, delayMs: number) {
  setTimeout(() => {
    interaction.deleteReply().catch(() => null);
  }, delayMs).unref();
}

function deleteMessagesLater(delayMs: number, ...messages: (Message | undefined | null)[]) {
  setTimeout(() => {
    for (const message of messages) message?.delete().catch(() => null);
  }, delayMs).unref();
}

export async function registerSlashCommands(client: Client) {
  if (!client.user) return;
  const commands = [
    new SlashCommandBuilder().setName("nexus").setDescription("Configure Nexus essentials").setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
      .addSubcommand((sub) => sub.setName("prefix").setDescription("Set rank text command prefix").addStringOption((o) => o.setName("value").setDescription("Example: R").setRequired(true).setMaxLength(8))),
    new SlashCommandBuilder().setName("setup").setDescription("Open the Nexus server setup panel").setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),
    new SlashCommandBuilder().setName("help").setDescription("Show the Nexus command guide"),
    new SlashCommandBuilder().setName("xp").setDescription("Edit Nexus levels").setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
      .addSubcommand((sub) => sub.setName("set-level").setDescription("Set a member level").addUserOption((o) => o.setName("user").setDescription("User").setRequired(true)).addIntegerOption((o) => o.setName("level").setDescription("Target level").setMinValue(0).setMaxValue(500).setRequired(true))),
  ].map((c) => c.toJSON());
  const rest = new REST().setToken(env.token);
  if (env.guildId) await rest.put(Routes.applicationGuildCommands(client.user.id, env.guildId), { body: commands });
  else await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
}

function normalizeType(value: string | undefined): LeaderboardType {
  const type = value?.toLowerCase();
  return (type && leaderboardTypes.includes(type) ? type : "overall") as LeaderboardType;
}

function maxTopPage(guildId: string) {
  return Math.max(1, Math.ceil(countUsers(guildId) / 10));
}

function topButtons(type: LeaderboardType, page: number, maxPage: number) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`nexus_top:${type}:${Math.max(1, page - 1)}:prev`).setLabel("Prev").setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(`nexus_top:${type}:${Math.min(maxPage, page + 1)}:next`).setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(page >= maxPage),
  )];
}

function normalizeStatsView(value: string | undefined): StatsView {
  return statsViews.includes(value as StatsView) ? value as StatsView : "overview";
}

async function sendTop(target: Message | ButtonInteraction, type: LeaderboardType, page: number) {
  const guild = target.guild!;
  const maxPage = maxTopPage(guild.id);
  const safePage = Math.min(Math.max(1, page), maxPage);
  const users = getLeaderboard(guild.id, type, 10, (safePage - 1) * 10);
  const file = await topCard(guild, type, safePage, users);
  const payload = { files: [file], components: topButtons(type, safePage, maxPage) };
  if (target instanceof Message) return target.reply(payload);
  return target.update(payload);
}

function maxStatsPage(guildId: string, view: StatsView) {
  if (view === "overview") return 1;
  const total = view === "message_channels" ? countChannels(guildId, "text") : view === "voice_channels" ? countChannels(guildId, "voice") : countUsers(guildId);
  return Math.max(1, Math.ceil(total / 10));
}

function statsRows(view: StatsView, page: number, maxPage: number) {
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("nexus_stats_select")
        .setPlaceholder("Choose a statistics view")
        .addOptions(
          { label: "Overview", value: "overview", description: "Main statistics menu", default: view === "overview" },
          { label: "Top Message Members", value: "message_members", description: "Most active message members", default: view === "message_members" },
          { label: "Top Voice Members", value: "voice_members", description: "Most active voice members", default: view === "voice_members" },
          { label: "Top Message Channels", value: "message_channels", description: "Most active text channels", default: view === "message_channels" },
          { label: "Top Voice Channels", value: "voice_channels", description: "Most active voice channels", default: view === "voice_channels" },
        ),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`nexus_stats:${view}:1:first`).setLabel("First").setStyle(ButtonStyle.Secondary).setDisabled(view === "overview" || page <= 1),
      new ButtonBuilder().setCustomId(`nexus_stats:${view}:${Math.max(1, page - 1)}:prev`).setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(view === "overview" || page <= 1),
      new ButtonBuilder().setCustomId(`nexus_stats:${view}:${page}:noop`).setLabel(`${page}/${maxPage}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(`nexus_stats:${view}:${Math.min(maxPage, page + 1)}:next`).setLabel("Next").setStyle(ButtonStyle.Success).setDisabled(view === "overview" || page >= maxPage),
      new ButtonBuilder().setCustomId(`nexus_stats:${view}:${maxPage}:last`).setLabel("Last").setStyle(ButtonStyle.Success).setDisabled(view === "overview" || page >= maxPage),
    ),
  ];
}

async function sendStats(target: Message | ButtonInteraction | StringSelectMenuInteraction, view: StatsView, page: number) {
  const guild = target.guild!;
  const maxPage = maxStatsPage(guild.id, view);
  const safePage = Math.min(Math.max(1, page), maxPage);
  const offset = (safePage - 1) * 10;
  const users = view === "voice_members" ? getLeaderboard(guild.id, "voice", 10, offset) : getLeaderboard(guild.id, "messages", 10, offset);
  const channels = view === "voice_channels" ? getChannelLeaderboard(guild.id, "voice", 10, offset) : getChannelLeaderboard(guild.id, "text", 10, offset);
  const file = await statsCard(guild, view, safePage, users, channels);
  const payload = { files: [file], components: statsRows(view, safePage, maxPage) };
  if (target instanceof Message) return target.reply(payload);
  return target.update(payload);
}

function requireManager(member: GuildMember) {
  return canManageLevels(member);
}

function canGiveReward(member: GuildMember) {
  return requireManager(member) || hasRewardGiverRole(member.guild.id, member.roles.cache.map((r) => r.id));
}

function setupEmbed(guildId: string) {
  const config = getConfig(guildId);
  const rewards = getRewards(guildId);
  const managers = getManagerRoles(guildId);
  const events = getEventVoiceChannels(guildId);
  const rewardGivers = getRewardGiverRoles(guildId);
  const ignoredRoles = getIgnoredRoles(guildId);
  const ignoredChannels = getIgnoredChannels(guildId);
  const blockedCommandChannels = getBlockedCommandChannels(guildId);
  return new EmbedBuilder()
    .setColor(brand)
    .setTitle("🌌 Current Nexus Setup")
    .setDescription("Everything important is shown here clearly so you can check the current Nexus setup.")
    .addFields(
      { name: "📌 Member Commands", value: "`R` rank\n`L` level\n`S` statistics\n`Top` leaderboard\n`Reward @user` daily reward", inline: true },
      { name: "⚡ XP Rates", value: `Text: ${config.textMinXp}-${config.textMaxXp} XP / ${config.textCooldownSeconds}s\nVoice: ${config.voiceXpPerMinute} XP/min`, inline: true },
      { name: "📣 Level Message", value: `Channel: ${config.levelupChannelId ? `<#${config.levelupChannelId}>` : "same channel"}\n${config.levelupMessage.slice(0, 220)}`, inline: false },
      { name: "🏅 Level Rewards", value: rewards.length ? rewards.map((r) => `• Level ${r.level}: <@&${r.roleId}>`).join("\n").slice(0, 900) : "No level rewards set.", inline: false },
      { name: "🎁 Reward Givers", value: `Amount: ${config.rewardXpAmount} hidden XP\nRoles: ${rewardGivers.length ? rewardGivers.map((r) => `<@&${r}>`).join(" ") : "none"}`, inline: false },
      { name: "🚫 Jail", value: config.jailRoleId ? `<@&${config.jailRoleId}> resets level to 0 and blocks XP.` : "No jail role set.", inline: false },
      { name: "🙈 Ignored Roles", value: ignoredRoles.length ? ignoredRoles.map((r) => `<@&${r}>`).join(" ") : "none", inline: false },
      { name: "🔇 Ignored Channels", value: ignoredChannels.length ? ignoredChannels.map((c) => `<#${c.channelId}> (${c.kind})`).join("\n").slice(0, 900) : "none", inline: false },
      { name: "⛔ Blocked Command Channels", value: blockedCommandChannels.length ? blockedCommandChannels.map((c) => `<#${c}>`).join(" ") : "none", inline: false },
      { name: "🎤 Event Voice", value: events.length ? events.map((e) => `• <#${e.channelId}> x${e.multiplier}`).join("\n") : "none", inline: false },
      { name: "🛠️ Managers", value: managers.length ? managers.map((r) => `<@&${r}>`).join(" ") : "Admins only", inline: false },
    );
}

function setupIntroEmbed() {
  return new EmbedBuilder()
    .setColor(brand)
    .setTitle("🌌 Nexus Setup Panel")
    .setDescription("Nexus manages levels, rewards, rank cards, statistics, ignored XP areas, event voice boosts, and command access for Night Stars.");
}

function rewardEmbed(guildId: string) {
  const config = getConfig(guildId);
  const roles = getRewardGiverRoles(guildId);
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("🎁 Reward Giver System")
    .setDescription("Members with a reward giver role can type `Reward @user` to give the daily reward. A member can receive it only once per day, even if different reward givers try.")
    .addFields(
      { name: "💎 Reward amount", value: `${config.rewardXpAmount} hidden XP`, inline: true },
      { name: "✅ Allowed roles", value: roles.length ? roles.map((r) => `<@&${r}>`).join(" ") : "No roles set yet", inline: true },
      { name: "📝 How to use", value: "1. Add a reward giver role.\n2. Set the reward amount.\n3. Reward givers type `Reward @user`.\n4. Nexus blocks duplicate rewards for the same member that day.", inline: false },
    );
}

function setupRows() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("nexus_panel:view").setLabel("🌌 View Setup").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("nexus_panel:reward_system").setLabel("🎁 Reward Giver").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("nexus_panel:reset_setup").setLabel("Reset Setup").setStyle(ButtonStyle.Danger),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("nexus_panel:jail_role").setLabel("🚫 Jail Role").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("nexus_panel:level_message").setLabel("📣 Level Message").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("nexus_panel:level_channel").setLabel("📍 Level Channel").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("nexus_panel:xp_rates").setLabel("⚡ XP Rates").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("nexus_panel:add_reward").setLabel("🏅 Level Reward").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("nexus_panel:add_ignore_role").setLabel("🙈 Ignored Role").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("nexus_panel:add_ignore_channel").setLabel("🔇 Ignored Channel").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("nexus_panel:add_event_stage").setLabel("🎤 Event Voice").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("nexus_panel:add_blocked_command_channel").setLabel("⛔ Block Cmd Channel").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("nexus_panel:channel_restrictions").setLabel("📍 Channel Restrictions").setStyle(ButtonStyle.Primary),
    ),
  ];
}

function rewardRows() {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("nexus_panel:reward_amount").setLabel("💎 Set Amount").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("nexus_panel:add_reward_role").setLabel("Add Reward Role").setStyle(ButtonStyle.Success),
  )];
}

function resetRows() {
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("nexus_reset_select")
      .setPlaceholder("Choose what to reset")
      .addOptions(
        { label: "Level-up channel", value: "level_channel", description: "Send level messages back to the same channel" },
        { label: "Level-up message", value: "level_message", description: "Reset the level-up message text" },
        { label: "XP rates", value: "xp_rates", description: "Reset text and voice XP rates" },
        { label: "Reward amount", value: "reward_amount", description: "Reset daily reward XP amount" },
        { label: "Jail role", value: "jail_role", description: "Remove the jail role setting" },
        { label: "Level rewards", value: "level_rewards", description: "Remove all level reward roles" },
        { label: "Reward giver roles", value: "reward_roles", description: "Remove all reward giver roles" },
        { label: "Ignored roles", value: "ignored_roles", description: "Remove all ignored XP roles" },
        { label: "Ignored channels", value: "ignored_channels", description: "Remove all ignored XP channels" },
        { label: "Event voice channels", value: "event_voice", description: "Remove all event voice boosts" },
        { label: "Blocked command channels", value: "blocked_commands", description: "Unblock commands everywhere" },
      ),
  )];
}

function textInput(id: string, label: string, placeholder: string, required = true) {
  return new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder).setRequired(required).setStyle(TextInputStyle.Short);
}

function modal(id: string, title: string, inputs: TextInputBuilder[]) {
  return new ModalBuilder().setCustomId(id).setTitle(title).addComponents(...inputs.map((input) => new ActionRowBuilder<TextInputBuilder>().addComponents(input)));
}

async function handleSetup(interaction: ChatInputCommandInteraction) {
  if (!requireManager(interaction.member as GuildMember)) return interaction.reply({ content: "You do not have permission to use the setup panel.", ephemeral: true });
  await interaction.reply({ embeds: [setupIntroEmbed()], components: setupRows(), ephemeral: true });
  deleteReplyLater(interaction, setupDeleteMs);
}

function extractId(value: string) {
  return value.replace(/[^0-9]/g, "");
}

function boolValue(value: string) {
  return !["false", "off", "no", "0", "remove", "disable"].includes(value.trim().toLowerCase());
}

function resetSetupSection(guildId: string, section: string) {
  if (section === "level_channel") updateConfig(guildId, { levelupChannelId: null });
  if (section === "level_message") updateConfig(guildId, { levelupMessage: "{user} reached level {level}! Rank #{rank}" });
  if (section === "xp_rates") updateConfig(guildId, { textMinXp: 8, textMaxXp: 15, textCooldownSeconds: 90, voiceXpPerMinute: 12 });
  if (section === "reward_amount") updateConfig(guildId, { rewardXpAmount: 75 });
  if (section === "jail_role") updateConfig(guildId, { jailRoleId: null });
  if (section === "level_rewards") for (const reward of getRewards(guildId)) removeReward(guildId, reward.level, reward.roleId);
  if (section === "reward_roles") for (const roleId of getRewardGiverRoles(guildId)) toggleList("reward_giver_roles", guildId, roleId, false);
  if (section === "ignored_roles") for (const roleId of getIgnoredRoles(guildId)) toggleList("ignored_roles", guildId, roleId, false);
  if (section === "ignored_channels") for (const channel of getIgnoredChannels(guildId)) toggleList("ignored_channels", guildId, channel.channelId, false);
  if (section === "event_voice") for (const channel of getEventVoiceChannels(guildId)) setEventVoiceChannel(guildId, channel.channelId, 1);
  if (section === "blocked_commands") for (const channelId of getBlockedCommandChannels(guildId)) setCommandBlockedChannel(guildId, channelId, false);
}

function resetLabel(section: string) {
  const labels: Record<string, string> = {
    level_channel: "Level-up channel",
    level_message: "Level-up message",
    xp_rates: "XP rates",
    reward_amount: "Reward amount",
    jail_role: "Jail role",
    level_rewards: "Level rewards",
    reward_roles: "Reward giver roles",
    ignored_roles: "Ignored roles",
    ignored_channels: "Ignored channels",
    event_voice: "Event voice channels",
    blocked_commands: "Blocked command channels",
  };
  return labels[section] ?? "Setup section";
}

async function openSetupModal(interaction: ButtonInteraction, action: string) {
  if (!requireManager(interaction.member as GuildMember)) return interaction.reply({ content: "You do not have permission to use the setup panel.", ephemeral: true });
  if (action === "view") {
    await interaction.reply({ embeds: [setupEmbed(interaction.guild!.id)], ephemeral: true });
    deleteReplyLater(interaction, setupDeleteMs);
    return;
  }
  if (action === "reward_system") {
    await interaction.reply({ embeds: [rewardEmbed(interaction.guild!.id)], components: rewardRows(), ephemeral: true });
    deleteReplyLater(interaction, setupDeleteMs);
    return;
  }
  if (action === "reset_setup") {
    await interaction.reply({ content: "Choose the setup section you want to reset.", components: resetRows(), ephemeral: true });
    deleteReplyLater(interaction, setupDeleteMs);
    return;
  }
  if (action === "reward_amount") return interaction.showModal(modal("nexus_modal:reward_amount", "Set Daily Reward Amount", [textInput("amount", "Reward amount", "75") ]));
  if (action === "add_reward_role") return interaction.showModal(modal("nexus_modal:add_reward_role", "Add Reward Giver Role", [textInput("role", "Role ID or mention", "@Reward Giver or 123456789")]));
  if (action === "jail_role") return interaction.showModal(modal("nexus_modal:jail_role", "Set Jail Role", [textInput("role", "Jail role ID or mention", "@Jailed or 123456789. Leave 0 to remove") ]));
  if (action === "level_message") return interaction.showModal(modal("nexus_modal:level_message", "Set Level Up Message", [textInput("message", "Message", "Use {user} {username} {level} {rank}")]));
  if (action === "level_channel") return interaction.showModal(modal("nexus_modal:level_channel", "Set Level Up Channel", [textInput("channel", "Channel ID or mention", "#levels or 123456789")]));
  if (action === "xp_rates") return interaction.showModal(modal("nexus_modal:xp_rates", "Set XP Rates", [textInput("textMin", "Text minimum", "8"), textInput("textMax", "Text maximum", "15"), textInput("cooldown", "Text cooldown seconds", "90"), textInput("voice", "Voice per minute", "12")]));
  if (action === "add_reward") return interaction.showModal(modal("nexus_modal:add_reward", "Add Level Role Reward", [textInput("level", "Level", "10"), textInput("role", "Role ID or mention", "@Role or 123456789")]));
  if (action === "add_ignore_role") return interaction.showModal(modal("nexus_modal:add_ignore_role", "Add Ignored Role", [textInput("role", "Role ID or mention", "@Role or 123456789")]));
  if (action === "add_ignore_channel") return interaction.showModal(modal("nexus_modal:add_ignore_channel", "Add Ignored Channel", [textInput("channel", "Channel ID or mention", "#channel or 123456789"), textInput("kind", "Kind", "all, text, or voice")]));
  if (action === "add_event_stage") return interaction.showModal(modal("nexus_modal:add_event_stage", "Add Event Voice", [textInput("channel", "Voice channel ID or mention", "voice channel or 123456789"), textInput("multiplier", "XP multiplier", "2 or 3")]));
  if (action === "add_blocked_command_channel") return interaction.showModal(modal("nexus_modal:add_blocked_command_channel", "Block Command Channel", [textInput("channel", "Channel ID or mention", "#channel or 123456789")]));
}

async function handleSetupModal(interaction: ModalSubmitInteraction) {
  if (!interaction.guild || !requireManager(interaction.member as GuildMember)) return interaction.reply({ content: "You do not have permission to update Nexus setup.", ephemeral: true });
  const action = interaction.customId.split(":")[1];
  const guildId = interaction.guild.id;
  if (action === "reward_amount") updateConfig(guildId, { rewardXpAmount: Math.max(1, Number(interaction.fields.getTextInputValue("amount")) || 75) });
  if (action === "add_reward_role" || action === "remove_reward_role") {
    const roleId = extractId(interaction.fields.getTextInputValue("role"));
    if (roleId) toggleList("reward_giver_roles", guildId, roleId, action === "add_reward_role");
  }
  if (action === "jail_role") {
    const roleId = extractId(interaction.fields.getTextInputValue("role"));
    updateConfig(guildId, { jailRoleId: roleId && roleId !== "0" ? roleId : null });
  }
  if (action === "level_message") updateConfig(guildId, { levelupMessage: interaction.fields.getTextInputValue("message").slice(0, 500) });
  if (action === "level_channel") updateConfig(guildId, { levelupChannelId: extractId(interaction.fields.getTextInputValue("channel")) || null });
  if (action === "xp_rates") {
    const textMinXp = Math.max(1, Number(interaction.fields.getTextInputValue("textMin")) || 8);
    const textMaxXp = Math.max(textMinXp, Number(interaction.fields.getTextInputValue("textMax")) || textMinXp);
    const textCooldownSeconds = Math.max(5, Number(interaction.fields.getTextInputValue("cooldown")) || 90);
    const voiceXpPerMinute = Math.max(1, Number(interaction.fields.getTextInputValue("voice")) || 12);
    updateConfig(guildId, { textMinXp, textMaxXp, textCooldownSeconds, voiceXpPerMinute });
  }
  if (action === "add_reward") {
    const roleId = extractId(interaction.fields.getTextInputValue("role"));
    if (roleId) setReward(guildId, Math.max(1, Number(interaction.fields.getTextInputValue("level")) || 1), roleId);
  }
  if (action === "remove_reward") {
    const level = Math.max(1, Number(interaction.fields.getTextInputValue("level")) || 1);
    const roleId = extractId(interaction.fields.getTextInputValue("role"));
    removeReward(guildId, level, roleId || undefined);
  }
  if (action === "add_ignore_role" || action === "remove_ignore_role") {
    const roleId = extractId(interaction.fields.getTextInputValue("role"));
    if (roleId) toggleList("ignored_roles", guildId, roleId, action === "add_ignore_role");
  }
  if (action === "add_ignore_channel") {
    const channelId = extractId(interaction.fields.getTextInputValue("channel"));
    const kindInput = interaction.fields.getTextInputValue("kind").trim().toLowerCase();
    const kind = ["text", "voice", "all"].includes(kindInput) ? kindInput : "all";
    if (channelId) toggleList("ignored_channels", guildId, channelId, true, kind);
  }
  if (action === "remove_ignore_channel") {
    const channelId = extractId(interaction.fields.getTextInputValue("channel"));
    if (channelId) toggleList("ignored_channels", guildId, channelId, false);
  }
  if (action === "add_event_stage") {
    const channelId = extractId(interaction.fields.getTextInputValue("channel"));
    if (channelId) setEventVoiceChannel(guildId, channelId, Math.max(1, Math.min(3, Number(interaction.fields.getTextInputValue("multiplier")) || 1)));
  }
  if (action === "remove_event_stage") {
    const channelId = extractId(interaction.fields.getTextInputValue("channel"));
    if (channelId) setEventVoiceChannel(guildId, channelId, 1);
  }
  if (action === "add_blocked_command_channel" || action === "remove_blocked_command_channel") {
    const channelId = extractId(interaction.fields.getTextInputValue("channel"));
    if (channelId) setCommandBlockedChannel(guildId, channelId, action === "add_blocked_command_channel");
  }
  const isRewardAction = action === "reward_amount" || action === "add_reward_role" || action === "remove_reward_role";
  await interaction.reply({ content: "Nexus setup updated.", embeds: [isRewardAction ? rewardEmbed(guildId) : setupEmbed(guildId)], components: isRewardAction ? rewardRows() : [], ephemeral: true });
  deleteReplyLater(interaction, setupDeleteMs);
}

async function handleNexus(interaction: ChatInputCommandInteraction) {
  if (!requireManager(interaction.member as GuildMember)) return interaction.reply({ content: "You do not have permission to configure Nexus.", ephemeral: true });
  const sub = interaction.options.getSubcommand();
  if (sub === "prefix") {
    updateConfig(interaction.guild!.id, { prefix: interaction.options.getString("value", true) });
    return interaction.reply({ content: "Nexus rank prefix updated. Text commands still work as R, L, and Top.", ephemeral: true });
  }
}

async function handleXp(interaction: ChatInputCommandInteraction) {
  if (!requireManager(interaction.member as GuildMember)) return interaction.reply({ content: "You do not have permission to edit levels.", ephemeral: true });
  const member = await interaction.guild!.members.fetch(interaction.options.getUser("user", true).id).catch(() => null);
  if (!member) return interaction.reply({ content: "Member not found.", ephemeral: true });
  setLevel(member, interaction.options.getInteger("level", true));
  await applyRewards(member, interaction.options.getInteger("level", true));
  return interaction.reply({ content: `${member} level was updated.`, ephemeral: true });
}

function buildHelpEmbed(guildId: string) {
  const config = getConfig(guildId);
  return new EmbedBuilder()
    .setColor(brand)
    .setTitle("✨ Nexus Leveling Guide")
    .setDescription("A clean level system for Night Stars. Early levels are easy, higher levels become harder with a progressive curve.")
    .addFields(
      { name: "📌 Member Commands", value: "`R` or `R @user` - Rank card\n`L` or `L @user` - Level card\n`S` - Statistics menu\n`Top` - Overall level leaderboard\n`Top voice`, `Top text`, `Top messages` - Other leaderboards", inline: false },
      { name: "🎁 Reward Giver", value: `Reward givers type \`Reward @user\` to give ${config.rewardXpAmount} hidden XP. A member can receive only one reward per day.`, inline: false },
      { name: "🛠️ Staff Setup", value: "`/setup` - Open the full button panel (includes Channel Restrictions to pick where commands can be used)\n`/nexus prefix` - Change rank shortcut prefix\n`/xp set-level` - Set a member level", inline: false },
      { name: "🚫 Jail System", value: "When the jail role is added, Nexus resets that member to level 0 and blocks XP while they remain jailed. When unjailed, they start again from the beginning.", inline: false },
    )
    .setFooter({ text: "Nexus - Night Stars Leveling" })
    .setTimestamp();
}

function buildMemberHelpEmbed(guildId: string) {
  const config = getConfig(guildId);
  return new EmbedBuilder()
    .setColor(brand)
    .setTitle("✨ Nexus Member Commands")
    .setDescription(`Use \`${config.prefix}help\` anytime to see this guide.`)
    .addFields(
      { name: "R = Rank", value: "See your rank card. Use `R @member` to see another member.", inline: false },
      { name: "L = Level", value: "See your level card with messages, voice, and overall progress. Use `L @member` for another member.", inline: false },
      { name: "S = Stats", value: "Open server statistics for top members and top channels.", inline: false },
      { name: "Top = Leaderboard", value: "See the server leaderboard. You can also use `Top voice`, `Top text`, or `Top messages`.", inline: false },
    )
    .setFooter({ text: "Nexus - Night Stars Leveling" })
    .setTimestamp();
}

async function handleHelp(interaction: ChatInputCommandInteraction) {
  await interaction.reply({ embeds: [buildHelpEmbed(interaction.guild!.id)], ephemeral: true });
}

function buildChannelRestrictionsPayload(guildId: string) {
  const allowedChannels = getAllowedCommandChannels(guildId);
  const allowedCategories = getAllowedCommandCategories(guildId);
  const embed = new EmbedBuilder()
    .setColor(brand)
    .setTitle("📍 Channel Restrictions")
    .setDescription("Pick the channels and/or categories where Nexus member commands (R, L, S, Top) are allowed. Leave both empty to allow them everywhere.")
    .addFields(
      { name: "Allowed channels", value: allowedChannels.length ? allowedChannels.map((id) => `<#${id}>`).join(" ") : "None — allowed everywhere", inline: false },
      { name: "Allowed categories", value: allowedCategories.length ? allowedCategories.map((id) => `<#${id}>`).join(" ") : "None — allowed everywhere", inline: false },
    )
    .setFooter({ text: "Nexus • Channel Restrictions" });
  const channelSelect = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("nexus_allowed_channels")
      .setPlaceholder(allowedChannels.length ? `✅ ${allowedChannels.length} channel(s) selected` : "Select allowed channels…")
      .addChannelTypes(ChannelType.GuildText)
      .setMinValues(0)
      .setMaxValues(25)
      .setDefaultChannels(allowedChannels.slice(0, 25)),
  );
  const categorySelect = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId("nexus_allowed_categories")
      .setPlaceholder(allowedCategories.length ? `✅ ${allowedCategories.length} category(ies) selected` : "Select allowed categories…")
      .addChannelTypes(ChannelType.GuildCategory)
      .setMinValues(0)
      .setMaxValues(25)
      .setDefaultChannels(allowedCategories.slice(0, 25)),
  );
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("nexus_panel:clear_channel_restrictions").setLabel("Clear restrictions").setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [channelSelect, categorySelect, buttons] };
}

export async function handleButtonInteraction(interaction: ButtonInteraction) {
  if (!interaction.guild) return;
  if (interaction.customId === "nexus_panel:channel_restrictions") {
    if (!requireManager(interaction.member as GuildMember)) return interaction.reply({ content: "You do not have permission to update Nexus setup.", ephemeral: true });
    const payload = buildChannelRestrictionsPayload(interaction.guild.id);
    await interaction.reply({ ...payload, ephemeral: true });
    deleteReplyLater(interaction, setupDeleteMs);
    return;
  }
  if (interaction.customId === "nexus_panel:clear_channel_restrictions") {
    if (!requireManager(interaction.member as GuildMember)) return interaction.reply({ content: "You do not have permission to update Nexus setup.", ephemeral: true });
    clearAllowedCommandRestrictions(interaction.guild.id);
    const payload = buildChannelRestrictionsPayload(interaction.guild.id);
    await interaction.update(payload);
    return;
  }
  if (interaction.customId.startsWith("nexus_panel:")) return openSetupModal(interaction, interaction.customId.split(":")[1]);
  if (interaction.customId.startsWith("nexus_stats:")) {
    const [, rawView, rawPage] = interaction.customId.split(":");
    return sendStats(interaction, normalizeStatsView(rawView), Math.max(1, Number(rawPage) || 1));
  }
  if (!interaction.customId.startsWith("nexus_top:")) return;
  const [, rawType, rawPage] = interaction.customId.split(":");
  const type = normalizeType(rawType);
  const page = Math.max(1, Number(rawPage) || 1);
  return sendTop(interaction, type, page);
}

export async function handleChannelSelectInteraction(interaction: ChannelSelectMenuInteraction) {
  if (!interaction.guild) return;
  if (!requireManager(interaction.member as GuildMember)) return interaction.reply({ content: "You do not have permission to update Nexus setup.", ephemeral: true });
  if (interaction.customId === "nexus_allowed_channels") {
    setAllowedCommandChannels(interaction.guild.id, interaction.values);
    const payload = buildChannelRestrictionsPayload(interaction.guild.id);
    await interaction.update(payload);
    return;
  }
  if (interaction.customId === "nexus_allowed_categories") {
    setAllowedCommandCategories(interaction.guild.id, interaction.values);
    const payload = buildChannelRestrictionsPayload(interaction.guild.id);
    await interaction.update(payload);
    return;
  }
}

export async function handleStringSelectInteraction(interaction: StringSelectMenuInteraction) {
  if (!interaction.guild) return;
  if (interaction.customId === "nexus_stats_select") return sendStats(interaction, normalizeStatsView(interaction.values[0]), 1);
  if (interaction.customId === "nexus_reset_select") {
    const section = interaction.values[0];
    resetSetupSection(interaction.guild.id, section);
    await interaction.update({ content: `${resetLabel(section)} was reset.`, embeds: [setupEmbed(interaction.guild.id)], components: [] });
    deleteReplyLater(interaction, setupDeleteMs);
    return;
  }
}

export async function handleModalSubmit(interaction: ModalSubmitInteraction) {
  if (!interaction.customId.startsWith("nexus_modal:")) return;
  return handleSetupModal(interaction);
}

export async function handleInteraction(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) return;
  if (interaction.commandName === "help") return handleHelp(interaction);
  if (interaction.commandName === "setup") return handleSetup(interaction);
  if (interaction.commandName === "nexus") return handleNexus(interaction);
  if (interaction.commandName === "xp") return handleXp(interaction);
}

async function memberFromArg(message: Message, arg: string | undefined) {
  if (!message.guild) return null;
  if (message.mentions.members?.first()) return message.mentions.members.first()!;
  if (arg && /^\d{15,25}$/.test(arg)) return message.guild.members.fetch(arg).catch(() => null);
  return message.member;
}

function hasOnlyMentionOrIdArg(args: string[]) {
  if (args.length === 1) return true;
  if (args.length !== 2) return false;
  return /^<@!?\d{15,25}>$/.test(args[1]) || /^\d{15,25}$/.test(args[1]);
}

function hasOnlyTopArgs(args: string[]) {
  if (args.length === 1) return true;
  const typeArg = args[1]?.toLowerCase();
  if (leaderboardTypes.includes(typeArg ?? "")) return args.length === 2 || (args.length === 3 && /^\d+$/.test(args[2]));
  return args.length === 2 && /^\d+$/.test(args[1]);
}

export async function handlePrefixMessage(message: Message) {
  if (!message.guild || message.author.bot) return;
  const config = getConfig(message.guild.id);
  const trimmed = message.content.trim();
  if (!trimmed) return;
  const args = trimmed.split(/\s+/g);
  const command = args[0]?.toLowerCase();
  const rankAliases = new Set([config.prefix.toLowerCase(), "r", "rank"]);
  const prefixHelp = `${config.prefix.toLowerCase()}help`;
  const isMemberCommand = command === prefixHelp || rankAliases.has(command) || command === "l" || command === "level" || command === "s" || command === "stats" || command === "statistics" || command === "top" || command === "leaderboard";

  if (isMemberCommand && isCommandBlockedChannel(message.guild.id, message.channelId)) return;
  if (isMemberCommand) {
    const parentId = (message.channel as any)?.parentId ?? null;
    if (!isCommandAllowedHere(message.guild.id, message.channelId, parentId)) return;
  }

  if (command === prefixHelp) {
    if (args.length !== 1) return;
    await message.reply({ embeds: [buildMemberHelpEmbed(message.guild.id)] });
    return;
  }

  if (rankAliases.has(command)) {
    if (!hasOnlyMentionOrIdArg(args) && args[1]?.toLowerCase() !== "help") return;
    if (args[1]?.toLowerCase() === "help") {
      await message.reply({ embeds: [buildHelpEmbed(message.guild.id)] });
      return;
    }
    const member = await memberFromArg(message, args[1]);
    if (!member) return;
    const stats = ensureUser(message.guild.id, member.id, member.user.username, member.displayAvatarURL({ extension: "png", size: 128 }));
    const file = await rankCard(member, stats);
    await message.reply({ files: [file] });
    return;
  }

  if (command === "l" || command === "level") {
    if (!hasOnlyMentionOrIdArg(args)) return;
    const member = await memberFromArg(message, args[1]);
    if (!member) return;
    const stats = ensureUser(message.guild.id, member.id, member.user.username, member.displayAvatarURL({ extension: "png", size: 128 }));
    const file = await levelCard(member, stats);
    await message.reply({ files: [file] });
    return;
  }

  if (command === "top" || command === "leaderboard") {
    if (!hasOnlyTopArgs(args)) return;
    const firstArg = args[1]?.toLowerCase();
    const type = normalizeType(firstArg);
    const pageArg = leaderboardTypes.includes(firstArg ?? "") ? args[2] : args[1];
    const page = Math.max(1, Number(pageArg ?? 1) || 1);
    await sendTop(message, type, page);
    return;
  }

  if (command === "s" || command === "stats" || command === "statistics") {
    if (args.length !== 1) return;
    await sendStats(message, "overview", 1);
    return;
  }

  if (command === "reward") {
    const giver = message.member;
    if (!giver || !canGiveReward(giver)) return message.reply("You need a Reward Giver role to use this command.");
    const target = await memberFromArg(message, args[1]);
    if (!target || target.id === giver.id || target.user.bot) return message.reply("Mention one server member to reward.");
    if (config.jailRoleId && target.roles.cache.has(config.jailRoleId)) return message.reply("That member is jailed, so they cannot receive rewards right now.");
    const existing = getTodayRewardGrant(message.guild.id, target.id);
    if (existing) return message.reply(`${target} already received today's reward.`);
    const grant = recordRewardGrant(message.guild.id, target.id, giver.id, config.rewardXpAmount);
    if (!grant) return message.reply(`${target} already received today's reward.`);
    const level = addRewardXp(target, config.rewardXpAmount);
    await message.reply(`${target} received today's reward and is now level ${level}.`);
    return;
  }
}
