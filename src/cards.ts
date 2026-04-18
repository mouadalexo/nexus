import sharp from "sharp";
import { AttachmentBuilder, Guild, GuildMember } from "discord.js";
import type { LeaderboardType, UserStats } from "./db.js";
import { countUsers, getRanks } from "./db.js";
import { progressForLevel, totalXp } from "./leveling.js";

const W = 1000;
const H = 420;
const purple = "#7c2cff";
const green = "#35c84a";
const pink = "#d93682";

function esc(value: string) {
  return value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function compact(n: number) {
  return new Intl.NumberFormat("en-US", { notation: n >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(Math.floor(n));
}

function hours(seconds: number) {
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function progressBar(x: number, y: number, width: number, pct: number, color: string) {
  const fill = Math.max(8, Math.floor(width * Math.min(1, Math.max(0, pct))));
  return `<rect x="${x}" y="${y}" width="${width}" height="18" rx="9" fill="#e9e9f1" opacity="0.92"/><rect x="${x}" y="${y}" width="${fill}" height="18" rx="9" fill="${color}"/>`;
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
  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#080b16"/><stop offset="0.5" stop-color="#171b28"/><stop offset="1" stop-color="#30125d"/></linearGradient>
      <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#1d2231"/><stop offset="1" stop-color="#141821"/></linearGradient>
      <filter id="shadow"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-opacity="0.42"/></filter>
    </defs>
    <rect width="${W}" height="${H}" rx="30" fill="url(#bg)"/>
    <path d="M560 0 C700 70 740 210 1000 150 L1000 420 L380 420 C430 310 410 90 560 0Z" fill="#6e23df" opacity="0.26"/>
    <circle cx="135" cy="135" r="95" fill="#090b11" stroke="${purple}" stroke-width="5"/>
    <text x="260" y="80" font-family="Inter, Arial" font-size="46" font-weight="800" fill="#f6f3ff">${esc(member.displayName)}</text>
    <text x="262" y="120" font-family="Inter, Arial" font-size="24" fill="#aeb2c2">@${esc(member.user.username)} · Overall Rank #${ranks.overall}</text>
    <g filter="url(#shadow)">
      <rect x="250" y="155" width="690" height="74" rx="22" fill="url(#panel)"/>
      <rect x="250" y="250" width="690" height="74" rx="22" fill="url(#panel)"/>
      <rect x="65" y="270" width="160" height="72" rx="20" fill="#151922"/>
    </g>
    <text x="285" y="186" font-family="Inter, Arial" font-size="19" fill="#c4c7d4">LVL</text>
    <text x="285" y="218" font-family="Inter, Arial" font-size="36" font-weight="900" fill="#ffffff">${text.level}</text>
    <text x="365" y="184" font-family="Inter, Arial" font-size="22" font-weight="800" fill="#f4f1ff">💬 Text Rank #${ranks.text}</text>
    ${progressBar(365, 198, 400, text.percent, green)}
    <text x="785" y="213" font-family="Inter, Arial" font-size="22" font-weight="800" fill="#ffffff">${compact(text.progress)} / ${compact(text.needed)}</text>
    <text x="285" y="281" font-family="Inter, Arial" font-size="19" fill="#c4c7d4">LVL</text>
    <text x="285" y="313" font-family="Inter, Arial" font-size="36" font-weight="900" fill="#ffffff">${voice.level}</text>
    <text x="365" y="279" font-family="Inter, Arial" font-size="22" font-weight="800" fill="#f4f1ff">🎙 Voice Rank #${ranks.voice}</text>
    ${progressBar(365, 293, 400, voice.percent, pink)}
    <text x="785" y="308" font-family="Inter, Arial" font-size="22" font-weight="800" fill="#ffffff">${compact(voice.progress)} / ${compact(voice.needed)}</text>
    <text x="92" y="300" font-family="Inter, Arial" font-size="18" fill="#aeb2c2">TOTAL</text>
    <text x="92" y="329" font-family="Inter, Arial" font-size="28" font-weight="900" fill="#fff">LVL ${overall.level}</text>
    <text x="65" y="382" font-family="Inter, Arial" font-size="22" fill="#ced2df">${compact(stats.textMessages)} messages · ${hours(stats.voiceSeconds)} voice · ${compact(totalXp(stats))} XP</text>
  </svg>`;
  const avatar = await avatarComposite(member.displayAvatarURL({ extension: "png", size: 256 }), 40, 40, 190);
  return new AttachmentBuilder(await render(svg, avatar ? [avatar] : []), { name: "nexus-rank.png" });
}

export async function levelCard(member: GuildMember, stats: UserStats) {
  const ranks = getRanks(member.guild.id, member.id);
  const overall = progressForLevel(totalXp(stats));
  const text = progressForLevel(stats.textXp);
  const voice = progressForLevel(stats.voiceXp);
  const svg = `<svg width="1000" height="520" viewBox="0 0 1000 520" xmlns="http://www.w3.org/2000/svg">
    <rect width="1000" height="520" rx="26" fill="#1b1f28"/>
    <circle cx="70" cy="70" r="45" fill="#0d1017" stroke="${purple}" stroke-width="3"/>
    <text x="135" y="62" font-family="Inter, Arial" font-size="42" font-weight="900" fill="#f0f0f4">${esc(member.displayName)}</text>
    <text x="135" y="100" font-family="Inter, Arial" font-size="23" fill="#a9adba">${esc(member.guild.name)} · Nexus User Stats</text>
    <rect x="610" y="30" width="160" height="84" rx="16" fill="#10131a"/><text x="635" y="62" font-family="Inter, Arial" font-size="20" fill="#c7cbd6">Message</text><circle cx="735" cy="52" r="12" fill="${green}"/><text x="635" y="96" font-family="Inter, Arial" font-size="32" font-weight="900" fill="#fff">${compact(stats.textMessages)}</text>
    <rect x="795" y="30" width="175" height="84" rx="16" fill="#10131a"/><text x="820" y="62" font-family="Inter, Arial" font-size="20" fill="#c7cbd6">Voice Hours</text><circle cx="940" cy="52" r="12" fill="${pink}"/><text x="820" y="96" font-family="Inter, Arial" font-size="32" font-weight="900" fill="#fff">${Math.floor(stats.voiceSeconds / 3600)}</text>
    <rect x="30" y="150" width="300" height="150" rx="18" fill="#2a2e38"/><text x="55" y="188" font-family="Inter, Arial" font-size="27" font-weight="900" fill="#f4f4f8">Server Ranks</text><text x="275" y="188" font-family="Inter, Arial" font-size="26" fill="#d4d7df">🏆</text><rect x="55" y="210" width="250" height="38" rx="7" fill="#151820"/><text x="80" y="237" font-family="Inter, Arial" font-size="25" font-weight="800" fill="#fff">Overall</text><text x="230" y="237" font-family="Inter, Arial" font-size="25" fill="#fff">#${ranks.overall}</text><rect x="55" y="255" width="250" height="38" rx="7" fill="#151820"/><text x="80" y="282" font-family="Inter, Arial" font-size="25" font-weight="800" fill="#fff">Voice</text><text x="230" y="282" font-family="Inter, Arial" font-size="25" fill="#fff">#${ranks.voice}</text>
    <rect x="355" y="150" width="300" height="150" rx="18" fill="#2a2e38"/><text x="380" y="188" font-family="Inter, Arial" font-size="27" font-weight="900" fill="#f4f4f8">Messages</text><text x="610" y="188" font-family="Inter, Arial" font-size="28" fill="#d4d7df">#</text><rect x="380" y="210" width="250" height="38" rx="7" fill="#151820"/><text x="405" y="237" font-family="Inter, Arial" font-size="23" font-weight="800" fill="#fff">LVL ${text.level}</text><text x="500" y="237" font-family="Inter, Arial" font-size="23" fill="#fff">${compact(stats.textXp)} XP</text><rect x="380" y="255" width="250" height="38" rx="7" fill="#151820"/><text x="405" y="282" font-family="Inter, Arial" font-size="23" font-weight="800" fill="#fff">Rank</text><text x="500" y="282" font-family="Inter, Arial" font-size="23" fill="#fff">#${ranks.text}</text>
    <rect x="680" y="150" width="290" height="150" rx="18" fill="#2a2e38"/><text x="705" y="188" font-family="Inter, Arial" font-size="27" font-weight="900" fill="#f4f4f8">Voice Activity</text><text x="925" y="188" font-family="Inter, Arial" font-size="25" fill="#d4d7df">🔊</text><rect x="705" y="210" width="240" height="38" rx="7" fill="#151820"/><text x="730" y="237" font-family="Inter, Arial" font-size="23" font-weight="800" fill="#fff">LVL ${voice.level}</text><text x="825" y="237" font-family="Inter, Arial" font-size="23" fill="#fff">${hours(stats.voiceSeconds)}</text><rect x="705" y="255" width="240" height="38" rx="7" fill="#151820"/><text x="730" y="282" font-family="Inter, Arial" font-size="23" font-weight="800" fill="#fff">Rank</text><text x="825" y="282" font-family="Inter, Arial" font-size="23" fill="#fff">#${ranks.voice}</text>
    <rect x="30" y="330" width="940" height="150" rx="18" fill="#11151d"/><text x="55" y="370" font-family="Inter, Arial" font-size="27" font-weight="900" fill="#fff">Overall Level ${overall.level}</text><text x="790" y="370" font-family="Inter, Arial" font-size="23" fill="#bfc3ce">${compact(overall.progress)} / ${compact(overall.needed)} XP</text>${progressBar(55, 400, 890, overall.percent, purple)}<text x="55" y="455" font-family="Inter, Arial" font-size="22" fill="#bfc3ce">Total XP ${compact(totalXp(stats))} · Text XP ${compact(stats.textXp)} · Voice XP ${compact(stats.voiceXp)}</text>
  </svg>`;
  const avatar = await avatarComposite(member.displayAvatarURL({ extension: "png", size: 128 }), 25, 25, 90);
  return new AttachmentBuilder(await render(svg, avatar ? [avatar] : []), { name: "nexus-level.png" });
}

export async function topCard(guild: Guild, type: LeaderboardType, page: number, users: UserStats[]) {
  const title = type === "voice" ? "Voice Leaderboard" : type === "text" ? "Text XP Leaderboard" : type === "messages" ? "Messages Leaderboard" : "Overall Leaderboard";
  const total = countUsers(guild.id);
  const rows = users.map((u, i) => {
    const rank = (page - 1) * 10 + i + 1;
    const value = type === "voice" ? hours(u.voiceSeconds) : type === "messages" ? compact(u.textMessages) : type === "text" ? compact(u.textXp) : compact(totalXp(u));
    const medal = rank === 1 ? "#d8d816" : rank === 2 ? "#d9e0ea" : rank === 3 ? "#c77a33" : "#25304a";
    const y = 155 + i * 52;
    return `<rect x="55" y="${y}" width="890" height="42" rx="13" fill="${rank <= 3 ? "#2d3021" : "#111827"}" opacity="0.96"/><circle cx="78" cy="${y + 21}" r="9" fill="${medal}"/><text x="105" y="${y + 29}" font-family="Inter, Arial" font-size="21" font-weight="900" fill="#f8f8fb">${rank}.</text><text x="160" y="${y + 29}" font-family="Inter, Arial" font-size="22" font-weight="800" fill="#f8f8fb">${esc(u.username)}</text><text x="810" y="${y + 29}" text-anchor="end" font-family="Inter, Arial" font-size="22" font-weight="900" fill="#f8f8fb">${value}</text>`;
  }).join("");
  const svg = `<svg width="1000" height="760" viewBox="0 0 1000 760" xmlns="http://www.w3.org/2000/svg"><rect width="1000" height="760" rx="24" fill="#070d1a"/><rect x="20" y="20" width="960" height="720" rx="24" fill="#0d1322" stroke="#1b2a4a" stroke-width="2"/><circle cx="75" cy="78" r="36" fill="#111827" stroke="${purple}" stroke-width="3"/><text x="125" y="72" font-family="Georgia, serif" font-size="38" font-weight="900" fill="#f5f2ff">${esc(title)}</text><text x="125" y="105" font-family="Inter, Arial" font-size="20" font-weight="700" fill="#c7cadd">Stats of ${esc(guild.name)}</text><rect x="835" y="45" width="105" height="58" rx="12" fill="#0a0f1c"/><text x="887" y="70" text-anchor="middle" font-family="Inter, Arial" font-size="18" font-weight="900" fill="#fff">Page ${page}</text><text x="887" y="94" text-anchor="middle" font-family="Inter, Arial" font-size="15" fill="#9fa6bb">Tracked: ${total}</text><rect x="55" y="130" width="890" height="1" fill="#20283b"/><text x="65" y="118" font-family="Inter, Arial" font-size="18" font-weight="900" fill="#9da6bc">#</text><text x="160" y="118" font-family="Inter, Arial" font-size="18" font-weight="900" fill="#9da6bc">User</text><text x="810" y="118" text-anchor="end" font-family="Inter, Arial" font-size="18" font-weight="900" fill="#9da6bc">${type === "voice" ? "Voice" : type === "messages" ? "Messages" : "XP"}</text>${rows}<text x="55" y="720" font-family="Inter, Arial" font-size="18" font-weight="700" fill="#b7bdcd">Nexus Lookback: lightweight lifetime totals · Voice XP is weighted above chat</text><text x="945" y="720" text-anchor="end" font-family="Inter, Arial" font-size="18" fill="#7f88a0">Night Stars</text></svg>`;
  return new AttachmentBuilder(await render(svg), { name: "nexus-top.png" });
}
