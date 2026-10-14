using Hms.Infrastructure.MongoDB;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;
using Xunit;

namespace Hms.Api.Tests;

public sealed class ClinicalRecordSerializationTests
{
    [Fact]
    public void Clinical_record_serializes_tenant_and_patient_guids_as_standard_uuid()
    {
        var tenantId = Guid.NewGuid();
        var patientId = Guid.NewGuid();
        var document = new ClinicalRecordDocument
        {
            TenantId = tenantId,
            PatientId = patientId
        };

        var bson = document.ToBsonDocument();

        Assert.Equal(
            new BsonBinaryData(tenantId, GuidRepresentation.Standard),
            bson[nameof(ClinicalRecordDocument.TenantId)]);
        Assert.Equal(
            new BsonBinaryData(patientId, GuidRepresentation.Standard),
            bson[nameof(ClinicalRecordDocument.PatientId)]);

        var roundTripped = BsonSerializer.Deserialize<ClinicalRecordDocument>(bson);
        Assert.Equal(tenantId, roundTripped.TenantId);
        Assert.Equal(patientId, roundTripped.PatientId);
    }
}
