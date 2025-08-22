
const { MongoClient } = require("mongodb");
const { v4: uuidv4 } = require("uuid");

const mongoUrl = "mongodb://localhost:27030";
const dbName = "central_db";
const collectionName = "sensor_data";

const simulateSensorData = () => {
    return {
        sensor_id: uuidv4(),
        timestamp: new Date(),
        temperature: Math.floor(Math.random() * (30 - 18 + 1)) + 18,
        pressure: Math.floor(Math.random() * (1050 - 950 + 1)) + 950,
        co2: Math.floor(Math.random() * (1200 - 400 + 1)) + 400,
        status: "actief"
    };
};

(async () => {
    const client = new MongoClient(mongoUrl);
    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        console.log("⏳ Start real-time sensor simulatie (MongoDB)...");

        setInterval(async () => {
            const data = simulateSensorData();
            await collection.insertOne(data);
            console.log(`📡 Data toegevoegd: CO2=${data.co2}ppm, Temp=${data.temperature}°C`);

            if (data.co2 > 800) {
                console.warn(`🚨 WAARSCHUWING: CO₂-drempel overschreden! (${data.co2} ppm)`);
                await db.collection("logs").insertOne({
                    timestamp: new Date(),
                    message: `CO2 overschreden: ${data.co2} ppm`,
                    sensor_id: data.sensor_id
                });
            }
        }, 5000);
    } catch (err) {
        console.error("❌ Fout bij verbinding of insert:", err);
    }
})();
