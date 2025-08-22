using MongoDB.Driver;
using EdgeMonitoringSystem.Models;
using EdgeMonitoringSystem.Services.Interfaces;

namespace EdgeMonitoringSystem.Services
{
    public class EdgeDbService_Mongo : IEdgeDbService_Mongo
    {
        private readonly IMongoCollection<SensorData> _collection;

        public EdgeDbService_Mongo(IConfiguration configuration)
        {
            var client = new MongoClient(configuration.GetConnectionString("EdgeDb_Mongo"));
            var database = client.GetDatabase("edge_range_partitioning");
            _collection = database.GetCollection<SensorData>("sensor_data");

        }

        public async Task SaveAsync(SensorData data)
        {
            if (data.Id == Guid.Empty)
                data.Id = Guid.NewGuid();
            data.Building = "GebouwB";

            if (string.IsNullOrEmpty(data.Room))
            {
                var roomNumber = new Random().Next(101, 111);
                data.Room = $"B{roomNumber}";
            }

            await _collection.InsertOneAsync(data);
        }

        public async Task<SensorData?> GetLatestAsync()
        {
            return await _collection.Find(FilterDefinition<SensorData>.Empty)
                                    .SortByDescending(d => d.Timestamp)
                                    .FirstOrDefaultAsync();
        }

        public async Task<List<SensorData>> GetRecentAsync(int count)
        {
            return await _collection.Find(FilterDefinition<SensorData>.Empty)
                                    .SortByDescending(d => d.Timestamp)
                                    .Limit(count)
                                    .ToListAsync();
        }
    }
}