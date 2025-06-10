using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace EdgeMonitoringSystem.Models
{
    public class SensorData
    {
        [BsonId]
        [BsonRepresentation(BsonType.String)]
        public Guid Id { get; set; }

        [BsonElement("timestamp")]
        public DateTime Timestamp { get; set; }

        [BsonElement("temperature")]
        public double Temperature { get; set; }

        [BsonElement("co2")]
        public double Co2 { get; set; }

        [BsonElement("pressure")]
        public double Pressure { get; set; }

        [BsonElement("building")]
        public required string Building { get; set; }

        [BsonElement("room")]
        public required string Room { get; set; }
    }
}