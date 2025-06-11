using EdgeMonitoringSystem.Services;
using EdgeMonitoringSystem.Services.Interfaces;

var builder = WebApplication.CreateBuilder(args);

builder.Logging.ClearProviders();
builder.Logging.AddConsole();

builder.Services.AddControllers();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowReactApp", policy =>
    {
        policy.WithOrigins("http://localhost:3000")
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

builder.Services.AddSingleton<ICentralMongoDbService, CentralMongoDbService>();
builder.Services.AddSingleton<ICentralCassandraDbService, CentralCassandraDbService>();
builder.Services.AddSingleton<ICentralTimescaleDbService, CentralTimescaleDbService>();

builder.Services.AddSingleton<IEdgeDbService_Cassandra, EdgeDbService_Cassandra>();
builder.Services.AddSingleton<IEdgeDbService_Mongo, EdgeDbService_Mongo>();
builder.Services.AddSingleton<IEdgeDbService_Timescale, EdgeDbService_Timescale>();

builder.WebHost.UseUrls("http://localhost:5001");

var app = builder.Build();

app.UseCors("AllowReactApp");

app.UseAuthorization();
app.MapControllers();

app.Run();