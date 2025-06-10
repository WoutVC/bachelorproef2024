# Use official .NET SDK image to build the app
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /app

# Copy everything and restore dependencies
COPY . ./
RUN dotnet restore "./EdgeMonitoringSystem.csproj"
RUN dotnet publish "./EdgeMonitoringSystem.csproj" -c Release -o /out/publish

# Use runtime image to run the app
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
COPY --from=build /out/publish .

# Expose port
EXPOSE 80

ENTRYPOINT ["dotnet", "EdgeMonitoringSystem.dll"]