using MongoDB.Driver;
using EdgeMonitoringSystem.Models;
using EdgeMonitoringSystem.Services.Interfaces;

namespace EdgeMonitoringSystem.Services
{
    public class CentralMongoDbService : ICentralMongoDbService
    {
        private readonly IMongoCollection<SensorData> _collection;

        public CentralMongoDbService(IConfiguration configuration)
        {
            var client = new MongoClient(configuration.GetConnectionString("CentralDb_Mongo"));
            var database = client.GetDatabase("centraldb");
            _collection = database.GetCollection<SensorData>("sensor_data");

        }

        public async Task SaveAsync(SensorData data)
        {
            if (data.Id == Guid.Empty)
                data.Id = Guid.NewGuid();

            data.Building = "GebouwA";

            if (string.IsNullOrEmpty(data.Room))
            {
                var roomNumber = new Random().Next(101, 111);
                data.Room = $"A{roomNumber}";
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