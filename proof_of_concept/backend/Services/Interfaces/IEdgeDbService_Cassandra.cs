using EdgeMonitoringSystem.Models;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace EdgeMonitoringSystem.Services.Interfaces
{
    public interface IEdgeDbService_Cassandra
    {
        Task SaveAsync(SensorData data);
        Task<SensorData?> GetLatestAsync();
        Task<List<SensorData>> GetRecentAsync(int limit = 50);
    }
}
