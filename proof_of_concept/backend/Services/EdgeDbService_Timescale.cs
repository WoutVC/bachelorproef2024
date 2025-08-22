using Npgsql;
using EdgeMonitoringSystem.Models;
using EdgeMonitoringSystem.Services.Interfaces;

namespace EdgeMonitoringSystem.Services
{
    public class EdgeDbService_Timescale : IEdgeDbService_Timescale
    {
        private readonly string _connectionString;

        public EdgeDbService_Timescale(IConfiguration configuration)
        {
            _connectionString = configuration.GetConnectionString("EdgeDb_Timescale");
        }
        
        public async Task SaveAsync(SensorData data)
        {
            data.Building = "GebouwB";
            var room = data.Room;
            if (string.IsNullOrEmpty(room))
            {
                var roomNumber = new Random().Next(101, 111);
                room = $"A{roomNumber}";
            }

            await using var conn = new NpgsqlConnection(_connectionString);
            await conn.OpenAsync();

            var cmd = new NpgsqlCommand(@"
                INSERT INTO sensor_data (id, timestamp, temperature, co2, pressure, building, room)
                VALUES (@id, @timestamp, @temperature, @co2, @pressure, @building, @room)", conn);

            cmd.Parameters.AddWithValue("id", Guid.NewGuid());
            cmd.Parameters.AddWithValue("timestamp", data.Timestamp);
            cmd.Parameters.AddWithValue("temperature", data.Temperature);
            cmd.Parameters.AddWithValue("co2", data.Co2);
            cmd.Parameters.AddWithValue("pressure", data.Pressure);
            cmd.Parameters.AddWithValue("building", data.Building);
            cmd.Parameters.AddWithValue("room", data.Room);

            await cmd.ExecuteNonQueryAsync();
        }

        public async Task<SensorData?> GetLatestAsync()
        {
            using var conn = new NpgsqlConnection(_connectionString);
            await conn.OpenAsync();

            var cmd = new NpgsqlCommand("SELECT id, timestamp, temperature, co2, pressure, building, room FROM sensor_data ORDER BY timestamp DESC LIMIT 1", conn);
            using var reader = await cmd.ExecuteReaderAsync();

            if (await reader.ReadAsync())
            {
                return new SensorData
                {
                    Id = reader.GetGuid(0),
                    Timestamp = reader.GetDateTime(1),
                    Temperature = reader.GetDouble(2),
                    Co2 = reader.GetDouble(3),
                    Pressure = reader.GetDouble(4),
                    Building = reader.GetString(5),
                    Room = reader.GetString(6)
                };
            }

            return null;
        }

        public async Task<List<SensorData>> GetRecentAsync(int count)
        {
            var list = new List<SensorData>();

            using var conn = new NpgsqlConnection(_connectionString);
            await conn.OpenAsync();

            var cmd = new NpgsqlCommand("SELECT id, timestamp, temperature, co2, pressure, building, room FROM sensor_data ORDER BY timestamp DESC LIMIT @count", conn);
            cmd.Parameters.AddWithValue("count", count);

            using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                list.Add(new SensorData
                {
                    Id = reader.GetGuid(0),
                    Timestamp = reader.GetDateTime(1),
                    Temperature = reader.GetDouble(2),
                    Co2 = reader.GetDouble(3),
                    Pressure = reader.GetDouble(4),
                    Building = reader.GetString(5),
                    Room = reader.GetString(6)
                });
            }

            return list;
        }
    }
}