using Hms.Api.Features.Appointments.CreateAppointment;
using Hms.Domain.Appointments;
using Xunit;

namespace Hms.Api.Tests;

public sealed class OfflineAppointmentIdempotencyTests
{
    [Fact]
    public void Retry_with_same_operation_payload_is_recognized()
    {
        var scheduledAt = NormalizeToPostgresPrecision(
            DateTime.UtcNow.AddDays(1));
        var tenantId = Guid.NewGuid();
        var patientId = Guid.NewGuid();
        var doctorId = Guid.NewGuid();
        var operationId = Guid.NewGuid();
        var receipt = new AppointmentOperation(
            tenantId,
            operationId,
            Guid.NewGuid(),
            patientId,
            doctorId,
            scheduledAt,
            "Annual check-up",
            DateTime.UtcNow);
        var retry = new Command(
            patientId,
            doctorId,
            scheduledAt,
            "  Annual check-up  ",
            operationId);

        Assert.True(Handler.IsSameOperation(receipt, retry));
    }

    [Fact]
    public void Reusing_operation_id_for_different_payload_is_not_recognized()
    {
        var scheduledAt = NormalizeToPostgresPrecision(
            DateTime.UtcNow.AddDays(1));
        var tenantId = Guid.NewGuid();
        var patientId = Guid.NewGuid();
        var doctorId = Guid.NewGuid();
        var operationId = Guid.NewGuid();
        var receipt = new AppointmentOperation(
            tenantId,
            operationId,
            Guid.NewGuid(),
            patientId,
            doctorId,
            scheduledAt,
            "Annual check-up",
            DateTime.UtcNow);

        Assert.False(Handler.IsSameOperation(
            receipt,
            new Command(Guid.NewGuid(), doctorId, scheduledAt, "Annual check-up", operationId)));
        Assert.False(Handler.IsSameOperation(
            receipt,
            new Command(patientId, doctorId, scheduledAt, "Annual check-up", Guid.NewGuid())));
        Assert.False(Handler.IsSameOperation(
            receipt,
            new Command(patientId, doctorId, scheduledAt.AddHours(1), "Annual check-up", operationId)));
        Assert.False(Handler.IsSameOperation(
            receipt,
            new Command(patientId, doctorId, scheduledAt, "Different reason", operationId)));
        Assert.False(Handler.IsSameOperation(
            receipt,
            new Command(patientId, doctorId, scheduledAt, "Annual check-up")));
    }

    private static DateTime NormalizeToPostgresPrecision(DateTime value) =>
        new(value.Ticks - value.Ticks % 10, DateTimeKind.Utc);
}
