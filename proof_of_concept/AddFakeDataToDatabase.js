const cassandra = require("cassandra-driver");
const { Client } = require("pg");
const { v4: uuidv4 } = require("uuid");
const { faker } = require("@faker-js/faker");
const { MongoClient } = require("mongodb");

const NUM_RECORDS = 100;

// Cassandra Clients
const cassClientWithoutKeyspace = new cassandra.Client({
  contactPoints: ["127.0.0.1"], // Default Cassandra
  localDataCenter: "datacenter1",
  socketOptions: { readTimeout: 30000 },
});

const cassClientAltWithoutKeyspace = new cassandra.Client({
  contactPoints: ["127.0.0.1:9043"], // Alternative Cassandra
  localDataCenter: "datacenter1",
  socketOptions: { readTimeout: 30000 },
});

const cassClientCentralWithoutKeyspace = new cassandra.Client({
  contactPoints: ["127.0.0.1:9052"], // Centralized Cassandra
  localDataCenter: "datacenter1",
  socketOptions: { readTimeout: 30000 },
});

let cassClient, cassClientAlt, cassClientCentral;

// TimescaleDB Clients
const pgClientCentral = new Client({
  user: "central_user",
  host: "localhost",
  database: "central_db",
  password: "central_pass",
  port: 5444,
});

const pgClient = new Client({
  user: "edge_user",
  host: "localhost",
  database: "edge_db",
  password: "edge_pass",
  port: 5432,
});

const pgClientAlt = new Client({
  user: "edge_user_alt",
  host: "localhost",
  database: "edge_db_alt",
  password: "edge_pass_alt",
  port: 5433,
});

// MongoDB URLs
const mongoCentralUrl = "mongodb://localhost:27030";
const mongoHashUrl = "mongodb://localhost:27019";
const mongoRangeUrl = "mongodb://localhost:27025";

// Main Function
(async () => {
  try {
    // ** Cassandra Initialization **
    console.log("Initializing Cassandra...");
    await cassClientWithoutKeyspace.connect();

    // Default Cassandra: Consistent Hashing
    await cassClientWithoutKeyspace.execute(`
      CREATE KEYSPACE IF NOT EXISTS edge_keyspace
      WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};
    `);

    cassClient = new cassandra.Client({
      contactPoints: ["127.0.0.1"],
      localDataCenter: "datacenter1",
      keyspace: "edge_keyspace",
      socketOptions: { readTimeout: 30000 },
    });

    await cassClient.connect();
    await cassClient.execute(`
      CREATE TABLE IF NOT EXISTS sensor_data (
        sensor_id UUID,
        timestamp TIMESTAMP,
        temperature DOUBLE,
        humidity DOUBLE,
        status TEXT,
        log_level TEXT,
        PRIMARY KEY (sensor_id)
      );
    `);
    console.log("Cassandra (Consistent Hashing) initialized.");

    // Alternative Cassandra: Range-Based Partitioning (Token Range)
    console.log("Initializing Alternative Cassandra...");
    await cassClientAltWithoutKeyspace.connect();

    await cassClientAltWithoutKeyspace.execute(`
      CREATE KEYSPACE IF NOT EXISTS edge_keyspace_alt
      WITH replication = {'class': 'NetworkTopologyStrategy', 'datacenter1': 2};
    `);

    cassClientAlt = new cassandra.Client({
      contactPoints: ["127.0.0.1:9043"],
      localDataCenter: "datacenter1",
      keyspace: "edge_keyspace_alt",
      socketOptions: { readTimeout: 30000 },
    });

    await cassClientAlt.connect();
    await cassClientAlt.execute(`
      CREATE TABLE IF NOT EXISTS sensor_data (
        region TEXT,
        sensor_id UUID,
        timestamp TIMESTAMP,
        temperature DOUBLE,
        humidity DOUBLE,
        status TEXT,
        log_level TEXT,
        PRIMARY KEY ((region), sensor_id, timestamp)
      ) WITH CLUSTERING ORDER BY (sensor_id ASC, timestamp DESC);
    `);
    console.log("Alternative Cassandra (Range-Based Partitioning) initialized.");

    // ** Centralized Cassandra Initialization **
    console.log("Initializing Centralized Cassandra...");
    await cassClientCentralWithoutKeyspace.connect();

    await cassClientCentralWithoutKeyspace.execute(`
      CREATE KEYSPACE IF NOT EXISTS edge_keyspace_central
      WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};
    `);

    cassClientCentral = new cassandra.Client({
      contactPoints: ["127.0.0.1:9052"],
      localDataCenter: "datacenter1",
      keyspace: "edge_keyspace_central",
      socketOptions: { readTimeout: 30000 },
    });

    await cassClientCentral.connect();

    await cassClientCentral.execute(`
      CREATE TABLE IF NOT EXISTS sensor_data (
        sensor_id UUID,
        timestamp TIMESTAMP,
        temperature DOUBLE,
        humidity DOUBLE,
        status TEXT,
        log_level TEXT,
        PRIMARY KEY (sensor_id, timestamp)
      ) WITH CLUSTERING ORDER BY (timestamp DESC);
    `);

    console.log("Centralized Cassandra initialized.");

    // ** MongoDB Initialization **
    console.log("Initializing MongoDB (Hash-Based Sharding)...");
    const mongoHashClient = new MongoClient(mongoHashUrl);
    await mongoHashClient.connect();
    const mongoHashDb = mongoHashClient.db("edge_db");

    console.log("Creating MongoDB collection for Hash-Based Sharding...");
    if (!(await mongoHashDb.listCollections({ name: "sensor_data" }).hasNext())) {
      await mongoHashDb.createCollection("sensor_data");
      await mongoHashDb.collection("sensor_data").createIndex({ sensor_id: "hashed" });
    }
    console.log("MongoDB (Hash-Based Sharding) initialized.");

    console.log("Initializing MongoDB (Range-Based Sharding)...");
    const mongoRangeClient = new MongoClient(mongoRangeUrl);
    await mongoRangeClient.connect();
    const mongoRangeDb = mongoRangeClient.db("edge_db");

    console.log("Creating MongoDB collection for Range-Based Sharding...");
    if (!(await mongoRangeDb.listCollections({ name: "sensor_data" }).hasNext())) {
      await mongoRangeDb.createCollection("sensor_data");
      await mongoRangeDb.collection("sensor_data").createIndex({ timestamp: 1 });
    }
    console.log("MongoDB (Range-Based Sharding) initialized.");

    // ** Centralized MongoDB Initialization **
    console.log("Initializing Centralized MongoDB...");
    const mongoCentralClient = new MongoClient(mongoCentralUrl);
    await mongoCentralClient.connect();
    const mongoCentralDb = mongoCentralClient.db("central_db");

    if (!(await mongoCentralDb.listCollections({ name: "sensor_data" }).hasNext())) {
      await mongoCentralDb.createCollection("sensor_data");
    }
    console.log("Centralized MongoDB initialized.");

    // ** TimescaleDB Initialization **
    console.log("Initializing TimescaleDB...");
    await pgClient.connect();

    await pgClient.query(`DROP TABLE IF EXISTS sensor_data;`);
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS sensor_data (
        sensor_id UUID,
        timestamp TIMESTAMPTZ NOT NULL,
        temperature DOUBLE PRECISION NOT NULL,
        humidity DOUBLE PRECISION NOT NULL,
        status TEXT,
        log_level TEXT,
        PRIMARY KEY (sensor_id, timestamp)
      );
    `);
    await pgClient.query(`
      SELECT create_hypertable('sensor_data', 'timestamp', if_not_exists => TRUE);
    `);
    console.log("TimescaleDB (Range-Based Partitioning) initialized.");

    // Alternative TimescaleDB: List-Based Partitioning
    console.log("Initializing Alternative TimescaleDB...");
    await pgClientAlt.connect();

    await pgClientAlt.query(`DROP TABLE IF EXISTS sensor_data;`);
    await pgClientAlt.query(`
      CREATE TABLE sensor_data (
        sensor_id UUID,
        timestamp TIMESTAMPTZ NOT NULL,
        temperature DOUBLE PRECISION NOT NULL,
        humidity DOUBLE PRECISION NOT NULL,
        status TEXT,
        log_level TEXT,
        PRIMARY KEY (sensor_id, timestamp)
      );
    `);
    await pgClientAlt.query(`
      SELECT create_hypertable('sensor_data', 'timestamp', if_not_exists => TRUE);
    `);
    console.log("Alternative TimescaleDB (List-Based Partitioning) initialized.");

    // ** Centralized TimescaleDB Initialization **
    console.log("Initializing Centralized TimescaleDB...");
    await pgClientCentral.connect();

    await pgClientCentral.query(`DROP TABLE IF EXISTS sensor_data;`);
    await pgClientCentral.query(`
      CREATE TABLE IF NOT EXISTS sensor_data (
        sensor_id UUID,
        timestamp TIMESTAMPTZ NOT NULL,
        temperature DOUBLE PRECISION NOT NULL,
        humidity DOUBLE PRECISION NOT NULL,
        status TEXT,
        log_level TEXT,
        PRIMARY KEY (sensor_id, timestamp)
      );
    `);
    await pgClientCentral.query(`
      SELECT create_hypertable('sensor_data', 'timestamp', if_not_exists => TRUE);
    `);
    console.log("Centralized TimescaleDB initialized.");

    // ** Data Insertion **
    console.log("Inserting data into Cassandra...");
    for (let i = 0; i < NUM_RECORDS; i++) {
      await cassClient.execute(
        `INSERT INTO sensor_data (sensor_id, timestamp, temperature, humidity, status, log_level)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          new Date(),
          faker.number.float({ min: -20, max: 40 }),
          faker.number.float({ min: 0, max: 100 }),
          faker.helpers.arrayElement(["actief", "offline"]),
          faker.helpers.arrayElement(["INFO", "ERROR"]),
        ]
      );
    }
    console.log("Cassandra (Consistent Hashing) data inserted.");

    console.log("Inserting data into Alternative Cassandra...");
    for (let i = 0; i < NUM_RECORDS; i++) {
      await cassClientAlt.execute(
        `INSERT INTO sensor_data (region, sensor_id, timestamp, temperature, humidity, status, log_level)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          faker.helpers.arrayElement(["Europe", "Asia", "America"]),
          uuidv4(),
          new Date(),
          faker.number.float({ min: -20, max: 40 }),
          faker.number.float({ min: 0, max: 100 }),
          faker.helpers.arrayElement(["actief", "offline"]),
          faker.helpers.arrayElement(["INFO", "ERROR"]),
        ]
      );
    }
    console.log("Alternative Cassandra (Range-Based Partitioning) data inserted.");

    console.log("Inserting data into Centralized Cassandra...");
    for (let i = 0; i < NUM_RECORDS; i++) {
      await cassClientCentral.execute(
        `INSERT INTO sensor_data (sensor_id, timestamp, temperature, humidity, status, log_level)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          new Date(),
          faker.number.float({ min: -20, max: 40 }),
          faker.number.float({ min: 0, max: 100 }),
          faker.helpers.arrayElement(["active", "offline"]),
          faker.helpers.arrayElement(["INFO", "ERROR"]),
        ]
      );
    }
    console.log("Centralized Cassandra data inserted.");

    // ** MongoDB Data Insertion **
    console.log("Inserting data into MongoDB (Hash-Based Sharding)...");
    for (let i = 0; i < NUM_RECORDS; i++) {
      await mongoHashDb.collection("sensor_data").insertOne({
        sensor_id: uuidv4(),
        timestamp: new Date().toISOString(),
        temperature: faker.number.float({ min: -20, max: 40 }),
        humidity: faker.number.float({ min: 0, max: 100 }),
        status: faker.helpers.arrayElement(["actief", "offline"]),
        log_level: faker.helpers.arrayElement(["INFO", "ERROR"]),
      });
    }
    console.log("MongoDB (Hash-Based Sharding) data inserted.");

    console.log("Inserting data into MongoDB (Range-Based Sharding)...");
    for (let i = 0; i < NUM_RECORDS; i++) {
      await mongoRangeDb.collection("sensor_data").insertOne({
        sensor_id: uuidv4(),
        timestamp: new Date().toISOString(),
        temperature: faker.number.float({ min: -20, max: 40 }),
        humidity: faker.number.float({ min: 0, max: 100 }),
        status: faker.helpers.arrayElement(["actief", "offline"]),
        log_level: faker.helpers.arrayElement(["INFO", "ERROR"]),
      });
    }
    console.log("MongoDB (Range-Based Sharding) data inserted.");

    console.log("Inserting data into TimescaleDB...");
    for (let i = 0; i < NUM_RECORDS; i++) {
      await pgClient.query(
        `INSERT INTO sensor_data (sensor_id, timestamp, temperature, humidity, status, log_level)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          uuidv4(),
          new Date(),
          faker.number.float({ min: -20, max: 40 }),
          faker.number.float({ min: 0, max: 100 }),
          faker.helpers.arrayElement(["actief", "offline"]),
          faker.helpers.arrayElement(["INFO", "ERROR"]),
        ]
      );
    }
    console.log("TimescaleDB (Range-Based Partitioning) data inserted.");

    console.log("Inserting data into Alternative Cassandra...");
    for (let i = 0; i < NUM_RECORDS; i++) {
      await cassClientAlt.execute(
        `INSERT INTO sensor_data (region, sensor_id, timestamp, temperature, humidity, status, log_level)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          faker.helpers.arrayElement(["Europe", "Asia", "America"]),
          uuidv4(),
          new Date(),
          faker.number.float({ min: -20, max: 40 }),
          faker.number.float({ min: 0, max: 100 }),
          faker.helpers.arrayElement(["actief", "offline"]),
          faker.helpers.arrayElement(["INFO", "ERROR"]),
        ]
      );
    }
    console.log("Alternative Cassandra (Range-Based Partitioning) data inserted.");

    console.log("Inserting data into Centralized MongoDB...");
    for (let i = 0; i < NUM_RECORDS; i++) {
      await mongoCentralDb.collection("sensor_data").insertOne({
        sensor_id: uuidv4(),
        timestamp: new Date().toISOString(),
        temperature: faker.number.float({ min: -20, max: 40 }),
        humidity: faker.number.float({ min: 0, max: 100 }),
        status: faker.helpers.arrayElement(["active", "offline"]),
        log_level: faker.helpers.arrayElement(["INFO", "ERROR"]),
      });
    }
    console.log("Centralized MongoDB data inserted.");

    console.log("Inserting data into Centralized TimescaleDB...");
    for (let i = 0; i < NUM_RECORDS; i++) {
      await pgClientCentral.query(
        `INSERT INTO sensor_data (sensor_id, timestamp, temperature, humidity, status, log_level)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          uuidv4(),
          new Date(),
          faker.number.float({ min: -20, max: 40 }),
          faker.number.float({ min: 0, max: 100 }),
          faker.helpers.arrayElement(["active", "offline"]),
          faker.helpers.arrayElement(["INFO", "ERROR"]),
        ]
      );
    }
    console.log("Centralized TimescaleDB data inserted.");
    
  } catch (err) {
    console.error("Error:", err);
  } finally {
    if (cassClient) await cassClient.shutdown();
    if (cassClientAlt) await cassClientAlt.shutdown();
    if (cassClientCentral) await cassClientCentral.shutdown();
    await cassClientWithoutKeyspace.shutdown();
    await cassClientAltWithoutKeyspace.shutdown();
    await cassClientCentralWithoutKeyspace.shutdown();
    await pgClient.end();
    await pgClientAlt.end();
    await pgClientCentral.end();
    console.log("Database connections closed.");
  }
})();