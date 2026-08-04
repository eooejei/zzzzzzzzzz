// server.js
const express = require("express");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");
const config = require("./config");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

function safeText(value, limit = 1024) {
  if (!value) return "Aucun";
  return String(value).slice(0, limit);
}

discordClient.once("ready", () => {
  console.log(`✅ Bot prêt : ${discordClient.user.tag}`);
});

app.post("/recrutement", async (req, res) => {
  try {
    const {
      poste,
      discordTag,
      discordId,
      prenom,
      age,
      ambitions,
      pourquoiVous,
      experiences,
      roleModerateur
    } = req.body;

    if (!poste || !discordTag || !discordId || !prenom || !age || !ambitions || !pourquoiVous || !roleModerateur) {
      return res.status(400).json({ error: "Merci de remplir tous les champs obligatoires." });
    }

    if (!config.token || !config.recruitChannelId) {
      return res.status(500).json({ error: "Configuration Discord incomplète." });
    }

    const channel = await discordClient.channels.fetch(config.recruitChannelId);
    if (!channel || !channel.isTextBased()) {
      return res.status(500).json({ error: "Salon de recrutement introuvable." });
    }

    const embed = new EmbedBuilder()
      .setTitle(`📋 Nouvelle candidature — ${safeText(poste, 100)}`)
      .setColor(0xe52d48)
      .addFields(
        { name: "Pseudo Discord", value: safeText(discordTag, 1024), inline: true },
        { name: "ID Discord", value: safeText(discordId, 1024), inline: true },
        { name: "Prénom", value: safeText(prenom, 1024), inline: true },
        { name: "Âge", value: safeText(age, 1024), inline: true },
        { name: "Ambitions dans le staff", value: safeText(ambitions), inline: false },
        { name: "Pourquoi vous et pas un autre ?", value: safeText(pourquoiVous), inline: false },
        { name: "Expériences", value: safeText(experiences || "Aucune"), inline: false },
        { name: "Vision du rôle de modérateur", value: safeText(roleModerateur), inline: false }
      )
      .setTimestamp()
      .setFooter({ text: "Urgence Lilloise — Recrutement" });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`accept|${discordId}|${poste}`)
        .setLabel("Accepter")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`refuse|${discordId}|${poste}`)
        .setLabel("Refuser")
        .setStyle(ButtonStyle.Danger)
    );

    const content = config.mentionRoleIds.length
      ? config.mentionRoleIds.map(id => `<@&${id}>`).join(" ")
      : "";

    await channel.send({
      content: content ? `${content}\n📥 Nouvelle candidature pour **${poste}**` : `📥 Nouvelle candidature pour **${poste}**`,
      embeds: [embed],
      components: [row]
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Erreur /recrutement :", err);
    return res.status(500).json({ error: "Erreur interne du serveur." });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, async () => {
  console.log(`✅ Serveur lancé sur le port ${PORT}`);
  if (!discordClient.isReady()) {
    await discordClient.login(config.token);
  }
});
