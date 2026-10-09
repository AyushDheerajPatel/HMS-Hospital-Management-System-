using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Hms.Infrastructure.MongoDB;

public sealed class ClinicalRecordDocument
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public string Id { get; set; } = Guid.NewGuid().ToString();

    public Guid TenantId { get; set; }

    public Guid PatientId { get; set; }

    public string Diagnosis { get; set; } = string.Empty;

    public string Notes { get; set; } = string.Empty;

    public List<string> Medications { get; set; } = [];

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
}