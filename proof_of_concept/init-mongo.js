db = db.getSiblingDB('edge_db'); // Switch to database 'edge_db'

db.createCollection('sensor_data'); // Create the collection

db.sensor_data.createIndex({ sensor_id: 1, timestamp: -1 }); // Create an index
