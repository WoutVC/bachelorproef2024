const cassandra = require("cassandra-driver");
const { Client } = require("pg");
const { MongoClient } = require("mongodb");
const { v4: uuidv4 } = require("uuid");
const { performance } = require("perf_hooks");
const { ObjectId } = require("mongodb");
const fs = require("fs");

const NUM_RECORDS = 100;
const SCALE_FACTORS = [10, 50, 100];

const cassClient = new cassandra.Client({
  contactPoints: ["127.0.0.1"],
  localDataCenter: "datacenter1",
  keyspace: "edge_keyspace",
});

const cassClientAlt = new cassandra.Client({
  contactPoints: ["127.0.0.1:9043"],
  localDataCenter: "datacenter1",
  keyspace: "edge_keyspace_alt",
});

const cassCentralClient = new cassandra.Client({
  contactPoints: ["127.0.0.1:9052"],
  localDataCenter: "datacenter1",
  keyspace: "edge_keyspace_central",
  socketOptions: { readTimeout: 30000 },
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

const centralizedPgClient = new Client({
  user: "central_user",
  host: "localhost",
  database: "central_db",
  password: "central_pass",
  port: 5444,
});

const mongoHashUrl = "mongodb://localhost:27019";
const mongoRangeUrl = "mongodb://localhost:27025";
const mongoCentralizedUrl = "mongodb://localhost:27030";

let mongoHashClient, mongoRangeClient, mongoCentralClient;
let mongoHashDb, mongoRangeDb, mongoCentralDb;

const testResults = [];

function saveResultsToFile() {
  fs.writeFileSync("testResults.json", JSON.stringify(testResults, null, 2));
  console.log("Test results saved to testResults.json");
}

async function executeQuery(client, query) {
  if (client instanceof cassandra.Client) {
    await client.execute(query);
  } else if (client instanceof Client) {
    await client.query(query);
  } else if (client instanceof MongoClient) {
    await query();
  }
}

async function testLatency(client, query, label) {
  console.log(`Testing Latency for ${label}...`);
  const start = performance.now();
  for (let i = 0; i < NUM_RECORDS; i++) {
    try {
      await executeQuery(client, query);
    } catch (error) {
      console.error(`Error during ${label} at record ${i}:`, error);
    }
  }
  const end = performance.now();
  const latency = ((end - start) / NUM_RECORDS).toFixed(2);
  console.log(`${label} Latency: ${latency} ms per operation`);
  testResults.push({ metric: "Latency", label, value: parseFloat(latency) });
}

async function testThroughput(client, query, label) {
  console.log(`Testing Throughput for ${label}...`);
  const start = performance.now();
  const promises = [];
  for (let i = 0; i < NUM_RECORDS; i++) {
    promises.push(executeQuery(client, query));
  }
  await Promise.all(promises);
  const end = performance.now();
  const throughput = (NUM_RECORDS / ((end - start) / 1000)).toFixed(2);
  console.log(`${label} Throughput: ${throughput} ops/sec`);
  testResults.push({ metric: "Throughput", label, value: parseFloat(throughput) });
}

async function testScalability(client, query, label, scaleFactors) {
  console.log(`Testing Scalability for ${label}...`);
  for (const factor of scaleFactors) {
    const start = performance.now();
    for (let i = 0; i < factor; i++) {
      try {
        await executeQuery(client, query);
      } catch (error) {
        console.error(`Error during ${label} at record ${i}:`, error);
      }
    }
    const end = performance.now();
    const scalability = ((end - start) / factor).toFixed(2);
    console.log(`${label} Scalability (${factor} records): ${scalability} ms per operation`);
    testResults.push({ metric: "Scalability", label: `${label} (${factor} records)`, value: parseFloat(scalability) });
  }
}

async function testConsistency(client, query, label) {
  console.log(`Testing Consistency for ${label}...`);
  const writePromises = [];
  for (let i = 0; i < 10; i++) {
    if (client instanceof cassandra.Client) {
      writePromises.push(client.execute(query));
    } else if (client instanceof Client) {
      writePromises.push(client.query(query));
    } else if (client instanceof MongoClient) {
      writePromises.push(
        client.db().collection("sensor_data").insertOne({
          _id: new ObjectId(),
          sensor_id: uuidv4(),
          timestamp: new Date(),
          status: "actief",
        })
      );
    }
  }
  await Promise.all(writePromises);
  let resultCount = 0;
  if (client instanceof cassandra.Client) {
    const result = await client.execute("SELECT COUNT(*) FROM sensor_data WHERE status = 'actief' ALLOW FILTERING");
    resultCount = result.rows[0].count;
  } else if (client instanceof Client) {
    const result = await client.query("SELECT COUNT(*) FROM sensor_data WHERE status = 'actief'");
    resultCount = result.rows[0].count;
  } else if (client instanceof MongoClient) {
    resultCount = await client.db().collection("sensor_data").countDocuments({ status: "actief" });
  }
  console.log(`${label} Consistency: ${resultCount} records match`);
  testResults.push({ metric: "Consistency", label, value: resultCount });
}

async function testFaultTolerance(client, label, createNewClient) {
  console.log(`Testing Fault Tolerance for ${label}...`);
  try {
    console.log("Simulating failure by closing client...");
    
    if (client instanceof cassandra.Client) {
      await client.shutdown();
      client = createNewClient();
      await client.connect();
    } else if (client instanceof Client) {
      await client.end();
      client = createNewClient();
      await client.connect();
    } else if (client instanceof MongoClient) {
      await client.close();
      client = createNewClient();
      await client.connect();
    } else {
      throw new Error("Unhandled client type for fault tolerance test.");
    }

    console.log(`${label} Fault Tolerance: Successfully recovered`);
    testResults.push({ metric: "Fault Tolerance", label, value: "Success" });
  } catch (error) {
    console.error(`${label} Fault Tolerance: Error encountered - ${error.message}`);
    testResults.push({ metric: "Fault Tolerance", label, value: "Failed" });
  }

  return client;
}


(async () => {
  try {
    await cassClient.connect();
    await cassClientAlt.connect();
    await cassCentralClient.connect();
    await pgClient.connect();
    await pgClientAlt.connect();
    await centralizedPgClient.connect();
    mongoHashClient = new MongoClient(mongoHashUrl);
    mongoRangeClient = new MongoClient(mongoRangeUrl);
    mongoCentralClient = new MongoClient(mongoCentralizedUrl);
    await mongoHashClient.connect();
    await mongoRangeClient.connect();
    await mongoCentralClient.connect();
    mongoHashDb = mongoHashClient.db("edge_db");
    mongoRangeDb = mongoRangeClient.db("edge_db");
    mongoCentralDb = mongoCentralClient.db("central_db");

    const cassWriteQuery = `INSERT INTO sensor_data (sensor_id, timestamp, temperature, humidity, status, log_level) VALUES (uuid(), toTimestamp(now()), 25.5, 60.0, 'actief', 'INFO')`;
    const cassAltWriteQuery = `INSERT INTO sensor_data (region, sensor_id, timestamp, temperature, humidity, status, log_level) VALUES ('Europe', uuid(), toTimestamp(now()), 25.5, 60.0, 'actief', 'INFO')`;
    const pgWriteQuery = `INSERT INTO sensor_data (sensor_id, timestamp, temperature, humidity, status, log_level) VALUES (gen_random_uuid(), NOW(), 25.5, 60.0, 'actief', 'INFO')`;
    const mongoHashQuery = async () => mongoHashDb.collection("sensor_data").insertOne({ sensor_id: uuidv4(), timestamp: new Date(), temperature: Math.random() * 100, humidity: Math.random() * 100, status: "actief", log_level: "INFO" });
    const mongoRangeQuery = async () => mongoRangeDb.collection("sensor_data").insertOne({ sensor_id: uuidv4(), timestamp: new Date(), temperature: Math.random() * 100, humidity: Math.random() * 100, status: "actief", log_level: "INFO" });
    const centralizedMongoQuery = async () => mongoCentralDb.collection("sensor_data").insertOne({ sensor_id: uuidv4(), timestamp: new Date(), temperature: Math.random() * 100, humidity: Math.random() * 100, status: "actief", log_level: "INFO" });

    await testLatency(cassClient, cassWriteQuery, "Cassandra Consistent Hashing"); 
    await testLatency(cassClientAlt, cassAltWriteQuery, "Cassandra Range-Based Partitioning");
    await testLatency(pgClient, pgWriteQuery, "TimescaleDB Range-Based Partitioning");
    await testLatency(pgClientAlt, pgWriteQuery, "TimescaleDB List-Based Partitioning");
    await testLatency(mongoHashClient, mongoHashQuery, "MongoDB Hash-Based Sharding");
    await testLatency(mongoRangeClient, mongoRangeQuery, "MongoDB Range-Based Sharding");
    await testLatency(cassCentralClient, cassWriteQuery, "Cassandra Centralized");
    await testLatency(centralizedPgClient, pgWriteQuery, "TimescaleDB Centralized");
    await testLatency(mongoCentralClient, centralizedMongoQuery, "MongoDB Centralized");

    await testThroughput(cassClient, cassWriteQuery, "Cassandra Consistent Hashing");
    await testThroughput(cassClientAlt, cassAltWriteQuery, "Cassandra Range-Based Partitioning");
    await testThroughput(pgClient, pgWriteQuery, "TimescaleDB Range-Based Partitioning");
    await testThroughput(pgClientAlt, pgWriteQuery, "TimescaleDB List-Based Partitioning");
    await testThroughput(mongoHashClient, mongoHashQuery, "MongoDB Hash-Based Sharding");
    await testThroughput(mongoRangeClient, mongoRangeQuery, "MongoDB Range-Based Sharding");
    await testThroughput(cassCentralClient, cassWriteQuery, "Cassandra Centralized");
    await testThroughput(centralizedPgClient, pgWriteQuery, "TimescaleDB Centralized");
    await testThroughput(mongoCentralClient, centralizedMongoQuery, "MongoDB Centralized");
    
    await testScalability(cassClient, cassWriteQuery, "Cassandra Consistent Hashing", SCALE_FACTORS);
    await testScalability(cassClientAlt, cassAltWriteQuery, "Cassandra Range-Based Partitioning", SCALE_FACTORS);
    await testScalability(pgClient, pgWriteQuery, "TimescaleDB Range-Based Partitioning", SCALE_FACTORS);
    await testScalability(pgClientAlt, pgWriteQuery, "TimescaleDB List-Based Partitioning", SCALE_FACTORS);
    await testScalability(mongoHashClient, mongoHashQuery, "MongoDB Hash-Based Sharding", SCALE_FACTORS);
    await testScalability(mongoRangeClient, mongoRangeQuery, "MongoDB Range-Based Sharding", SCALE_FACTORS);
    await testScalability(cassCentralClient, cassWriteQuery, "Cassandra Centralized", SCALE_FACTORS);
    await testScalability(centralizedPgClient, pgWriteQuery, "TimescaleDB Centralized", SCALE_FACTORS);
    await testScalability(mongoCentralClient, centralizedMongoQuery, "MongoDB Centralized", SCALE_FACTORS);
    
    await testConsistency(cassClient, cassWriteQuery, "Cassandra Consistent Hashing");
    await testConsistency(cassClientAlt, cassAltWriteQuery, "Cassandra Range-Based Partitioning");
    await testConsistency(pgClient, pgWriteQuery, "TimescaleDB Range-Based Partitioning");
    await testConsistency(pgClientAlt, pgWriteQuery, "TimescaleDB List-Based Partitioning");
    await testConsistency(mongoHashClient, mongoHashQuery, "MongoDB Hash-Based Sharding");
    await testConsistency(mongoRangeClient, mongoRangeQuery, "MongoDB Range-Based Sharding");
    await testConsistency(cassCentralClient, cassWriteQuery, "Cassandra Centralized");
    await testConsistency(centralizedPgClient, pgWriteQuery, "TimescaleDB Centralized");
    await testConsistency(mongoCentralClient, centralizedMongoQuery, "MongoDB Centralized");
    
    await testFaultTolerance(cassClient, "Cassandra Consistent Hashing", () => new cassandra.Client({
      contactPoints: ["127.0.0.1"],
      localDataCenter: "datacenter1",
      keyspace: "edge_keyspace",
    }));
    
    await testFaultTolerance(cassClientAlt, "Cassandra Range-Based Partitioning", () => new cassandra.Client({
      contactPoints: ["127.0.0.1:9043"],
      localDataCenter: "datacenter1",
      keyspace: "edge_keyspace_alt",
    }));
    
    await testFaultTolerance(mongoHashClient, "MongoDB Hash-Based Sharding", () => new MongoClient(mongoHashUrl));
    
    await testFaultTolerance(mongoRangeClient, "MongoDB Range-Based Sharding", () => new MongoClient(mongoRangeUrl));
    
    await testFaultTolerance(cassCentralClient, "Cassandra Centralized", () => new cassandra.Client({
      contactPoints: ["127.0.0.1:9052"],
      localDataCenter: "datacenter1",
      keyspace: "edge_keyspace_central",
      socketOptions: { readTimeout: 30000 },
    }));
    
    await testFaultTolerance(mongoCentralClient, "MongoDB Centralized", () => new MongoClient(mongoCentralizedUrl));


    /*await testBandwidth(cassClient, "Cassandra Consistent Hashing");
    await testBandwidth(cassClientAlt, "Cassandra Range-Based Partitioning");
    await testBandwidth(pgClient, "TimescaleDB Range-Based Partitioning");
    await testBandwidth(pgClientAlt, "TimescaleDB List-Based Partitioning");
    await testBandwidth(mongoHashClient, "MongoDB Hash-Based Sharding");
    await testBandwidth(mongoRangeClient, "MongoDB Range-Based Sharding");
    await testBandwidth(cassCentralClient, "Cassandra Centralized");
    await testBandwidth(centralizedPgClient, "TimescaleDB Centralized");
    await testBandwidth(mongoCentralClient, "MongoDB Centralized");*/

    saveResultsToFile();
  } catch (error) {
    console.error("Error during tests:", error);
  } finally {
    console.log("Shutting down all clients...");
    await cassClient.shutdown();
    await cassClientAlt.shutdown();
    await cassCentralClient.shutdown();
    await pgClient.end();
    await pgClientAlt.end();
    await centralizedPgClient.end();
    await mongoHashClient.close();
    await mongoRangeClient.close();
    await mongoCentralClient.close();

    console.log("All clients shut down.");
  }
})();