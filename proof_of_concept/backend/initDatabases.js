const { Client } = require('pg');
const cassandra = require('cassandra-driver');
const { MongoClient } = require('mongodb');

const cassandraClient = new cassandra.Client({
  contactPoints: ['localhost'],
  localDataCenter: 'datacenter1',
  protocolOptions: { port: 9052 },
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
    }),
    keyspace: 'edge_list_partitioning',
  },
  {
    name: 'RangePartitioning',
    client: new cassandra.Client({
      contactPoints: ['localhost'],
      localDataCenter: 'datacenter1',
      protocolOptions: { port: 9043 },
    }),
    keyspace: 'edge_range_partitioning',
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

async function initCassandra() {
  await cassandraClient.connect();
  await cassandraClient.execute(`
    CREATE KEYSPACE IF NOT EXISTS centraldb
    WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};
  `);
  
  await cassandraClient.execute(`
    CREATE TABLE IF NOT EXISTS centraldb.sensor_data (
      id UUID PRIMARY KEY,
      building text,
      room text,
      timestamp timestamp,
      temperature double,
      co2 double,
      pressure double
    );
  `);
  console.log(`✅ Centrale Cassandra keyspace/tabel geïnitieerd`);
}

async function initMongo() {
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db(mongoDbName);
  await db.createCollection('sensor_data').catch(() => {});
  await db.createCollection('logs').catch(() => {});
  console.log(`✅ Centrale MongoDB database geïnitieerd`);
}

async function initTimescale() {
  await timescaleClient.connect();
  await timescaleClient.query(`
    CREATE TABLE IF NOT EXISTS sensor_data (
      id UUID NOT NULL,
      building TEXT NOT NULL,
      room TEXT NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL,
      temperature DOUBLE PRECISION NOT NULL,
      co2 DOUBLE PRECISION NOT NULL,
      pressure DOUBLE PRECISION NOT NULL,
      PRIMARY KEY (timestamp, id)
    );
  `);
  await timescaleClient.query(`
    SELECT create_hypertable('sensor_data', 'timestamp', if_not_exists => TRUE);
  `);
  console.log(`✅ Centrale TimescaleDB hypertable geïnitieerd`);
}

async function initCassandraPartitioned() {
  for (const { name, client, keyspace } of cassandraPartitionedConfigs) {
    await client.connect();
    await client.execute(`
      CREATE KEYSPACE IF NOT EXISTS ${keyspace}
      WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};
    `);
    await client.execute(`USE ${keyspace}`);

    if (name === 'ListPartitioning') {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS sensor_data (
          building text,
          room text,
          id UUID,
          timestamp timestamp,
          temperature double,
          co2 double,
          pressure double,
          PRIMARY KEY ((building), timestamp)
        ) WITH CLUSTERING ORDER BY (timestamp ASC);
      `);
    } else if (name === 'RangePartitioning') {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS sensor_data (
          building text,
          room text,
          timestamp timestamp,
          id UUID,
          temperature double,
          co2 double,
          pressure double,
          PRIMARY KEY ((building, room), timestamp, id)
        ) WITH CLUSTERING ORDER BY (timestamp ASC);
      `);
    } else {
      console.warn(`⚠️ Onbekende partitioneringstechniek: ${name}`);
    }

    console.log(`✅ Cassandra (${name}) keyspace '${keyspace}' geïnitieerd`);
  }
}

async function waitForMongo(uri) {
  let connected = false;
  while (!connected) {
    try {
      const client = new MongoClient(uri);
      await client.connect();
      await client.db("admin").command({ ping: 1 });
      connected = true;
      console.log(`✅ Mongo router beschikbaar op ${uri}`);
    } catch (err) {
      console.log(`⏳ Wachten op ${uri}...`);
      await new Promise(res => setTimeout(res, 5000));
    }
  }
}

async function initMongoSharded() {
  for (const { uri, dbName } of mongoShardedConfigs) {
    await waitForMongo(uri);

    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db(dbName);

    await db.createCollection('sensor_data').catch(() => {});
    await db.createCollection('logs').catch(() => {});

    const adminDb = client.db('admin');

    if (dbName.includes('range')) {
      await adminDb.command({
        shardCollection: `${dbName}.sensor_data`,
        key: { timestamp: 1 },
      }).catch(() => {});
    } else if (dbName.includes('list')) {
      await adminDb.command({
        shardCollection: `${dbName}.sensor_data`,
        key: { building: 1, room: 1 },
      }).catch(() => {});
    }

    console.log(`✅ MongoDB (sharded cluster) database '${dbName}' met juiste shard key geïnitieerd`);
  }
}

async function initTimescalePartitioned() {
  for (const { name, client } of timescalePartitionedConfigs) {
    await client.connect();

    await client.query(`DROP TABLE IF EXISTS sensor_data;`);

    if (name === 'RangePartitioning') {
      await client.query(`
        CREATE TABLE sensor_data (
          id UUID NOT NULL,
          building TEXT NOT NULL,
          room TEXT NOT NULL,
          timestamp TIMESTAMPTZ NOT NULL,
          temperature DOUBLE PRECISION NOT NULL,
          co2 DOUBLE PRECISION NOT NULL,
          pressure DOUBLE PRECISION NOT NULL,
          PRIMARY KEY (timestamp, id)
        );
      `);
      await client.query(`
        SELECT create_hypertable('sensor_data', 'timestamp', if_not_exists => TRUE);
      `);
    } else if (name === 'ListPartitioning') {
      await client.query(`
        CREATE TABLE sensor_data (
          id UUID NOT NULL,
          building TEXT NOT NULL,
          room TEXT NOT NULL,
          timestamp TIMESTAMPTZ NOT NULL,
          temperature DOUBLE PRECISION NOT NULL,
          co2 DOUBLE PRECISION NOT NULL,
          pressure DOUBLE PRECISION NOT NULL,
          PRIMARY KEY (timestamp, building, room, id)
        );
      `);
      await client.query(`
        SELECT create_hypertable('sensor_data', 'timestamp', 'building', 10, if_not_exists => TRUE);
      `);
    } else {
      console.warn(`⚠️ Onbekende partitioneringstechniek TimescaleDB: ${name}`);
    }
    console.log(`✅ TimescaleDB (${name}) hypertable 'sensor_data' geïnitieerd`);
  }
}

async function main() {
  try {
    await initCassandra();
    await initMongo();
    await initTimescale();

    await initCassandraPartitioned();
    await initMongoSharded();
    await initTimescalePartitioned();

    console.log(`\n🎉 Alle databases inclusief edge partitioneringssetups succesvol geïnitialiseerd!`);
  } catch (err) {
    console.error(`❌ Fout bij initialisatie:`, err);
    process.exit(1);
  }
}

main();