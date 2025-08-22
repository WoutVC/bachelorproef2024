using Cassandra;
using EdgeMonitoringSystem.Models;
using EdgeMonitoringSystem.Services.Interfaces;

namespace EdgeMonitoringSystem.Services
{
    public class CentralCassandraDbService : ICentralCassandraDbService
    {
        private readonly Cassandra.ISession _session;

        public CentralCassandraDbService(IConfiguration configuration)
        {
            var host = configuration["ConnectionStrings:CentralDb_Cassandra_Host"];
            var keyspace = configuration["ConnectionStrings:CentralDb_Cassandra_Keyspace"];
            var port = 9052;

            var cluster = Cluster.Builder()
                .AddContactPoint(host)
                .WithPort(port)
                .Build();

            _session = cluster.Connect(keyspace);
        }

        public async Task SaveAsync(SensorData data)
        {
            var query = "INSERT INTO sensor_data (id, timestamp, temperature, co2, pressure, building, room) VALUES (?, ?, ?, ?, ?, ?, ?)";
            var statement = await _session.PrepareAsync(query);
            var bound = statement.Bind(
                data.Id, 
                data.Timestamp, 
                data.Temperature, 
                data.Co2, 
                data.Pressure, 
                data.Building,
                data.Room
            );
            await _session.ExecuteAsync(bound);
        }
        
        public async Task<SensorData?> GetLatestAsync()
        {
            var result = await _session.ExecuteAsync(new SimpleStatement("SELECT * FROM sensor_data LIMIT 1"));
            var row = result.FirstOrDefault();
            if (row == null) return null;

            return new SensorData
            {
                Id = row.GetValue<Guid>("id"),
                Timestamp = row.GetValue<DateTime>("timestamp"),
                Temperature = row.GetValue<double>("temperature"),
                Co2 = row.GetValue<double>("co2"),
                Pressure = row.GetValue<double>("pressure"),
                Building = row.GetValue<string>("building"),
                Room = row.GetValue<string>("room"),
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
                Room = row.GetValue<string>("room"),
            }).ToList();
        }
    }
}