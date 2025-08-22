using Cassandra;
using EdgeMonitoringSystem.Models;
using EdgeMonitoringSystem.Services.Interfaces;

namespace EdgeMonitoringSystem.Services
{
    public class EdgeDbService_Cassandra : IEdgeDbService_Cassandra
    {
        private readonly Cassandra.ISession _session;

        public EdgeDbService_Cassandra(IConfiguration config)
        {
            var host = config["ConnectionStrings:EdgeDb_Cassandra_Host"];
            var port = 9042;
            var keyspace = config["ConnectionStrings:EdgeDb_Cassandra_Keyspace"];

            var cluster = Cluster.Builder()
                .AddContactPoint(host)
                .WithPort(port)
                .Build();

            _session = cluster.Connect(keyspace);
        }

        public async Task SaveAsync(SensorData data)
        {
            var building = "GebouwB";
            var room = data.Room;
            if (string.IsNullOrEmpty(room))
            {
                var roomNumber = new Random().Next(101, 111);
                room = $"B{roomNumber}";
            }

            var query = "INSERT INTO sensor_data (id, timestamp, temperature, co2, pressure, building, room) VALUES (?, ?, ?, ?, ?, ?, ?)";
            await _session.ExecuteAsync(new SimpleStatement(query,
                Guid.NewGuid(),
                data.Timestamp,
                data.Temperature,
                data.Co2,
                data.Pressure,
                building,
                room
            ));
        }

        public async Task<SensorData?> GetLatestAsync()
        {
            var result = await _session.ExecuteAsync(new SimpleStatement("SELECT * FROM sensor_data LIMIT 1"));
            var row = result.FirstOrDefault();
            return row == null ? null : new SensorData
            {
                Id = row.GetValue<Guid>("id"),
                Timestamp = row.GetValue<DateTime>("timestamp"),
                Temperature = row.GetValue<double>("temperature"),
                Co2 = row.GetValue<double>("co2"),
                Pressure = row.GetValue<double>("pressure"),
                Building = row.GetValue<string>("building"),
                Room = row.GetValue<string>("room")
            };
        }

        public async Task<List<SensorData>> GetRecentAsync(int count)
        {
            var result = await _session.ExecuteAsync(new SimpleStatement($"SELECT * FROM sensor_data LIMIT {count}"));
            return result.Select(row => new SensorData
            {
                Id = row.GetValue<Guid>("id"),
                Timestamp = row.GetValue<DateTime>("timestamp"),
                Temperature = row.GetValue<double>("temperature"),
                Co2 = row.GetValue<double>("co2"),
                Pressure = row.GetValue<double>("pressure"),
                Building = row.GetValue<string>("building"),
                Room = row.GetValue<string>("room")
            }).ToList();
        }
    }
}