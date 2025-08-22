const { faker } = require("@faker-js/faker");
const { MongoClient } = require("mongodb");
const { Client: PgClient } = require("pg");
const cassandra = require("cassandra-driver");
const { v4: uuidv4 } = require("uuid");

// MongoDB
const mongoClient = new MongoClient("mongodb://localhost:27017");
let mongoDb;

// PostgreSQL (TimescaleDB)
const pgClient = new PgClient({
  user: "postgres",
  host: "localhost",
  database: "edge_monitoring",
  password: "postgres",
  port: 5432,
});

// Cassandra
const cassClient = new cassandra.Client({
  contactPoints: ["localhost"],
  localDataCenter: "datacenter1",
  keyspace: "edge_monitoring",
});

// Sensor data generator
function generateSensorData() {
  return {
    id: uuidv4(),
    timestamp: new Date(),
    temperature: faker.number.float({ min: 18, max: 30 }),
    pressure: faker.number.float({ min: 950, max: 1050 }),
    co2: faker.number.int({ min: 400, max: 1600 }),
    source: faker.helpers.arrayElement(["GebouwA", "GebouwB"]),
    status: "actief"
  };
}

// Invoegen MongoDB
async function insertMongo(data) {
  await mongoDb.collection("sensor_data").insertOne(data);
}

// Invoegen PostgreSQL
async function insertPostgres(data) {
  const query = `
    INSERT INTO sensor_data (id, timestamp, temperature, co2, pressure, source, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `;
  const values = [
    data.id,
    data.timestamp,
    data.temperature,
    data.co2,
    data.pressure,
    data.source,
    data.status
  ];
  await pgClient.query(query, values);
}

// Invoegen Cassandra
async function insertCassandra(data) {
  const query = `
    INSERT INTO sensor_data (id, timestamp, temperature, co2, pressure, source, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
  const params = [
    data.id,
    data.timestamp,
    data.temperature,
    data.co2,
    data.pressure,
    data.source,
    data.status
  ];
  await cassClient.execute(query, params, { prepare: true });
}

// Logging overschrijdingen
async function logWarning(co2, id) {
  await mongoDb.collection("logs").insertOne({
    timestamp: new Date(),
    message: `CO2 overschreden: ${co2} ppm`,
    sensor_id: id
  });
}

// Main functie
async function main() {
  try {
    await mongoClient.connect();
    mongoDb = mongoClient.db("edge_monitoring");
    await pgClient.connect();
    await cassClient.connect();

    console.log("✅ Verbonden met MongoDB, PostgreSQL en Cassandra");
    console.log("⏳ Start real-time simulatie...");

    setInterval(async () => {
      const data = generateSensorData();

      try {
        await Promise.all([
          insertMongo(data),
          insertPostgres(data),
          insertCassandra(data)
        ]);

        console.log(
          `📡 ${data.source}: CO2=${data.co2}ppm, Temp=${data.temperature}°C`
        );

        if (data.co2 > 800) {
          console.warn(`🚨 WAARSCHUWING: CO2 overschreden (${data.co2} ppm)`);
          await logWarning(data.co2, data.id);
        }
      } catch (err) {
        console.error("❌ Fout bij data-insert:", err.message);
      }
    }, 5000);
  } catch (err) {
    console.error("❌ Verbinding mislukt:", err.message);
  }
}

main();