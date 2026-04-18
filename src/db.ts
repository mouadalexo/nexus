import fs from "node:fs";
import path from "node:path";
import { env } from "./config.js";

export type GuildConfig = {
  guildId: string;
  prefix: string;
  levelupChannelId: string | null;
  levelupMessage: string;
  textMinXp: number;
  textMaxXp: number;
  textCooldownSeconds: number;
  voiceXpPerMinute: number;
  stackRewards: number;
  ignoreMutedVoice: number;
  rewardXpAmount: number;
  jailRoleId: string | null;
};

export type EventVoiceChannel = { guildId: string; channelId: string; multiplier: number };

export type UserStats = {
  guildId: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  textXp: number;
  voiceXp: number;
  textMessages: number;
  voiceSeconds: number;
  level: number;
  updatedAt: string;
};

export type LeaderboardType = "overall" | "text" | "voice" | "messages";

type DailyStats = { guildId: string; userId: string; day: string; textMessages: number; voiceSeconds: number; textXp: number; voiceXp: number };
type ChannelStats = { guildId: string; channelId: string; kind: "text" | "voice"; textMessages: number; voiceSeconds: number };
export type RewardGrant = { guildId: string; targetUserId: string; giverUserId: string; day: string; amount: number; createdAt: string };

type Store = {
  configs: Record<string, GuildConfig>;
  users: Record<string, UserStats>;
  daily: Record<string, DailyStats>;
  channels: Record<string, ChannelStats>;
  rewards: { guildId: string; level: number; roleId: string }[];
  ignoredChannels: { guildId: string; channelId: string; kind: string }[];
  ignoredRoles: { guildId: string; roleId: string }[];
  managerRoles: { guildId: string; roleId: string }[];
  eventVoiceChannels: EventVoiceChannel[];
  rewardGiverRoles: { guildId: string; roleId: string }[];
  rewardGrants: RewardGrant[];
};

const emptyStore = (): Store => ({ configs: {}, users: {}, daily: {}, channels: {}, rewards: [], ignoredChannels: [], ignoredRoles: [], managerRoles: [], eventVoiceChannels: [], rewardGiverRoles: [], rewardGrants: [] });
fs.mkdirSync(path.dirname(env.databasePath), { recursive: true });
const filePath = env.databasePath.endsWith(".sqlite") ? env.databasePath.replace(/\.sqlite$/, ".json") : env.databasePath;
let store: Store = emptyStore();

try {
  if (fs.existsSync(filePath)) store = { ...emptyStore(), ...JSON.parse(fs.readFileSync(filePath, "utf8")) };
} catch {
  store = emptyStore();
}

let saveTimer: NodeJS.Timeout | null = null;
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store));
    fs.renameSync(tmp, filePath);
  }, 750);
}

export function flushStore() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, filePath);
}

function userKey(guildId: string, userId: string) {
  return `${guildId}:${userId}`;
}

function dailyKey(guildId: string, userId: string, day: string) {
  return `${guildId}:${userId}:${day}`;
}

function channelKey(guildId: string, channelId: string, kind: string) {
  return `${guildId}:${channelId}:${kind}`;
}

export function getConfig(guildId: string): GuildConfig {
  store.configs[guildId] ??= {
    guildId,
    prefix: env.defaultPrefix,
    levelupChannelId: null,
    levelupMessage: "{user} reached level {level}! Rank #{rank}",
    textMinXp: 8,
    textMaxXp: 15,
    textCooldownSeconds: 90,
    voiceXpPerMinute: 12,
    stackRewards: 1,
    ignoreMutedVoice: 1,
    rewardXpAmount: 75,
    jailRoleId: null,
  };
  store.configs[guildId].rewardXpAmount ??= 75;
  store.configs[guildId].jailRoleId ??= null;
  return store.configs[guildId];
}

export function ensureUser(guildId: string, userId: string, username: string, avatarUrl: string | null): UserStats {
  const key = userKey(guildId, userId);
  store.users[key] ??= { guildId, userId, username, avatarUrl, textXp: 0, voiceXp: 0, textMessages: 0, voiceSeconds: 0, level: 0, updatedAt: new Date().toISOString() };
  store.users[key].username = username;
  store.users[key].avatarUrl = avatarUrl;
  store.users[key].updatedAt = new Date().toISOString();
  saveSoon();
  return store.users[key];
}

export function getUser(guildId: string, userId: string): UserStats | null {
  return store.users[userKey(guildId, userId)] ?? null;
}

export function addActivity(input: { guildId: string; userId: string; username: string; avatarUrl: string | null; textXp?: number; voiceXp?: number; textMessages?: number; voiceSeconds?: number; channelId?: string; channelKind?: "text" | "voice"; level: number }) {
  const user = ensureUser(input.guildId, input.userId, input.username, input.avatarUrl);
  user.textXp += input.textXp ?? 0;
  user.voiceXp += input.voiceXp ?? 0;
  user.textMessages += input.textMessages ?? 0;
  user.voiceSeconds += input.voiceSeconds ?? 0;
  user.level = input.level;
  user.updatedAt = new Date().toISOString();
  const day = new Date().toISOString().slice(0, 10);
  const dKey = dailyKey(input.guildId, input.userId, day);
  store.daily[dKey] ??= { guildId: input.guildId, userId: input.userId, day, textMessages: 0, voiceSeconds: 0, textXp: 0, voiceXp: 0 };
  store.daily[dKey].textMessages += input.textMessages ?? 0;
  store.daily[dKey].voiceSeconds += input.voiceSeconds ?? 0;
  store.daily[dKey].textXp += input.textXp ?? 0;
  store.daily[dKey].voiceXp += input.voiceXp ?? 0;
  if (input.channelId && input.channelKind) {
    const cKey = channelKey(input.guildId, input.channelId, input.channelKind);
    store.channels[cKey] ??= { guildId: input.guildId, channelId: input.channelId, kind: input.channelKind, textMessages: 0, voiceSeconds: 0 };
    store.channels[cKey].textMessages += input.textMessages ?? 0;
    store.channels[cKey].voiceSeconds += input.voiceSeconds ?? 0;
  }
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  for (const key of Object.keys(store.daily)) if (store.daily[key].day < cutoff) delete store.daily[key];
  saveSoon();
}

export function setUserXp(guildId: string, userId: string, textXp: number, voiceXp: number, level: number) {
  const user = store.users[userKey(guildId, userId)];
  if (!user) return;
  user.textXp = Math.max(0, Math.floor(textXp));
  user.voiceXp = Math.max(0, Math.floor(voiceXp));
  user.level = level;
  user.updatedAt = new Date().toISOString();
  saveSoon();
}

export function getRanks(guildId: string, userId: string) {
  const users = Object.values(store.users).filter((u) => u.guildId === guildId);
  const current = store.users[userKey(guildId, userId)];
  if (!current) return { overall: 1, text: 1, voice: 1, messages: 1 };
  return {
    overall: users.filter((u) => u.textXp + u.voiceXp > current.textXp + current.voiceXp).length + 1,
    text: users.filter((u) => u.textXp > current.textXp).length + 1,
    voice: users.filter((u) => u.voiceXp > current.voiceXp).length + 1,
    messages: users.filter((u) => u.textMessages > current.textMessages).length + 1,
  };
}

export function getLeaderboard(guildId: string, type: LeaderboardType, limit: number, offset: number): UserStats[] {
  const score = (u: UserStats) => type === "voice" ? u.voiceXp : type === "text" ? u.textXp : type === "messages" ? u.textMessages : u.textXp + u.voiceXp;
  return Object.values(store.users).filter((u) => u.guildId === guildId).sort((a, b) => score(b) - score(a) || a.updatedAt.localeCompare(b.updatedAt)).slice(offset, offset + limit);
}

export function countUsers(guildId: string) {
  return Object.values(store.users).filter((u) => u.guildId === guildId).length;
}

export function getRewards(guildId: string) {
  return store.rewards.filter((r) => r.guildId === guildId).sort((a, b) => a.level - b.level);
}

export function setReward(guildId: string, level: number, roleId: string) {
  if (!store.rewards.some((r) => r.guildId === guildId && r.level === level && r.roleId === roleId)) store.rewards.push({ guildId, level, roleId });
  saveSoon();
}

export function removeReward(guildId: string, level: number, roleId?: string) {
  store.rewards = store.rewards.filter((r) => !(r.guildId === guildId && r.level === level && (!roleId || r.roleId === roleId)));
  saveSoon();
}

export function hasIgnoredRole(guildId: string, roleIds: string[]) {
  return store.ignoredRoles.some((r) => r.guildId === guildId && roleIds.includes(r.roleId));
}

export function isIgnoredChannel(guildId: string, channelId: string, kind: "text" | "voice") {
  return store.ignoredChannels.some((c) => c.guildId === guildId && c.channelId === channelId && (c.kind === "all" || c.kind === kind));
}

export function toggleList(table: "ignored_channels" | "ignored_roles" | "manager_roles" | "reward_giver_roles", guildId: string, id: string, enabled: boolean, kind = "all") {
  if (table === "ignored_channels") {
    store.ignoredChannels = store.ignoredChannels.filter((x) => !(x.guildId === guildId && x.channelId === id));
    if (enabled) store.ignoredChannels.push({ guildId, channelId: id, kind });
  } else if (table === "ignored_roles") {
    store.ignoredRoles = store.ignoredRoles.filter((x) => !(x.guildId === guildId && x.roleId === id));
    if (enabled) store.ignoredRoles.push({ guildId, roleId: id });
  } else if (table === "manager_roles") {
    store.managerRoles = store.managerRoles.filter((x) => !(x.guildId === guildId && x.roleId === id));
    if (enabled) store.managerRoles.push({ guildId, roleId: id });
  } else {
    store.rewardGiverRoles = store.rewardGiverRoles.filter((x) => !(x.guildId === guildId && x.roleId === id));
    if (enabled) store.rewardGiverRoles.push({ guildId, roleId: id });
  }
  saveSoon();
}

export function getManagerRoles(guildId: string) {
  return store.managerRoles.filter((r) => r.guildId === guildId).map((r) => r.roleId);
}

export function updateConfig(guildId: string, fields: Partial<GuildConfig>) {
  const config = getConfig(guildId);
  Object.assign(config, fields, { guildId });
  saveSoon();
}


export function getEventVoiceChannels(guildId: string) {
  return store.eventVoiceChannels.filter((c) => c.guildId === guildId).sort((a, b) => a.channelId.localeCompare(b.channelId));
}

export function getVoiceXpMultiplier(guildId: string, channelId: string) {
  return store.eventVoiceChannels.find((c) => c.guildId === guildId && c.channelId === channelId)?.multiplier ?? 1;
}

export function setEventVoiceChannel(guildId: string, channelId: string, multiplier: number) {
  store.eventVoiceChannels = store.eventVoiceChannels.filter((c) => !(c.guildId === guildId && c.channelId === channelId));
  const safeMultiplier = Math.min(3, Math.max(1, Math.floor(multiplier)));
  if (safeMultiplier > 1) store.eventVoiceChannels.push({ guildId, channelId, multiplier: safeMultiplier });
  saveSoon();
}


export function getRewardGiverRoles(guildId: string) {
  return store.rewardGiverRoles.filter((r) => r.guildId === guildId).map((r) => r.roleId);
}

export function hasRewardGiverRole(guildId: string, roleIds: string[]) {
  return store.rewardGiverRoles.some((r) => r.guildId === guildId && roleIds.includes(r.roleId));
}

export function getTodayRewardGrant(guildId: string, targetUserId: string) {
  const day = new Date().toISOString().slice(0, 10);
  return store.rewardGrants.find((r) => r.guildId === guildId && r.targetUserId === targetUserId && r.day === day) ?? null;
}

export function recordRewardGrant(guildId: string, targetUserId: string, giverUserId: string, amount: number) {
  const day = new Date().toISOString().slice(0, 10);
  const existing = store.rewardGrants.find((r) => r.guildId === guildId && r.targetUserId === targetUserId && r.day === day);
  if (existing) return null;
  const cutoff = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
  store.rewardGrants = store.rewardGrants.filter((r) => r.day >= cutoff);
  const grant = { guildId, targetUserId, giverUserId, day, amount: Math.max(0, Math.floor(amount)), createdAt: new Date().toISOString() };
  store.rewardGrants.push(grant);
  saveSoon();
  return grant;
}

export function resetUserStats(guildId: string, userId: string, username: string, avatarUrl: string | null) {
  const user = ensureUser(guildId, userId, username, avatarUrl);
  user.textXp = 0;
  user.voiceXp = 0;
  user.textMessages = 0;
  user.voiceSeconds = 0;
  user.level = 0;
  user.updatedAt = new Date().toISOString();
  saveSoon();
  return user;
}
