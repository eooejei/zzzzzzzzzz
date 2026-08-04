require("dotenv").config();

const express = require("express");
const path = require("path");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const paypal = require("paypal-rest-sdk");
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
const db = new Database("db.sqlite");

paypal.configure({
  mode: process.env.PAYPAL_MODE || "sandbox",
  client_id: process.env.PAYPAL_CLIENT_ID,
  client_secret: process.env.PAYPAL_CLIENT_SECRET
});

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL,
  prenom TEXT NOT NULL,
  discordId TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  paypalOrderId TEXT,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paidAt TEXT,
  FOREIGN KEY (userId) REFERENCES users(id)
);
`);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "change_me",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true }
  })
);
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
    const user = await discordClient.users.fetch(userId);
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
    console.error("Impossible d'envoyer le MP :", err.message);
    return false;
  }
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Non authentifié." });
  next();
}

function getUserById(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
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

    const guild = await discordClient.guilds.fetch(config.guildId);
    if (!guild) return res.status(500).json({ error: "Serveur Discord introuvable." });

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

    const roleMentions = (config.mentionRoleIds || []).map(id => `<@&${id}>`).join(" ");

    await channel.send({
      content: roleMentions
        ? `${roleMentions}\n📥 Nouvelle candidature pour **${poste}**`
        : `📥 Nouvelle candidature pour **${poste}**`,
      embeds: [embed],
      components: [buildDecisionButtons(false, discordId, poste)],
      allowedMentions: { roles: config.mentionRoleIds || [] }
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Erreur /recrutement :", err);
    return res.status(500).json({ error: "Erreur interne du serveur." });
  }
});

discordClient.on("interactionCreate", async (interaction) => {
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
    const updatedEmbed = EmbedBuilder.from(originalEmbed).setColor(isAccept ? 0x2ed573 : 0xe52d48);

    updatedEmbed.addFields({
      name: "Décision",
      value: isAccept
        ? `✅ Acceptée par ${interaction.user.tag}`
        : `❌ Refusée par ${interaction.user.tag}`,
      inline: false
    });

    await interaction.message.edit({
      embeds: [updatedEmbed],
      components: [buildDecisionButtons(true, applicantId, poste)]
    });

    await sendDecisionDM(applicantId, isAccept, poste);
  } catch (err) {
    console.error("Erreur interaction button :", err);
  }
});

app.post("/api/register", async (req, res) => {
  try {
    const { nom, prenom, discordId, email, password } = req.body;
    if (!nom || !prenom || !discordId || !email || !password) {
      return res.status(400).json({ error: "Tous les champs sont obligatoires." });
    }

    const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (exists) return res.status(400).json({ error: "Cet email est déjà utilisé." });

    const passwordHash = await bcrypt.hash(password, 10);
    const info = db.prepare(
      "INSERT INTO users (nom, prenom, discordId, email, passwordHash) VALUES (?, ?, ?, ?, ?)"
    ).run(nom, prenom, discordId, email, passwordHash);

    req.session.userId = info.lastInsertRowid;
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erreur serveur." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email et mot de passe obligatoires." });
    }

    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user) return res.status(400).json({ error: "Identifiants invalides." });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(400).json({ error: "Identifiants invalides." });

    req.session.userId = user.id;
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erreur serveur." });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get("/api/me", requireAuth, (req, res) => {
  const user = getUserById(req.session.userId);
  if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });
  res.json({
    id: user.id,
    nom: user.nom,
    prenom: user.prenom,
    discordId: user.discordId,
    email: user.email
  });
});

app.post("/api/create-payment", requireAuth, (req, res) => {
  try {
    const { amount } = req.body;
    const user = getUserById(req.session.userId);
    if (!user) return res.status(401).json({ error: "Non authentifié." });

    const total = Number(amount);
    if (!total || total <= 0) return res.status(400).json({ error: "Montant invalide." });

    const order = db.prepare(
      "INSERT INTO orders (userId, amount, status) VALUES (?, ?, 'pending')"
    ).run(user.id, total);

    const createPaymentJson = {
      intent: "sale",
      payer: { payment_method: "paypal" },
      redirect_urls: {
        return_url: process.env.PAYPAL_RETURN_URL,
        cancel_url: process.env.PAYPAL_CANCEL_URL
      },
      transactions: [
        {
          item_list: {
            items: [
              {
                name: "Achat Boutique Urgence Lilloise",
                sku: `order_${order.lastInsertRowid}`,
                price: total.toFixed(2),
                currency: "EUR",
                quantity: 1
              }
            ]
          },
          amount: { currency: "EUR", total: total.toFixed(2) },
          description: "Paiement boutique Urgence Lilloise"
        }
      ]
    };

    paypal.payment.create(createPaymentJson, (error, payment) => {
      if (error) {
        console.error(error);
        return res.status(500).json({ error: "Erreur PayPal." });
      }

      db.prepare("UPDATE orders SET paypalOrderId = ? WHERE id = ?")
        .run(payment.id, order.lastInsertRowid);

      const approvalUrl = payment.links.find(l => l.rel === "approval_url");
      return res.json({
        success: true,
        approvalUrl: approvalUrl ? approvalUrl.href : null,
        orderId: order.lastInsertRowid
      });
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erreur serveur." });
  }
});

app.post("/api/payment/confirm", requireAuth, async (req, res) => {
  try {
    const { orderId } = req.body;
    const user = getUserById(req.session.userId);
    const order = db.prepare(
      "SELECT * FROM orders WHERE id = ? AND userId = ?"
    ).get(orderId, user.id);

    if (!order) return res.status(404).json({ error: "Commande introuvable." });
    if (order.status === "paid") return res.json({ success: true, alreadyPaid: true });

    db.prepare(
      "UPDATE orders SET status = 'paid', paidAt = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(orderId);

    const channel = await discordClient.channels.fetch(process.env.DISCORD_LOG_CHANNEL_ID);
    if (channel && channel.isTextBased()) {
      await channel.send(
        `✅ **Paiement reçu**\n` +
        `**Nom :** ${user.nom}\n` +
        `**Prénom :** ${user.prenom}\n` +
        `**ID Discord :** ${user.discordId}\n` +
        `**Email :** ${user.email}\n` +
        `**Commande :** #${order.id}\n` +
        `**Montant :** ${order.amount.toFixed(2)} €`
      );
    }

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erreur serveur." });
  }
});

app.get("/payment/success", (req, res) => {
  res.send(`
    <h1>Paiement en attente de confirmation</h1>
    <p>Le paiement doit être validé côté serveur.</p>
  `);
});

app.get("/payment/cancel", (req, res) => {
  res.send(`
    <h1>Paiement annulé</h1>
    <p>Tu as annulé le paiement.</p>
  `);
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

(async () => {
  await discordClient.login(config.token);
  app.listen(PORT, () => {
    console.log(`✅ Serveur lancé sur le port ${PORT}`);
  });
})();
