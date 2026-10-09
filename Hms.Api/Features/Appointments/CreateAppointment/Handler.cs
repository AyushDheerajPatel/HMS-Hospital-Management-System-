using Hms.Api.Infrastructure.Errors;
using Hms.Api.Infrastructure.Tenancy;
using Hms.Domain.Appointments;
using Hms.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Hms.Api.Features.Appointments.CreateAppointment;

public sealed class Handler
{
    private readonly HmsDbContext _dbContext;
    private readonly ITenantContext _tenantContext;

    public Handler(
        HmsDbContext dbContext,
        ITenantContext tenantContext)
    {
        _dbContext = dbContext;
        _tenantContext = tenantContext;
    }

    public async Task<Appointment> HandleAsync(Command command)
    {
        var tenantId = _tenantContext.TenantId;

        if (tenantId is null)
        {
            throw new ValidationException(
                "Tenant context is required.");
        }

        if (command.ScheduledAtUtc <= DateTime.UtcNow)
        {
            throw new ValidationException(
                "Appointment must be scheduled in the future.");
        }

        if (string.IsNullOrWhiteSpace(command.Reason))
        {
            throw new ValidationException(
                "Appointment reason is required.");
        }

        var patientExists = await _dbContext.Patients
            .AnyAsync(x =>
                x.Id == command.PatientId &&
                x.TenantId == tenantId.Value);

        if (!patientExists)
        {
            throw new ValidationException(
                "Patient not found.");
        }

        var appointment = new Appointment(
            Guid.NewGuid(),
            tenantId.Value,
            command.PatientId,
            command.ScheduledAtUtc,
            command.Reason.Trim());

        _dbContext.Appointments.Add(appointment);

        await _dbContext.SaveChangesAsync();

        return appointment;
    }
}