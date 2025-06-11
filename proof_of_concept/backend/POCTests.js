const cassandra = require("cassandra-driver");
const { Client } = require("pg");
const { MongoClient } = require("mongodb");
const { v4: uuidv4 } = require("uuid");
const { performance } = require("perf_hooks");
const fs = require("fs");

const NUM_RECORDS = 100;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function generateSensorData(building = "Building A", room = "Room 1", fixedTimestamp) {
  return {
    Id: uuidv4(),
    timestamp: fixedTimestamp || new Date(),
    temperature: Math.random() * 30 + 15,
    co2: Math.random() * 1000,
    pressure: Math.random() * 1000,
    building,
    room
  };
}

const offlineBuffer = {};


const cassandraClient = new cassandra.Client({
   contactPoints: ['localhost'],
   localDataCenter: 'datacenter1',
   protocolOptions: { port: 9052 },
   keyspace: 'centraldb',
});
 
const mongoUri = 'mongodb://localhost:27030';
const mongoDbName = 'centraldb';
 
const timescaleClient = new Client({
  user: 'central_user',
  host: 'localhost',
  database: 'central_db',
  password: 'central_pass',
  port: 5444,
});
 
const cassandraPartitionedConfigs = [
  {
    name: 'ListPartitioning',
    client: new cassandra.Client({
      contactPoints: ['localhost'],
      localDataCenter: 'datacenter1',
      protocolOptions: { port: 9042 },
      keyspace: 'edge_list_partitioning',
    }),     
  },
  {
    name: 'RangePartitioning',
    client: new cassandra.Client({
      contactPoints: ['localhost'],
      localDataCenter: 'datacenter1',
      protocolOptions: { port: 9043 },
      keyspace: 'edge_range_partitioning',
    }),     
  },
];
 
const mongoShardedConfigs = [
  { uri: 'mongodb://localhost:27019', dbName: 'edge_range_partitioning' },
  { uri: 'mongodb://localhost:27025', dbName: 'edge_list_partitioning' },
];
 
const timescalePartitionedConfigs = [
  {
    name: 'RangePartitioning',
    client: new Client({
      user: 'edge_user',
      host: 'localhost',
      database: 'edge_db',
      password: 'edge_pass',
      port: 5432,
    }),
  },
  {
    name: 'ListPartitioning',
    client: new Client({
      user: 'edge_user_alt',
      host: 'localhost',
      database: 'edge_db_alt',
      password: 'edge_pass_alt',
      port: 5433,
    }),
  },
];
 
const testResults = [];

function saveResultsToFile() {
  fs.writeFileSync("testResults.json", JSON.stringify(testResults, null, 2));
  console.log("Test results saved to testResults.json");
}

async function executeQuery(queryFn, timestamp) {
  if (timestamp !== undefined) {
    await queryFn(timestamp);
  } else {
    await queryFn();
  }
}

/*async function testLatency(client, query, label) {
  console.log(`Testing Latency for ${label}...`);
  const start = performance.now();
  for (let i = 0; i < NUM_RECORDS; i++) {
    try {
      await executeQuery(query);
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
}*/

async function testScalability(client, query, label, scaleFactors) {
  console.log(`Testing Scalability for ${label}...`);
  for (const factor of scaleFactors) {
    const start = performance.now();
    for (let i = 0; i < factor; i++) {
      try {
        await executeQuery(query);
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

async function testConsistency(client, queryFn, label) {
  console.log(`🔍 Testing Consistency for ${label}...`);

  const writeCount = 10;
  const baseTimestamp = new Date();

  // Genereer timestamps die verschillen per insert (bv. + i seconden)
  const timestamps = [];
  for (let i = 0; i < writeCount; i++) {
    timestamps.push(new Date(baseTimestamp.getTime() + i * 1000)); // elke insert +1s apart
  }

  const writePromises = timestamps.map(ts => queryFn(ts));
  await Promise.all(writePromises);

  const waitIntervals = [0, 500, 1000, 2000, 3000];
  const resultsOverTime = [];

  for (const delay of waitIntervals) {
    if (delay > 0) await new Promise(res => setTimeout(res, delay));

    let resultCount = 0;

    if (client instanceof require('cassandra-driver').Client) {
      if (label.includes('RangePartitioning')) {
        const from = baseTimestamp;
        const to = new Date(baseTimestamp.getTime() + (writeCount - 1) * 1000);

        const result = await client.execute(
          `SELECT COUNT(*) FROM sensor_data 
           WHERE building = 'Building A' AND room = 'Room 201' 
           AND timestamp >= ? AND timestamp <= ? ALLOW FILTERING`,
          [from, to],
          { prepare: true }
        );
        resultCount = parseInt(result.rows[0]['count'], 10);

      } else {
        const ts = timestamps[0];
        const result = await client.execute(
          "SELECT COUNT(*) FROM sensor_data WHERE building = 'Building A' AND timestamp = ? ALLOW FILTERING",
          [ts],
          { prepare: true }
        );
        resultCount = parseInt(result.rows[0]['count'], 10);
      }

    } else if (client.constructor.name === 'MongoClient') {
      const db = client.db();
      if (label.toLowerCase().includes('range')) {
        const from = baseTimestamp;
        const to = new Date(baseTimestamp.getTime() + (writeCount - 1) * 1000);

        resultCount = await db.collection("sensor_data").countDocuments({
          building: "Building A",
          timestamp: { $gte: from, $lte: to }
        });

      } else {
        const ts = timestamps[0];
        resultCount = await db.collection("sensor_data").countDocuments({
          building: "Building A",
          timestamp: ts
        });
      }

    } else if (client instanceof require('pg').Client) {
      const ts = timestamps[0];
      const result = await client.query(
        "SELECT COUNT(*) FROM sensor_data WHERE building = 'Building A' AND timestamp = $1",
        [ts]
      );
      resultCount = parseInt(result.rows[0].count, 10);

    } else {
      console.warn(`⚠️ Unknown client type for consistency test: ${label}`);
    }

    resultsOverTime.push({ delayMs: delay, visibleCount: resultCount });
    console.log(`⏱️ After ${delay}ms: ${resultCount}/${writeCount} records visible`);
  }

  const finalVisible = resultsOverTime[resultsOverTime.length - 1].visibleCount;
  testResults.push({
    metric: "Consistency",
    label,
    value: finalVisible,
    timeline: resultsOverTime
  });
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

/*async function testOfflineBehavior(edgeClients, label) {
  console.log(`\n🔌 Testing Offline Behavior for ${label} (Edge zonder centrale verbinding)...`);

  try {
    for (const [name, client] of Object.entries(edgeClients)) {
      console.log(`➡ Simulatie van lokaal schrijven in ${name}...`);

      for (let i = 0; i < 10; i++) {
        const sensorData = {
          Id: uuidv4(),
          timestamp: new Date(),
          temperature: Math.random() * 100,
          co2: Math.random() * 1000,
          pressure: Math.random() * 1000,
          building: "Building A",
          room: "Room 101"
        };

        if (name.includes("MongoDB")) {
          if (!client.isConnected || !client.topology || !client.topology.isConnected()) {
            if (!offlineBuffer[name]) offlineBuffer[name] = [];
            offlineBuffer[name].push(sensorData);
          } else {
            await executeQuery(() =>
              client.db("edge_building_b").collection("sensor_data").insertOne(sensorData)
            );
          }
        } else if (name.includes("TimescaleDB")) {
          await executeQuery(() =>
            client.query(
              "INSERT INTO sensor_data (id, timestamp, temperature, co2, pressure, building, room) VALUES ($1, $2, $3, $4, $5, $6, $7)",
              [
                sensorData.Id,
                sensorData.timestamp,
                sensorData.temperature,
                sensorData.co2,
                sensorData.pressure,
                sensorData.building,
                sensorData.room,
              ]
            )
          );
        } else if (name.includes("Cassandra")) {
          await executeQuery(() =>
            client.execute(
              "INSERT INTO sensor_data (id, timestamp, temperature, co2, pressure, building, room) VALUES (?, ?, ?, ?, ?, ?, ?)",
              [
                sensorData.Id,
                sensorData.timestamp,
                sensorData.temperature,
                sensorData.co2,
                sensorData.pressure,
                sensorData.building,
                sensorData.room,
              ],
              { prepare: true }
            )
          );
        }
      }

      console.log(`✅ ${name} operationeel zonder centrale connectie`);
      testResults.push({ metric: "Offline Behavior", label: name, value: "Operational" });
    }
  } catch (err) {
    console.error(`❌ Fout tijdens offline gedragstest:`, err);
    testResults.push({ metric: "Offline Behavior", label, value: "Failed" });
  }
}*/

async function testRealtimeLatency(client, queryFn, label, intervalMs = 1000, durationSeconds = 10) {
  console.log(`\n📡 Realtime Latency Test for ${label}...`);
  const records = Math.floor(durationSeconds * 1000 / intervalMs);
  let totalLatency = 0;

  for (let i = 0; i < records; i++) {
    const start = performance.now();
    try {
      await executeQuery(queryFn);
    } catch (error) {
      console.error(`Latency error at ${i}:`, error);
    }
    const end = performance.now();
    const latency = end - start;
    totalLatency += latency;
    await sleep(intervalMs);
  }

  const avgLatency = (totalLatency / records).toFixed(2);
  console.log(`${label} Avg Latency (real-time): ${avgLatency} ms`);
  testResults.push({ metric: "Realtime Latency", label, value: parseFloat(avgLatency) });
}

async function testRealtimeThroughput(client, queryFn, label, intervalMs = 200, durationSeconds = 10) {
  console.log(`\n🚀 Realtime Throughput Test for ${label}...`);
  let operationCount = 0;
  const start = performance.now();
  const endTime = start + durationSeconds * 1000;

  while (performance.now() < endTime) {
    try {
      await executeQuery(queryFn);
      operationCount++;
    } catch (err) {
      console.error("Throughput error:", err);
    }
    await sleep(intervalMs);
  }

  const end = performance.now();
  const throughput = (operationCount / ((end - start) / 1000)).toFixed(2);
  console.log(`${label} Throughput (real-time): ${throughput} ops/sec`);
  testResults.push({ metric: "Realtime Throughput", label, value: parseFloat(throughput) });
}

(async () => {
  try {
    await cassandraClient.connect();

    for (const config of cassandraPartitionedConfigs) {
      await config.client.connect();
    }

    await timescaleClient.connect();
    await timescaleClient.query("SET synchronous_commit TO OFF");

    for (const config of timescalePartitionedConfigs) {
      await config.client.connect();
      await config.client.query("SET synchronous_commit TO OFF");
    }


    const mongoCentralClient = new MongoClient(mongoUri);
    await mongoCentralClient.connect();
    const mongoCentralDb = mongoCentralClient.db(mongoDbName);

    const mongoShardedClients = [];
    const mongoShardedDbs = [];
    for (const shardConfig of mongoShardedConfigs) {
      const client = new MongoClient(shardConfig.uri);
      await client.connect();
      mongoShardedClients.push(client);
      mongoShardedDbs.push(client.db(shardConfig.dbName));
    }

    const cassandraQueryFn = async (timestamp) => {
      const sensorData = generateSensorData("Building A", "Room 101", timestamp);
      await cassandraClient.execute(
        "INSERT INTO sensor_data (id, timestamp, temperature, co2, pressure, building, room) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          sensorData.Id,
          sensorData.timestamp,
          sensorData.temperature,
          sensorData.co2,
          sensorData.pressure,
          sensorData.building,
          sensorData.room,
        ],
        { prepare: true }
      );
    };

    const cassandraPartitionedQueryFns = cassandraPartitionedConfigs.map(({ name, client }) => {
      return async (timestamp) => {
        const sensorData = generateSensorData("Building A", "Room 201", timestamp);
        if (name === 'ListPartitioning') {
          await client.execute(
            `INSERT INTO sensor_data (building, room, id, timestamp, temperature, co2, pressure) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              sensorData.building,
              sensorData.room,
              sensorData.Id,
              sensorData.timestamp,
              sensorData.temperature,
              sensorData.co2,
              sensorData.pressure,
            ],
            { prepare: true }
          );
        } else if (name === 'RangePartitioning') {
          await client.execute(
            `INSERT INTO sensor_data (building, room, timestamp, id, temperature, co2, pressure) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              sensorData.building,
              sensorData.room,
              sensorData.timestamp,
              sensorData.Id,
              sensorData.temperature,
              sensorData.co2,
              sensorData.pressure,
            ],
            { prepare: true }
          );
        } else {
          console.warn(`⚠️ Onbekende partitionering ${name} bij insert`);
        }
      };
    });

    const mongoCentralQueryFn = async (timestamp) => {
      const sensorData = generateSensorData("Building A", "Room 101", timestamp);
      await mongoCentralDb.collection("sensor_data").insertOne(sensorData);
    };

    const mongoShardedQueryFns = mongoShardedDbs.map(db => {
      return async (timestamp) => {
        const sensorData = generateSensorData("Building A", "Room 201", timestamp);
        await db.collection("sensor_data").insertOne(sensorData);
      };
    });

    const timescaleQueryFn = async (timestamp) => {
      const sensorData = generateSensorData("Building A", "Room 101", timestamp);
      const query =
        "INSERT INTO sensor_data (id, timestamp, temperature, co2, pressure, building, room) VALUES ($1, $2, $3, $4, $5, $6, $7)";
      await timescaleClient.query(query, [
        sensorData.Id,
        sensorData.timestamp,
        sensorData.temperature,
        sensorData.co2,
        sensorData.pressure,
        sensorData.building,
        sensorData.room,
      ]);
    };

    const timescalePartitionedQueryFns = timescalePartitionedConfigs.map(({ client }) => {
      return async (timestamp) => {
        const sensorData = generateSensorData("Building A", "Room 201", timestamp);
        const query =
          "INSERT INTO sensor_data (id, timestamp, temperature, co2, pressure, building, room) VALUES ($1, $2, $3, $4, $5, $6, $7)";
        await client.query(query, [
          sensorData.Id,
          sensorData.timestamp,
          sensorData.temperature,
          sensorData.co2,
          sensorData.pressure,
          sensorData.building,
          sensorData.room,
        ]);
      };
    });

    async function clearData() {
      // Cassandra
      await cassandraClient.execute("TRUNCATE sensor_data");
      for (const config of cassandraPartitionedConfigs) {
        await config.client.execute("TRUNCATE sensor_data");
      }

      // TimescaleDB (PostgreSQL)
      await timescaleClient.query("TRUNCATE TABLE sensor_data");
      for (const config of timescalePartitionedConfigs) {
        await config.client.query("TRUNCATE TABLE sensor_data");
      }

      // MongoDB
      await mongoCentralDb.collection("sensor_data").deleteMany({});
      for (const db of mongoShardedDbs) {
        await db.collection("sensor_data").deleteMany({});
      }

      console.log("Alle testdata verwijderd voor nieuwe tests");
    }

    await clearData();

    const SCALE_FACTORS = [1, 10, 100];

    // Cassandra centraal
    /*await testLatency(cassandraClient, cassandraQueryFn, 'Cassandra Centralized');
    await testThroughput(cassandraClient, cassandraQueryFn, 'Cassandra Centralized');*/
    await testRealtimeLatency(cassandraClient, cassandraQueryFn, 'Cassandra Centralized Realtime');
    await testRealtimeThroughput(cassandraClient, cassandraQueryFn, 'Cassandra Centralized Realtime');
    await testScalability(cassandraClient, cassandraQueryFn, 'Cassandra Centralized', SCALE_FACTORS);
    await testConsistency(cassandraClient, cassandraQueryFn, 'Cassandra Centralized');

    // Cassandra partitioned (2 config varianten)
    /*await testLatency(cassandraPartitionedConfigs[0].client, cassandraPartitionedQueryFns[0], `Cassandra ${cassandraPartitionedConfigs[0].name}`);
    await testLatency(cassandraPartitionedConfigs[1].client, cassandraPartitionedQueryFns[1], `Cassandra ${cassandraPartitionedConfigs[1].name}`);
    await testThroughput(cassandraPartitionedConfigs[0].client, cassandraPartitionedQueryFns[0], `Cassandra ${cassandraPartitionedConfigs[0].name}`);
    await testThroughput(cassandraPartitionedConfigs[1].client, cassandraPartitionedQueryFns[1], `Cassandra ${cassandraPartitionedConfigs[1].name}`);*/
    await testRealtimeLatency(cassandraPartitionedConfigs[0].client, cassandraPartitionedQueryFns[0], `Cassandra ${cassandraPartitionedConfigs[0].name} Realtime`);
    await testRealtimeLatency(cassandraPartitionedConfigs[1].client, cassandraPartitionedQueryFns[1], `Cassandra ${cassandraPartitionedConfigs[1].name} Realtime`);
    await testRealtimeThroughput(cassandraPartitionedConfigs[0].client, cassandraPartitionedQueryFns[0], `Cassandra ${cassandraPartitionedConfigs[0].name} Realtime`);
    await testRealtimeThroughput(cassandraPartitionedConfigs[1].client, cassandraPartitionedQueryFns[1], `Cassandra ${cassandraPartitionedConfigs[1].name} Realtime`);
    await testScalability(cassandraPartitionedConfigs[0].client, cassandraPartitionedQueryFns[0], `Cassandra ${cassandraPartitionedConfigs[0].name}`, SCALE_FACTORS);
    await testScalability(cassandraPartitionedConfigs[1].client, cassandraPartitionedQueryFns[1], `Cassandra ${cassandraPartitionedConfigs[1].name}`, SCALE_FACTORS);
    await testConsistency(cassandraPartitionedConfigs[0].client, cassandraPartitionedQueryFns[0], `Cassandra ${cassandraPartitionedConfigs[0].name}`);
    await testConsistency(cassandraPartitionedConfigs[1].client, cassandraPartitionedQueryFns[1], `Cassandra ${cassandraPartitionedConfigs[1].name}`);

    // TimescaleDB centraal
    /*await testLatency(timescaleClient, timescaleQueryFn, 'TimescaleDB Centralized');
    await testThroughput(timescaleClient, timescaleQueryFn, 'TimescaleDB Centralized');*/
    await testRealtimeLatency(timescaleClient, timescaleQueryFn, 'TimescaleDB Centralized Realtime');
    await testRealtimeThroughput(timescaleClient, timescaleQueryFn, 'TimescaleDB Centralized Realtime');
    await testScalability(timescaleClient, timescaleQueryFn, 'TimescaleDB Centralized', SCALE_FACTORS);
    await testConsistency(timescaleClient, timescaleQueryFn, 'TimescaleDB Centralized');

    // TimescaleDB partitioned (2 config varianten)
    /*await testLatency(timescalePartitionedConfigs[0].client, timescalePartitionedQueryFns[0], `TimescaleDB ${timescalePartitionedConfigs[0].name}`);
    await testLatency(timescalePartitionedConfigs[1].client, timescalePartitionedQueryFns[1], `TimescaleDB ${timescalePartitionedConfigs[1].name}`);
    await testThroughput(timescalePartitionedConfigs[0].client, timescalePartitionedQueryFns[0], `TimescaleDB ${timescalePartitionedConfigs[0].name}`);
    await testThroughput(timescalePartitionedConfigs[1].client, timescalePartitionedQueryFns[1], `TimescaleDB ${timescalePartitionedConfigs[1].name}`);*/
    await testRealtimeLatency(timescalePartitionedConfigs[0].client, timescalePartitionedQueryFns[0], `TimescaleDB ${timescalePartitionedConfigs[0].name} Realtime`);
    await testRealtimeLatency(timescalePartitionedConfigs[1].client, timescalePartitionedQueryFns[1], `TimescaleDB ${timescalePartitionedConfigs[1].name} Realtime`);
    await testRealtimeThroughput(timescalePartitionedConfigs[0].client, timescalePartitionedQueryFns[0], `TimescaleDB ${timescalePartitionedConfigs[0].name} Realtime`);
    await testRealtimeThroughput(timescalePartitionedConfigs[1].client, timescalePartitionedQueryFns[1], `TimescaleDB ${timescalePartitionedConfigs[1].name} Realtime`);
    await testScalability(timescalePartitionedConfigs[0].client, timescalePartitionedQueryFns[0], `TimescaleDB ${timescalePartitionedConfigs[0].name}`, SCALE_FACTORS);
    await testScalability(timescalePartitionedConfigs[1].client, timescalePartitionedQueryFns[1], `TimescaleDB ${timescalePartitionedConfigs[1].name}`, SCALE_FACTORS);
    await testConsistency(timescalePartitionedConfigs[0].client, timescalePartitionedQueryFns[0], `TimescaleDB ${timescalePartitionedConfigs[0].name}`);
    await testConsistency(timescalePartitionedConfigs[1].client, timescalePartitionedQueryFns[1], `TimescaleDB ${timescalePartitionedConfigs[1].name}`);

    // MongoDB centraal
    /*await testLatency(mongoCentralClient, mongoCentralQueryFn, 'MongoDB Centralized');
    await testThroughput(mongoCentralClient, mongoCentralQueryFn, 'MongoDB Centralized');*/
    await testRealtimeLatency(mongoCentralClient, mongoCentralQueryFn, 'MongoDB Centralized Realtime');
    await testRealtimeThroughput(mongoCentralClient, mongoCentralQueryFn, 'MongoDB Centralized Realtime');
    await testScalability(mongoCentralClient, mongoCentralQueryFn, 'MongoDB Centralized', SCALE_FACTORS);
    await testConsistency(mongoCentralClient, mongoCentralQueryFn, 'MongoDB Centralized');

    // MongoDB sharded (2 config varianten)
    /*await testLatency(mongoShardedClients[0], mongoShardedQueryFns[0], `MongoDB ${mongoShardedConfigs[0].dbName}`);
    await testLatency(mongoShardedClients[1], mongoShardedQueryFns[1], `MongoDB ${mongoShardedConfigs[1].dbName}`);
    await testThroughput(mongoShardedClients[0], mongoShardedQueryFns[0], `MongoDB ${mongoShardedConfigs[0].dbName}`);
    await testThroughput(mongoShardedClients[1], mongoShardedQueryFns[1], `MongoDB ${mongoShardedConfigs[1].dbName}`);*/
    await testRealtimeLatency(mongoShardedClients[0], mongoShardedQueryFns[0], `MongoDB ${mongoShardedConfigs[0].dbName} Realtime`);
    await testRealtimeLatency(mongoShardedClients[1], mongoShardedQueryFns[1], `MongoDB ${mongoShardedConfigs[1].dbName} Realtime`);
    await testRealtimeThroughput(mongoShardedClients[0], mongoShardedQueryFns[0], `MongoDB ${mongoShardedConfigs[0].dbName} Realtime`);
    await testRealtimeThroughput(mongoShardedClients[1], mongoShardedQueryFns[1], `MongoDB ${mongoShardedConfigs[1].dbName} Realtime`);
    await testScalability(mongoShardedClients[0], mongoShardedQueryFns[0], `MongoDB ${mongoShardedConfigs[0].dbName}`, SCALE_FACTORS);
    await testScalability(mongoShardedClients[1], mongoShardedQueryFns[1], `MongoDB ${mongoShardedConfigs[1].dbName}`, SCALE_FACTORS);
    await testConsistency(mongoShardedClients[0], mongoShardedQueryFns[0], `MongoDB ${mongoShardedConfigs[0].dbName}`);
    await testConsistency(mongoShardedClients[1], mongoShardedQueryFns[1], `MongoDB ${mongoShardedConfigs[1].dbName}`);

    await testFaultTolerance(cassandraClient, 'Cassandra Centralized', () => new cassandra.Client({
      contactPoints: ['localhost'],
      localDataCenter: 'datacenter1',
      protocolOptions: { port: 9052 },
    }));

    await testFaultTolerance(cassandraPartitionedConfigs[0].client, `Cassandra ${cassandraPartitionedConfigs[0].name}`, () => new cassandra.Client({
      contactPoints: ['localhost'],
      localDataCenter: 'datacenter1',
      protocolOptions: { port: 9042 },
    }));

    await testFaultTolerance(cassandraPartitionedConfigs[1].client, `Cassandra ${cassandraPartitionedConfigs[1].name}`, () => new cassandra.Client({
      contactPoints: ['localhost'],
      localDataCenter: 'datacenter1',
      protocolOptions: { port: 9043 },
    }));

    await testFaultTolerance(mongoShardedClients[0], `MongoDB ${mongoShardedConfigs[0].dbName}`, () => new MongoClient(mongoShardedConfigs[0].uri));
    await testFaultTolerance(mongoShardedClients[1], `MongoDB ${mongoShardedConfigs[1].dbName}`, () => new MongoClient(mongoShardedConfigs[1].uri));
    await testFaultTolerance(mongoCentralClient, 'MongoDB Centralized', () => new MongoClient(mongoUri));

    await testFaultTolerance(
      timescalePartitionedConfigs[0].client,
      `TimescaleDB ${timescalePartitionedConfigs[0].name}`,
      () => new Client({
        user: 'edge_user',
        host: 'localhost',
        database: 'edge_db',
        password: 'edge_pass',
        port: 5432,
      })
    );

    await testFaultTolerance(
      timescalePartitionedConfigs[1].client,
      `TimescaleDB ${timescalePartitionedConfigs[1].name}`,
      () => new Client({
        user: 'edge_user_alt',
        host: 'localhost',
        database: 'edge_db_alt',
        password: 'edge_pass_alt',
        port: 5433,
      })
    );

    await testFaultTolerance(
      timescaleClient,
      'TimescaleDB Centralized',
      () => new Client({
        user: 'central_user',
        host: 'localhost',
        database: 'central_db',
        password: 'central_pass',
        port: 5444,
      })
    );

    
    /*await testOfflineBehavior(
      {
        [`MongoDB ${mongoShardedConfigs[0].dbName}`]: mongoShardedClients[0],
        [`MongoDB ${mongoShardedConfigs[1].dbName}`]: mongoShardedClients[1],
        'TimescaleDB Range-Based Partitioning': timescalePartitionedConfigs[0].client,
        'Cassandra ListPartitioning': cassandraPartitionedConfigs[0].client,
      },
      'Edge Only Test'
    );*/

    saveResultsToFile();

      await cassandraClient.shutdown();
    for (const cfg of cassandraPartitionedConfigs) {
      await cfg.client.shutdown();
    }

    await timescaleClient.connect();
    await timescaleClient.query("SET synchronous_commit TO ON");
    await timescaleClient.end();

    for (const config of timescalePartitionedConfigs) {
      await config.client.connect();
      await config.client.query("SET synchronous_commit TO ON");
      await config.client.end();
    }

    await mongoCentralClient.close();
    for (const client of mongoShardedClients) {
      await client.close();
    }

    console.log("All tests finished and clients closed.");
    process.exit(0);
  } catch (err) {
    console.error("Error during tests:", err);
    process.exit(1);
  }
})();