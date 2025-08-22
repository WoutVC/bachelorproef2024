const { faker } = require('@faker-js/faker');
const { MongoClient } = require('mongodb');
const cassandra = require('cassandra-driver');
const { Client } = require('pg');

const BULK_SIZE = 1000;

const cassandraClientsEdge = {
  list: new cassandra.Client({
    contactPoints: ['localhost'],
    localDataCenter: 'datacenter1',
    keyspace: 'edge_list_partitioning',
    protocolOptions: { port: 9042 },
  }),
  range: new cassandra.Client({
    contactPoints: ['localhost'],
    localDataCenter: 'datacenter1',
    keyspace: 'edge_range_partitioning',
    protocolOptions: { port: 9043 },
  }),
};

const cassClientCentral = new cassandra.Client({
  contactPoints: ['localhost'],
  localDataCenter: 'datacenter1',
  keyspace: 'centraldb',
  protocolOptions: { port: 9052 },
});

const mongoClientsEdge = {
  range: new MongoClient('mongodb://localhost:27019'),
  list: new MongoClient('mongodb://localhost:27025'),
};

const mongoClientCentral = new MongoClient('mongodb://localhost:27030');

const pgClientsEdge = {
  range: new Client({
    user: 'edge_user',
    host: 'localhost',
    database: 'edge_db',
    password: 'edge_pass',
    port: 5432,
  }),
  list: new Client({
    user: 'edge_user_alt',
    host: 'localhost',
    database: 'edge_db_alt',
    password: 'edge_pass_alt',
    port: 5433,
  }),
};

const pgClientCentral = new Client({
  user: 'central_user',
  host: 'localhost',
  database: 'central_db',
  password: 'central_pass',
  port: 5444,
});

let mongoDbEdgeRange;
let mongoDbEdgeList;
let mongoDbCentral;

const now = new Date();
const START_TIME = new Date(
  now.getFullYear(),
  now.getMonth(),
  now.getDate(),
  20,
  40,
  0,
  0
);

function getRandomRoom(building) {
  const rooms = building === 'GebouwA'
    ? Array.from({ length: 10 }, (_, i) => `A10${i + 1}`)
    : Array.from({ length: 10 }, (_, i) => `B10${i + 1}`);
  const randomIndex = Math.floor(Math.random() * rooms.length);
  return rooms[randomIndex];
}

function generateRandomData(building, index = 0, prevData = null, fixedRoom = null) {
  const timestamp = new Date(START_TIME.getTime() + index * 5000);

  const room = fixedRoom ?? getRandomRoom(building);

  function varyValue(prev, min, max, maxDelta) {
    if (prev === null) {
      return faker.number.float({ min, max, multipleOf: 0.1 });
    }
    let next = prev + faker.number.float({ min: -maxDelta, max: maxDelta, multipleOf: 0.1 });
    if (next < min) next = min;
    if (next > max) next = max;
    return Number(next.toFixed(1));
  }

  let co2;
  const shouldTriggerWarning = Math.random() < 0.05;

  if (shouldTriggerWarning) {
    co2 = varyValue(prevData ? prevData.co2 : null, 801, 850, 20);
  } else {
    co2 = varyValue(prevData ? prevData.co2 : null, 350, 800, 20);
  }
  co2 = Math.round(co2);

  const temperature = varyValue(prevData ? prevData.temperature : null, 18, 28, 0.2);
  const pressure = varyValue(prevData ? prevData.pressure : null, 990, 1030, 0.3);

  return {
    _id: faker.string.uuid(),
    timestamp,
    temperature,
    co2,
    pressure,
    building,
    room,
  };
}

function generateFixedData(i) {
  const building = i % 2 === 0 ? 'GebouwA' : 'GebouwB';
  return {
    _id: `fixed-id-${i}`,
    timestamp: new Date(START_TIME.getTime() + i * 5000),
    temperature: 20 + (i % 10) * 0.5,
    co2: 400 + (i % 50) * 10,
    pressure: 1000 + (i % 15) * 0.5,
    building,
    room: getRandomRoom(building),
  };
}

const edgeRooms = {
  mongo_list: 'B101',
  mongo_range: 'B102',
  cassandra_list: 'B103',
  cassandra_range: 'B104',
  timescale_list: 'B105',
  timescale_range: 'B106',
};

async function clearAllData() {
  await Promise.all([
    cassandraClientsEdge.list.execute('TRUNCATE sensor_data'),
    cassandraClientsEdge.range.execute('TRUNCATE sensor_data'),
    cassClientCentral.execute('TRUNCATE sensor_data'),
    mongoDbEdgeList.collection('sensor_data').deleteMany({}),
    mongoDbEdgeRange.collection('sensor_data').deleteMany({}),
    mongoDbCentral.collection('sensor_data').deleteMany({}),
    pgClientsEdge.list.query('TRUNCATE sensor_data'),
    pgClientsEdge.range.query('TRUNCATE sensor_data'),
    pgClientCentral.query('TRUNCATE sensor_data'),
  ]);
  console.log('Alle data verwijderd uit alle databases.');
}

async function insertIntoCassandra(client, data) {
  const query = `INSERT INTO sensor_data (id, building, room, timestamp, temperature, co2, pressure) VALUES (?, ?, ?, ?, ?, ?, ?)`;
  await client.execute(query, [
    data._id,
    data.building,
    data.room,
    data.timestamp,
    data.temperature,
    data.co2,
    data.pressure,
  ], { prepare: true });
}

async function insertIntoMongo(db, data) {
  await db.collection('sensor_data').insertOne(data);
}

async function insertIntoPostgres(client, data) {
  const query = `
    INSERT INTO sensor_data (id, building, room, timestamp, temperature, co2, pressure)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `;
  await client.query(query, [
    data._id,
    data.building,
    data.room,
    data.timestamp,
    data.temperature,
    data.co2,
    data.pressure,
  ]);
}

async function insertRandomBulk() {
  console.log(`Start bulk insert RANDOM data van ${BULK_SIZE} records per database...`);
  for (let i = 0; i < BULK_SIZE; i++) {
    const dataEdgeList = generateRandomData('GebouwB', i, null, edgeRooms.mongo_list);
    const dataEdgeRange = generateRandomData('GebouwB', i, null, edgeRooms.mongo_range);
    const dataEdgeCassList = generateRandomData('GebouwB', i, null, edgeRooms.cassandra_list);
    const dataEdgeCassRange = generateRandomData('GebouwB', i, null, edgeRooms.cassandra_range);
    const dataEdgePgList = generateRandomData('GebouwB', i, null, edgeRooms.timescale_list);
    const dataEdgePgRange = generateRandomData('GebouwB', i, null, edgeRooms.timescale_range);

    const dataCentral = generateRandomData('GebouwA', i);
    await Promise.all([
      insertIntoCassandra(cassandraClientsEdge.list, dataEdgeCassList),
      insertIntoMongo(mongoDbEdgeList, dataEdgeList),
      insertIntoPostgres(pgClientsEdge.list, dataEdgePgList),

      insertIntoCassandra(cassandraClientsEdge.range, dataEdgeCassRange),
      insertIntoMongo(mongoDbEdgeRange, dataEdgeRange),
      insertIntoPostgres(pgClientsEdge.range, dataEdgePgRange),

      insertIntoCassandra(cassClientCentral, dataCentral),
      insertIntoMongo(mongoDbCentral, dataCentral),
      insertIntoPostgres(pgClientCentral, dataCentral),
    ]);
    if ((i + 1) % 100 === 0) {
      console.log(`${i + 1} records random data ingevoegd per database...`);
    }
  }
}

async function insertFixedBulk() {
  console.log(`Start bulk insert FIXED data van ${BULK_SIZE} records voor alle databases...`);
  for (let i = 0; i < BULK_SIZE; i++) {
    const data = generateFixedData(i);
    await Promise.all([
      insertIntoCassandra(cassandraClientsEdge.list, data),
      insertIntoMongo(mongoDbEdgeList, data),
      insertIntoPostgres(pgClientsEdge.list, data),

      insertIntoCassandra(cassandraClientsEdge.range, data),
      insertIntoMongo(mongoDbEdgeRange, data),
      insertIntoPostgres(pgClientsEdge.range, data),

      insertIntoCassandra(cassClientCentral, data),
      insertIntoMongo(mongoDbCentral, data),
      insertIntoPostgres(pgClientCentral, data),
    ]);
    if ((i + 1) % 100 === 0) {
      console.log(`${i + 1} records fixed data ingevoegd in alle databases...`);
    }
  }
}

async function run() {
  try {
    await Promise.all([
      cassandraClientsEdge.list.connect(),
      cassandraClientsEdge.range.connect(),
      cassClientCentral.connect(),
      mongoClientsEdge.list.connect(),
      mongoClientsEdge.range.connect(),
      mongoClientCentral.connect(),
      pgClientsEdge.list.connect(),
      pgClientsEdge.range.connect(),
      pgClientCentral.connect(),
    ]);
    mongoDbEdgeList = mongoClientsEdge.list.db('edge_list_partitioning');
    mongoDbEdgeRange = mongoClientsEdge.range.db('edge_range_partitioning');
    mongoDbCentral = mongoClientCentral.db('centraldb');
    console.log('Verbonden met alle databases.');
    await clearAllData();
    const mode = process.argv.includes('--fixed') ? 'fixed' : 'random';
    if (mode === 'fixed') {
      await insertFixedBulk();
    } else {
      await insertRandomBulk();
    }
  } catch (err) {
    console.error('Fout:', err);
  } finally {
    await Promise.all([
      cassandraClientsEdge.list.shutdown(),
      cassandraClientsEdge.range.shutdown(),
      cassClientCentral.shutdown(),
      mongoClientsEdge.list.close(),
      mongoClientsEdge.range.close(),
      mongoClientCentral.close(),
      pgClientsEdge.list.end(),
      pgClientsEdge.range.end(),
      pgClientCentral.end(),
    ]);
    console.log('Alle verbindingen gesloten.');
  }
}

run();