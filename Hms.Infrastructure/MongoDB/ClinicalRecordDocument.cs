using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace Hms.Infrastructure.MongoDB;

public sealed class ClinicalRecordDocument
{
    [BsonId]
    [BsonRepresentation(BsonType.String)]
    public string Id { get; set; } = Guid.NewGuid().ToString();

    [BsonGuidRepresentation(GuidRepresentation.Standard)]
    public Guid TenantId { get; set; }

    [BsonGuidRepresentation(GuidRepresentation.Standard)]
    public Guid PatientId { get; set; }

    public string Diagnosis { get; set; } = string.Empty;

    public string Notes { get; set; } = string.Empty;

    public List<string> Medications { get; set; } = [];

    public List<string> Allergies { get; set; } = [];

    public string MedicalHistory { get; set; } = string.Empty;

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}