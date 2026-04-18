import dotenv from "dotenv";

dotenv.config();

export const env = {
  token: process.env.DISCORD_TOKEN?.trim() ?? "",
  clientId: process.env.CLIENT_ID?.trim() ?? "",
  guildId: process.env.GUILD_ID?.trim() ?? "",
  databasePath: process.env.DATABASE_PATH?.trim() || "./data/nexus.sqlite",
  defaultPrefix: process.env.DEFAULT_PREFIX?.trim() || "%",
};

if (!env.token) {
  throw new Error("DISCORD_TOKEN is missing");
}
