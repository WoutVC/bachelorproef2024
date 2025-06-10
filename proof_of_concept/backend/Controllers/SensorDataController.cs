using Microsoft.AspNetCore.Mvc;
using EdgeMonitoringSystem.Models;
using EdgeMonitoringSystem.Services.Interfaces;

namespace EdgeMonitoringSystem.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class SensorDataController : ControllerBase
    {
        private readonly ICentralMongoDbService _centralMongoService;
        private readonly ICentralCassandraDbService _centralCassandraService;
        private readonly ICentralTimescaleDbService _centralTimescaleService;

        private readonly IEdgeDbService_Mongo _edgeMongoService;
        private readonly IEdgeDbService_Cassandra _edgeCassandraService;
        private readonly IEdgeDbService_Timescale _edgeTimescaleService;

        public SensorDataController(
            ICentralMongoDbService centralMongo,
            ICentralCassandraDbService centralCassandra,
            ICentralTimescaleDbService centralTimescale,
            IEdgeDbService_Mongo edgeMongo,
            IEdgeDbService_Cassandra edgeCassandra,
            IEdgeDbService_Timescale edgeTimescale)
        {
            _centralMongoService = centralMongo;
            _centralCassandraService = centralCassandra;
            _centralTimescaleService = centralTimescale;

            _edgeMongoService = edgeMongo;
            _edgeCassandraService = edgeCassandra;
            _edgeTimescaleService = edgeTimescale;
        }

        // POST: api/sensordata
        [HttpPost]
        public async Task<IActionResult> PostData([FromBody] SensorData data)
        {
            if (string.IsNullOrWhiteSpace(data.Building))
                return BadRequest("Building is required.");

            if (data.Building == "GebouwA")
            {
                await _centralMongoService.SaveAsync(data);
                await _centralCassandraService.SaveAsync(data);
                await _centralTimescaleService.SaveAsync(data);
            }
            else if (data.Building == "GebouwB")
            {
                await _edgeMongoService.SaveAsync(data);
                await _edgeCassandraService.SaveAsync(data);
                await _edgeTimescaleService.SaveAsync(data);
            }
            else
            {
                return BadRequest("Unknown building.");
            }

            return Ok();
        }

        // GET: api/sensordata/latest?building=GebouwA&type=mongo
        [HttpGet("latest")]
        public async Task<ActionResult<SensorData>> GetLatest([FromQuery] string building, [FromQuery] string type)
        {
            return type.ToLower() switch
            {
                "mongo" => Ok(building == "GebouwA"
                    ? await _centralMongoService.GetLatestAsync()
                    : await _edgeMongoService.GetLatestAsync()),

                "cassandra" => Ok(building == "GebouwA"
                    ? await _centralCassandraService.GetLatestAsync()
                    : await _edgeCassandraService.GetLatestAsync()),

                "timescale" => Ok(building == "GebouwA"
                    ? await _centralTimescaleService.GetLatestAsync()
                    : await _edgeTimescaleService.GetLatestAsync()),

                _ => BadRequest("Invalid type")
            };
        }

        // GET: api/sensordata/recent?building=GebouwB&type=timescale&count=20
        [HttpGet("recent")]
        public async Task<ActionResult<IEnumerable<SensorData>>> GetRecent([FromQuery] string building, [FromQuery] string type, [FromQuery] int count = 10)
        {
            return type.ToLower() switch
            {
                "mongo" => Ok(building == "GebouwA"
                    ? await _centralMongoService.GetRecentAsync(count)
                    : await _edgeMongoService.GetRecentAsync(count)),

                "cassandra" => Ok(building == "GebouwA"
                    ? await _centralCassandraService.GetRecentAsync(count)
                    : await _edgeCassandraService.GetRecentAsync(count)),

                "timescale" => Ok(building == "GebouwA"
                    ? await _centralTimescaleService.GetRecentAsync(count)
                    : await _edgeTimescaleService.GetRecentAsync(count)),

                _ => BadRequest("Invalid type")
            };
        }
    }
}