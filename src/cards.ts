import sharp from "sharp";
import { AttachmentBuilder, Guild, GuildMember } from "discord.js";
import type { ChannelStats, LeaderboardType, UserStats } from "./db.js";
import { countChannels, countUsers, getRanks } from "./db.js";
import { progressForLevel, totalXp } from "./leveling.js";

const W = 1000;
const H = 420;
const purple = "#6f55ff";
const blue = "#4f8dff";
const cyan = "#8fc7ff";
const lavender = "#b8a7ff";
const textMain = "#f8fbff";
const textSoft = "#b8c4de";
const panelFill = "url(#panel)";

function esc(value: string) {
  return value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function cleanLabel(value: string, fallback: string) {
  const cleaned = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
  return /[A-Za-z0-9]{2,}/.test(cleaned) ? cleaned : fallback;
}

function compact(n: number) {
  return new Intl.NumberFormat("en-US", { notation: n >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(Math.floor(n));
}

function hours(seconds: number) {
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function cardDefs(height = H) {
  return `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#050a19"/><stop offset="0.48" stop-color="#101d46"/><stop offset="1" stop-color="#371074"/></linearGradient><linearGradient id="panel" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#152451"/><stop offset="1" stop-color="#0a1024"/></linearGradient><linearGradient id="glow" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#4f8dff" stop-opacity="0.55"/><stop offset="1" stop-color="#6f55ff" stop-opacity="0.25"/></linearGradient><filter id="shadow"><feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#000814" flood-opacity="0.55"/></filter><filter id="soft"><feGaussianBlur stdDeviation="34"/></filter></defs><rect width="1000" height="${height}" rx="30" fill="url(#bg)"/><ellipse cx="765" cy="95" rx="315" ry="115" fill="#4f8dff" opacity="0.16" filter="url(#soft)"/><path d="M565 0 C710 72 740 205 1000 145 L1000 ${height} L382 ${height} C432 305 410 88 565 0Z" fill="url(#glow)"/>`;
}

function progressBar(x: number, y: number, width: number, pct: number, color: string) {
  const fill = Math.max(8, Math.floor(width * Math.min(1, Math.max(0, pct))));
  return `<rect x="${x}" y="${y}" width="${width}" height="18" rx="9" fill="#e8efff" opacity="0.9"/><rect x="${x}" y="${y}" width="${fill}" height="18" rx="9" fill="${color}"/>`;
}

async function avatarComposite(url: string | null, x: number, y: number, size: number) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const input = Buffer.from(await res.arrayBuffer());
    const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`);
    const image = await sharp(input).resize(size, size).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
    return { input: image, left: x, top: y };
  } catch {
    return null;
  }
}

async function render(svg: string, composites: any[] = []) {
  return sharp(Buffer.from(svg)).composite(composites.filter(Boolean)).png().toBuffer();
}

export async function rankCard(member: GuildMember, stats: UserStats) {
  const ranks = getRanks(member.guild.id, member.id);
  const text = progressForLevel(stats.textXp);
  const voice = progressForLevel(stats.voiceXp);
  const overall = progressForLevel(totalXp(stats));
  const displayName = cleanLabel(member.displayName, member.user.username);
  const username = cleanLabel(member.user.username, "member");
  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    ${cardDefs()}
    <circle cx="135" cy="135" r="95" fill="#050814" stroke="${purple}" stroke-width="5"/>
    <text x="260" y="82" font-family="Arial, sans-serif" font-size="44" font-weight="800" fill="${textMain}">${esc(displayName)}</text>
    <text x="262" y="120" font-family="Arial, sans-serif" font-size="24" fill="${textSoft}">@${esc(username)} · Overall Rank #${ranks.overall}</text>
    <g filter="url(#shadow)">
      <rect x="250" y="155" width="690" height="74" rx="22" fill="${panelFill}"/>
      <rect x="250" y="250" width="690" height="74" rx="22" fill="${panelFill}"/>
      <rect x="65" y="270" width="160" height="72" rx="20" fill="#0b1128" stroke="#253b7a" stroke-width="1"/>
    </g>
    <text x="285" y="186" font-family="Arial, sans-serif" font-size="19" fill="${textSoft}">LVL</text>
    <text x="285" y="218" font-family="Arial, sans-serif" font-size="36" font-weight="900" fill="#ffffff">${voice.level}</text>
    <text x="365" y="184" font-family="Arial, sans-serif" font-size="22" font-weight="800" fill="${textMain}">Voice Rank #${ranks.voice}</text>
    ${progressBar(365, 198, 400, voice.percent, cyan)}
    <text x="785" y="213" font-family="Arial, sans-serif" font-size="22" font-weight="800" fill="#ffffff">Next Level</text>
    <text x="285" y="281" font-family="Arial, sans-serif" font-size="19" fill="${textSoft}">LVL</text>
    <text x="285" y="313" font-family="Arial, sans-serif" font-size="36" font-weight="900" fill="#ffffff">${text.level}</text>
    <text x="365" y="279" font-family="Arial, sans-serif" font-size="22" font-weight="800" fill="${textMain}">Text Rank #${ranks.text}</text>
    ${progressBar(365, 293, 400, text.percent, lavender)}
    <text x="785" y="308" font-family="Arial, sans-serif" font-size="22" font-weight="800" fill="#ffffff">Next Level</text>
    <text x="92" y="300" font-family="Arial, sans-serif" font-size="18" fill="${textSoft}">TOTAL</text>
    <text x="92" y="329" font-family="Arial, sans-serif" font-size="28" font-weight="900" fill="#fff">LVL ${overall.level}</text>
  </svg>`;
  const avatar = await avatarComposite(member.displayAvatarURL({ extension: "png", size: 256 }), 40, 40, 190);
  return new AttachmentBuilder(await render(svg, avatar ? [avatar] : []), { name: "nexus-rank.png" });
}

export async function levelCard(member: GuildMember, stats: UserStats) {
  const ranks = getRanks(member.guild.id, member.id);
  const overall = progressForLevel(totalXp(stats));
  const text = progressForLevel(stats.textXp);
  const voice = progressForLevel(stats.voiceXp);
  const displayName = cleanLabel(member.displayName, member.user.username);
  const guildName = cleanLabel(member.guild.name.split("#")[0].trim(), "Night Stars");
  const svg = `<svg width="1000" height="520" viewBox="0 0 1000 520" xmlns="http://www.w3.org/2000/svg">
    ${cardDefs(520)}
    <circle cx="70" cy="70" r="45" fill="#050814" stroke="${purple}" stroke-width="3"/>
    <text x="135" y="62" font-family="Arial, sans-serif" font-size="42" font-weight="900" fill="${textMain}">${esc(displayName)}</text>
    <text x="135" y="100" font-family="Arial, sans-serif" font-size="23" fill="${textSoft}">${esc(guildName)} · Nexus User Stats</text>
    <rect x="610" y="30" width="160" height="84" rx="16" fill="#0b1128" stroke="#253b7a"/><text x="635" y="62" font-family="Arial, sans-serif" font-size="20" fill="${textSoft}">Messages</text><text x="635" y="96" font-family="Arial, sans-serif" font-size="32" font-weight="900" fill="#fff">${compact(stats.textMessages)}</text>
    <rect x="795" y="30" width="175" height="84" rx="16" fill="#0b1128" stroke="#253b7a"/><text x="820" y="62" font-family="Arial, sans-serif" font-size="20" fill="${textSoft}">Voice Hours</text><text x="820" y="96" font-family="Arial, sans-serif" font-size="32" font-weight="900" fill="#fff">${Math.floor(stats.voiceSeconds / 3600)}</text>
    <rect x="30" y="150" width="300" height="150" rx="18" fill="${panelFill}" filter="url(#shadow)"/><text x="55" y="188" font-family="Arial, sans-serif" font-size="27" font-weight="900" fill="${textMain}">Server Ranks</text><rect x="55" y="210" width="250" height="38" rx="7" fill="#081026"/><text x="80" y="237" font-family="Arial, sans-serif" font-size="25" font-weight="800" fill="#fff">Overall</text><text x="230" y="237" font-family="Arial, sans-serif" font-size="25" fill="#fff">#${ranks.overall}</text><rect x="55" y="255" width="250" height="38" rx="7" fill="#081026"/><text x="80" y="282" font-family="Arial, sans-serif" font-size="25" font-weight="800" fill="#fff">Voice</text><text x="230" y="282" font-family="Arial, sans-serif" font-size="25" fill="#fff">#${ranks.voice}</text>
    <rect x="355" y="150" width="300" height="150" rx="18" fill="${panelFill}" filter="url(#shadow)"/><text x="380" y="188" font-family="Arial, sans-serif" font-size="27" font-weight="900" fill="${textMain}">Messages</text><rect x="380" y="210" width="250" height="38" rx="7" fill="#081026"/><text x="405" y="237" font-family="Arial, sans-serif" font-size="23" font-weight="800" fill="#fff">LVL ${text.level}</text><text x="500" y="237" font-family="Arial, sans-serif" font-size="23" fill="#fff">Text Level</text><rect x="380" y="255" width="250" height="38" rx="7" fill="#081026"/><text x="405" y="282" font-family="Arial, sans-serif" font-size="23" font-weight="800" fill="#fff">Rank</text><text x="500" y="282" font-family="Arial, sans-serif" font-size="23" fill="#fff">#${ranks.text}</text>
    <rect x="680" y="150" width="290" height="150" rx="18" fill="${panelFill}" filter="url(#shadow)"/><text x="705" y="188" font-family="Arial, sans-serif" font-size="27" font-weight="900" fill="${textMain}">Voice Activity</text><rect x="705" y="210" width="240" height="38" rx="7" fill="#081026"/><text x="730" y="237" font-family="Arial, sans-serif" font-size="23" font-weight="800" fill="#fff">LVL ${voice.level}</text><text x="825" y="237" font-family="Arial, sans-serif" font-size="23" fill="#fff">${hours(stats.voiceSeconds)}</text><rect x="705" y="255" width="240" height="38" rx="7" fill="#081026"/><text x="730" y="282" font-family="Arial, sans-serif" font-size="23" font-weight="800" fill="#fff">Rank</text><text x="825" y="282" font-family="Arial, sans-serif" font-size="23" fill="#fff">#${ranks.voice}</text>
    <rect x="30" y="330" width="940" height="150" rx="18" fill="#081026" stroke="#253b7a"/><text x="55" y="370" font-family="Arial, sans-serif" font-size="27" font-weight="900" fill="#fff">Overall Level ${overall.level}</text><text x="790" y="370" font-family="Arial, sans-serif" font-size="23" fill="#d9e2f7">Next Level</text>${progressBar(55, 400, 890, overall.percent, blue)}<text x="55" y="455" font-family="Arial, sans-serif" font-size="22" fill="#d9e2f7">Messages ${compact(stats.textMessages)} · Voice ${hours(stats.voiceSeconds)} · Overall Level ${overall.level}</text>
  </svg>`;
  const avatar = await avatarComposite(member.displayAvatarURL({ extension: "png", size: 128 }), 25, 25, 90);
  return new AttachmentBuilder(await render(svg, avatar ? [avatar] : []), { name: "nexus-level.png" });
}

function serverName(value: string) {
  return cleanLabel(value.split("#")[0].trim(), "Night Stars");
}

function topLevel(type: LeaderboardType, user: UserStats) {
  if (type === "voice") return progressForLevel(user.voiceXp).level;
  if (type === "text") return progressForLevel(user.textXp).level;
  return progressForLevel(totalXp(user)).level;
}

function topValue(type: LeaderboardType, user: UserStats) {
  if (type === "messages") return compact(user.textMessages);
  return String(topLevel(type, user));
}

function topHeader(type: LeaderboardType) {
  if (type === "messages") return "Messages";
  return "Level";
}

export type StatsView = "overview" | "message_members" | "voice_members" | "message_channels" | "voice_channels";

export async function topCard(guild: Guild, type: LeaderboardType, page: number, users: UserStats[]) {
  const title = type === "voice" ? "Voice Leaderboard" : type === "text" ? "Text Leaderboard" : type === "messages" ? "Messages Leaderboard" : "Overall Leaderboard";
  const total = countUsers(guild.id);
  const totalPages = Math.max(1, Math.ceil(total / 10));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const guildName = serverName(guild.name);
  const rows = users.map((u, i) => {
    const rank = (safePage - 1) * 10 + i + 1;
    const value = topValue(type, u);
    const medal = rank === 1 ? "#ffd84d" : rank === 2 ? "#cfd8e6" : rank === 3 ? "#cd7f32" : "#31415f";
    const rowFill = rank === 1 ? "#232712" : rank === 2 ? "#1a2231" : rank === 3 ? "#241b17" : "#101827";
    const y = 145 + i * 52;
    return `<rect x="55" y="${y}" width="890" height="43" rx="13" fill="${rowFill}" opacity="0.98"/><circle cx="78" cy="${y + 21}" r="7" fill="${medal}"/><text x="115" y="${y + 29}" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" font-weight="900" fill="${textMain}">${rank}</text><circle cx="180" cy="${y + 21}" r="15" fill="#050814" stroke="#253b7a" stroke-width="1"/><text x="225" y="${y + 29}" font-family="Arial, sans-serif" font-size="21" font-weight="800" fill="${textMain}">${esc(cleanLabel(u.username, "member"))}</text><text x="850" y="${y + 29}" text-anchor="end" font-family="Arial, sans-serif" font-size="21" font-weight="900" fill="${textMain}">${value}</text>`;
  }).join("");
  const svg = `<svg width="1000" height="690" viewBox="0 0 1000 690" xmlns="http://www.w3.org/2000/svg">
    ${cardDefs(690)}
    <rect x="28" y="20" width="944" height="640" rx="24" fill="#07102a" opacity="0.9" stroke="#253b7a" stroke-width="2"/>
    <circle cx="78" cy="72" r="34" fill="#050814" stroke="${purple}" stroke-width="3"/>
    <text x="125" y="67" font-family="Arial, sans-serif" font-size="37" font-weight="900" fill="${textMain}">${esc(title)}</text>
    <text x="125" y="98" font-family="Arial, sans-serif" font-size="18" font-weight="800" fill="${textSoft}">Stats of ${esc(guildName)}</text>
    <rect x="835" y="28" width="110" height="54" rx="12" fill="#081026" stroke="#253b7a"/>
    <text x="890" y="51" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="900" fill="#fff">Page ${safePage}/${totalPages}</text>
    <text x="890" y="73" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" fill="${textSoft}">Tracked: ${compact(total)}</text>
    <rect x="55" y="122" width="890" height="1" fill="#253b7a"/>
    <text x="850" y="112" text-anchor="end" font-family="Arial, sans-serif" font-size="17" font-weight="900" fill="${textSoft}">${topHeader(type)}</text>
    ${rows}
  </svg>`;
  const composites: any[] = [];
  const guildIcon = guild.iconURL?.({ extension: "png", size: 128 }) ?? null;
  const icon = await avatarComposite(guildIcon, 48, 42, 60);
  if (icon) composites.push(icon);
  const rowAvatars = await Promise.all(users.map((u, i) => avatarComposite(u.avatarUrl, 165, 151 + i * 52, 30)));
  composites.push(...rowAvatars.filter(Boolean));
  return new AttachmentBuilder(await render(svg, composites), { name: "nexus-top.png" });
}

function statsTitle(view: StatsView) {
  if (view === "message_members") return "Top Message Members";
  if (view === "voice_members") return "Top Voice Members";
  if (view === "message_channels") return "Top Message Channels";
  if (view === "voice_channels") return "Top Voice Channels";
  return "Overview";
}

function statsValue(view: StatsView, item: UserStats | ChannelStats) {
  if ("userId" in item) {
    if (view === "voice_members") return hours(item.voiceSeconds);
    return compact(item.textMessages);
  }
  if (view === "voice_channels") return hours(item.voiceSeconds);
  return compact(item.textMessages);
}

function statsName(guild: Guild, view: StatsView, item: UserStats | ChannelStats) {
  if ("userId" in item) return cleanLabel(item.username, "member");
  const channel = guild.channels.cache.get(item.channelId);
  return cleanLabel(channel?.name ?? `Channel ${item.channelId.slice(-4)}`, "channel");
}

export async function statsCard(guild: Guild, view: StatsView, page: number, users: UserStats[], channels: ChannelStats[]) {
  const items = view === "message_channels" || view === "voice_channels" ? channels : users;
  const total = view === "message_channels" ? countChannels(guild.id, "text") : view === "voice_channels" ? countChannels(guild.id, "voice") : countUsers(guild.id);
  const totalPages = Math.max(1, Math.ceil(total / 10));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const guildName = serverName(guild.name);
  const overviewItems = [
    ["Top Message Members", `${countUsers(guild.id)} tracked members`],
    ["Top Voice Members", "Voice time ranking"],
    ["Top Message Channels", `${countChannels(guild.id, "text")} text channels`],
    ["Top Voice Channels", `${countChannels(guild.id, "voice")} voice channels`],
  ];
  const overview = overviewItems.map((item, i) => {
    const y = 165 + i * 92;
    return `<rect x="70" y="${y}" width="860" height="70" rx="15" fill="#121827" stroke="#2a3552"/><text x="105" y="${y + 31}" font-family="Arial, sans-serif" font-size="25" font-weight="900" fill="${textMain}">${esc(item[0])}</text><text x="105" y="${y + 55}" font-family="Arial, sans-serif" font-size="17" fill="${textSoft}">${esc(item[1])}</text><text x="890" y="${y + 45}" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" fill="${lavender}">›</text>`;
  }).join("");
  const rows = items.map((item, i) => {
    const rank = (safePage - 1) * 10 + i + 1;
    const y = 145 + i * 46;
    const name = statsName(guild, view, item);
    const value = statsValue(view, item);
    return `<rect x="55" y="${y}" width="890" height="38" rx="9" fill="${i % 2 ? "#242934" : "#30343d"}" opacity="0.98"/><rect x="55" y="${y}" width="58" height="38" rx="9" fill="#151922"/><text x="84" y="${y + 26}" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" font-weight="900" fill="${textMain}">${rank}</text><text x="140" y="${y + 26}" font-family="Arial, sans-serif" font-size="20" font-weight="800" fill="${textMain}">${esc(name)}</text><rect x="770" y="${y + 7}" width="145" height="24" rx="6" fill="#1a1f2b"/><text x="842" y="${y + 26}" text-anchor="middle" font-family="Arial, sans-serif" font-size="19" font-weight="900" fill="${textMain}">${esc(value)}</text>`;
  }).join("");
  const svg = `<svg width="1000" height="650" viewBox="0 0 1000 650" xmlns="http://www.w3.org/2000/svg">
    ${cardDefs(650)}
    <rect x="25" y="20" width="950" height="595" rx="28" fill="#171a22" opacity="0.95" stroke="#2d3350" stroke-width="2"/>
    <circle cx="76" cy="67" r="34" fill="#050814" stroke="${purple}" stroke-width="3"/>
    <text x="125" y="61" font-family="Arial, sans-serif" font-size="34" font-weight="900" fill="${textMain}">${esc(guildName)}</text>
    <text x="125" y="92" font-family="Arial, sans-serif" font-size="21" fill="${textSoft}">Nexus Top Statistics</text>
    ${view === "overview" ? `<text x="55" y="133" font-family="Arial, sans-serif" font-size="27" font-weight="900" fill="${textMain}">Overview</text><rect x="55" y="145" width="890" height="1" fill="#2d3350"/>${overview}` : `<text x="55" y="133" font-family="Arial, sans-serif" font-size="27" font-weight="900" fill="${textMain}">${esc(statsTitle(view))}</text><rect x="810" y="93" width="120" height="46" rx="12" fill="#202533" stroke="#3a4264"/><text x="870" y="122" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="900" fill="${textMain}">Page ${safePage}/${totalPages}</text>${rows}<text x="55" y="620" font-family="Arial, sans-serif" font-size="17" fill="${textSoft}">Server Lookback: All time — Timezone: UTC</text><text x="930" y="620" text-anchor="end" font-family="Arial, sans-serif" font-size="17" fill="${textSoft}">Powered by Nexus</text>`}
  </svg>`;
  const composites: any[] = [];
  const guildIcon = guild.iconURL?.({ extension: "png", size: 128 }) ?? null;
  const icon = await avatarComposite(guildIcon, 42, 33, 68);
  if (icon) composites.push(icon);
  return new AttachmentBuilder(await render(svg, composites), { name: "nexus-stats.png" });
}
