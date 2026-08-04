const express = require("express");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField
} = require("discord.js");

const config = require("./config");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const client = new Client({
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

function buildRecruitEmbed(data) {
  return new EmbedBuilder()
    .setTitle(`📋 Nouvelle candidature — ${safeText(data.poste, 100)}`)
    .setColor(0xe52d48)
    .addFields(
      { name: "Pseudo Discord", value: safeText(data.discordTag), inline: true },
      { name: "ID Discord", value: safeText(data.discordId), inline: true },
      { name: "Prénom", value: safeText(data.prenom), inline: true },
      { name: "Âge", value: safeText(data.age), inline: true },
      { name: "Ambitions dans le staff", value: safeText(data.ambitions), inline: false },
      { name: "Pourquoi vous et pas un autre ?", value: safeText(data.pourquoiVous), inline: false },
      { name: "Expériences", value: safeText(data.experiences || "Aucune"), inline: false },
      { name: "Vision du rôle de modérateur", value: safeText(data.roleModerateur), inline: false }
    )
    .setTimestamp()
    .setFooter({ text: "Urgence Lilloise — Recrutement" });
}

function buildDecisionButtons(disabled = false, applicantId = null, poste = null) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`accept|${applicantId || "none"}|${poste || "none"}`)
      .setLabel("Accepter")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`refuse|${applicantId || "none"}|${poste || "none"}`)
      .setLabel("Refuser")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

async function sendDecisionDM(userId, accepted, poste) {
  try {
    console.log("Envoi MP à :", userId, "| accepted =", accepted, "| poste =", poste);

    const user = await client.users.fetch(userId);

    if (accepted) {
      await user.send(
        `Bonjour <@${userId}>, vous êtes retenu pour un entretien oral. Merci de faire un ticket et de mettre une preuve de votre retenue.`
      );
    } else {
      await user.send(
        `Nous sommes désolés de vous annoncer que vous ne serez pas retenu pour votre candidature à **${poste}**.`
      );
    }

    return true;
  } catch (err) {
    console.error("Impossible d'envoyer le MP :", err);
    return false;
  }
}

client.once("ready", () => {
  console.log(`✅ Bot prêt : ${client.user.tag}`);
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

    if (
      !poste ||
      !discordTag ||
      !discordId ||
      !prenom ||
      !age ||
      !ambitions ||
      !pourquoiVous ||
      !roleModerateur
    ) {
      return res.status(400).json({ error: "Merci de remplir tous les champs obligatoires." });
    }

    const guild = await client.guilds.fetch(config.guildId);
    if (!guild) {
      return res.status(500).json({ error: "Serveur Discord introuvable." });
    }

    const channel = await guild.channels.fetch(config.recruitChannelId);
    if (!channel || !channel.isTextBased()) {
      return res.status(500).json({ error: "Salon de recrutement introuvable." });
    }

    const embed = buildRecruitEmbed({
      poste,
      discordTag,
      discordId,
      prenom,
      age,
      ambitions,
      pourquoiVous,
      experiences,
      roleModerateur
    });

    const roleMentions = (config.mentionRoleIds || [])
      .map(id => `<@&${id}>`)
      .join(" ");

    await channel.send({
      content: roleMentions
        ? `${roleMentions}\n📥 Nouvelle candidature pour **${poste}**`
        : `📥 Nouvelle candidature pour **${poste}**`,
      embeds: [embed],
      components: [buildDecisionButtons(false, discordId, poste)],
      allowedMentions: {
        roles: config.mentionRoleIds || []
      }
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Erreur /recrutement :", err);
    return res.status(500).json({ error: "Erreur interne du serveur." });
  }
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isButton()) return;

    console.log("Bouton cliqué :", interaction.customId);

    const [action, applicantId, poste] = interaction.customId.split("|");
    if (!["accept", "refuse"].includes(action)) return;

    const isAccept = action === "accept";

    if (
      !interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageMessages) &&
      !interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)
    ) {
      return interaction.reply({
        content: "❌ Tu n'as pas la permission d'utiliser ce bouton.",
        ephemeral: true
      });
    }

    await interaction.deferUpdate();

    const oldEmbed = interaction.message.embeds[0];
    const newEmbed = EmbedBuilder.from(oldEmbed).setColor(isAccept ? 0x2ed573 : 0xe52d48);

    newEmbed.addFields({
      name: "Décision",
      value: isAccept
        ? `✅ Acceptée par ${interaction.user.tag}`
        : `❌ Refusée par ${interaction.user.tag}`,
      inline: false
    });

    await interaction.message.edit({
      embeds: [newEmbed],
      components: [buildDecisionButtons(true, applicantId, poste)]
    });

    const dmSent = await sendDecisionDM(applicantId, isAccept, poste);
    console.log(dmSent ? "MP envoyé avec succès" : "MP non envoyé");
  } catch (err) {
    console.error("Erreur interaction button :", err);
  }
});

client.login(config.token);

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, async () => {
  console.log(`✅ Serveur lancé sur le port ${PORT}`);
});
