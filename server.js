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

function padNumber(n) {
  return String(n).padStart(2, "0");
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

async function sendDecisionDM(userId, accepted, poste) {
  try {
    const user = await discordClient.users.fetch(userId);
    await user.send(
      accepted
        ? `✅ Félicitations, ta candidature pour **${poste}** a été **acceptée**. Merci de prendre contact avec le staff.`
        : `❌ Ta candidature pour **${poste}** a été **refusée**. Merci pour ton intérêt et bonne continuation.`
    );
    return true;
  } catch (err) {
    console.error("Impossible d'envoyer le MP :", err.message);
    return false;
  }
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

    if (!config.token) {
      return res.status(500).json({ error: "Token Discord manquant." });
    }

    const guild = await discordClient.guilds.fetch(config.guildId);
    if (!guild) {
      return res.status(500).json({ error: "Serveur Discord introuvable." });
    }

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

    const embed = new EmbedBuilder()
      .setTitle(`📋 Nouvelle candidature — ${safeText(poste, 100)}`)
      .setColor(0xe52d48)
      .addFields(
        { name: "Pseudo Discord", value: safeText(discordTag), inline: true },
        { name: "ID Discord", value: safeText(discordId), inline: true },
        { name: "Prénom", value: safeText(prenom), inline: true },
        { name: "Âge", value: safeText(age), inline: true },
        { name: "Ambitions dans le staff", value: safeText(ambitions), inline: false },
        { name: "Pourquoi vous et pas un autre ?", value: safeText(pourquoiVous), inline: false },
        { name: "Expériences", value: safeText(experiences || "Aucune"), inline: false },
        { name: "Vision du rôle de modérateur", value: safeText(roleModerateur), inline: false }
      )
      .setTimestamp()
      .setFooter({ text: "Urgence Lilloise — Recrutement" });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`accept|${discordId}|${poste}|${createdChannel.id}`)
        .setLabel("Accepter")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`refuse|${discordId}|${poste}|${createdChannel.id}`)
        .setLabel("Refuser")
        .setStyle(ButtonStyle.Danger)
    );

    const roleMentions = (config.mentionRoleIds || [])
      .map(id => `<@&${id}>`)
      .join(" ");

    await createdChannel.send({
      content: roleMentions
        ? `${roleMentions}\n📥 Nouvelle candidature pour **${poste}**`
        : `📥 Nouvelle candidature pour **${poste}**`,
      embeds: [embed],
      components: [row]
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

    const [action, applicantId, poste, channelId] = interaction.customId.split("|");
    if (!["accept", "refuse"].includes(action)) return;

    const isAccept = action === "accept";

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

    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const originalEmbed = interaction.message.embeds[0];
    const updatedEmbed = EmbedBuilder.from(originalEmbed).setColor(
      isAccept ? 0x2ed573 : 0xe52d48
    );

    updatedEmbed.addFields({
      name: "Décision",
      value: isAccept
        ? `✅ Acceptée par ${interaction.user.tag}`
        : `❌ Refusée par ${interaction.user.tag}`,
      inline: false
    });

    const disabledRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("disabled_accept")
        .setLabel("Accepter")
        .setStyle(ButtonStyle.Success)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId("disabled_refuse")
        .setLabel("Refuser")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(true)
    );

    await interaction.message.edit({
      embeds: [updatedEmbed],
      components: [disabledRow]
    });

    await channel.setName(
      `${isAccept ? "acceptée" : "refusée"}-${interaction.message.id.slice(-4)}`.toLowerCase()
    ).catch(() => {});

    await sendDecisionDM(applicantId, isAccept, poste);

    if (isAccept) {
      await channel.send(`✅ <@${applicantId}> candidature **acceptée** par ${interaction.user.tag}.`);
    } else {
      await channel.send(`❌ <@${applicantId}> candidature **refusée** par ${interaction.user.tag}.`);
    }
  } catch (err) {
    console.error("Erreur interaction button :", err);
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
