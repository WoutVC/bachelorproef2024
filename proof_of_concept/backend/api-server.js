const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

// MongoDB connectie-instellingen
const mongoUrl = 'mongodb://localhost:27030';
const dbName = 'central_db';
const collectionName = 'sensor_data';

let db, collection;

// Connecteer naar MongoDB bij het opstarten van de server
MongoClient.connect(mongoUrl, { useUnifiedTopology: true })
  .then((client) => {
    db = client.db(dbName);
    collection = db.collection(collectionName);
    console.log('✅ Verbonden met MongoDB');
  })
  .catch((err) => {
    console.error('❌ Fout bij verbinden met MongoDB:', err);
  });

// API-endpoint: haal de meest recente sensorwaarde op
app.get('/latest', async (req, res) => {
  try {
    const latest = await collection
      .find({})
      .sort({ timestamp: -1 })
      .limit(1)
      .toArray();

    if (latest.length === 0) {
      return res.status(404).json({ message: 'Geen data gevonden' });
    }

    res.json(latest[0]);
  } catch (err) {
    console.error('❌ Fout bij ophalen laatste data:', err);
    res.status(500).json({ message: 'Serverfout' });
  }
});

app.listen(port, () => {
  console.log(`🚀 API-server draait op http://localhost:${port}`);
});