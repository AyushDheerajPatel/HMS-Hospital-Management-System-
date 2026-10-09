
using Microsoft.Extensions.Configuration;
using MongoDB.Driver;

namespace Hms.Infrastructure.MongoDB;

public sealed class MongoDbContext
{
    public IMongoCollection<ClinicalRecordDocument> ClinicalRecords { get; }

    public MongoDbContext(IConfiguration configuration)
    {
        var connectionString =
            configuration["MongoDb:ConnectionString"]
            ?? throw new InvalidOperationException(
                "MongoDB connection string is missing.");

        var databaseName =
            configuration["MongoDb:DatabaseName"]
            ?? throw new InvalidOperationException(
                "MongoDB database name is missing.");

        var mongoUri = new MongoUrl(connectionString);

        Console.WriteLine(
            $"MongoDB host: {mongoUri.Server.Host}, port: {mongoUri.Server.Port}");
        Console.WriteLine($"MongoDB username: {mongoUri.Username}");
        Console.WriteLine($"MongoDB auth database: {mongoUri.AuthenticationSource}");
        Console.WriteLine($"MongoDB auth mechanism: {mongoUri.AuthenticationMechanism}");

        var client = new MongoClient(connectionString);
        var database = client.GetDatabase(databaseName);

        ClinicalRecords =
            database.GetCollection<ClinicalRecordDocument>(
                "clinical_records");
    }
}
