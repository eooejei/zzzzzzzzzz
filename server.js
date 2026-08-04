const express = require('express');
const path = require('path');

const app = express();

// Port required by Render.com
const PORT = process.env.PORT || 3000;

// Serve static files from the current directory (or adjust to 'public' if you use that)
const staticDir = path.resolve(__dirname);
app.use(express.static(staticDir));

// Fallback to index.html for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(staticDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
