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
  ChannelType,
  PermissionsBitField
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

const RECRUIT_CATEGORY_ID = "1534026157161447534";

function safeText(value, limit = 1024) {
  if (!value) return "Aucun";
  return String(value).slice(0, limit);
}

async function getNextRecruitChannelName(guild) {
  const channels = guild.channels.cache.filter(
    ch => ch.type === ChannelType.GuildText && ch.parentId === RECRUIT_CATEGORY_ID
  );

  let maxNum = 0;

  for (const channel of channels.values()) {
    const match = channel.name.match(/^recrutement-(\d+)$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!Number.isNaN(num) && num > maxNum) maxNum = num;
    }
  }

  return `recrutement-${maxNum + 1}`;
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

function buildPrisButton(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("pris")
      .setLabel("Pris")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled)
  );
}

discordClient.once("clientReady", () => {
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

    if (!config.token || !config.guildId) {
      return res.status(500).json({ error: "Configuration Discord incomplète." });
    }

    const guild = await discordClient.guilds.fetch(config.guildId);
    const category = await guild.channels.fetch(RECRUIT_CATEGORY_ID);

    if (!category || category.type !== ChannelType.GuildCategory) {
      return res.status(500).json({ error: "Catégorie de recrutement introuvable." });
    }

    const channelName = await getNextRecruitChannelName(guild);

    const createdChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: RECRUIT_CATEGORY_ID,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionsBitField.Flags.ViewChannel]
        },
        {
          id: discordId,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.AttachFiles,
            PermissionsBitField.Flags.EmbedLinks
          ]
        }
      ]
    });

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

    await createdChannel.send({
      content: `📥 Nouvelle candidature pour **${poste}**`,
      embeds: [embed],
      components: [buildPrisButton(false)]
    });

    return res.status(200).json({
      success: true,
      channelId: createdChannel.id,
      channelName: createdChannel.name
    });
  } catch (err) {
    console.error("Erreur /recrutement :", err);
    return res.status(500).json({ error: "Erreur interne du serveur." });
  }
});

discordClient.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isButton()) return;
    if (interaction.customId !== "pris") return;

    if (
      !interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageChannels) &&
      !interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)
    ) {
      return interaction.reply({
        content: "❌ Tu n'as pas la permission d'utiliser ce bouton.",
        ephemeral: true
      });
    }

    await interaction.deferUpdate();

    const oldEmbed = interaction.message.embeds[0];
    const newEmbed = EmbedBuilder.from(oldEmbed).setColor(0x2ed573);

    newEmbed.addFields({
      name: "Statut",
      value: `✅ Pris par ${interaction.user.tag}`,
      inline: false
    });

    await interaction.message.edit({
      embeds: [newEmbed],
      components: [buildPrisButton(true)]
    });
  } catch (err) {
    console.error("Erreur bouton Pris :", err);
  }
});

discordClient.login(config.token);

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, async () => {
  console.log(`✅ Serveur lancé sur le port ${PORT}`);
  if (!discordClient.isReady()) {
    await discordClient.login(config.token);
  }
});
