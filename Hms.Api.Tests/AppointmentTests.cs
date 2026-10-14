using Hms.Domain.Appointments;
using Xunit;

namespace Hms.Api.Tests;

public sealed class AppointmentTests
{
    [Fact]
    public void Appointment_mutations_increment_version()
    {
        var appointment = new Appointment(
            Guid.NewGuid(),
            Guid.NewGuid(),
            Guid.NewGuid(),
            DateTime.UtcNow.AddDays(1),
            "Initial visit");

        Assert.Equal(1, appointment.Version);

        appointment.UpdateDetails(
            Guid.NewGuid(),
            DateTime.UtcNow.AddDays(2),
            "Follow-up");
        Assert.Equal(2, appointment.Version);

        appointment.Reschedule(DateTime.UtcNow.AddDays(3));
        Assert.Equal(3, appointment.Version);

        appointment.ChangeStatus("cancelled");
        Assert.Equal(4, appointment.Version);
        Assert.Equal("cancelled", appointment.Status);
    }

    [Fact]
    public void Appointment_status_only_allows_one_terminal_transition()
    {
        var appointment = new Appointment(
            Guid.NewGuid(),
            Guid.NewGuid(),
            Guid.NewGuid(),
            DateTime.UtcNow.AddDays(1),
            "Initial visit");

        appointment.ChangeStatus("completed");

        Assert.Equal("completed", appointment.Status);
        Assert.Throws<InvalidOperationException>(
            () => appointment.ChangeStatus("cancelled"));
        Assert.Throws<ArgumentException>(
            () => appointment.ChangeStatus("scheduled"));
        Assert.Equal(2, appointment.Version);
    }
}
