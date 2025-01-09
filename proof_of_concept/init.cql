CREATE KEYSPACE IF NOT EXISTS edge_keyspace
WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

USE edge_keyspace;

CREATE TABLE IF NOT EXISTS sensor_data (
    sensor_id UUID,
    timestamp TIMESTAMP,
    value FLOAT,
    PRIMARY KEY (sensor_id, timestamp)
) WITH CLUSTERING ORDER BY (timestamp DESC);
