import type { GuildMember, TextBasedChannel } from "discord.js";
import { getConfig, getRewards, getRanks, getManagerRoles, addActivity, ensureUser, getUser, setUserXp, hasIgnoredRole, isIgnoredChannel } from "./db.js";

const textCooldowns = new Map<string, number>();

export function totalXp(stats: { textXp: number; voiceXp: number }) {
  return stats.textXp + stats.voiceXp;
}

export function xpNeededForNext(level: number) {
  return 100 + level * 50 + level * level * 5;
}

export function xpAtLevel(level: number) {
  let total = 0;
  for (let i = 0; i < level; i += 1) total += xpNeededForNext(i);
  return total;
}

export function levelFromXp(xp: number) {
  let level = 0;
  let remaining = Math.max(0, Math.floor(xp));
  while (remaining >= xpNeededForNext(level) && level < 500) {
    remaining -= xpNeededForNext(level);
    level += 1;
  }
  return level;
}

export function progressForLevel(xp: number) {
  const level = levelFromXp(xp);
  const base = xpAtLevel(level);
  const needed = xpNeededForNext(level);
  const progress = Math.max(0, xp - base);
  return { level, base, needed, progress, nextLevel: level + 1, percent: needed > 0 ? Math.min(1, progress / needed) : 1 };
}

export function isMilestone(level: number) {
  return level === 1 || level === 5 || level === 10 || level === 20 || level === 30 || (level > 30 && level % 10 === 0);
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function cooldownKey(guildId: string, userId: string) {
  return `${guildId}:${userId}`;
}

export async function processTextXp(member: GuildMember, channel: TextBasedChannel, contentChannelId: string) {
  if (member.user.bot) return null;
  const guildId = member.guild.id;
  const config = getConfig(guildId);
  if (isIgnoredChannel(guildId, contentChannelId, "text")) return null;
  if (hasIgnoredRole(guildId, member.roles.cache.map((r) => r.id))) return null;
  const key = cooldownKey(guildId, member.id);
  const now = Date.now();
  const nextAllowed = textCooldowns.get(key) ?? 0;
  if (now < nextAllowed) return null;
  textCooldowns.set(key, now + config.textCooldownSeconds * 1000);
  const before = ensureUser(guildId, member.id, member.user.username, member.displayAvatarURL({ extension: "png", size: 128 }));
  const beforeLevel = levelFromXp(totalXp(before));
  const xp = randomInt(Math.min(config.textMinXp, config.textMaxXp), Math.max(config.textMinXp, config.textMaxXp));
  const afterTotal = totalXp(before) + xp;
  const afterLevel = levelFromXp(afterTotal);
  addActivity({ guildId, userId: member.id, username: member.user.username, avatarUrl: member.displayAvatarURL({ extension: "png", size: 128 }), textXp: xp, textMessages: 1, level: afterLevel, channelId: contentChannelId, channelKind: "text" });
  return afterLevel > beforeLevel ? { member, oldLevel: beforeLevel, newLevel: afterLevel, channel, xpGained: xp } : null;
}

export async function processVoiceMinute(member: GuildMember, channelId: string) {
  if (member.user.bot) return null;
  const guildId = member.guild.id;
  const config = getConfig(guildId);
  if (isIgnoredChannel(guildId, channelId, "voice")) return null;
  if (hasIgnoredRole(guildId, member.roles.cache.map((r) => r.id))) return null;
  if (config.ignoreMutedVoice && (member.voice.selfMute || member.voice.serverMute || member.voice.selfDeaf || member.voice.serverDeaf)) return null;
  const before = ensureUser(guildId, member.id, member.user.username, member.displayAvatarURL({ extension: "png", size: 128 }));
  const beforeLevel = levelFromXp(totalXp(before));
  const xp = Math.max(1, Math.floor(config.voiceXpPerMinute));
  const afterLevel = levelFromXp(totalXp(before) + xp);
  addActivity({ guildId, userId: member.id, username: member.user.username, avatarUrl: member.displayAvatarURL({ extension: "png", size: 128 }), voiceXp: xp, voiceSeconds: 60, level: afterLevel, channelId, channelKind: "voice" });
  return afterLevel > beforeLevel ? { member, oldLevel: beforeLevel, newLevel: afterLevel, xpGained: xp } : null;
}

export async function applyRewards(member: GuildMember, newLevel: number) {
  const config = getConfig(member.guild.id);
  const rewards = getRewards(member.guild.id);
  const eligible = rewards.filter((r) => r.level <= newLevel);
  if (!eligible.length) return [];
  const highestLevel = Math.max(...eligible.map((r) => r.level));
  const toGive = config.stackRewards ? eligible : eligible.filter((r) => r.level === highestLevel);
  const toRemove = config.stackRewards ? [] : rewards.filter((r) => r.level < highestLevel);
  const added: string[] = [];
  for (const reward of toRemove) {
    if (member.roles.cache.has(reward.roleId)) await member.roles.remove(reward.roleId).catch(() => null);
  }
  for (const reward of toGive) {
    if (!member.roles.cache.has(reward.roleId)) {
      await member.roles.add(reward.roleId).then(() => added.push(reward.roleId)).catch(() => null);
    }
  }
  return added;
}

export async function sendLevelAnnouncement(member: GuildMember, level: number, fallbackChannel?: TextBasedChannel | null) {
  if (!isMilestone(level)) return;
  const config = getConfig(member.guild.id);
  const stats = getUser(member.guild.id, member.id);
  const ranks = getRanks(member.guild.id, member.id);
  const message = config.levelupMessage
    .replaceAll("{user}", `<@${member.id}>`)
    .replaceAll("{username}", member.user.username)
    .replaceAll("{level}", String(level))
    .replaceAll("{rank}", String(ranks.overall))
    .replaceAll("{totalXp}", String(stats ? totalXp(stats) : 0));
  const channel = config.levelupChannelId ? await member.guild.channels.fetch(config.levelupChannelId).catch(() => null) : fallbackChannel;
  if (channel?.isTextBased()) await channel.send({ content: message, allowedMentions: { users: [member.id], roles: [] } }).catch(() => null);
}

export function canManageLevels(member: GuildMember) {
  if (member.permissions.has("Administrator")) return true;
  const roles = getManagerRolesSafe(member.guild.id);
  return roles.some((roleId) => member.roles.cache.has(roleId));
}

function getManagerRolesSafe(guildId: string) {
  return getManagerRoles(guildId);
}

export function setLevel(member: GuildMember, level: number) {
  const current = ensureUser(member.guild.id, member.id, member.user.username, member.displayAvatarURL({ extension: "png", size: 128 }));
  const targetTotal = xpAtLevel(Math.max(0, level));
  const textShare = totalXp(current) > 0 ? current.textXp / totalXp(current) : 0.5;
  const textXp = Math.floor(targetTotal * textShare);
  const voiceXp = targetTotal - textXp;
  setUserXp(member.guild.id, member.id, textXp, voiceXp, Math.max(0, level));
}

export function addManualXp(member: GuildMember, amount: number) {
  const current = ensureUser(member.guild.id, member.id, member.user.username, member.displayAvatarURL({ extension: "png", size: 128 }));
  const textXp = Math.max(0, current.textXp + Math.floor(amount));
  const level = levelFromXp(textXp + current.voiceXp);
  setUserXp(member.guild.id, member.id, textXp, current.voiceXp, level);
  return level;
}
