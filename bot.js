// bot.js
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

async function sendDecisionDM(userId, accepted, poste) {
  try {
    const user = await client.users.fetch(userId);
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

client.once("clientReady", () => {
  console.log(`✅ Bot prêt : ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isButton()) return;

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

    const row = new ActionRowBuilder().addComponents(
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
      components: [row]
    });

    await sendDecisionDM(applicantId, isAccept, poste);
  } catch (err) {
    console.error("Erreur interaction button :", err);
  }
});

client.login(config.token);
