#!/bin/bash

# Wacht op mongod componenten
echo "Wachten tot MongoDB nodes beschikbaar zijn..."
sleep 30  # Geef containers voldoende tijd om op te starten

echo "Initialiseren van replica-sets..."

# === Config replicaset voor list-based cluster ===
mongo --host configsvr:27017 <<EOF
rs.initiate({
  _id: "configReplSet",
  configsvr: true,
  members: [{ _id: 0, host: "configsvr:27017" }]
})
EOF

# === Shard 1 replicaset (list) ===
mongo --host shard1:27018 <<EOF
rs.initiate({
  _id: "shard1ReplSet",
  members: [{ _id: 0, host: "shard1:27018" }]
})
EOF

# === Shard 2 replicaset (list) ===
mongo --host shard2:27020 <<EOF
rs.initiate({
  _id: "shard2ReplSet",
  members: [{ _id: 0, host: "shard2:27020" }]
})
EOF

# === Config replicaset voor range-based cluster ===
mongo --host configsvr2:27017 <<EOF
rs.initiate({
  _id: "configReplSet2",
  configsvr: true,
  members: [{ _id: 0, host: "configsvr2:27017" }]
})
EOF

# === Shard 3 replicaset (range) ===
mongo --host shard3:27018 <<EOF
rs.initiate({
  _id: "shard3ReplSet",
  members: [{ _id: 0, host: "shard3:27018" }]
})
EOF

# === Shard 4 replicaset (range) ===
mongo --host shard4:27020 <<EOF
rs.initiate({
  _id: "shard4ReplSet",
  members: [{ _id: 0, host: "shard4:27020" }]
})
EOF

# === Voeg shards toe aan mongos (list-based) ===
mongo --host mongos:27019 <<EOF
sh.addShard("shard1ReplSet/shard1:27018")
sh.addShard("shard2ReplSet/shard2:27020")

# Schakel sharding in en stel shard key in op building + room
sh.enableSharding("edge_list_partitioning")
sh.shardCollection("edge_list_partitioning.sensor_data", { building: 1, room: 1 })

# Voeg samengestelde index toe
db = db.getSiblingDB("edge_list_partitioning")
db.sensor_data.createIndex({ building: 1, room: 1, timestamp: 1 })
EOF

# === Voeg shards toe aan mongos2 (range-based) ===
mongo --host mongos2:27025 <<EOF
sh.addShard("shard3ReplSet/shard3:27018")
sh.addShard("shard4ReplSet/shard4:27020")

# Schakel sharding in en stel shard key in op timestamp
sh.enableSharding("edge_range_partitioning")
sh.shardCollection("edge_range_partitioning.sensor_data", { timestamp: 1 })

# Voeg samengestelde index toe
db = db.getSiblingDB("edge_range_partitioning")
db.sensor_data.createIndex({ building: 1, room: 1, timestamp: 1 })
EOF

echo "Replica-sets en sharding zijn geconfigureerd."
