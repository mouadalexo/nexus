import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, Client, EmbedBuilder, GuildMember, Message, ModalBuilder, ModalSubmitInteraction, PermissionsBitField, REST, Routes, SlashCommandBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { env } from "./config.js";
import { countUsers, getConfig, updateConfig, ensureUser, getLeaderboard, getRewards, setReward, toggleList, getManagerRoles, setEventVoiceChannel, getEventVoiceChannels, getRewardGiverRoles, hasRewardGiverRole, getTodayRewardGrant, recordRewardGrant, type LeaderboardType } from "./db.js";
import { rankCard, levelCard, topCard } from "./cards.js";
import { addRewardXp, canManageLevels, setLevel } from "./leveling.js";

const brand = 0x6f55ff;
const leaderboardTypes = ["overall", "text", "voice", "messages"];

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
  return new EmbedBuilder()
    .setColor(brand)
    .setTitle("🌌 Nexus Setup Panel")
    .setDescription("Manage leveling, rewards, jail, XP rates, and messages from one clear panel. Use the colored buttons below to update one section at a time.")
    .addFields(
      { name: "📌 Member Commands", value: "`R` rank\n`L` level\n`Top` overall leaderboard\n`Reward @user` daily reward", inline: true },
      { name: "⚡ Leveling Speed", value: `Text ${config.textMinXp}-${config.textMaxXp} / ${config.textCooldownSeconds}s\nVoice ${config.voiceXpPerMinute}/min\nCurve: easy early, harder later`, inline: true },
      { name: "📣 Level Up Message", value: `Channel: ${config.levelupChannelId ? `<#${config.levelupChannelId}>` : "default"}\n${config.levelupMessage.slice(0, 180)}`, inline: false },
      { name: "🎁 Reward Giver", value: `Daily reward: ${config.rewardXpAmount} hidden XP\nRoles: ${rewardGivers.length ? rewardGivers.map((r) => `<@&${r}>`).join(" ") : "No reward giver roles"}\nLimit: one reward per member per day`, inline: false },
      { name: "🚫 Jail Role", value: config.jailRoleId ? `<@&${config.jailRoleId}> resets members to level 0 and blocks XP while jailed.` : "No jail role set.", inline: false },
      { name: "🏅 Level Rewards", value: rewards.length ? rewards.map((r) => `Level ${r.level} -> <@&${r.roleId}>`).join("\n").slice(0, 900) : "No level rewards set", inline: false },
      { name: "🛠️ Managers / Event Stage", value: `Managers: ${managers.length ? managers.map((r) => `<@&${r}>`).join(" ") : "Admins only"}\nEvent voice: ${events.length ? events.map((e) => `<#${e.channelId}> x${e.multiplier}`).join(", ") : "none"}`, inline: false },
    );
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
      new ButtonBuilder().setCustomId("nexus_panel:jail_role").setLabel("🚫 Jail Role").setStyle(ButtonStyle.Danger),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("nexus_panel:level_message").setLabel("📣 Level Message").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("nexus_panel:level_channel").setLabel("📍 Level Channel").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("nexus_panel:xp_rates").setLabel("⚡ XP Rates").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("nexus_panel:add_reward").setLabel("🏅 Level Reward").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("nexus_panel:ignore_role").setLabel("🙈 Ignore Role").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("nexus_panel:ignore_channel").setLabel("🔇 Ignore Channel").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("nexus_panel:event_stage").setLabel("🎤 Event Voice").setStyle(ButtonStyle.Success),
    ),
  ];
}

function rewardRows() {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("nexus_panel:reward_amount").setLabel("💎 Set Amount").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("nexus_panel:reward_role").setLabel("Reward Giver Role").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("nexus_panel:view").setLabel("⬅️ Back to Setup").setStyle(ButtonStyle.Secondary),
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
  return interaction.reply({ embeds: [setupEmbed(interaction.guild!.id)], components: setupRows(), ephemeral: true });
}

function extractId(value: string) {
  return value.replace(/[^0-9]/g, "");
}

function boolValue(value: string) {
  return !["false", "off", "no", "0", "remove", "disable"].includes(value.trim().toLowerCase());
}

async function openSetupModal(interaction: ButtonInteraction, action: string) {
  if (!requireManager(interaction.member as GuildMember)) return interaction.reply({ content: "You do not have permission to use the setup panel.", ephemeral: true });
  if (action === "view") return interaction.update({ embeds: [setupEmbed(interaction.guild!.id)], components: setupRows() });
  if (action === "reward_system") return interaction.update({ embeds: [rewardEmbed(interaction.guild!.id)], components: rewardRows() });
  if (action === "reward_amount") return interaction.showModal(modal("nexus_modal:reward_amount", "Set Daily Reward Amount", [textInput("amount", "Reward amount", "75") ]));
  if (action === "reward_role") return interaction.showModal(modal("nexus_modal:reward_role", "Reward Giver Role", [textInput("role", "Role ID or mention", "@Reward Giver or 123456789"), textInput("enabled", "Enable this role?", "true or false") ]));
  if (action === "jail_role") return interaction.showModal(modal("nexus_modal:jail_role", "Set Jail Role", [textInput("role", "Jail role ID or mention", "@Jailed or 123456789. Leave 0 to remove") ]));
  if (action === "level_message") return interaction.showModal(modal("nexus_modal:level_message", "Set Level Up Message", [textInput("message", "Message", "Use {user} {username} {level} {rank}")]));
  if (action === "level_channel") return interaction.showModal(modal("nexus_modal:level_channel", "Set Level Up Channel", [textInput("channel", "Channel ID or mention", "#levels or 123456789")]));
  if (action === "xp_rates") return interaction.showModal(modal("nexus_modal:xp_rates", "Set XP Rates", [textInput("textMin", "Text minimum", "8"), textInput("textMax", "Text maximum", "15"), textInput("cooldown", "Text cooldown seconds", "90"), textInput("voice", "Voice per minute", "12")]));
  if (action === "add_reward") return interaction.showModal(modal("nexus_modal:add_reward", "Add Level Role Reward", [textInput("level", "Level", "10"), textInput("role", "Role ID or mention", "@Role or 123456789")]));
  if (action === "ignore_role") return interaction.showModal(modal("nexus_modal:ignore_role", "Ignore Role", [textInput("role", "Role ID or mention", "@Role or 123456789"), textInput("enabled", "Enable ignore?", "true or false")]));
  if (action === "ignore_channel") return interaction.showModal(modal("nexus_modal:ignore_channel", "Ignore Channel", [textInput("channel", "Channel ID or mention", "#channel or 123456789"), textInput("kind", "Kind", "all, text, or voice"), textInput("enabled", "Enable ignore?", "true or false")]));
  if (action === "event_stage") return interaction.showModal(modal("nexus_modal:event_stage", "Setup Event Stage Voice", [textInput("channel", "Voice channel ID or mention", "voice channel or 123456789"), textInput("multiplier", "XP multiplier", "1, 2, or 3")]));
}

async function handleSetupModal(interaction: ModalSubmitInteraction) {
  if (!interaction.guild || !requireManager(interaction.member as GuildMember)) return interaction.reply({ content: "You do not have permission to update Nexus setup.", ephemeral: true });
  const action = interaction.customId.split(":")[1];
  const guildId = interaction.guild.id;
  if (action === "reward_amount") updateConfig(guildId, { rewardXpAmount: Math.max(1, Number(interaction.fields.getTextInputValue("amount")) || 75) });
  if (action === "reward_role") {
    const roleId = extractId(interaction.fields.getTextInputValue("role"));
    if (roleId) toggleList("reward_giver_roles", guildId, roleId, boolValue(interaction.fields.getTextInputValue("enabled")));
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
  if (action === "ignore_role") {
    const roleId = extractId(interaction.fields.getTextInputValue("role"));
    if (roleId) toggleList("ignored_roles", guildId, roleId, boolValue(interaction.fields.getTextInputValue("enabled")));
  }
  if (action === "ignore_channel") {
    const channelId = extractId(interaction.fields.getTextInputValue("channel"));
    const kindInput = interaction.fields.getTextInputValue("kind").trim().toLowerCase();
    const kind = ["text", "voice", "all"].includes(kindInput) ? kindInput : "all";
    if (channelId) toggleList("ignored_channels", guildId, channelId, boolValue(interaction.fields.getTextInputValue("enabled")), kind);
  }
  if (action === "event_stage") {
    const channelId = extractId(interaction.fields.getTextInputValue("channel"));
    if (channelId) setEventVoiceChannel(guildId, channelId, Math.max(1, Math.min(3, Number(interaction.fields.getTextInputValue("multiplier")) || 1)));
  }
  const isRewardAction = action === "reward_amount" || action === "reward_role";
  return interaction.reply({ content: "Nexus setup updated.", embeds: [isRewardAction ? rewardEmbed(guildId) : setupEmbed(guildId)], components: isRewardAction ? rewardRows() : setupRows(), ephemeral: true });
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
  return interaction.reply({ content: `${member} level was updated.`, ephemeral: true });
}

function buildHelpEmbed(guildId: string) {
  const config = getConfig(guildId);
  return new EmbedBuilder()
    .setColor(brand)
    .setTitle("✨ Nexus Leveling Guide")
    .setDescription("A clean level system for Night Stars. Early levels are easy, higher levels become harder with a progressive curve.")
    .addFields(
      { name: "📌 Member Commands", value: "`R` or `R @user` - Rank card\n`L` or `L @user` - Level card\n`Top` - Overall level leaderboard\n`Top voice`, `Top text`, `Top messages` - Other leaderboards", inline: false },
      { name: "🎁 Reward Giver", value: `Reward givers type \`Reward @user\` to give ${config.rewardXpAmount} hidden XP. A member can receive only one reward per day.`, inline: false },
      { name: "🛠️ Staff Setup", value: "`/setup` - Open the full button panel\n`/nexus prefix` - Change rank shortcut prefix\n`/xp set-level` - Set a member level", inline: false },
      { name: "🚫 Jail System", value: "When the jail role is added, Nexus resets that member to level 0 and blocks XP while they remain jailed. When unjailed, they start again from the beginning.", inline: false },
    )
    .setFooter({ text: "Nexus - Night Stars Leveling" })
    .setTimestamp();
}

async function handleHelp(interaction: ChatInputCommandInteraction) {
  await interaction.reply({ embeds: [buildHelpEmbed(interaction.guild!.id)], ephemeral: true });
}

export async function handleButtonInteraction(interaction: ButtonInteraction) {
  if (!interaction.guild) return;
  if (interaction.customId.startsWith("nexus_panel:")) return openSetupModal(interaction, interaction.customId.split(":")[1]);
  if (!interaction.customId.startsWith("nexus_top:")) return;
  const [, rawType, rawPage] = interaction.customId.split(":");
  const type = normalizeType(rawType);
  const page = Math.max(1, Number(rawPage) || 1);
  return sendTop(interaction, type, page);
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

export async function handlePrefixMessage(message: Message) {
  if (!message.guild || message.author.bot) return;
  const config = getConfig(message.guild.id);
  const trimmed = message.content.trim();
  if (!trimmed) return;
  const args = trimmed.split(/\s+/g);
  const command = args[0]?.toLowerCase();
  const rankAliases = new Set([config.prefix.toLowerCase(), "r", "rank"]);

  if (rankAliases.has(command)) {
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
    const member = await memberFromArg(message, args[1]);
    if (!member) return;
    const stats = ensureUser(message.guild.id, member.id, member.user.username, member.displayAvatarURL({ extension: "png", size: 128 }));
    const file = await levelCard(member, stats);
    await message.reply({ files: [file] });
    return;
  }

  if (command === "top" || command === "leaderboard") {
    const firstArg = args[1]?.toLowerCase();
    const type = normalizeType(firstArg);
    const pageArg = leaderboardTypes.includes(firstArg ?? "") ? args[2] : args[1];
    const page = Math.max(1, Number(pageArg ?? 1) || 1);
    await sendTop(message, type, page);
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

  if (command === "help") {
    await message.reply({ embeds: [buildHelpEmbed(message.guild.id)] });
  }
}
