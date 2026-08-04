// server.js — Urgence Lilloise
// Sert le site statique et reçoit les candidatures de recrutement.html
// Prêt pour un déploiement sur Render.com

const express = require('express');
const path = require('path');

const app = express();

// Render fournit automatiquement le port via la variable d'environnement PORT
const PORT = process.env.PORT || 3000;

// URL de ton webhook Discord (à définir dans les variables d'environnement sur Render)
// Exemple : https://discord.com/api/webhooks/xxxxxxxx/yyyyyyyy
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

app.use(express.json());

// Sert tous les fichiers du dossier "public" (index.html, recrutement.html, reglement.html, etc.)
app.use(express.static(path.join(__dirname, 'public')));

// --- Route de recrutement ---
app.post('/recrutement', async (req, res) => {
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

    // Vérification basique des champs obligatoires
    if (!poste || !discordTag || !discordId || !prenom || !age || !ambitions || !pourquoiVous || !roleModerateur) {
      return res.status(400).json({ error: 'Merci de remplir tous les champs obligatoires.' });
    }

    if (!DISCORD_WEBHOOK_URL) {
      console.error('DISCORD_WEBHOOK_URL non définie dans les variables d\'environnement.');
      return res.status(500).json({ error: 'Configuration serveur incomplète. Contactez un administrateur.' });
    }

    // Construction de l'embed Discord
    const embed = {
      title: `📋 Nouvelle candidature — ${poste}`,
      color: 0xE52D48,
      fields: [
        { name: 'Pseudo Discord', value: discordTag, inline: true },
        { name: 'ID Discord', value: discordId, inline: true },
        { name: 'Prénom', value: prenom, inline: true },
        { name: 'Âge', value: String(age), inline: true },
        { name: 'Ambitions dans le staff', value: ambitions.slice(0, 1024) },
        { name: 'Pourquoi vous et pas un autre ?', value: pourquoiVous.slice(0, 1024) },
        { name: 'Expériences', value: experiences && experiences.trim() ? experiences.slice(0, 1024) : 'Aucune' },
        { name: 'Vision du rôle de modérateur', value: roleModerateur.slice(0, 1024) }
      ],
      timestamp: new Date().toISOString(),
      footer: { text: 'Urgence Lilloise — Recrutement' }
    };

    const discordResponse = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `📥 Nouvelle candidature pour le poste **${poste}** !`,
        embeds: [embed]
      })
    });

    if (!discordResponse.ok) {
      const errText = await discordResponse.text();
      console.error('Erreur webhook Discord:', errText);
      return res.status(502).json({ error: "Impossible d'envoyer la candidature au staff (Discord)." });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Erreur /recrutement:', err);
    return res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
});

// Fallback : renvoie index.html pour toute autre route (utile si tu ajoutes du routing plus tard)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Serveur Urgence Lilloise lancé sur le port ${PORT}`);
});
