CREATE TABLE IF NOT EXISTS sensor_data (
    sensor_id UUID,
    timestamp TIMESTAMPTZ NOT NULL,
    value FLOAT NOT NULL,
    PRIMARY KEY (sensor_id, timestamp)
);

SELECT create_hypertable('sensor_data', 'timestamp');
