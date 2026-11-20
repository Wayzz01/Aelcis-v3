const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const bcrypt = require("bcrypt");
const { v4: uuidv4 } = require("uuid");
const User = require("../../core/models/User");
const Ban = require("../../core/models/Ban");
const SacCode = require("../../core/models/SacCode");
const { getOrCreateProfile, saveProfile } = require("../../core/services/profiles");
const { addMtx, bumpRvn } = require("../../core/services/mcp");
const { generateCatalog } = require("../../api/routes/storefront");
const logger = require("../../shared/utils/logger");

async function start(config) {
  if (!config.discord || !config.discord.token) {
    logger.bot("Discord bot token missing, skipping.");
    return null;
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  const commands = [
    new SlashCommandBuilder().setName("ping").setDescription("Check if bot is online"),
    new SlashCommandBuilder()
      .setName("create").setDescription("Create an account")
      .addStringOption(o => o.setName("email").setDescription("Email").setRequired(true))
      .addStringOption(o => o.setName("username").setDescription("Username").setRequired(true))
      .addStringOption(o => o.setName("password").setDescription("Password").setRequired(true)),
    new SlashCommandBuilder()
      .setName("addvbucks").setDescription("Add V-Bucks to a user (admin)")
      .addStringOption(o => o.setName("username").setDescription("Username").setRequired(true))
      .addIntegerOption(o => o.setName("amount").setDescription("Amount").setRequired(true)),
    new SlashCommandBuilder()
      .setName("setvbucks").setDescription("Set V-Bucks for a user (admin)")
      .addStringOption(o => o.setName("username").setDescription("Username").setRequired(true))
      .addIntegerOption(o => o.setName("amount").setDescription("Amount").setRequired(true)),
    new SlashCommandBuilder()
      .setName("ban").setDescription("Ban a user from matchmaking (admin)")
      .addStringOption(o => o.setName("username").setDescription("Username").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false))
      .addStringOption(o => o.setName("duration").setDescription("Duration: 1h,7d,30d,permanent").setRequired(false)),
    new SlashCommandBuilder()
      .setName("unban").setDescription("Unban a user (admin)")
      .addStringOption(o => o.setName("username").setDescription("Username").setRequired(true)),
    new SlashCommandBuilder()
      .setName("matchmake-ban").setDescription("Ban a user from matchmaking (admin)")
      .addStringOption(o => o.setName("username").setDescription("Username").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false))
      .addStringOption(o => o.setName("duration").setDescription("Duration: 1h,7d,30d,permanent").setRequired(false)),
    new SlashCommandBuilder()
      .setName("competitive-ban").setDescription("Ban a user from competitive/arena (admin)")
      .addStringOption(o => o.setName("username").setDescription("Username").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false))
      .addStringOption(o => o.setName("duration").setDescription("Duration: 1h,7d,30d,permanent").setRequired(false)),
    new SlashCommandBuilder()
      .setName("createsac").setDescription("Create/set a Support-A-Creator code for a user (admin)")
      .addStringOption(o => o.setName("code").setDescription("Creator code").setRequired(true))
      .addStringOption(o => o.setName("username").setDescription("In-game username (owner)").setRequired(true)),
    new SlashCommandBuilder().setName("refreshitemshop").setDescription("Refresh the item shop (admin)"),
    new SlashCommandBuilder()
      .setName("exchange-code").setDescription("Generate an exchange code for your linked account")
      .addStringOption(o => o.setName("username").setDescription("Username (if not linked)").setRequired(false))
      .addStringOption(o => o.setName("password").setDescription("Password (if not linked)").setRequired(false)),
    new SlashCommandBuilder()
      .setName("accountinfo").setDescription("Get account info")
      .addStringOption(o => o.setName("username").setDescription("Username").setRequired(true)),
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(config.discord.token);

  client.once("ready", async () => {
    logger.bot(`Discord bot logged in as ${client.user.tag}`);
    try {
      if (config.discord.clientId) {
        if (config.discord.guildId) {
          await rest.put(Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId), { body: commands });
          logger.bot("Registered guild slash commands");
        } else {
          await rest.put(Routes.applicationCommands(config.discord.clientId), { body: commands });
          logger.bot("Registered global slash commands");
        }
      }
    } catch (e) {
      logger.warn("Failed to register slash commands:", e.message);
    }
  });

  function parseDuration(dur) {
    if (!dur || dur.toLowerCase() === "permanent" || dur.toLowerCase() === "perm") return null;
    const m = String(dur).match(/^(\d+)(h|d|m)$/i);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    const u = m[2].toLowerCase();
    const ms = u === "m" ? n * 60000 : u === "h" ? n * 3600000 : n * 86400000;
    return new Date(Date.now() + ms);
  }

  function isAdmin(interaction) {
    // allow if user has Administrator or configured mod role; also allow guild owner
    try {
      if (!interaction.inGuild()) return true; // DM: be cautious, but commands mostly admin
      if (interaction.memberPermissions && interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) return true;
      const modRole = config.discord.moderatorRoleId;
      if (modRole && interaction.member && interaction.member.roles && interaction.member.roles.cache && interaction.member.roles.cache.has(modRole)) return true;
    } catch {}
    return false;
  }

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const name = interaction.commandName;
    try {
      if (name === "ping") return interaction.reply({ content: "Alecis-v3 bot is online.", ephemeral: true });

      if (name === "create") {
        const email = interaction.options.getString("email");
        const username = interaction.options.getString("username");
        const password = interaction.options.getString("password");
        const exists = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username }] });
        if (exists) return interaction.reply({ content: "Email or username already exists.", ephemeral: true });
        const hash = await bcrypt.hash(password, 10);
        const accountId = uuidv4().replace(/-/g, "");
        await User.create({ accountId, email: email.toLowerCase(), username, password: hash, vbucks: 1000 });
        await Promise.all([
          getOrCreateProfile(accountId, "athena"),
          getOrCreateProfile(accountId, "common_core"),
          getOrCreateProfile(accountId, "common_public"),
        ]);
        return interaction.reply({ content: `Account created for **${username}** (${email}).`, ephemeral: true });
      }

      if (["addvbucks", "setvbucks", "ban", "unban", "matchmake-ban", "competitive-ban", "createsac", "refreshitemshop"].includes(name)) {
        if (!isAdmin(interaction)) return interaction.reply({ content: "You do not have permission to use this command.", ephemeral: true });
      }

      if (name === "addvbucks" || name === "setvbucks") {
        const username = interaction.options.getString("username");
        const amount = interaction.options.getInteger("amount");
        const user = await User.findOne({ username: new RegExp(`^${username}$`, "i") });
        if (!user) return interaction.reply({ content: "User not found.", ephemeral: true });
        const core = await getOrCreateProfile(user.accountId, "common_core");
        if (name === "setvbucks") {
          core.data.items = core.data.items || {};
          core.data.items["Currency:MtxPurchased"] = { templateId: "Currency:MtxPurchased", attributes: { platform: "EpicPC" }, quantity: amount };
        } else {
          addMtx(core, amount);
        }
        bumpRvn(core); await saveProfile(core);
        return interaction.reply({ content: `${name === "setvbucks" ? "Set" : "Added"} V-Bucks for **${user.username}**: ${amount}`, ephemeral: true });
      }

      if (name === "ban" || name === "matchmake-ban" || name === "competitive-ban") {
        const username = interaction.options.getString("username");
        const reason = interaction.options.getString("reason") || "No reason provided";
        const duration = interaction.options.getString("duration") || "permanent";
        const user = await User.findOne({ username: new RegExp(`^${username}$`, "i") });
        if (!user) return interaction.reply({ content: "User not found.", ephemeral: true });
        const expiresAt = parseDuration(duration);
        const type = name === "competitive-ban" ? "competitive" : "matchmaking";
        await Ban.create({ accountId: user.accountId, type, reason, bannedBy: interaction.user.id, expiresAt, active: true });
        user.banned = (type === "permanent"); // convenience flag
        await user.save();
        return interaction.reply({ content: `Banned **${user.username}** from ${type}. Reason: ${reason}. Expires: ${expiresAt ? expiresAt.toISOString() : "never"}`, ephemeral: true });
      }

      if (name === "unban") {
        const username = interaction.options.getString("username");
        const user = await User.findOne({ username: new RegExp(`^${username}$`, "i") });
        if (!user) return interaction.reply({ content: "User not found.", ephemeral: true });
        await Ban.updateMany({ accountId: user.accountId }, { $set: { active: false } });
        user.banned = false; user.banReason = ""; user.banExpires = null; await user.save();
        return interaction.reply({ content: `Unbanned **${user.username}**.`, ephemeral: true });
      }

      if (name === "createsac") {
        const code = interaction.options.getString("code").toLowerCase().trim();
        const username = interaction.options.getString("username");
        const user = await User.findOne({ username: new RegExp(`^${username}$`, "i") });
        if (!user) return interaction.reply({ content: "User not found.", ephemeral: true });
        await SacCode.findOneAndUpdate({ code }, { code, ownerAccountId: user.accountId, ownerUsername: user.username, active: true }, { upsert: true, new: true });
        user.creatorCode = code; await user.save();
        return interaction.reply({ content: `SAC code **${code}** created for **${user.username}**.`, ephemeral: true });
      }

      if (name === "refreshitemshop") {
        const cat = generateCatalog();
        return interaction.reply({ content: `Item shop refreshed. Expires: ${cat.expiration}`, ephemeral: true });
      }

      if (name === "exchange-code") {
        // permissive: accept any credentials and auto-create user if missing
        const username = interaction.options.getString("username") || interaction.user?.username || "player";
        let user = await User.findOne({ username: new RegExp(`^${username}$`, "i") });
        if (!user) {
          const accountId = uuidv4().replace(/-/g, "");
          const safe = String(username).replace(/[^a-zA-Z0-9_\-]/g, "").slice(0, 20) || `player_${accountId.slice(0,4)}`;
          user = await User.create({
            accountId,
            email: `${safe.toLowerCase()}_${accountId.slice(0, 6)}@alecis.local`,
            username: safe,
            password: "no-mongo-any-credentials",
            vbucks: 1000,
          });
          await Promise.all([
            getOrCreateProfile(accountId, "athena"),
            getOrCreateProfile(accountId, "common_core"),
            getOrCreateProfile(accountId, "common_public"),
          ]);
        }
        const { createExchangeCode } = require("../../core/services/tokens");
        const code = createExchangeCode(user.accountId, "alecis-bot");
        return interaction.reply({ content: `Exchange code for **${user.username}**: \`${code}\` (valid ~5 min)`, ephemeral: true });
      }

      if (name === "accountinfo") {
        const username = interaction.options.getString("username");
        const user = await User.findOne({ username: new RegExp(`^${username}$`, "i") }).lean();
        if (!user) return interaction.reply({ content: "User not found.", ephemeral: true });
        const core = await getOrCreateProfile(user.accountId, "common_core");
        const mtx = (core.data.items && core.data.items["Currency:MtxPurchased"] && core.data.items["Currency:MtxPurchased"].quantity) || 0;
        return interaction.reply({ content: `**${user.username}**\nAccount: \`${user.accountId}\`\nEmail: ${user.email}\nV-Bucks: ${mtx}\nHype: ${user.hype || 0}`, ephemeral: true });
      }

      return interaction.reply({ content: "Unknown command.", ephemeral: true });
    } catch (e) {
      logger.error("Discord command error", e);
      if (interaction.deferred || interaction.replied) await interaction.followUp({ content: `Error: ${e.message}`, ephemeral: true });
      else await interaction.reply({ content: `Error: ${e.message}`, ephemeral: true });
    }
  });

  await client.login(config.discord.token);
  return client;
}

module.exports = start;
