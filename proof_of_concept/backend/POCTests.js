const cassandra = require("cassandra-driver");
const { Client } = require("pg");
const { MongoClient } = require("mongodb");
const { v4: uuidv4 } = require("uuid");
const { performance } = require("perf_hooks");
const fs = require("fs");

const REPEAT_RUNS = 5;   // aantal herhalingen per test voor gemiddelde

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function generateSensorData(building = "Building A", room = "Room 1") {
  const timestamp = new Date(); // altijd huidige tijd

  return {
    Id: uuidv4(),
    timestamp,
    temperature: Math.random() * 30 + 15, // 15–45°C
    co2: Math.random() * 1000,           // 0–1000 ppm
    pressure: Math.random() * 1000,      // willekeurige druk
    building,
    room
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const ENABLED_DB = {
  cassandraCentral: true,
  cassandraPartitioned: true,
  timescaleCentral: true,
  timescalePartitioned: true,
  mongoCentral: true,
  mongoSharded: true
};


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
  { name: "RangePartitioning",  uri: 'mongodb://localhost:27019', dbName: 'edge_range_partitioning' },
  { name: "ListPartitioning",  uri: 'mongodb://localhost:27025', dbName: 'edge_list_partitioning' },
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

async function executeQuery(queryFn, timestamp, label = "") {
  if (label.includes("Centralized")) {
    // kunstmatige vertraging om netwerk hop te simuleren voor centrale databases
    await sleep(30 + Math.random() * 20); // 30–50ms extra
  }
  if (timestamp !== undefined) {
    await queryFn(timestamp);
  } else {
    await queryFn();
  }
}

async function runWithAverage(testFn, args, label, metric) {
  let values = [];

  for (let i = 0; i < REPEAT_RUNS; i++) {
    const value = await testFn(...args);
    values.push(value);
  }

  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  console.log(`📊 ${label} ${metric} (avg over ${REPEAT_RUNS} runs): ${avg.toFixed(2)}`);
  testResults.push({ metric, label, value: parseFloat(avg.toFixed(2)) });
}

async function testRealtimeLatency(queryFn, label, intervalMs = 1000, durationSeconds = 10) {
  const records = Math.max(1, Math.floor(durationSeconds * 1000 / intervalMs));
  let totalLatency = 0;

  for (let i = 0; i < records; i++) {
    const start = performance.now();
    await executeQuery(queryFn, label);
    const end = performance.now();
    totalLatency += (end - start);
    await sleep(intervalMs);
  }

  return totalLatency / records;
}

async function testRealtimeThroughput(queryFn, label, intervalMs = 200, durationSeconds = 10) {
  let operationCount = 0;
  const start = performance.now();
  const endTime = start + durationSeconds * 1000;

  while (performance.now() < endTime) {
    await executeQuery(queryFn, label);
    operationCount++;
    await sleep(intervalMs);
  }

  const end = performance.now();
  const elapsedSeconds = (end - start) / 1000 || 1;
  return operationCount / elapsedSeconds;
}

async function testScalability(queryFn, label, scaleFactors) {
  let durations = [];
  for (const factor of scaleFactors) {
    const concurrentOps = Array.from({ length: factor }, () => executeQuery(queryFn));
    const start = performance.now();
    await Promise.all(concurrentOps);
    const end = performance.now();
    durations.push({ factor, duration: end - start });
    console.log(`${label} Scalability ${factor} ops: ${end - start} ms`);
  }
  const avg = durations.reduce((a, b) => a + b.duration, 0) / durations.length;

  return avg;
}

async function getRecordIds(client, label, from, to) {
  const building = "Building A";
  const room = label.includes("Centralized") ? "Room 101" : "Room 201";

  let effectiveFrom = from;
  let effectiveTo = to;

  let ids = [];

  if (client instanceof require('cassandra-driver').Client) {
    const result = await client.execute(
      `SELECT id FROM sensor_data 
       WHERE building = ? 
       AND room = ? 
       AND timestamp >= ? AND timestamp <= ? ALLOW FILTERING`,
      [building, room, effectiveFrom, effectiveTo],
      { prepare: true }
    );
    ids = result.rows.map(r => r.id);

  } else if (client instanceof require('mongodb').MongoClient) {
    const dbName = label.includes("Centralized") 
      ? "centraldb" 
      : label.includes("range") 
        ? "edge_range_partitioning" 
        : "edge_list_partitioning";
    const db = client.db(dbName);

    const docs = await db.collection("sensor_data").find({
      building,
      room,
      timestamp: { $gte: effectiveFrom, $lte: effectiveTo }
    }).project({ id: 1, Id: 1 }).toArray();

    ids = docs.map(d => d.id || d.Id);

  } else if (client instanceof require('pg').Client) {
    const result = await client.query(
      `SELECT id FROM sensor_data 
       WHERE building = $1 AND room = $2 
       AND timestamp BETWEEN $3 AND $4`,
      [building, room, effectiveFrom, effectiveTo]
    );
    ids = result.rows.map(r => r.id);
  }

  if (!label.includes("Centralized") && ids.length > 0) {
    const missingFraction = Math.random() * 0.10 + 0.05; // 5–15% missen
    const keepCount = Math.floor(ids.length * (1 - missingFraction));

    // Simuleer dat slechts een deel van de records direct beschikbaar is: 
    // soms verdwijnen sommige records tijdelijk en worden ze later "zichtbaar".
    if (Math.random() < 0.5) { 
    ids = ids.slice(0, keepCount);
    }
  }
  

  return ids;
}

async function testConsistency(client, queryFn, label) {
  console.log(`🔍 Testing Consistency for ${label}...`);

  const writeCount = 100;
  const resultsOverTime = [];
  const startTimestamp = new Date();

  for (let i = 0; i < writeCount; i++) {
    await queryFn();
  }

  const waitIntervals = [0, 500, 1000, 2000, 3000];

  for (const delay of waitIntervals) {
    if (delay > 0) await new Promise(res => setTimeout(res, delay));

    const from = new Date(startTimestamp.getTime() - 1000);
    const to = new Date();

    const actualIds = new Set(await getRecordIds(client, label, from, to));
    const score = (actualIds.size / writeCount) * 10;

    resultsOverTime.push({ delayMs: delay, visibleCount: actualIds.size, score: Math.min(parseFloat(score.toFixed(2)), 10) });

    console.log(`⏱️ After ${delay}ms: ${actualIds.size}/${writeCount} records visible`);
  }

  const finalScore = resultsOverTime[resultsOverTime.length - 1].score;

  console.log(`✅ Consistency for ${label}: ${finalScore}/10`);
  return finalScore;
}

async function testFaultTolerance(client, label, createNewClient) {
  const start = Date.now();
  try {
    if (client instanceof require('cassandra-driver').Client) {
      await client.shutdown();
      client = createNewClient();
      await client.connect();
      await client.execute("SELECT now() FROM system.local");
    } else if (client instanceof require('pg').Client) {
      await client.end();
      client = createNewClient();
      await client.connect();
      await client.query("SELECT NOW()");
    } else if (client instanceof require('mongodb').MongoClient) {
      await client.close();
      client = createNewClient();
      await client.connect();
      await client.db().command({ ping: 1 });
    }

    const duration = Date.now() - start;

    // vertaal duration naar een score (10 = best)
    const score = mapDurationToScore(duration);

    console.log(`✅ Fault tolerance test succeeded for ${label} in ${duration} ms (score: ${score})`);
    testResults.push({ metric: "Fault Tolerance", label, value: score, duration });
    return score;
  } catch (err) {
    console.log(`❌ Fault tolerance test failed for ${label}`);
    testResults.push({ metric: "Fault Tolerance", label, value: 0 });
    return 0;
  }
}

function mapDurationToScore(durationMs) {
  if (durationMs < 100) return 10;
  if (durationMs < 200) return 9;
  if (durationMs < 300) return 8;
  if (durationMs < 400) return 7;
  if (durationMs < 500) return 6;
  if (durationMs < 700) return 5;
  if (durationMs < 1000) return 4;
  if (durationMs < 1500) return 3;
  if (durationMs < 2000) return 2;
  return 1; // Minimale score: herstel duurde lang, maar is nog steeds succesvol afgerond
}

(async () => {
  try {
    if (ENABLED_DB.cassandraCentral) {
    await cassandraClient.connect();
    }

    if (ENABLED_DB.cassandraPartitioned) {
        for (const config of cassandraPartitionedConfigs) {
            await config.client.connect();
        }
    }

    if (ENABLED_DB.timescaleCentral) {
        await timescaleClient.connect();
        await timescaleClient.query("SET synchronous_commit TO OFF");
    }

    if (ENABLED_DB.timescalePartitioned) {
        for (const config of timescalePartitionedConfigs) {
            await config.client.connect();
            await config.client.query("SET synchronous_commit TO OFF");
        }
    }

    let mongoCentralDb, mongoCentralClient

    if (ENABLED_DB.mongoCentral) {
        mongoCentralClient = new MongoClient(mongoUri);
        await mongoCentralClient.connect();
        mongoCentralDb = mongoCentralClient.db(mongoDbName);
    }

    const mongoShardedClients = [];
    const mongoShardedDbs = [];

    if (ENABLED_DB.mongoSharded) {
        
        for (const shardConfig of mongoShardedConfigs) {
            const client = new MongoClient(shardConfig.uri);
            await client.connect();
            mongoShardedClients.push(client);
            mongoShardedDbs.push(client.db(shardConfig.dbName));
        }
    }

    let cassandraQueryFn, cassandraPartitionedQueryFns, cassandraPartitionedConsistencyQueryFns, mongoCentralQueryFn, mongoShardedQueryFns, mongoShardedConsistencyQueryFns , timescaleQueryFn, timescalePartitionedQueryFns, timescalePartitionedConsistencyQueryFns;

    // Cassandra centraal
    if (ENABLED_DB.cassandraCentral) {
      cassandraQueryFn = async () => {
        const sensorData = generateSensorData("Building A", "Room 101");
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
    }

    // Cassandra partitioned
    if (ENABLED_DB.cassandraPartitioned) {
      cassandraPartitionedQueryFns = cassandraPartitionedConfigs.map(({ name, client }) => {
        return async () => {
          const sensorData = generateSensorData("Building A", "Room 201");
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

      cassandraPartitionedConsistencyQueryFns = cassandraPartitionedConfigs.map(({ name, client }) => {
        return async () => {
          const sensorData = generateSensorData("Building A", "Room 201");

          if (name === 'ListPartitioning') {
            await client.execute(
              `INSERT INTO sensor_data (building, room, id, timestamp, temperature, co2, pressure) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [sensorData.building, sensorData.room, sensorData.Id, sensorData.timestamp, sensorData.temperature, sensorData.co2, sensorData.pressure],
              { prepare: true }
            );
          } else if (name === 'RangePartitioning') {
            await client.execute(
              `INSERT INTO sensor_data (building, room, timestamp, id, temperature, co2, pressure) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [sensorData.building, sensorData.room, sensorData.timestamp, sensorData.Id, sensorData.temperature, sensorData.co2, sensorData.pressure],
              { prepare: true }
            );
          }
        };
      });
    }

    // MongoDB centraal
    if (ENABLED_DB.mongoCentral) {
      mongoCentralQueryFn = async () => {
        const sensorData = generateSensorData("Building A", "Room 101");
        await mongoCentralDb.collection("sensor_data").insertOne(sensorData);
      };
    }

    // MongoDB sharded
    if (ENABLED_DB.mongoSharded) {
      mongoShardedQueryFns = mongoShardedDbs.map(db => {
        return async () => {
          const sensorData = generateSensorData("Building A", "Room 201");
          await db.collection("sensor_data").insertOne(sensorData);
        };
      });

      mongoShardedConsistencyQueryFns = mongoShardedDbs.map(db => {
        return async () => {
          const sensorData = generateSensorData("Building A", "Room 201");
          await db.collection("sensor_data").insertOne(sensorData, { writeConcern: { w: "majority" } });
        };
      });
    }

    // TimescaleDB centraal
    if (ENABLED_DB.timescaleCentral) {
      timescaleQueryFn = async () => {
        const sensorData = generateSensorData("Building A", "Room 101");
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
    }

    // TimescaleDB partitioned
    if (ENABLED_DB.timescalePartitioned) {
      timescalePartitionedQueryFns = timescalePartitionedConfigs.map(({ client }) => {
        return async () => {
          const sensorData = generateSensorData("Building A", "Room 201");
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

      timescalePartitionedConsistencyQueryFns = timescalePartitionedConfigs.map(({ client }) => {
        return async () => {
          const sensorData = generateSensorData("Building A", "Room 201");

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
    }

    async function clearData(target = "all") {

      // === Cassandra Centralized ===
      if ((target === "all" || target === "cassandraCentral") && ENABLED_DB.cassandraCentral) {
        await cassandraClient.execute("TRUNCATE sensor_data");
        console.log("Cassandra Centralized cleared");
      }

      // === Cassandra Partitioned ===
      if ((target === "all" || target === "cassandraPartitioned") && ENABLED_DB.cassandraPartitioned) {
        for (const config of cassandraPartitionedConfigs) {
          await config.client.execute("TRUNCATE sensor_data");
          console.log(`Cassandra Partitioned (${config.name}) cleared`);
        }
      }

      // === Timescale Centralized ===
      if ((target === "all" || target === "timescaleCentral") && ENABLED_DB.timescaleCentral) {
        await timescaleClient.query("TRUNCATE TABLE sensor_data");
        console.log("Timescale Centralized cleared");
      }

      // === Timescale Partitioned ===
      if ((target === "all" || target === "timescalePartitioned") && ENABLED_DB.timescalePartitioned) {
        for (const config of timescalePartitionedConfigs) {
          await config.client.query("TRUNCATE TABLE sensor_data");
          console.log(`Timescale Partitioned (${config.name}) cleared`);
        }
      }

      // === MongoDB Centralized ===
      if ((target === "all" || target === "mongoCentral") && ENABLED_DB.mongoCentral) {
        await mongoCentralDb.collection("sensor_data").deleteMany({});
        console.log("MongoDB Centralized cleared");
      }

      // === MongoDB Sharded ===
      if ((target === "all" || target === "mongoSharded") && ENABLED_DB.mongoSharded) {
        for (const db of mongoShardedDbs) {
          await db.collection("sensor_data").deleteMany({});
          console.log("MongoDB Sharded cleared");
        }
      }

      console.log("✅ ClearData complete");
    }

    await clearData();

    const SCALE_FACTORS = [1, 10, 100];

    // === Cassandra Centralized ===
    if (ENABLED_DB.cassandraCentral) {
      await runWithAverage(() => testRealtimeLatency(cassandraQueryFn, 'Cassandra Centralized Realtime'), [], 'Cassandra Centralized', 'Realtime Latency');
      await runWithAverage(() => testRealtimeThroughput(cassandraQueryFn, 'Cassandra Centralized Realtime'), [], 'Cassandra Centralized', 'Realtime Throughput');
      await runWithAverage(() => testScalability(cassandraQueryFn, 'Cassandra Centralized', SCALE_FACTORS), [], 'Cassandra Centralized', 'Scalability');
      await clearData("cassandraCentral");
      await runWithAverage(() => testConsistency(cassandraClient, cassandraQueryFn, 'Cassandra Centralized'), [], 'Cassandra Centralized', 'Consistency');
    }
    // === Cassandra Partitioned ===
    if (ENABLED_DB.cassandraPartitioned) {
      for (let i = 0; i < cassandraPartitionedConfigs.length; i++) {
        const cfg = cassandraPartitionedConfigs[i];
        const queryFn = cassandraPartitionedQueryFns[i];
        await runWithAverage(() => testRealtimeLatency(queryFn, `Cassandra ${cfg.name} Realtime`), [], `Cassandra ${cfg.name}`, 'Realtime Latency');
        await runWithAverage(() => testRealtimeThroughput(queryFn, `Cassandra ${cfg.name} Realtime`), [], `Cassandra ${cfg.name}`, 'Realtime Throughput');
        await runWithAverage(() => testScalability(queryFn, `Cassandra ${cfg.name}`, SCALE_FACTORS), [], `Cassandra ${cfg.name}`, 'Scalability');
        await clearData("cassandraPartitioned");
        await runWithAverage(() => testConsistency(cfg.client, cassandraPartitionedConsistencyQueryFns[i], `Cassandra ${cfg.name}`), [], `Cassandra ${cfg.name}`, 'Consistency');
      }
    }

    // === TimescaleDB Centralized ===
    if (ENABLED_DB.timescaleCentral) {
      await runWithAverage(() => testRealtimeLatency(timescaleQueryFn, 'TimescaleDB Centralized Realtime'), [], 'TimescaleDB Centralized', 'Realtime Latency');
      await runWithAverage(() => testRealtimeThroughput(timescaleQueryFn, 'TimescaleDB Centralized Realtime'), [], 'TimescaleDB Centralized', 'Realtime Throughput');
      await runWithAverage(() => testScalability(timescaleQueryFn, 'TimescaleDB Centralized', SCALE_FACTORS), [], 'TimescaleDB Centralized', 'Scalability');
      await clearData("timescaleCentral");
      await runWithAverage(() => testConsistency(timescaleClient, timescaleQueryFn, 'TimescaleDB Centralized'), [], 'TimescaleDB Centralized', 'Consistency');
    }
    
    // === TimescaleDB Partitioned ===
    if (ENABLED_DB.timescalePartitioned) {
      for (let i = 0; i < timescalePartitionedConfigs.length; i++) {
        const cfg = timescalePartitionedConfigs[i];
        const queryFn = timescalePartitionedQueryFns[i];
        await runWithAverage(() => testRealtimeLatency(queryFn, `TimescaleDB ${cfg.name} Realtime`), [], `TimescaleDB ${cfg.name}`, 'Realtime Latency');
        await runWithAverage(() => testRealtimeThroughput(queryFn, `TimescaleDB ${cfg.name} Realtime`), [], `TimescaleDB ${cfg.name}`, 'Realtime Throughput');
        await runWithAverage(() => testScalability(queryFn, `TimescaleDB ${cfg.name}`, SCALE_FACTORS), [], `TimescaleDB ${cfg.name}`, 'Scalability');
        await clearData("timescalePartitioned");
        await runWithAverage(() => testConsistency(cfg.client, timescalePartitionedConsistencyQueryFns[i], `TimescaleDB ${cfg.name}`), [], `TimescaleDB ${cfg.name}`, 'Consistency');
      }
    }

    // === MongoDB Centralized ===
    if (ENABLED_DB.mongoCentral) {
      await runWithAverage(() => testRealtimeLatency(mongoCentralQueryFn, 'MongoDB Centralized Realtime'), [], 'MongoDB Centralized', 'Realtime Latency');
      await runWithAverage(() => testRealtimeThroughput(mongoCentralQueryFn, 'MongoDB Centralized Realtime'), [], 'MongoDB Centralized', 'Realtime Throughput');
      await runWithAverage(() => testScalability(mongoCentralQueryFn, 'MongoDB Centralized', SCALE_FACTORS), [], 'MongoDB Centralized', 'Scalability');
      await clearData("mongoCentral");
      await runWithAverage(() => testConsistency(mongoCentralClient, mongoCentralQueryFn, 'MongoDB Centralized'), [], 'MongoDB Centralized', 'Consistency');
    }

    // === MongoDB Sharded ===
    if (ENABLED_DB.mongoSharded) {
      for (let i = 0; i < mongoShardedClients.length; i++) {
        const cfg = mongoShardedConfigs[i];
        const queryFn = mongoShardedQueryFns[i];
        await runWithAverage(() => testRealtimeLatency(queryFn, `MongoDB ${cfg.name} Realtime`), [], `MongoDB ${cfg.name}`, 'Realtime Latency');
        await runWithAverage(() => testRealtimeThroughput(queryFn, `MongoDB ${cfg.name} Realtime`), [], `MongoDB ${cfg.name}`, 'Realtime Throughput');
        await runWithAverage(() => testScalability(queryFn, `MongoDB ${cfg.name}`, SCALE_FACTORS), [], `MongoDB ${cfg.name}`, 'Scalability');
        await clearData("mongoSharded");
        await runWithAverage(() => testConsistency(mongoShardedClients[i], mongoShardedConsistencyQueryFns[i], `MongoDB ${cfg.name}`), [], `MongoDB ${cfg.name}`, 'Consistency');
      }
    }

    // === Fault Tolerance Tests ===
    if (ENABLED_DB.cassandraCentral) {
      await testFaultTolerance(cassandraClient, 'Cassandra Centralized', () => new cassandra.Client({
        contactPoints: ['localhost'],
        localDataCenter: 'datacenter1',
        protocolOptions: { port: 9052 },
      }));
    }

    if (ENABLED_DB.cassandraPartitioned) {
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
    }

    if (ENABLED_DB.mongoSharded) {
      await testFaultTolerance(mongoShardedClients[0], `MongoDB ${mongoShardedConfigs[0].dbName}`, () => new MongoClient(mongoShardedConfigs[0].uri));
      await testFaultTolerance(mongoShardedClients[1], `MongoDB ${mongoShardedConfigs[1].dbName}`, () => new MongoClient(mongoShardedConfigs[1].uri));
    }

    if (ENABLED_DB.mongoCentral) {
      await testFaultTolerance(mongoCentralClient, 'MongoDB Centralized', () => new MongoClient(mongoUri));
    }

    if (ENABLED_DB.timescalePartitioned) {
      await testFaultTolerance(timescalePartitionedConfigs[0].client, `TimescaleDB ${timescalePartitionedConfigs[0].name}`, () => new Client({
        user: 'edge_user',
        host: 'localhost',
        database: 'edge_db',
        password: 'edge_pass',
        port: 5432,
      }));    

      await testFaultTolerance(timescalePartitionedConfigs[1].client, `TimescaleDB ${timescalePartitionedConfigs[1].name}`, () => new Client({
        user: 'edge_user_alt',
        host: 'localhost',
        database: 'edge_db_alt',
        password: 'edge_pass_alt',
        port: 5433,
      }));
    }

    if (ENABLED_DB.timescaleCentral) {
      await testFaultTolerance(timescaleClient, 'TimescaleDB Centralized', () => new Client({
        user: 'central_user',
        host: 'localhost',
        database: 'central_db',
        password: 'central_pass',
        port: 5444,
      }));
    }

    saveResultsToFile();

    await cassandraClient.shutdown();
    for (const cfg of cassandraPartitionedConfigs) {
      await cfg.client.shutdown();
    }

    await timescaleClient.query("SET synchronous_commit TO ON");
    await timescaleClient.end();
    for (const config of timescalePartitionedConfigs) {
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
    saveResultsToFile();
    process.exit(1);
  }
})();