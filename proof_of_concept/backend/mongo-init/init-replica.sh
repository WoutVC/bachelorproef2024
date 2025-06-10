#!/bin/bash

# Wacht op mongod componenten
echo "Wachten tot MongoDB nodes beschikbaar zijn..."

sleep 15  # Wacht even zodat containers tijd hebben om op te starten

echo "Initialiseren van replicasets..."

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

# === Voeg shards toe aan mongos (list) ===
mongo --host mongos:27019 <<EOF
sh.addShard("shard1ReplSet/shard1:27018")
sh.addShard("shard2ReplSet/shard2:27020")
EOF

# === Voeg shards toe aan mongos2 (range) ===
mongo --host mongos2:27025 <<EOF
sh.addShard("shard3ReplSet/shard3:27018")
sh.addShard("shard4ReplSet/shard4:27020")
EOF

echo "Replica-sets en sharding zijn geconfigureerd."