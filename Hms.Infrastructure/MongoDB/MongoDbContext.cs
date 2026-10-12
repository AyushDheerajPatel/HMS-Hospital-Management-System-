
using Microsoft.Extensions.Configuration;
using MongoDB.Driver;

namespace Hms.Infrastructure.MongoDB;

public sealed class MongoDbContext
{
    private readonly SemaphoreSlim _indexLock = new(1, 1);
    private bool _indexesCreated;

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

        var client = new MongoClient(connectionString);
        var database = client.GetDatabase(databaseName);

        ClinicalRecords =
            database.GetCollection<ClinicalRecordDocument>(
                "clinical_records");
    }

    public async Task EnsureIndexesAsync(CancellationToken cancellationToken)
    {
        await _indexLock.WaitAsync(cancellationToken);
        try
        {
            if (_indexesCreated)
            {
                return;
            }

            var index = new CreateIndexModel<ClinicalRecordDocument>(
                Builders<ClinicalRecordDocument>.IndexKeys
                    .Ascending(x => x.TenantId)
                    .Ascending(x => x.PatientId)
                    .Descending(x => x.CreatedAtUtc),
                new CreateIndexOptions { Name = "ix_tenant_patient_created" });

            await ClinicalRecords.Indexes.CreateOneAsync(
                index,
                cancellationToken: cancellationToken);
            _indexesCreated = true;
        }
        finally
        {
            _indexLock.Release();
        }
    }
}
